// Hodric's Castle Gauntlet: full-Sim behavior of the race. Queue guards,
// practice fields, bot backfill, the countdown rope, live race physics
// (launches, platform carry, kill-plane respawns), finishing, placements,
// standings, the return trip, and run-twice determinism.

import { describe, expect, it } from 'vitest';
import { DUNGEON_X_THRESHOLD, hodricsOrigin, isHodricsPos } from '../src/sim/data';
import {
  HC_DRAWSPANS,
  HC_FLAILS,
  hcCheckpointSpawn,
  hcDrawspanX,
  hcFlailBob,
} from '../src/sim/hodrics_layout';
import { Sim } from '../src/sim/sim';
import { HC_BOT_BACKFILL_WAIT, HC_COUNTDOWN, HC_RETURN_DELAY } from '../src/sim/social/hodrics';
import { DT, type SimEvent, TICK_RATE } from '../src/sim/types';

function makeSim(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function ff(sim: Sim, ticks: number, sink?: SimEvent[]): void {
  for (let i = 0; i < ticks; i++) {
    const evs = sim.tick();
    if (sink) sink.push(...evs);
  }
}

function place(sim: Sim, pid: number, x: number, z: number, y?: number): void {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  if (y !== undefined) e.pos.y = y;
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

// Practice field up and racing: returns the local pid once the match is active.
function startActiveRace(sim: Sim, sink: SimEvent[]): number {
  const pid = sim.addPlayer('warrior', 'Racer');
  expect(sim.hcPracticeStart()).toBe(true);
  ff(sim, 1, sink); // matchmake pass seats the field
  expect(sim.hcMatches.get(pid)).toBeTruthy();
  ff(sim, HC_COUNTDOWN * TICK_RATE + 2, sink);
  expect(sim.hcMatches.get(pid)!.state).toBe('active');
  return pid;
}

describe('queue guards', () => {
  it('refuses the dead, the instanced, and the Coliseum-queued', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Guard');
    const e = sim.entities.get(pid)!;

    e.dead = true;
    sim.hcQueueJoin(pid);
    expect(sim.hcQueue).toHaveLength(0);
    e.dead = false;

    place(sim, pid, DUNGEON_X_THRESHOLD + 50, -1250);
    sim.hcQueueJoin(pid);
    expect(sim.hcQueue).toHaveLength(0);
    place(sim, pid, 0, 660);

    sim.arenaQueueJoin(pid, '1v1');
    sim.hcQueueJoin(pid);
    expect(sim.hcQueue).toHaveLength(0);
    sim.arenaQueueLeave(pid);

    sim.hcQueueJoin(pid);
    expect(sim.hcQueue).toHaveLength(1);
    sim.hcQueueLeave(pid);
    expect(sim.hcQueue).toHaveLength(0);
  });

  it('a level 1 character may race: there is no level gate', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('mage', 'Fresh');
    expect(sim.entities.get(pid)!.level).toBe(1);
    sim.hcQueueJoin(pid);
    expect(sim.hcQueue).toHaveLength(1);
  });
});

describe('practice race, end to end', () => {
  it('seats ten, holds the rope, races, finishes, scores, returns', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = sim.addPlayer('warrior', 'Racer');
    const preQueue = { ...sim.entities.get(pid)!.pos };

    expect(sim.hcPracticeStart()).toBe(true);
    ff(sim, 1, events);
    const match = sim.hcMatches.get(pid)!;
    expect(match).toBeTruthy();
    expect(match.state).toBe('countdown');
    expect(match.racers.size).toBe(10);
    expect(events.some((ev) => ev.type === 'hcFound')).toBe(true);

    // Everyone teleported to the start plates in the race band.
    const origin = hodricsOrigin(match.slot);
    for (const racer of match.racers.values()) {
      const e = sim.entities.get(racer.pid)!;
      expect(isHodricsPos(e.pos.x)).toBe(true);
      expect(e.pos.z - origin.z).toBeLessThan(-90);
    }

    // The rope: mash forward during the countdown, never pass the yard mouth.
    const meta = sim.players.get(pid)!;
    const me = sim.entities.get(pid)!;
    me.facing = 0;
    meta.moveInput.forward = true;
    ff(sim, HC_COUNTDOWN * TICK_RATE - 10, events);
    expect(match.state).toBe('countdown');
    expect(me.pos.z - origin.z).toBeLessThanOrEqual(-85.9);
    ff(sim, 12, events);
    expect(match.state).toBe('active');
    expect(events.some((ev) => ev.type === 'hcStart')).toBe(true);
    meta.moveInput.forward = false;

    // Let the court race for 100 seconds: bots make real progress, obstacles
    // land real hits, checkpoints bank, and the quick finish.
    ff(sim, 100 * TICK_RATE, events);
    for (const racer of match.racers.values()) {
      if (racer.bot) expect(racer.furthestZ).toBeGreaterThan(-90);
    }
    expect(events.some((ev) => ev.type === 'hcKnocked')).toBe(true);
    expect(events.some((ev) => ev.type === 'hcCheckpoint')).toBe(true);
    expect(events.filter((ev) => ev.type === 'hcFinish').length).toBeGreaterThan(0);

    // Walk the human over the line: every human done ends the race.
    place(sim, pid, origin.x, origin.z + 116, 13);
    me.facing = 0;
    meta.moveInput.forward = true;
    ff(sim, 3 * TICK_RATE, events);
    meta.moveInput.forward = false;
    const myFinish = events.find((ev) => ev.type === 'hcFinish' && ev.pid === pid);
    expect(myFinish).toBeTruthy();
    const end = events.find((ev) => ev.type === 'hcEnd' && ev.pid === pid);
    expect(end).toBeTruthy();
    if (end?.type === 'hcEnd') {
      expect(end.field).toHaveLength(10);
      const places = end.field.map((r) => r.place).sort((a, b) => a - b);
      expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
    expect(sim.players.get(pid)!.hcRaces).toBe(1);

    // Aftermath, then everyone goes home and the slot frees.
    ff(sim, HC_RETURN_DELAY * TICK_RATE + 5, events);
    expect(sim.hcMatches.size).toBe(0);
    expect(me.pos.x).toBeCloseTo(preQueue.x, 0);
    expect(me.pos.z).toBeCloseTo(preQueue.z, 0);
  }, 30000);
});

describe('race physics', () => {
  it('a flail launches the racer on a ballistic arc', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = startActiveRace(sim, events);
    const match = sim.hcMatches.get(pid)!;
    const origin = hodricsOrigin(match.slot);
    const f = HC_FLAILS[0];
    let knocked = false;
    for (let i = 0; i < 120 && !knocked; i++) {
      const bob = hcFlailBob(f, sim.time + DT);
      place(sim, pid, origin.x + bob.x, origin.z + f.z, 0);
      const evs = sim.tick();
      knocked = evs.some((ev) => ev.type === 'hcKnocked' && ev.pid === pid);
    }
    expect(knocked).toBe(true);
    const me = sim.entities.get(pid)!;
    expect(me.onGround).toBe(false);
    expect(Math.abs(me.vx) + Math.abs(me.vy)).toBeGreaterThan(3);
  }, 20000);

  it('falling into the chasm respawns at the checkpoint with a fall banked', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = startActiveRace(sim, events);
    const match = sim.hcMatches.get(pid)!;
    const origin = hodricsOrigin(match.slot);
    // Between the two Drawspan platforms: no floor, no platform, only sky.
    place(sim, pid, origin.x, origin.z + 68, 0);
    const sink: SimEvent[] = [];
    ff(sim, 3 * TICK_RATE, sink);
    expect(sink.some((ev) => ev.type === 'hcFall' && ev.pid === pid)).toBe(true);
    const racer = match.racers.get(pid)!;
    expect(racer.falls).toBe(1);
    const me = sim.entities.get(pid)!;
    const spawn = hcCheckpointSpawn(racer.checkpoint, racer.seat);
    expect(me.pos.z - origin.z).toBeCloseTo(spawn.z, 1);
    expect(me.onGround).toBe(true);
  }, 20000);

  it('the Drawspan carries a standing racer with the platform', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = startActiveRace(sim, events);
    const match = sim.hcMatches.get(pid)!;
    const origin = hodricsOrigin(match.slot);
    const d = HC_DRAWSPANS[0];
    const px0 = hcDrawspanX(d, sim.time);
    place(sim, pid, origin.x + px0, origin.z + d.zCenter, d.y);
    ff(sim, TICK_RATE); // one second of riding
    const me = sim.entities.get(pid)!;
    const pxNow = hcDrawspanX(d, sim.time);
    expect(me.onGround).toBe(true);
    expect(me.pos.y).toBeCloseTo(d.y, 3);
    // Carried: the racer tracks the platform's travel, not their drop point.
    expect(me.pos.x - origin.x).toBeCloseTo(pxNow, 0);
    expect(Math.abs(pxNow - px0)).toBeGreaterThan(1);
  }, 20000);

  it('abilities are barred mid-race, through every cast entry point', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = startActiveRace(sim, events);
    const meta = sim.players.get(pid)!;
    const known = meta.known[0]?.def.id;
    expect(known).toBeTruthy();

    const before = sim.entities.get(pid)!.castingAbility;
    sim.castAbility(known!, pid);
    expect(sim.entities.get(pid)!.castingAbility).toBe(before);

    // The hotbar is the primary way a real player casts; it must funnel
    // through the same guard, not just the named /cast entry point.
    const slot = meta.known.findIndex((k) => k.def.id === known);
    sim.castAbilityBySlot(slot, pid);
    expect(sim.entities.get(pid)!.castingAbility).toBe(before);

    // Ground-targeted casts (offline, the local player only) share the guard too.
    sim.primaryId = pid;
    sim.castAbilityAt(known!, { x: 0, z: 0 });
    expect(sim.entities.get(pid)!.castingAbility).toBe(before);
  }, 20000);
});

describe('practice toggle', () => {
  it('a fast start-then-stop before any tick releases the player from the queue', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Impatient');
    expect(sim.hcPracticeStart()).toBe(true);
    // Toggle off with zero ticks elapsed: matchmaking has not run yet, so the
    // player is still queued, not matched. Regression for a bug where
    // stopHcPractice only released the bots, leaving the human stuck.
    expect(sim.hcPracticeStart()).toBe(false);
    expect(sim.hcQueue.some((u) => u.pid === pid)).toBe(false);
    expect(sim.hcMatches.has(pid)).toBe(false);
    expect(sim.hcPracticeBotPids).toHaveLength(0);
    // A fresh practice start still works afterward (queue is genuinely clean).
    expect(sim.hcPracticeStart()).toBe(true);
    expect(sim.hcQueue.some((u) => u.pid === pid)).toBe(true);
  });

  it('stopping mid-race (after matchmaking) tears down the whole match', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'QuickQuitter');
    sim.hcPracticeStart();
    ff(sim, 1); // let matchmaking seat the full field
    expect(sim.hcMatches.has(pid)).toBe(true);
    sim.hcPracticeStart(); // toggles off (hcPracticeActive is true: bots exist)
    expect(sim.hcMatches.has(pid)).toBe(false);
    expect(sim.hcQueue.some((u) => u.pid === pid)).toBe(false);
    expect(sim.hcPracticeBotPids).toHaveLength(0);
    expect([...sim.players.values()].some((m) => m.isHcBot === true)).toBe(false);
  });
});

describe('mid-race save and reload', () => {
  it('serializes hcReturnPos while racing and relocates there on reload', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = startActiveRace(sim, events);
    const preQueuePos = sim.hcMatches.get(pid)!.returns.get(pid)!;

    // Save mid-race: the character's live pos is deep in the race band, but
    // the persisted CharacterState must never resume a reload there.
    const state = sim.serializeCharacter(pid)!;
    expect(state.pos.x).toBeGreaterThan(10000); // inside the Hodric's band
    expect(state.hcReturnPos).toEqual(preQueuePos);

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', 'Reloaded', { state });
    const e2 = sim2.entities.get(pid2)!;
    expect(isHodricsPos(e2.pos.x)).toBe(false);
    expect(e2.pos.x).toBeCloseTo(preQueuePos.x, 0);
    expect(e2.pos.z).toBeCloseTo(preQueuePos.z, 0);
  }, 20000);

  it('falls back to the world start when no return position was ever recorded', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Ghost');
    // A character saved mid-race with no hcReturnPos on file (e.g. an older
    // save format) must not relocate INTO the race band on reload.
    const state = sim.serializeCharacter(pid)!;
    state.pos = { x: 11100, z: -1250 };
    state.hcReturnPos = undefined;

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', 'Ghost2', { state });
    const e2 = sim2.entities.get(pid2)!;
    expect(isHodricsPos(e2.pos.x)).toBe(false);
  });
});

describe('disconnect right after finishing', () => {
  it('credits the win the instant you cross the line, not at match end', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = startActiveRace(sim, events);
    const match = sim.hcMatches.get(pid)!;
    const origin = hodricsOrigin(match.slot);

    // Walk the human over the line while the other 9 bots are still racing
    // the earlier sections (a race can run up to HC_MAX_DURATION seconds).
    place(sim, pid, origin.x, origin.z + 116, 13);
    const meta = sim.players.get(pid)!;
    sim.entities.get(pid)!.facing = 0;
    meta.moveInput.forward = true;
    ff(sim, 3 * TICK_RATE, events);
    expect(events.some((ev) => ev.type === 'hcFinish' && ev.pid === pid)).toBe(true);
    // The lone human finishing ends practice immediately (nothing left to
    // wait for but bots); endHcMatch's own crediting loop now skips
    // already-finished racers entirely, so this can only be the finish-time
    // credit, which is exactly what the fix adds.
    expect(sim.players.get(pid)!.hcWins).toBe(1);
    expect(sim.players.get(pid)!.hcRaces).toBe(1);

    // Disconnecting immediately must not claw the win back or crash the
    // still-running match for the rest of the field.
    sim.removePlayer(pid);
    expect(sim.hcMatches.has(pid)).toBe(false);
    expect(() => ff(sim, 60 * TICK_RATE)).not.toThrow();
  }, 20000);
});

describe('backfill', () => {
  it('fills a lone queuer to a full field after the wait, then reaps the bots', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('rogue', 'Loner');
    sim.hcQueueJoin(pid);
    ff(sim, (HC_BOT_BACKFILL_WAIT - 2) * TICK_RATE);
    expect(sim.hcMatches.size).toBe(0);
    ff(sim, 3 * TICK_RATE);
    const match = sim.hcMatches.get(pid)!;
    expect(match).toBeTruthy();
    expect(match.racers.size).toBe(10);
    expect([...match.racers.values()].filter((r) => r.bot)).toHaveLength(9);

    // Finish immediately: the lone human done ends the race.
    ff(sim, HC_COUNTDOWN * TICK_RATE + 2);
    const origin = hodricsOrigin(match.slot);
    place(sim, pid, origin.x, origin.z + 116, 13);
    const meta = sim.players.get(pid)!;
    sim.entities.get(pid)!.facing = 0;
    meta.moveInput.forward = true;
    ff(sim, 3 * TICK_RATE);
    expect(match.state).toBe('over');
    ff(sim, (HC_RETURN_DELAY + 2) * TICK_RATE);
    // Every fill bot left the world once the race returned.
    const botsLeft = [...sim.players.values()].filter((m) => m.isHcBot === true);
    expect(botsLeft).toHaveLength(0);
  }, 30000);
});

describe('the Gauntlet Herald', () => {
  it('is spawned guarded at world init with the reserved id', () => {
    const sim = makeSim();
    const npc = sim.entities.get(1_000_000_100)!;
    expect(npc).toBeTruthy();
    expect(npc.kind).toBe('npc');
    expect(npc.templateId).toBe('hodrics_herald');
    // A second Sim never collides with him (guarded spawn, no nextId churn).
    const sim2 = makeSim();
    expect(sim2.entities.get(1_000_000_100)!.templateId).toBe('hodrics_herald');
  });

  it('talking to him opens the race window instead of quest dialog', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Walker');
    const herald = sim.entities.get(1_000_000_100)!;
    place(sim, pid, herald.pos.x + 1, herald.pos.z);
    sim.interact(pid);
    const evs = sim.tick();
    expect(evs.some((ev) => ev.type === 'hodricsWindow' && ev.pid === pid)).toBe(true);
  });

  it('targeted interact (already-targeted path) also opens the window', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Walker2');
    const herald = sim.entities.get(1_000_000_100)!;
    place(sim, pid, herald.pos.x + 1, herald.pos.z);
    sim.entities.get(pid)!.targetId = herald.id;
    sim.interact(pid);
    const evs = sim.tick();
    expect(evs.some((ev) => ev.type === 'hodricsWindow' && ev.pid === pid)).toBe(true);
  });
});

describe('determinism', () => {
  it('same seed, same script, identical race', () => {
    const run = () => {
      const sim = makeSim();
      const pid = sim.addPlayer('warrior', 'Racer');
      sim.hcPracticeStart();
      const trace: string[] = [];
      for (let i = 0; i < 45 * TICK_RATE; i++) {
        sim.tick();
        if (i % 100 === 0) {
          for (const [id, e] of sim.entities) {
            if (sim.players.has(id))
              trace.push(`${i}:${id}:${e.pos.x.toFixed(4)}:${e.pos.z.toFixed(4)}`);
          }
        }
      }
      void pid;
      return trace.join('|');
    };
    expect(run()).toBe(run());
  }, 40000);
});
