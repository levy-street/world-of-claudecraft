// Hodric's Castle Gauntlet: full-Sim behavior of the three-round elimination
// show. Queue guards, practice fields, bot backfill, the countdown rope, live
// race physics on GENERATED courses (launches, platform carry, spinner carry,
// piston rams, kill-plane respawns), qualification and elimination, the
// spectator gallery, the crown, placements, standings, and the return trip.

import { describe, expect, it } from 'vitest';
import { DUNGEON_X_THRESHOLD, hodricsOrigin, isHodricsPos } from '../src/sim/data';
import {
  type HcCourse,
  hcCourseFor,
  hodricsGroundLocal,
  setActiveHodricsCourse,
} from '../src/sim/hodrics_course';
import { hcDrawspanX, hcFlailBob } from '../src/sim/hodrics_layout';
import { Sim } from '../src/sim/sim';
import {
  HC_BOT_BACKFILL_WAIT,
  HC_COUNTDOWN,
  HC_INTERMISSION,
  HC_RETURN_DELAY,
  type HcMatch,
  hcQualifyTarget,
} from '../src/sim/social/hodrics';
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

// Practice field up and racing: returns the local pid once round 1 is active.
function startActiveRace(sim: Sim, sink: SimEvent[]): number {
  const pid = sim.addPlayer('warrior', 'Racer');
  expect(sim.hcPracticeStart()).toBe(true);
  ff(sim, 1, sink); // matchmake pass seats the field
  expect(sim.hcMatches.get(pid)).toBeTruthy();
  ff(sim, HC_COUNTDOWN * TICK_RATE + 2, sink);
  expect(sim.hcMatches.get(pid)!.state).toBe('active');
  return pid;
}

// Teleport a racer just past the current course's line; the next physics
// tick banks the finish.
function crossLine(sim: Sim, match: HcMatch, pid: number): void {
  const origin = hodricsOrigin(match.slot);
  place(sim, pid, origin.x, origin.z + match.course.finishZ + 1.5, match.course.finishY);
}

// Fast-resolve the current round: cross exactly the qualify target and tick
// until the round resolves.
function winRound(sim: Sim, pid: number, sink: SimEvent[]): void {
  const match = sim.hcMatches.get(pid)!;
  const target = hcQualifyTarget(match);
  crossLine(sim, match, pid);
  ff(sim, 2, sink);
  const alive = [...match.racers.values()].filter(
    (r) => !r.left && r.eliminatedRound === 0 && !r.finished,
  );
  for (let i = 0; i < target - 1 && i < alive.length; i++) {
    crossLine(sim, match, alive[i].pid);
    ff(sim, 2, sink);
  }
  ff(sim, 5, sink);
}

// Ride out the intermission and the next countdown into the next active round.
function throughIntermission(sim: Sim, pid: number, sink: SimEvent[]): void {
  ff(sim, HC_INTERMISSION * TICK_RATE + 2, sink);
  const match = sim.hcMatches.get(pid)!;
  expect(match.state).toBe('countdown');
  ff(sim, HC_COUNTDOWN * TICK_RATE + 2, sink);
  expect(match.state).toBe('active');
}

// A generated course containing the wanted obstacle family (deterministic
// seed hunt; the generator is pure so this is stable forever).
function findCourseWith(
  kind: 'drawspans' | 'rotors' | 'spinners' | 'pushers' | 'flails',
  diff = 0,
): HcCourse {
  for (let seed = 1; seed < 500; seed++) {
    const c = hcCourseFor((seed * 2718281) >>> 0, diff);
    if ((c[kind] as unknown[]).length > 0) return c;
  }
  throw new Error(`no generated course carries ${kind}`);
}

// Swap the live match onto a specific course (tests only): the match module
// reads match.course every tick, and the registry write keeps the base sim's
// ground/collider routing in step.
function swapCourse(sim: Sim, match: HcMatch, course: HcCourse): void {
  match.course = course;
  match.courseSeed = course.seed;
  setActiveHodricsCourse(match.slot, course);
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

describe('the full three-round show', () => {
  it('races, qualifies, eliminates to the gallery, rebuilds, and crowns', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = sim.addPlayer('warrior', 'Racer');
    const preQueue = { ...sim.entities.get(pid)!.pos };

    expect(sim.hcPracticeStart()).toBe(true);
    ff(sim, 1, events);
    const match = sim.hcMatches.get(pid)!;
    expect(match).toBeTruthy();
    expect(match.state).toBe('countdown');
    expect(match.round).toBe(1);
    expect(match.racers.size).toBe(10);
    expect(events.some((ev) => ev.type === 'hcFound')).toBe(true);
    expect(events.some((ev) => ev.type === 'hcRoundStart' && ev.round === 1)).toBe(true);
    const seedRound1 = match.courseSeed;

    // Everyone teleported to the start plates in the race band.
    const origin = hodricsOrigin(match.slot);
    for (const racer of match.racers.values()) {
      const e = sim.entities.get(racer.pid)!;
      expect(isHodricsPos(e.pos.x)).toBe(true);
      expect(e.pos.z - origin.z).toBeLessThan(match.course.ropeZ);
    }

    // The rope: mash forward during the countdown, never pass the yard mouth.
    const meta = sim.players.get(pid)!;
    const me = sim.entities.get(pid)!;
    me.facing = 0;
    meta.moveInput.forward = true;
    ff(sim, HC_COUNTDOWN * TICK_RATE - 10, events);
    expect(match.state).toBe('countdown');
    expect(me.pos.z - origin.z).toBeLessThanOrEqual(match.course.ropeZ + 0.1);
    ff(sim, 12, events);
    expect(match.state).toBe('active');
    expect(events.some((ev) => ev.type === 'hcStart')).toBe(true);
    meta.moveInput.forward = false;

    // Let the court race for 30 seconds: bots make real progress on the
    // generated course, obstacles land real hits, checkpoints bank.
    ff(sim, 30 * TICK_RATE, events);
    for (const racer of match.racers.values()) {
      if (racer.bot) expect(racer.furthestZ).toBeGreaterThan(match.course.plateZ);
    }
    expect(events.some((ev) => ev.type === 'hcKnocked')).toBe(true);
    expect(events.some((ev) => ev.type === 'hcCheckpoint')).toBe(true);

    // ROUND 1: six qualify, four fly to the gallery.
    winRound(sim, pid, events);
    expect(match.state).toBe('intermission');
    expect(events.some((ev) => ev.type === 'hcQualified' && ev.pid === pid)).toBe(true);
    const elim1 = events.filter((ev) => ev.type === 'hcEliminated');
    expect(elim1).toHaveLength(4);
    expect(elim1.map((ev) => (ev as { place: number }).place).sort((a, b) => a - b)).toEqual([
      7, 8, 9, 10,
    ]);
    // No credit yet for a mere qualification.
    expect(sim.players.get(pid)!.hcRaces ?? 0).toBe(0);

    // The gallery seats the fallen (mid-intermission teleport).
    ff(sim, HC_INTERMISSION * TICK_RATE - 20, events);
    const g = match.course.gallery;
    for (const racer of match.racers.values()) {
      if (racer.eliminatedRound !== 1) continue;
      const e = sim.entities.get(racer.pid)!;
      expect(Math.abs(e.pos.x - origin.x - g.x)).toBeLessThan(7);
      expect(e.pos.y).toBeCloseTo(g.y, 0);
    }

    // ROUND 2: Hodric rebuilt (new seed), survivors re-plated behind the rope.
    ff(sim, 22, events);
    expect(match.state).toBe('countdown');
    expect(match.round).toBe(2);
    expect(match.courseSeed).not.toBe(seedRound1);
    expect(match.course.seed).toBe(match.courseSeed);
    for (const racer of match.racers.values()) {
      if (racer.eliminatedRound > 0 || racer.left) continue;
      const e = sim.entities.get(racer.pid)!;
      expect(e.pos.z - origin.z).toBeLessThan(match.course.ropeZ);
      expect(racer.finished).toBe(false);
    }
    ff(sim, HC_COUNTDOWN * TICK_RATE + 2, events);
    expect(match.state).toBe('active');
    winRound(sim, pid, events);
    expect(match.state).toBe('intermission');
    const elim2 = events.filter((ev) => ev.type === 'hcEliminated');
    expect(elim2).toHaveLength(7); // 4 + 3
    throughIntermission(sim, pid, events);

    // ROUND 3: the final. First over the line takes the crown, instantly
    // credited (disconnect-safe), and the match closes with a full board.
    expect(match.round).toBe(3);
    crossLine(sim, match, pid);
    ff(sim, 4, events);
    const myFinish = events.find((ev) => ev.type === 'hcFinish' && ev.pid === pid);
    expect(myFinish).toBeTruthy();
    if (myFinish?.type === 'hcFinish') expect(myFinish.place).toBe(1);
    expect(sim.players.get(pid)!.hcWins).toBe(1);
    expect(sim.players.get(pid)!.hcRaces).toBe(1);
    ff(sim, 4, events);
    expect(match.state).toBe('over');
    const end = events.find((ev) => ev.type === 'hcEnd' && ev.pid === pid);
    expect(end).toBeTruthy();
    if (end?.type === 'hcEnd') {
      expect(end.won).toBe(true);
      expect(end.field).toHaveLength(10);
      const places = end.field.map((r) => r.place).sort((a, b) => a - b);
      expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }

    // Aftermath, then everyone (finalists AND gallery) goes home.
    ff(sim, HC_RETURN_DELAY * TICK_RATE + 5, events);
    expect(sim.hcMatches.size).toBe(0);
    expect(me.pos.x).toBeCloseTo(preQueue.x, 0);
    expect(me.pos.z).toBeCloseTo(preQueue.z, 0);
    for (const racer of match.racers.values()) {
      const e = sim.entities.get(racer.pid);
      if (e) expect(isHodricsPos(e.pos.x)).toBe(false);
    }
  }, 40000);
});

describe('race physics on generated courses', () => {
  it('a hammer flail launches the racer on a ballistic arc', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = startActiveRace(sim, events);
    const match = sim.hcMatches.get(pid)!;
    swapCourse(sim, match, findCourseWith('flails'));
    const origin = hodricsOrigin(match.slot);
    const f = match.course.flails[0];
    let knocked = false;
    for (let i = 0; i < 120 && !knocked; i++) {
      const bob = hcFlailBob(f, sim.time + DT);
      place(sim, pid, origin.x + bob.x, origin.z + f.z, f.y);
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
    const course = match.course;
    // Off the open side of the first obstacle segment: bare chasm below.
    const seg = course.sections.find((s) => s.id !== 'start_yard' && s.id !== 'landing')!;
    let gapX = 0;
    let gapZ = 0;
    let found = false;
    for (let z = seg.z0 + 1; z < course.finishZ && !found; z += 2) {
      for (const x of [-11, 11, -10, 10]) {
        if (hodricsGroundLocal(course, x, z) < -30) {
          gapX = x;
          gapZ = z;
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
    place(sim, pid, origin.x + gapX, origin.z + gapZ, 0.5);
    const sink: SimEvent[] = [];
    ff(sim, 3 * TICK_RATE, sink);
    expect(sink.some((ev) => ev.type === 'hcFall' && ev.pid === pid)).toBe(true);
    const racer = match.racers.get(pid)!;
    expect(racer.falls).toBe(1);
    const me = sim.entities.get(pid)!;
    expect(me.onGround).toBe(true);
    expect(hodricsGroundLocal(course, me.pos.x - origin.x, me.pos.z - origin.z)).toBeGreaterThan(
      -30,
    );
  }, 20000);

  it('a drawspan deck carries a standing racer with the platform', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = startActiveRace(sim, events);
    const match = sim.hcMatches.get(pid)!;
    swapCourse(sim, match, findCourseWith('drawspans'));
    const origin = hodricsOrigin(match.slot);
    const d = match.course.drawspans[0];
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

  it('a spinner disc carries a standing racer around its hub', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = startActiveRace(sim, events);
    const match = sim.hcMatches.get(pid)!;
    swapCourse(sim, match, findCourseWith('spinners'));
    const origin = hodricsOrigin(match.slot);
    const d = match.course.spinners[0];
    // Stand near the rim; the disc's rotation should sweep the racer along.
    place(sim, pid, origin.x + d.cx + d.r - 1.5, origin.z + d.cz, d.y);
    const startAngle = Math.atan2(0, d.r - 1.5);
    ff(sim, TICK_RATE);
    const me = sim.entities.get(pid)!;
    const relX = me.pos.x - origin.x - d.cx;
    const relZ = me.pos.z - origin.z - d.cz;
    const angle = Math.atan2(relZ, relX);
    expect(me.onGround).toBe(true);
    // About omega radians of carry in one second (minus friction-free drift).
    expect(Math.abs(angle - startAngle)).toBeGreaterThan(Math.abs(d.omega) * 0.5);
    expect(Math.hypot(relX, relZ)).toBeLessThan(d.r + 0.5);
  }, 20000);

  it('a piston ram shoves the racer toward the open edge', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = startActiveRace(sim, events);
    const match = sim.hcMatches.get(pid)!;
    swapCourse(sim, match, findCourseWith('pushers'));
    const origin = hodricsOrigin(match.slot);
    const p = match.course.pushers[0];
    // Park in the ram's lane and wait out one cycle.
    place(sim, pid, origin.x, origin.z + p.z, p.y);
    const knocks: SimEvent[] = [];
    for (let i = 0; i < Math.ceil((p.period + 1) * TICK_RATE); i++) {
      knocks.push(...sim.tick().filter((ev) => ev.type === 'hcKnocked' && ev.pid === pid));
      if (knocks.length > 0) break;
    }
    expect(knocks.length).toBeGreaterThan(0);
    expect((knocks[0] as { kind?: string }).kind).toBe('piston');
    // Shoved AWAY from the mount wall.
    const me = sim.entities.get(pid)!;
    expect(Math.sign(me.vx || -p.side)).toBe(-p.side);
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

describe('physics feel', () => {
  it('a hard landing rebounds into a small decaying hop (gameshow bounce)', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = startActiveRace(sim, events);
    const match = sim.hcMatches.get(pid)!;
    const origin = hodricsOrigin(match.slot);
    const e = sim.entities.get(pid)!;

    // Drop the racer from 12 above the first landing: past the bounce
    // threshold, so the landing tick must rebound instead of sticking.
    const cpz = match.course.checkpoints[1].z + 2;
    const groundY = hodricsGroundLocal(match.course, 0, cpz);
    place(sim, pid, origin.x, origin.z + cpz, groundY + 12);
    e.onGround = false;
    e.vy = 0;
    e.fallStartY = groundY + 12;
    let bounced = false;
    for (let i = 0; i < 3 * TICK_RATE; i++) {
      sim.tick();
      if (!bounced && e.vy > 0 && !e.onGround && e.pos.y < groundY + 4) bounced = true;
    }
    expect(bounced).toBe(true);
    // And it settles: bounces decay, they never trampoline forever.
    ff(sim, 3 * TICK_RATE);
    expect(e.onGround).toBe(true);
  }, 20000);

  it('a rotor hit is a short-grace shove (0.4s), a hammer yeet a long one (0.9s)', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = startActiveRace(sim, events);
    const match = sim.hcMatches.get(pid)!;
    swapCourse(sim, match, findCourseWith('rotors'));
    const origin = hodricsOrigin(match.slot);
    const racer = match.racers.get(pid)!;
    const r = match.course.rotors[0];

    // Park on the rotor's sweep circle and wait out one revolution.
    place(sim, pid, origin.x + r.cx + r.r - 2, origin.z + r.cz, r.y);
    const knocks: SimEvent[] = [];
    for (let i = 0; i < 7 * TICK_RATE; i++) {
      knocks.push(...sim.tick().filter((ev) => ev.type === 'hcKnocked' && ev.pid === pid));
      if (knocks.length > 0) break;
    }
    expect(knocks.length).toBeGreaterThan(0);
    expect((knocks[0] as { kind?: string }).kind).toBe('log');
    expect(racer.immunity).toBeCloseTo(0.4);
  }, 20000);
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

describe('disconnects', () => {
  it('qualifying then vanishing neither crashes the show nor credits a race', () => {
    const sim = makeSim();
    const events: SimEvent[] = [];
    const pid = startActiveRace(sim, events);
    const match = sim.hcMatches.get(pid)!;
    crossLine(sim, match, pid);
    ff(sim, 3, events);
    expect(events.some((ev) => ev.type === 'hcFinish' && ev.pid === pid)).toBe(true);
    // A round-1 finish is a qualification, not a result: no credit yet, so a
    // deserter cannot farm hcRaces by bailing after each first round.
    expect(sim.players.get(pid)!.hcRaces ?? 0).toBe(0);
    sim.removePlayer(pid);
    expect(sim.hcMatches.has(pid)).toBe(false);
    expect(() => ff(sim, 30 * TICK_RATE)).not.toThrow();
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

    // Vanish mid-round-1: no humans left folds the whole show for the bots.
    ff(sim, HC_COUNTDOWN * TICK_RATE + 2);
    sim.removePlayer(pid);
    ff(sim, (HC_RETURN_DELAY + 2) * TICK_RATE);
    // Every fill bot left the world once the race returned.
    const botsLeft = [...sim.players.values()].filter((m) => m.isHcBot === true);
    expect(botsLeft).toHaveLength(0);
  }, 30000);

  it('all-human lobbies that fully disconnect free their slots (no leak)', () => {
    // Regression: removePlayer marks a leaver and deletes their pid, but a
    // match with no bots to keep it alive becomes unreachable from
    // updateHodrics once its LAST racer leaves, leaking the slot + the pinned
    // course forever. With only two slots, two such leaks would stop all
    // races; proven here through the public API (a fresh field can still
    // start) by leaking BOTH slots and requiring recovery.
    const sim = makeSim();
    // Twenty humans: matchmaking seats two full all-human fields (both slots).
    const first = Array.from({ length: 20 }, (_, i) => sim.addPlayer('warrior', `First${i}`));
    for (const pid of first) sim.hcQueueJoin(pid);
    ff(sim, 3);
    const slots = new Set(
      first.map((pid) => sim.hcMatches.get(pid)?.slot).filter((s) => s !== undefined),
    );
    expect(slots.size).toBe(2); // both slots in use
    for (const pid of first) {
      const m = sim.hcMatches.get(pid);
      expect(m && m.racers.get(pid)?.bot).toBe(false);
    }

    // Every human in both matches logs out: both slots must be freed, not
    // leaked, or no future race can ever start.
    for (const pid of first) sim.removePlayer(pid);
    ff(sim, 2);

    // A fresh full field claims a freed slot immediately.
    const next = Array.from({ length: 10 }, (_, i) => sim.addPlayer('rogue', `Next${i}`));
    for (const pid of next) sim.hcQueueJoin(pid);
    ff(sim, 2);
    expect(sim.hcMatches.get(next[0])).toBeTruthy();
  }, 20000);
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
