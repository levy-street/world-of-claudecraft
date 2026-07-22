import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';
import {
  armCadence,
  cadenceBlockedKeys,
  clampCadenceOnLoad,
  isCadenceBlocked,
  NUDGE_CADENCE_TICKS,
  WORK_ORDER_CADENCE_TICKS,
} from '../src/sim/professions/cadence';
import { computeQuestState, Sim } from '../src/sim/sim';

// A repeatable work order with a real cooldown (content, Phase 14): turned in at
// the forge master, on a 30-minute window.
const WORK_ORDER = 'q_prof_workorder_forge';
const FORGE_MASTER = 'forgemistress_darva';
const ORE_ITEM = 'copper_ore';
const ORE_COUNT = 8;

function makeSim(seed = 7714): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function moveToNpc(sim: Sim, templateId: string, pid = sim.playerId): void {
  const npc = [...sim.entities.values()].find((e) => e.templateId === templateId);
  if (!npc) throw new Error(`${templateId} missing`);
  const player = sim.entities.get(pid);
  if (!player) throw new Error('player missing');
  player.pos.x = npc.pos.x + 1;
  player.pos.z = npc.pos.z;
}

/** Accept the work order, hand it the required materials, force it ready, and turn
 *  it in at the forge master (the harness idiom from
 *  profession_attunement_quests.test.ts, extended for a collect objective). */
function turnInWorkOrder(sim: Sim): void {
  moveToNpc(sim, FORGE_MASTER);
  sim.acceptQuest(WORK_ORDER);
  const qp = sim.questLog.get(WORK_ORDER);
  if (!qp) throw new Error('work order was not accepted');
  sim.addItem(ORE_ITEM, ORE_COUNT, sim.playerId);
  qp.counts = [ORE_COUNT];
  qp.state = 'ready';
  moveToNpc(sim, FORGE_MASTER);
  sim.turnInQuest(WORK_ORDER);
}

describe('cadence.ts pure helpers', () => {
  it('the two window constants are the documented tick counts', () => {
    expect(WORK_ORDER_CADENCE_TICKS).toBe(36000); // 30 min at 20 Hz
    expect(NUDGE_CADENCE_TICKS).toBe(18000); // 15 min at 20 Hz
  });

  it('arms a window and reports blocked only strictly inside it', () => {
    const map = new Map<string, number>();
    expect(isCadenceBlocked(map, 'k', 0)).toBe(false); // absent = available
    armCadence(map, 'k', 100, 50);
    expect(map.get('k')).toBe(150);
    expect(isCadenceBlocked(map, 'k', 149)).toBe(true);
    expect(isCadenceBlocked(map, 'k', 150)).toBe(false); // available AT the boundary
    expect(isCadenceBlocked(map, 'k', 200)).toBe(false);
  });

  it('cadenceBlockedKeys returns only currently-blocked keys, sorted', () => {
    const map = new Map<string, number>([
      ['zulu', 300],
      ['alpha', 300],
      ['past', 50],
    ]);
    expect(cadenceBlockedKeys(map, 100)).toEqual(['alpha', 'zulu']); // 'past' lapsed
    expect(cadenceBlockedKeys(map, 300)).toEqual([]); // all available at the boundary
  });

  it('clampCadenceOnLoad caps a bogus far-future availableAt at now + window', () => {
    // A tick-counter reset (fresh Sim at tick 0) leaves a stored availableAt of
    // 999999 unreachable; the clamp caps it at now + window so it lapses on time.
    const clamped = clampCadenceOnLoad({ q: 999_999 }, 0, WORK_ORDER_CADENCE_TICKS);
    expect(clamped.get('q')).toBe(WORK_ORDER_CADENCE_TICKS);
  });

  it('clampCadenceOnLoad drops past-due and malformed entries, keeps valid ones', () => {
    const clamped = clampCadenceOnLoad(
      { pastDue: 40, valid: 500, bad: Number.NaN, alsoBad: Infinity },
      100,
      WORK_ORDER_CADENCE_TICKS,
    );
    expect([...clamped.entries()]).toEqual([['valid', 500]]);
  });

  it('clampCadenceOnLoad on absent input is an empty map', () => {
    expect(clampCadenceOnLoad(undefined, 0, WORK_ORDER_CADENCE_TICKS).size).toBe(0);
    expect(clampCadenceOnLoad(null, 0, WORK_ORDER_CADENCE_TICKS).size).toBe(0);
  });

  it('clampCadenceOnLoad drops a value exactly at now, keeps one exactly at the cap', () => {
    // The keep arm is strict (clamped > now): a window lapsing exactly on the load
    // tick is already available, so keeping it would only delay the shrink-back-to-
    // empty re-omission from the next save. The cap itself is a legal availableAt.
    const clamped = clampCadenceOnLoad(
      { atNow: 100, atCap: 100 + WORK_ORDER_CADENCE_TICKS },
      100,
      WORK_ORDER_CADENCE_TICKS,
    );
    expect(clamped.has('atNow')).toBe(false);
    expect(clamped.get('atCap')).toBe(100 + WORK_ORDER_CADENCE_TICKS);
  });

  it('armCadence clamps a negative window to immediately elapsed and floors a fraction', () => {
    const map = new Map<string, number>();
    // A non-positive window must never brick a key: availableAt lands AT now,
    // which the strict isCadenceBlocked arm treats as already available.
    armCadence(map, 'neg', 100, -50);
    expect(map.get('neg')).toBe(100);
    expect(isCadenceBlocked(map, 'neg', 100)).toBe(false);
    // Windows are whole ticks: a fractional input floors, never rounds up.
    armCadence(map, 'frac', 100, 50.9);
    expect(map.get('frac')).toBe(150);
  });
});

describe('work-order cadence catalog pin', () => {
  it('every quest with a repeatCadenceTicks uses the single WORK_ORDER_CADENCE_TICKS window', () => {
    // clampCadenceOnLoad clamps EVERY persisted questCadence key against this one
    // constant (the src/sim/sim.ts load arm), so a quest armed with a second,
    // different cadence value would silently mis-clamp on a tick-reset load. This
    // pin turns that future hazard into a loud failure directing the author to
    // make the load clamp per-key before introducing a second window length.
    const cadenced = Object.values(QUESTS).filter((q) => q.repeatCadenceTicks !== undefined);
    expect(cadenced.length).toBeGreaterThan(0); // the six work orders, at minimum
    for (const quest of cadenced) {
      expect(quest.repeatCadenceTicks, quest.id).toBe(WORK_ORDER_CADENCE_TICKS);
    }
  });
});

describe('computeQuestState cadence gating', () => {
  it('a would-be-available quest inside its window is unavailable, available otherwise', () => {
    const empty = new Map();
    const done = new Set<string>();
    // WORK_ORDER is repeatable, so a fresh character sees it available.
    expect(computeQuestState(WORK_ORDER, empty, done, 1)).toBe('available');
    // In its cadence window: unavailable. Out of window: available again.
    expect(computeQuestState(WORK_ORDER, empty, done, 1, undefined, new Set([WORK_ORDER]))).toBe(
      'unavailable',
    );
    expect(computeQuestState(WORK_ORDER, empty, done, 1, undefined, new Set(['other']))).toBe(
      'available',
    );
  });
});

describe('work-order turn-in arms the cooldown (Sim, Phase 14)', () => {
  it('turn-in arms the window, blocks re-accept inside it, and reopens after it lapses', () => {
    const sim = makeSim();
    expect(sim.questState(WORK_ORDER)).toBe('available');
    const meta = sim.players.get(sim.playerId)!;
    const copperReward = QUESTS[WORK_ORDER].copperReward;
    expect(copperReward).toBeGreaterThan(0); // a zero reward would make the payout deltas vacuous
    const copperStart = meta.copper;

    turnInWorkOrder(sim);
    // Armed for WORK_ORDER_CADENCE_TICKS from the current tick.
    expect(meta.questCadence.get(WORK_ORDER)).toBe(sim.tickCount + WORK_ORDER_CADENCE_TICKS);
    expect(sim.questState(WORK_ORDER)).toBe('unavailable');
    expect(meta.copper).toBe(copperStart + copperReward);
    expect(meta.questsDone.has(WORK_ORDER)).toBe(true);

    // An immediate re-accept attempt is rejected server-side (questState gates it).
    moveToNpc(sim, FORGE_MASTER);
    sim.acceptQuest(WORK_ORDER);
    expect(sim.questLog.has(WORK_ORDER)).toBe(false);

    // Simulate the window lapsing (advance the stored availableAt into the past).
    meta.questCadence.set(WORK_ORDER, sim.tickCount);
    expect(sim.questState(WORK_ORDER)).toBe('available');

    // Second FULL cycle after the lapse: 'available' must mean a real re-accept
    // and re-turn-in land, the reward pays out a second time, and the window
    // re-arms from the new turn-in tick (not from the first one).
    const secondTurnInTick = sim.tickCount;
    turnInWorkOrder(sim);
    expect(meta.copper).toBe(copperStart + 2 * copperReward);
    expect(meta.questsDone.has(WORK_ORDER)).toBe(true);
    expect(meta.questCadence.get(WORK_ORDER)).toBe(secondTurnInTick + WORK_ORDER_CADENCE_TICKS);
    expect(sim.questState(WORK_ORDER)).toBe('unavailable');
  });

  it('an immediate re-turn-in loop is bounded: only the first turn-in lands, then it is blocked', () => {
    const sim = makeSim();
    turnInWorkOrder(sim);
    expect(sim.players.get(sim.playerId)!.counters.questsCompleted).toBeGreaterThan(0);
    const firstArm = sim.players.get(sim.playerId)!.questCadence.get(WORK_ORDER);

    // A second immediate attempt cannot even accept (unavailable), so the loop
    // terminates rather than farming the reward every tick.
    for (let i = 0; i < 5; i++) {
      moveToNpc(sim, FORGE_MASTER);
      sim.acceptQuest(WORK_ORDER);
      expect(sim.questLog.has(WORK_ORDER)).toBe(false);
    }
    expect(sim.players.get(sim.playerId)!.questCadence.get(WORK_ORDER)).toBe(firstArm);
  });

  it('the armed window round-trips through save/load and stays blocked (tick-reset clamp)', () => {
    const sim = makeSim();
    turnInWorkOrder(sim);
    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved?.questCadence?.[WORK_ORDER]).toBeGreaterThan(0);

    // A fresh Sim starts at tick 0; the clamp keeps the window blocked (capped at
    // now + WORK_ORDER_CADENCE_TICKS) rather than bricking it far in the future.
    const reloaded = makeSim(7715);
    const pid = reloaded.addPlayer('warrior', 'Reloaded', { state: saved ?? undefined });
    expect(reloaded.questState(WORK_ORDER, pid)).toBe('unavailable');
    expect(reloaded.players.get(pid)!.questCadence.get(WORK_ORDER)).toBe(
      reloaded.tickCount + WORK_ORDER_CADENCE_TICKS,
    );
  });

  it('a character who never touched a work order serializes no questCadence key (zero-default omission)', () => {
    const sim = makeSim();
    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved && 'questCadence' in saved).toBe(false);
  });

  it('surfaces the blocked work order to the online cprof mirror via craftingIdentityFor', () => {
    // The online client feeds craftingIdentity.cadenceBlockedQuests into its own
    // computeQuestState; this is the server-side computation that rides cprof.
    const sim = makeSim();
    expect(sim.craftingIdentity.cadenceBlockedQuests).toEqual([]);
    turnInWorkOrder(sim);
    expect(sim.craftingIdentityFor(sim.playerId).cadenceBlockedQuests).toContain(WORK_ORDER);
  });
});
