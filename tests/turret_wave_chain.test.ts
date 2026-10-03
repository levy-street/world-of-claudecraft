import { describe, expect, it } from 'vitest';
import {
  FIRE_AND_FLY_SCENARIOS,
  TURRET_SCENARIO_STANDARD,
} from '../src/sim/content/fire_and_fly_scenarios';
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
import {
  resolveTurretPlan,
  type TurretKind,
  type TurretPlan,
  turretResupplyAfter,
} from '../src/sim/minigames/turret_defense_plan';

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
function plan(sizes: number[]): TurretPlan {
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
  };
}

function run(state: TurretDefenseState, toTick: number): TurretEvent[] {
  const events: TurretEvent[] = [];
  for (let t = state.tick + 1; t <= toTick; t++) events.push(...tickTurretDefense(state, t, flat));
  return events;
}

/** Every monster of the current wave out on the field (a lost run freezes, so it stops there). */
function spawnAll(state: TurretDefenseState): void {
  while (state.phase !== 'lost' && state.spawnCursor < state.plan.waves[state.wave].spawns.length)
    run(state, state.tick + 1);
  expect(state.phase).not.toBe('lost');
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
const CHAIN: ReadonlySet<TurretEvent['type']> = new Set([
  'waveCleared',
  'resupply',
  'waveStart',
  'barrelsPlaced',
  'ended',
]);

describe('waves chained on the clear', () => {
  it('launches the next wave on the tick the current one is cleared, its resupply first, with no pause', () => {
    const state = createTurretDefense(plan([3, 2, 2]), { x: 0, z: 0 }, 5, START);
    run(state, INTRO_END);
    spawnAll(state);
    kill(state, 2);
    expect(types(run(state, state.tick + 1))).toEqual([]);
    expect([state.wave, state.phase, living(state)]).toEqual([0, 'wave', 1]);
    kill(state, 1);
    const at = state.tick + 1;
    expect(run(state, at)).toEqual([
      { type: 'waveCleared', wave: 0 },
      { type: 'resupply', wave: 0, shockwave: 1, fragmentation: 0 },
      { type: 'waveStart', wave: 1, count: 2 },
    ]);
    expect([state.wave, state.phase, state.spawnCursor, state.nextSpawnTick]).toEqual([
      1,
      'wave',
      0,
      at,
    ]);
    expect(state.stats.resupplies).toBe(1);
    // The clear tick's spawns already ran: the new wave's first monster walks in on the next,
    // beside the cleared wave's corpses, which keep lying for their usual time.
    run(state, at + 1);
    expect([state.spawnCursor, living(state)]).toEqual([1, 1]);
    expect(state.monsters.filter((m) => m.state === 'dead')).toHaveLength(3);
    run(state, at + TURRET_TIMING.corpseTicks);
    expect(state.monsters.filter((m) => m.state === 'dead')).toHaveLength(0);
  });

  it("waits for the wave's last spawn, however few still live", () => {
    const state = createTurretDefense(plan([4, 3]), { x: 0, z: 0 }, 5, START);
    run(state, INTRO_END);
    state.nextSpawnTick = Number.MAX_SAFE_INTEGER;
    kill(state, living(state));
    expect(types(run(state, state.tick + 20))).toEqual([]);
    expect([state.wave, state.phase]).toEqual([0, 'wave']);
  });

  it('holds the next wave while a single monster of the current one lives', () => {
    const state = createTurretDefense(plan([3, 2]), { x: 0, z: 0 }, 5, START);
    run(state, INTRO_END);
    spawnAll(state);
    kill(state, 2);
    expect(types(run(state, state.tick + 20))).toEqual([]);
    expect([state.wave, state.phase, living(state)]).toEqual([0, 'wave', 1]);
  });

  it('wins on the last wave clear, and resupplies each resupply wave once', () => {
    const state = createTurretDefense(plan([3, 3, 3]), { x: 0, z: 0 }, 5, START);
    run(state, INTRO_END);
    const all: TurretEvent[] = [];
    for (let wave = 0; wave < 3; wave++) {
      spawnAll(state);
      kill(state, living(state));
      all.push(...run(state, state.tick + 1));
    }
    expect(types(all.filter((e) => e.type !== 'windupStart'))).toEqual([
      'waveCleared',
      'resupply',
      'waveStart',
      'waveCleared',
      'resupply',
      'waveStart',
      'waveCleared',
      'ended',
    ]);
    expect(state.phase).toBe('won');
    expect(state.stats.resupplies).toBe(2);
  });

  it.each(FIRE_AND_FLY_SCENARIOS.map((s) => [s.boardKey, s] as const))(
    "sets %s's next wave off on its clear's tick, its first spawn on its own schedule after it",
    (_key, scenario) => {
      // An unbreakable tower: nobody shoots here, and a wave's walkers would bring the 100
      // points down before the last ones spawn.
      const resolved = resolveTurretPlan({ ...scenario, integrity: 100_000 });
      const state = createTurretDefense(resolved, { x: 0, z: 0 }, 9, START);
      run(state, INTRO_END);
      let kegged = 0;
      for (let wave = 0; wave < resolved.waves.length - 1; wave++) {
        spawnAll(state);
        kill(state, living(state));
        const at = state.tick + 1;
        const events = run(state, at);
        const next = resolved.waves[wave + 1];
        // The clear, its resupply, the next wave's start, then its kegs, all on one tick.
        const grant = turretResupplyAfter(resolved, wave);
        const resupply =
          grant && grant.shockwave + grant.fragmentation > 0
            ? [{ type: 'resupply', wave, ...grant }]
            : [];
        const chain = events.filter((e) => CHAIN.has(e.type));
        const head = 2 + resupply.length;
        expect(chain.slice(0, head)).toEqual([
          { type: 'waveCleared', wave },
          ...resupply,
          { type: 'waveStart', wave: wave + 1, count: next.spawns.length },
        ]);
        const rest = types(chain.slice(head));
        expect(rest).toEqual(rest.length ? ['barrelsPlaced'] : []);
        kegged += rest.length;
        expect([state.wave, state.phase]).toEqual([wave + 1, 'wave']);
        const first = Math.max(at + 1, at + (next.hunt?.ticks[0] ?? 0));
        expect(state.nextSpawnTick).toBe(at + (next.hunt?.ticks[0] ?? 0));
        run(state, first - 1);
        expect(state.spawnCursor).toBe(0);
        run(state, first);
        expect(state.spawnCursor).toBeGreaterThan(0);
      }
      const laysKegs = resolved.waves
        .slice(1)
        .some((w) => w.barrels.count > 0 || w.hunt?.packs.some((p) => p.kegs.length > 0));
      expect(kegged > 0).toBe(laysKegs);
    },
  );
});
