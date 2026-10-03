import { describe, expect, it } from 'vitest';
import { TURRET_SCENARIO_STANDARD } from '../src/sim/content/fire_and_fly_scenarios';
import {
  TURRET_BOWLING,
  TURRET_SIZE_CLASSES,
  TURRET_TIMING,
} from '../src/sim/content/turret_defense';
import { positionAt, stillSegment, type ThrowProbe } from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  type TurretDefenseState,
  type TurretEvent,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import type { TurretKind, TurretPlan } from '../src/sim/minigames/turret_defense_plan';

const flat: ThrowProbe = { ground: () => 0, water: () => null };
const START = 1000;
const INTRO_END = START + TURRET_TIMING.introTicks;
const NO_BARRELS = { count: 0, minRadius: 0, maxRadius: 0 };
const WOLF: TurretKind = {
  templateId: 'forest_wolf',
  level: 2,
  sizeClass: 'small',
  maxHp: 50,
  marchSpeed: 1,
  ...TURRET_SIZE_CLASSES.small,
};

/** Waves of slow wolves (`sizes` per wave), a Shockwave given after the first two waves. */
function plan(sizes: number[], overlap?: number): TurretPlan {
  return {
    scenarioId: 'test',
    integrity: 100,
    medals: TURRET_SCENARIO_STANDARD.medals,
    arsenal: { shockwave: 1, fragmentation: 0 },
    resupplyWaves: [0, 1],
    chargeBonus: false,
    kinds: [WOLF],
    waves: sizes.map((n) => ({
      spawns: Array.from({ length: n }, () => 0),
      coreDamage: 60,
      gapMinTicks: 1,
      gapMaxTicks: 1,
      barrels: NO_BARRELS,
      arrival: { kind: 'ring' },
    })),
    bowling: { ...TURRET_BOWLING, enabled: false },
    ...(overlap !== undefined ? { overlap } : {}),
  };
}

function run(state: TurretDefenseState, toTick: number): TurretEvent[] {
  const events: TurretEvent[] = [];
  for (let t = state.tick + 1; t <= toTick; t++) events.push(...tickTurretDefense(state, t, flat));
  return events;
}

/** Every monster of the current wave out on the field. */
function spawnAll(state: TurretDefenseState): void {
  while (state.spawnCursor < state.plan.waves[state.wave].spawns.length) run(state, state.tick + 1);
}

/** Lays `n` living monsters down as corpses where they stand, as a killing blast would. */
function kill(state: TurretDefenseState, n: number): void {
  for (const m of state.monsters.filter((x) => x.hp > 0).slice(0, n)) {
    m.hp = 0;
    m.state = 'dead';
    m.seg = stillSegment(
      state.tick,
      TURRET_TIMING.corpseTicks,
      positionAt(m.seg, state.tick, flat),
    );
  }
}

const living = (state: TurretDefenseState) => state.monsters.filter((m) => m.hp > 0).length;
const types = (events: TurretEvent[]) => events.map((e) => e.type);

describe('overlapping waves', () => {
  it('launches the next wave on the tick the living fall to the overlap, with no clear and no pause', () => {
    const state = createTurretDefense(plan([4, 3, 2], 2), { x: 0, z: 0 }, 5, START);
    run(state, INTRO_END);
    spawnAll(state);
    kill(state, 1);
    expect(types(run(state, state.tick + 1))).toEqual([]);
    expect([state.wave, state.phase, living(state)]).toEqual([0, 'wave', 3]);
    kill(state, 1);
    const at = state.tick + 1;
    const events = run(state, at);
    expect(events).toEqual([
      { type: 'resupply', wave: 0, shockwave: 1, fragmentation: 0 },
      { type: 'waveStart', wave: 1, count: 3 },
    ]);
    expect([state.wave, state.phase, state.phaseEndTick, state.spawnCursor]).toEqual([
      1,
      'wave',
      at,
      0,
    ]);
    expect(state.stats.resupplies).toBe(1);
    // The tail keeps marching beside the new wave's first spawn, on the next tick.
    run(state, at + 1);
    expect(living(state)).toBe(3);
  });

  it("waits for the wave's last spawn, however few still live", () => {
    const state = createTurretDefense(plan([4, 3], 3), { x: 0, z: 0 }, 5, START);
    run(state, INTRO_END);
    state.nextSpawnTick = Number.MAX_SAFE_INTEGER;
    expect(living(state)).toBe(1);
    run(state, state.tick + 20);
    expect([state.wave, state.phase]).toEqual([0, 'wave']);
  });

  it('counts the living of every wave: a tail still standing holds the next launch back', () => {
    const state = createTurretDefense(plan([3, 2, 2], 2), { x: 0, z: 0 }, 5, START);
    run(state, INTRO_END);
    spawnAll(state);
    kill(state, 1);
    run(state, state.tick + 1);
    expect(state.wave).toBe(1);
    spawnAll(state);
    expect(living(state)).toBe(4);
    kill(state, 1);
    run(state, state.tick + 1);
    expect(state.wave).toBe(1);
    kill(state, 1);
    run(state, state.tick + 1);
    expect(state.wave).toBe(2);
  });

  it('never overlaps the last wave: the run is won only once every monster is down', () => {
    const state = createTurretDefense(plan([3, 3], 2), { x: 0, z: 0 }, 5, START);
    run(state, INTRO_END);
    spawnAll(state);
    kill(state, 1);
    run(state, state.tick + 1);
    expect(state.wave).toBe(1);
    spawnAll(state);
    kill(state, living(state) - 1);
    expect(types(run(state, state.tick + 1))).toEqual([]);
    expect(state.phase).toBe('wave');
    kill(state, 1);
    expect(types(run(state, state.tick + 1))).toEqual(['waveCleared', 'ended']);
    expect(state.phase).toBe('won');
  });

  it('still clears and pauses a wave that falls all at once, and resupplies each wave once', () => {
    const state = createTurretDefense(plan([3, 3, 3], 2), { x: 0, z: 0 }, 5, START);
    run(state, INTRO_END);
    spawnAll(state);
    kill(state, 3);
    const at = state.tick + 1;
    expect(types(run(state, at))).toEqual(['waveCleared', 'resupply']);
    expect([state.phase, state.phaseEndTick]).toEqual(['between', at + TURRET_TIMING.betweenTicks]);
    run(state, state.phaseEndTick);
    expect([state.wave, state.phase]).toEqual([1, 'wave']);
    spawnAll(state);
    kill(state, 1);
    const all = run(state, state.tick + 1);
    expect(types(all)).toEqual(['resupply', 'waveStart']);
    spawnAll(state);
    kill(state, living(state));
    all.push(...run(state, state.tick + 1));
    expect(state.phase).toBe('won');
    expect(
      all.filter((e) => e.type === 'resupply').map((e) => e.type === 'resupply' && e.wave),
    ).toEqual([1]);
    expect(state.stats.resupplies).toBe(2);
  });

  it('keeps the clear and the pause between every wave of a plan with no overlap', () => {
    const state = createTurretDefense(plan([3, 3]), { x: 0, z: 0 }, 5, START);
    run(state, INTRO_END);
    spawnAll(state);
    kill(state, 2);
    expect(types(run(state, state.tick + 1))).toEqual([]);
    kill(state, 1);
    const at = state.tick + 1;
    expect(types(run(state, at))).toEqual(['waveCleared', 'resupply']);
    expect([state.wave, state.phase, state.phaseEndTick]).toEqual([
      0,
      'between',
      at + TURRET_TIMING.betweenTicks,
    ]);
  });

  it('pauses 2 s between waves', () => {
    expect(TURRET_TIMING.betweenTicks).toBe(40);
  });
});
