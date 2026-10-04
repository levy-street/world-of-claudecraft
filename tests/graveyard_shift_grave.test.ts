// The Graveyard Shift's way in and out: the grave by the Hollow Crypt (offline
// only, and only for an eligible player), Tibbs who climbs out of it and offers
// the shift, the accept and refusal paths, and every grave shift ending back in
// front of him with his report, his consolation, or nothing at all.
import { describe, expect, it } from 'vitest';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift';
import { CORPSE_RETURN_TICKS } from '../src/sim/graveyard_shift/corpse_run';
import {
  BOSS_FOR_A_DAY_DEED_ID,
  GRAVE_ENTITY_ID,
  GRAVE_INTERACT_RADIUS,
  GRAVE_ITEM_ID,
  GRAVE_POS,
  graveReturnSpot,
  TIBBS_ENTITY_ID,
  TIBBS_IDLE_SECONDS,
  TIBBS_LEAVE_RADIUS,
  TIBBS_NPC_ID,
  tibbsSpot,
} from '../src/sim/graveyard_shift/grave_entry';
import {
  graveyardShiftEligibleFor,
  TIBBS_FOLLOW_UP_SECONDS,
} from '../src/sim/graveyard_shift/grave_staging';
import {
  acceptGraveyardShiftFromTibbs,
  endGraveyardShift,
  startGraveyardShift,
} from '../src/sim/graveyard_shift/run_lifecycle';
import { LOSS_OUTRO_TICKS } from '../src/sim/graveyard_shift/shift_end_marks';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { TICK_RATE } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

interface Opts {
  offlineHost?: boolean;
  devCommands?: boolean;
  level?: number;
  deed?: boolean;
  quest?: boolean;
}

function graveSim(opts: Opts = {}) {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    devCommands: opts.devCommands ?? false,
    offlineHost: opts.offlineHost ?? true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(opts.level ?? 15);
  const meta = meta0(sim);
  if (opts.deed ?? true) meta.deedsEarned.set('dgn_hollow_crypt', '2026-10-01');
  if (opts.quest) meta.questsDone.add('q_hollow');
  return sim;
}

const meta0 = (sim: Sim) => sim.ctx.players.get(sim.playerId)!;

function place(sim: Sim, e: Entity, x: number, z: number) {
  e.pos = sim.ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

function ticks(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick());
  return out;
}

const tibbsLines = (events: SimEvent[]) =>
  events
    .filter(
      (ev): ev is Extract<SimEvent, { type: 'chat' }> =>
        ev.type === 'chat' && ev.fromPid === TIBBS_ENTITY_ID,
    )
    .map((ev) => ev.textKey?.replace('devCommand.graveyardShift.tibbs.say.', ''));

// Up to the grave, wake Tibbs, and collect the tick's events.
function wakeTibbs(sim: Sim): SimEvent[] {
  sim.tick();
  const spot = graveReturnSpot();
  place(sim, sim.player, spot.x, spot.z);
  sim.pickUpObject(GRAVE_ENTITY_ID);
  return sim.tick();
}

function takeShift(sim: Sim): SimEvent[] {
  wakeTibbs(sim);
  sim.targetEntity(TIBBS_ENTITY_ID);
  sim.interact();
  return sim.tick();
}

function lethal(sim: Sim, target: Entity) {
  (sim as any).dealDamage(
    sim.player,
    target,
    target.maxHp + 50,
    false,
    'shadow',
    null,
    'hit',
    true,
  );
}

// Kill the party twice (one corpse run each) and walk out through the Staff Exit.
function winShift(sim: Sim): { events: SimEvent[]; followUp: SimEvent[]; saved: number } {
  const run = graveyardShiftRunFor(sim.ctx, sim.playerId)!;
  for (const b of run.bots) lethal(sim, sim.entities.get(b.pid)!);
  ticks(sim, CORPSE_RETURN_TICKS + 1);
  for (const b of run.bots) lethal(sim, sim.entities.get(b.pid)!);
  sim.tick();
  expect(run.outro?.kind).toBe('won');
  const saved = run.allyIds.filter((id) => sim.entities.get(id)?.dead === false).length;
  const exit = sim.entities.get(run.outro!.portalId!)!;
  place(sim, sim.player, exit.pos.x, exit.pos.z);
  const events = sim.tick();
  expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
  // Tibbs' second line waits its turn, so the first bubble stays readable.
  const followUp = ticks(sim, TIBBS_FOLLOW_UP_SECONDS * TICK_RATE + 2);
  return { events, followUp, saved };
}

const atGrave = (sim: Sim) => {
  const spot = graveReturnSpot();
  return Math.hypot(sim.player.pos.x - spot.x, sim.player.pos.z - spot.z) < 0.5;
};

describe('the grave', () => {
  it('keeps its load-bearing ids', () => {
    expect(GRAVE_ITEM_ID).toBe('gshift_grave');
    expect(GRAVE_ENTITY_ID).toBe(2_147_200_001);
    expect(TIBBS_ENTITY_ID).toBe(2_147_200_002);
    expect(TIBBS_NPC_ID).toBe('tibbs');
    expect(BOSS_FOR_A_DAY_DEED_ID).toBe('hid_boss_for_a_day');
  });

  it('is absent for an ineligible offline player', () => {
    for (const opts of [{ level: 14 }, { level: 15, deed: false }] satisfies Opts[]) {
      const sim = graveSim(opts);
      ticks(sim, 3);
      expect(sim.entities.has(GRAVE_ENTITY_ID), JSON.stringify(opts)).toBe(false);
    }
  });

  it('never stands for a player who already won the shift (it can be won once)', () => {
    for (const quest of [false, true]) {
      const sim = graveSim({ quest });
      meta0(sim).deedsEarned.set(BOSS_FOR_A_DAY_DEED_ID, '2026-10-01');
      ticks(sim, 3);
      expect(sim.entities.has(GRAVE_ENTITY_ID), `quest ${quest}`).toBe(false);
    }
  });

  it('never stands on a host that is not the offline world', () => {
    const sim = graveSim({ offlineHost: false });
    ticks(sim, 3);
    expect(sim.entities.has(GRAVE_ENTITY_ID)).toBe(false);
  });

  it('stands at its spot for an eligible player, by the deed or by the quest', () => {
    for (const opts of [{ deed: true }, { deed: false, quest: true }] satisfies Opts[]) {
      const sim = graveSim(opts);
      sim.tick();
      const grave = sim.entities.get(GRAVE_ENTITY_ID);
      expect(grave, JSON.stringify(opts)).toBeDefined();
      expect(grave!.objectItemId).toBe(GRAVE_ITEM_ID);
      expect(grave!.pos.x).toBeCloseTo(GRAVE_POS.x);
      expect(grave!.pos.z).toBeCloseTo(GRAVE_POS.z);
    }
  });

  it('appears once the player becomes eligible mid-session', () => {
    const sim = graveSim({ level: 14 });
    sim.tick();
    expect(sim.entities.has(GRAVE_ENTITY_ID)).toBe(false);
    sim.setPlayerLevel(15);
    sim.tick();
    expect(sim.entities.has(GRAVE_ENTITY_ID)).toBe(true);
  });

  it('draws nothing from the shared rng stream, eligible or not', () => {
    const draws = (opts: Opts) => {
      const sim = graveSim(opts);
      let count = 0;
      sim.rng.setObserver(() => count++);
      ticks(sim, 60);
      sim.rng.setObserver(null);
      return { count, next: sim.rng.next() };
    };
    // No eligible player: the offline world is byte-identical to the server's.
    expect(draws({ deed: false })).toEqual(draws({ deed: false, offlineHost: false }));
    // An eligible player: the grave itself draws nothing either.
    expect(draws({ deed: true })).toEqual(draws({ deed: true, offlineHost: false }));
  });
});

describe('Tibbs', () => {
  it('climbs out beside the grave when it is touched and offers the shift', () => {
    const sim = graveSim();
    const events = wakeTibbs(sim);
    const tibbs = sim.entities.get(TIBBS_ENTITY_ID)!;
    expect(tibbs.templateId).toBe('tibbs');
    expect(tibbs.kind).toBe('npc');
    const spot = tibbsSpot();
    expect(Math.hypot(tibbs.pos.x - spot.x, tibbs.pos.z - spot.z)).toBeLessThan(0.01);
    const offers = events.filter((ev) => ev.type === 'graveyardShiftOffer');
    expect(offers).toEqual([
      { type: 'graveyardShiftOffer', npcId: TIBBS_ENTITY_ID, pid: sim.playerId },
    ]);
  });

  it('stays down when the grave is touched from too far away', () => {
    const sim = graveSim();
    sim.tick();
    place(sim, sim.player, GRAVE_POS.x, GRAVE_POS.z - (GRAVE_INTERACT_RADIUS + 3));
    sim.pickUpObject(GRAVE_ENTITY_ID);
    const events = sim.tick();
    expect(sim.entities.has(TIBBS_ENTITY_ID)).toBe(false);
    expect(events.some((ev) => ev.type === 'graveyardShiftOffer')).toBe(false);
  });

  it('starts a grave shift on [Take the shift], without dev commands', () => {
    const sim = graveSim({ devCommands: false });
    wakeTibbs(sim);
    sim.targetEntity(TIBBS_ENTITY_ID);
    sim.interact();
    const run = graveyardShiftRunFor(sim.ctx, sim.playerId);
    expect(run?.entry).toBe('grave');
    const events = sim.tick();
    const accept = events.find(
      (ev) => ev.type === 'chat' && ev.textKey === 'devCommand.graveyardShift.tibbs.say.accept',
    ) as Extract<SimEvent, { type: 'chat' }> | undefined;
    expect(accept?.entityId).toBe(TIBBS_ENTITY_ID);
    expect(accept?.pid).toBe(sim.playerId);
    // He goes back down once the shift has begun.
    expect(sim.entities.has(TIBBS_ENTITY_ID)).toBe(false);
    // The grave stays for the way back, though Morthen reads as level 10 on shift.
    ticks(sim, 20 * 10);
    expect(sim.entities.has(GRAVE_ENTITY_ID)).toBe(true);
  });

  it('reads eligibility from the parked real level while Morthen is pinned to level 10', () => {
    const sim = graveSim();
    takeShift(sim);
    const run = graveyardShiftRunFor(sim.ctx, sim.playerId)!;
    expect(sim.player.level).toBe(10);
    expect(run.parked.level).toBe(15);
    expect(graveyardShiftEligibleFor(sim.ctx, sim.playerId)).toBe(true);
    const parked = run.parked;
    Object.assign(run, { parked: { ...parked, level: 14 } });
    expect(graveyardShiftEligibleFor(sim.ctx, sim.playerId)).toBe(false);
    Object.assign(run, { parked });
  });

  it('answers a busy player with one line and starts nothing', () => {
    const sim = graveSim();
    wakeTibbs(sim);
    sim.player.inCombat = true;
    sim.targetEntity(TIBBS_ENTITY_ID);
    sim.interact();
    const events = sim.tick();
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(tibbsLines(events)).toEqual(['busy']);
  });

  it('goes back down when the player walks off', () => {
    const sim = graveSim();
    wakeTibbs(sim);
    place(sim, sim.player, GRAVE_POS.x, GRAVE_POS.z - TIBBS_LEAVE_RADIUS + 2);
    sim.tick();
    expect(sim.entities.has(TIBBS_ENTITY_ID)).toBe(true);
    place(sim, sim.player, GRAVE_POS.x, GRAVE_POS.z - TIBBS_LEAVE_RADIUS - 5);
    sim.tick();
    expect(sim.entities.has(TIBBS_ENTITY_ID)).toBe(false);
  });

  it('goes back down when left standing too long', () => {
    const sim = graveSim();
    wakeTibbs(sim);
    ticks(sim, TIBBS_IDLE_SECONDS * TICK_RATE - 5);
    expect(sim.entities.has(TIBBS_ENTITY_ID)).toBe(true);
    ticks(sim, 10);
    expect(sim.entities.has(TIBBS_ENTITY_ID)).toBe(false);
  });

  it('the dev path still needs dev commands', () => {
    const sim = graveSim({ devCommands: false });
    sim.tick();
    expect(startGraveyardShift(sim.ctx, sim.playerId)).toBe('Graveyard Shift runs offline only.');
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
  });
});

describe('the end of a grave shift', () => {
  it('a win sets the owner down at the grave, Tibbs reports and pays out the deed', () => {
    const sim = graveSim();
    takeShift(sim);
    const meta = meta0(sim);
    expect(meta.deedsEarned.has(BOSS_FOR_A_DAY_DEED_ID)).toBe(false);
    const { events, followUp, saved } = winShift(sim);
    expect(atGrave(sim)).toBe(true);
    expect(sim.entities.has(TIBBS_ENTITY_ID)).toBe(true);
    expect(tibbsLines(events)).toEqual(['report']);
    expect(tibbsLines(followUp)).toEqual(['payout']);
    const report = events.find(
      (ev) => ev.type === 'chat' && ev.textKey === 'devCommand.graveyardShift.tibbs.say.report',
    ) as Extract<SimEvent, { type: 'chat' }>;
    // Five adventurers, each killed twice.
    expect(report.textValues).toEqual({ sent: 10, saved });
    expect(meta.deedsEarned.has(BOSS_FOR_A_DAY_DEED_ID)).toBe(true);
    // The dev channel's end line is for /dev shifts only.
    const logs = events
      .filter((ev) => ev.type === 'log')
      .map((ev) => (ev as { text: string }).text);
    expect(logs.some((text) => text.startsWith('[dev]'))).toBe(false);
  });

  it('after the win the grave sinks once Tibbs goes down, and never comes back', () => {
    const sim = graveSim();
    takeShift(sim);
    winShift(sim);
    // Tibbs still stands for his report: the grave waits for him.
    expect(sim.entities.has(GRAVE_ENTITY_ID)).toBe(true);
    dismissAndWait(sim);
    expect(sim.entities.has(GRAVE_ENTITY_ID)).toBe(false);
    ticks(sim, 20 * 5);
    expect(sim.entities.has(GRAVE_ENTITY_ID)).toBe(false);
    // Nothing left to touch: no Tibbs, no offer.
    sim.pickUpObject(GRAVE_ENTITY_ID);
    const events = sim.tick();
    expect(sim.entities.has(TIBBS_ENTITY_ID)).toBe(false);
    expect(events.some((ev) => ev.type === 'graveyardShiftOffer')).toBe(false);
  });

  it('a second shift is refused after the win: Tibbs says it is covered and starts nothing', () => {
    const sim = graveSim();
    takeShift(sim);
    winShift(sim);
    // Tibbs still stands for his report; [Take the shift] from a stale dialog.
    expect(sim.entities.has(TIBBS_ENTITY_ID)).toBe(true);
    sim.targetEntity(TIBBS_ENTITY_ID);
    sim.interact();
    const events = sim.tick();
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(tibbsLines(events)).toEqual(['covered']);
  });

  it('a loss sets the owner down at the grave with a consolation and no deed', () => {
    const sim = graveSim();
    takeShift(sim);
    (sim as any).dealDamage(
      null,
      sim.player,
      sim.player.maxHp + 50,
      false,
      'physical',
      null,
      'hit',
      true,
    );
    const events = ticks(sim, LOSS_OUTRO_TICKS + 2);
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(atGrave(sim)).toBe(true);
    expect(tibbsLines(events)).toEqual(['consolation']);
    const followUp = ticks(sim, TIBBS_FOLLOW_UP_SECONDS * TICK_RATE + 2);
    expect(tibbsLines(followUp)).toEqual(['anotherShift']);
    expect(meta0(sim).deedsEarned.has(BOSS_FOR_A_DAY_DEED_ID)).toBe(false);
  });

  it('lands settled at the grave: no fall carried over from the Crypt', () => {
    const sim = graveSim();
    takeShift(sim);
    const p = sim.player;
    p.onGround = false;
    p.jumping = true;
    p.vy = -12;
    p.fallStartY = p.pos.y + 40;
    endGraveyardShift(sim.ctx, graveyardShiftRunFor(sim.ctx, sim.playerId)!, 'aborted');
    expect(atGrave(sim)).toBe(true);
    expect(p.vy).toBe(0);
    expect(p.jumping).toBe(false);
    expect(p.onGround).toBe(true);
    expect(p.fallStartY).toBe(p.pos.y);
  });

  it("drops a queued follow-up line when Tibbs went down and rose again (it was the old scene's)", () => {
    const sim = graveSim();
    takeShift(sim);
    (sim as any).dealDamage(
      null,
      sim.player,
      sim.player.maxHp + 50,
      false,
      'physical',
      null,
      'hit',
      true,
    );
    ticks(sim, LOSS_OUTRO_TICKS + 2);
    // Walk off (he goes down), come straight back and wake him for a fresh offer.
    place(sim, sim.player, GRAVE_POS.x, GRAVE_POS.z - TIBBS_LEAVE_RADIUS - 5);
    sim.tick();
    expect(sim.entities.has(TIBBS_ENTITY_ID)).toBe(false);
    const spot = graveReturnSpot();
    place(sim, sim.player, spot.x, spot.z);
    sim.pickUpObject(GRAVE_ENTITY_ID);
    const events = ticks(sim, TIBBS_FOLLOW_UP_SECONDS * TICK_RATE + 2);
    expect(sim.entities.has(TIBBS_ENTITY_ID)).toBe(true);
    expect(tibbsLines(events)).not.toContain('anotherShift');
  });

  it('holds his offer for the player who woke him only', () => {
    const sim = graveSim();
    wakeTibbs(sim);
    const other = sim.addPlayer('mage', 'Passerby');
    acceptGraveyardShiftFromTibbs(sim.ctx, other);
    const events = sim.tick();
    expect(graveyardShiftRunFor(sim.ctx, other)).toBeNull();
    expect(tibbsLines(events)).toEqual([]);
  });

  it('an aborted grave shift sets the owner down at the grave and Tibbs says nothing', () => {
    const sim = graveSim();
    takeShift(sim);
    graveyardShiftRunFor(sim.ctx, sim.playerId)!.pendingOutcome = 'aborted';
    const events = ticks(sim, 2);
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(atGrave(sim)).toBe(true);
    expect(tibbsLines(events)).toEqual([]);
    expect(sim.entities.has(TIBBS_ENTITY_ID)).toBe(false);
  });

  it('a dev-entry shift still ends at the Crypt door, not the grave', () => {
    const sim = graveSim({ devCommands: true });
    sim.chat('/dev graveyardshift start');
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)?.entry).toBe('dev');
    sim.chat('/dev graveyardshift end');
    const events = ticks(sim, 2);
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(atGrave(sim)).toBe(false);
    expect(Math.hypot(sim.player.pos.x - 80, sim.player.pos.z - 90)).toBeLessThan(10);
    expect(tibbsLines(events)).toEqual([]);
  });
});

// Let the waiting Tibbs time out so a fresh offer raises him anew.
function dismissAndWait(sim: Sim) {
  ticks(sim, TIBBS_IDLE_SECONDS * TICK_RATE + 2);
  expect(sim.entities.has(TIBBS_ENTITY_ID)).toBe(false);
}
