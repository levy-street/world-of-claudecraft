// Fire and Fly keg spacing and clusters (src/sim/minigames/turret_keg_clusters.ts, laid by
// layTurretKegs in turret_barrels.ts for every keg lot): a spaced lot stands each keg out of
// chain reach of every keg standing, leftovers included, within a bounded number of draws; a
// cluster's kegs stand 1.5 to 2 yd apart around one spot, whole or not at all, and go up as
// one chain once one is lit; the resolver and the online decoder refuse a forged lot. No
// shipped scenario sets any of it: these run on synthetic plans.
import { describe, expect, it } from 'vitest';
import { decodeTurretPlan } from '../src/net/turret_session_wire';
import { TURRET_SCENARIO_STANDARD } from '../src/sim/content/fire_and_fly_scenarios';
import {
  TURRET_BOWLING,
  TURRET_EXPLOSIVE_BARREL,
  TURRET_KEG_CROWN,
  TURRET_KEG_SPACING,
  TURRET_SIZE_CLASSES,
  TURRET_TIMING,
} from '../src/sim/content/turret_defense';
import type { ThrowProbe } from '../src/sim/minigames/thrown_body';
import {
  layTurretKegs,
  lightTurretBarrel,
  standTurretBarrel,
  type TurretBarrel,
} from '../src/sim/minigames/turret_barrels';
import {
  createTurretDefense,
  fireTurret,
  type TurretDefenseState,
  type TurretEvent,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan, type TurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { TURRET_STREAM } from '../src/sim/minigames/turret_defense_rng';
import type { TurretWavePlan } from '../src/sim/minigames/turret_group_plan';
import { turretKegClusterSpots, turretKegLotKegs } from '../src/sim/minigames/turret_keg_clusters';
import { placeTurretFieldKegs, placeTurretPathKegs } from '../src/sim/minigames/turret_keg_lots';
import { openTurretRallies } from '../src/sim/minigames/turret_rally';
import type { TurretKegLotDef, TurretScenarioDef } from '../src/sim/types';
import { TURRET_BRICKS_SCENARIO, walkersWavePlan } from './helpers/turret_wave_plan';

const flat: ThrowProbe = { ground: () => 0, water: () => null };
const START = 1000;
const EPS = 1e-9;
const { isolated, clusterMin, clusterMax, chainReach } = TURRET_KEG_SPACING;

function plan(waves: TurretWavePlan[]): TurretPlan {
  return {
    scenarioId: 'test',
    integrity: 100,
    medals: TURRET_SCENARIO_STANDARD.medals,
    arsenal: { shockwave: 0, fragmentation: 0 },
    resupplyWaves: [],
    chargeBonus: false,
    kinds: [
      {
        templateId: 'forest_wolf',
        level: 2,
        sizeClass: 'small',
        maxHp: 1e6,
        marchSpeed: 0.0001,
        ...TURRET_SIZE_CLASSES.small,
      },
    ],
    waves,
    bowling: { ...TURRET_BOWLING, enabled: false },
  };
}

function stateFor(wave: TurretWavePlan, seed: number): TurretDefenseState {
  return createTurretDefense(plan([wave]), { x: 0, z: 0 }, seed, START);
}

const d = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

/** Kegs within a cluster's reach of each other, joined: each set is one keg or one cluster. */
function clustersOf(barrels: readonly TurretBarrel[]): TurretBarrel[][] {
  const sets: TurretBarrel[][] = [];
  for (const b of barrels) {
    const near = sets.filter((set) => set.some((o) => d(o, b) <= clusterMax + EPS));
    const merged = [b, ...near.flat()];
    for (const set of near) sets.splice(sets.indexOf(set), 1);
    sets.push(merged);
  }
  return sets;
}

/** Every pair of kegs not of one cluster stands at least `spacing` apart. */
function expectSpaced(barrels: readonly TurretBarrel[], spacing: number): void {
  const sets = clustersOf(barrels);
  for (const set of sets) {
    expect(set.length).toBeLessThanOrEqual(3);
    for (const a of set)
      for (const b of set) if (a !== b) expect(d(a, b)).toBeGreaterThanOrEqual(clusterMin - EPS);
  }
  for (const a of sets)
    for (const b of sets)
      if (a !== b)
        for (const x of a) for (const y of b) expect(d(x, y)).toBeGreaterThanOrEqual(spacing - EPS);
}

describe('the spacing', () => {
  it('stands an isolated keg past the chain reach a keg blast lights another within', () => {
    expect(chainReach).toBe(TURRET_EXPLOSIVE_BARREL.blastRadius + TURRET_EXPLOSIVE_BARREL.radius);
    expect(isolated).toBeGreaterThan(chainReach);
    expect(clusterMax).toBeLessThan(chainReach);
    expect(clusterMin).toBeGreaterThan(2 * TURRET_EXPLOSIVE_BARREL.radius);
  });

  it('keeps every new spaced keg out of chain reach of every keg standing, leftovers included', () => {
    const kegs: TurretKegLotDef[] = [
      { mode: 'random', count: 4, minRadius: 16, maxRadius: 30, spaced: true },
      { mode: 'crown', count: 3, size: 'small' },
      { mode: 'crown', count: 3, size: 'large', cluster: 2, clusters: 1 },
      { mode: 'random', count: 3, minRadius: 26, maxRadius: 34, cluster: 3 },
    ];
    const wave = walkersWavePlan([0], { kegs, kegCap: 24 });
    let placed = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const state = stateFor(wave, seed);
      // Kegs left standing by an earlier wave, one well inside the field.
      standTurretBarrel(state, 0, 20, flat);
      standTurretBarrel(state, -22, -5, flat);
      const before = [...state.barrels];
      const out = placeTurretFieldKegs(state, wave, START, flat);
      placed += out.length;
      expectSpaced(state.barrels, isolated);
      for (const keg of out)
        for (const old of before) expect(d(keg, old)).toBeGreaterThanOrEqual(isolated);
    }
    expect(placed).toBeGreaterThan(16 * 10);
  });

  it('spaces a route keg that opts in, on a walking group and on a pack', () => {
    const scenario: TurretScenarioDef = {
      ...TURRET_SCENARIO_STANDARD,
      id: 'test_spaced_route',
      boardKey: 'test',
      waves: [TURRET_BRICKS_SCENARIO.waves[1]],
    };
    const resolved = resolveTurretPlan(scenario);
    const wave = {
      ...resolved.waves[0],
      kegs: resolved.waves[0].kegs.map((lot) =>
        lot.mode === 'path' ? { ...lot, spaced: true as const } : lot,
      ),
      kegCap: 24,
    };
    let placed = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const state = createTurretDefense(
        { ...resolved, waves: [wave] },
        { x: 0, z: 0 },
        seed,
        START,
      );
      standTurretBarrel(state, 0, -30, flat);
      standTurretBarrel(state, 25, 10, flat);
      openTurretRallies(state, wave);
      const before = [...state.barrels];
      const out = placeTurretPathKegs(state, wave, START, flat);
      placed += out.length;
      for (const keg of out)
        for (const other of [...before, ...out])
          if (other !== keg && d(other, keg) > clusterMax + EPS)
            expect(d(other, keg)).toBeGreaterThanOrEqual(isolated - EPS);
    }
    expect(placed).toBeGreaterThan(12 * 2);
  });

  /** Every keg a spaced lot laid stands `isolated` from every keg but its cluster's. */
  function expectSpacedKept(barrels: readonly TurretBarrel[]): number {
    const sets = clustersOf(barrels);
    let spaced = 0;
    for (const set of sets)
      for (const a of set) {
        if (a.spacing === undefined) continue;
        spaced++;
        for (const b of barrels)
          if (!set.includes(b)) expect(d(a, b)).toBeGreaterThanOrEqual(isolated - EPS);
      }
    return spaced;
  }

  it('keeps a spaced keg clear of the unspaced lots laid after it, leftovers included', () => {
    const kegs: TurretKegLotDef[] = [
      { mode: 'crown', count: 3, size: 'large' },
      { mode: 'random', count: 8, minRadius: 10, maxRadius: 22 },
    ];
    const wave = walkersWavePlan([0], { kegs, kegCap: 24 });
    let spaced = 0;
    let unspaced = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const state = stateFor(wave, seed);
      standTurretBarrel(state, 0, -17, flat, isolated);
      placeTurretFieldKegs(state, wave, START, flat);
      spaced += expectSpacedKept(state.barrels);
      unspaced += state.barrels.filter((b) => b.spacing === undefined).length;
    }
    expect(spaced).toBeGreaterThan(24 * 2);
    expect(unspaced).toBeGreaterThan(24 * 2);
  });

  it('keeps a spaced field or route keg clear of the unspaced route and lane kegs after it', () => {
    const resolved = resolveTurretPlan(TURRET_BRICKS_SCENARIO);
    const wave = resolved.waves[1];
    let spaced = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const state = createTurretDefense(resolved, { x: 0, z: 0 }, seed, START);
      state.wave = 1;
      placeTurretFieldKegs(state, wave, START, flat);
      openTurretRallies(state, wave);
      placeTurretPathKegs(state, wave, START, flat);
      spaced += expectSpacedKept(state.barrels);
    }
    expect(spaced).toBeGreaterThan(120);
  });

  it('drops a keg with no room left within its draws, and lays the same spots for the same seed', () => {
    const wave = walkersWavePlan([0], {
      kegs: [{ mode: 'crown', count: 20, size: 'large' }],
      kegCap: 24,
    });
    const a = stateFor(wave, 7);
    const placed = placeTurretFieldKegs(a, wave, START, flat);
    // A 13.5 yd band holds at most seven kegs 12 yd apart.
    expect(placed.length).toBeGreaterThan(2);
    expect(placed.length).toBeLessThanOrEqual(7);
    expectSpaced(placed, isolated);
    expect(placeTurretFieldKegs(stateFor(wave, 7), wave, START, flat)).toEqual(placed);
    expect(placeTurretFieldKegs(stateFor(wave, 8), wave, START, flat)).not.toEqual(placed);
  });

  it('leaves an unspaced lot on the barrels own spacing, as the shipped content lays it', () => {
    const lot = { mode: 'random', count: 6, minRadius: 16, maxRadius: 20 } as const;
    const wave = walkersWavePlan([0], { kegs: [lot] });
    let near = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const state = stateFor(wave, seed);
      const placed = placeTurretFieldKegs(state, wave, START, flat);
      for (const a of placed)
        for (const b of placed) {
          if (a === b) continue;
          expect(d(a, b)).toBeGreaterThanOrEqual(TURRET_EXPLOSIVE_BARREL.minSpacing);
          if (d(a, b) <= chainReach) near++;
        }
    }
    expect(near).toBeGreaterThan(0);
  });
});

describe('clusters', () => {
  it('stands a cluster of two or three 1.5 to 2 yd apart around its spot', () => {
    for (const kegs of [2, 3])
      for (const turn of [0, 0.3, 0.77])
        for (const gap of [0, 0.5, 0.999]) {
          const spots = turretKegClusterSpots(10, -4, kegs, turn, gap);
          expect(spots).toHaveLength(kegs);
          const cx = spots.reduce((n, s) => n + s.x, 0) / kegs;
          const cz = spots.reduce((n, s) => n + s.z, 0) / kegs;
          expect(cx).toBeCloseTo(10, 9);
          expect(cz).toBeCloseTo(-4, 9);
          const apart = clusterMin + gap * (clusterMax - clusterMin);
          for (const a of spots)
            for (const b of spots) if (a !== b) expect(d(a, b)).toBeCloseTo(apart, 9);
        }
    expect(turretKegClusterSpots(3, 4, 1, 0.5, 0.5)).toEqual([{ x: 3, z: 4 }]);
  });

  it('lays a lot whose first spots are clusters, spaced from every other keg and cluster', () => {
    const lot = {
      mode: 'random',
      count: 4,
      minRadius: 18,
      maxRadius: 32,
      cluster: 3,
      clusters: 2,
    } as const;
    expect(turretKegLotKegs(lot)).toBe(8);
    const wave = walkersWavePlan([0], { kegs: [lot], kegCap: 24 });
    let whole = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const state = stateFor(wave, seed);
      const placed = placeTurretFieldKegs(state, wave, START, flat);
      expectSpaced(placed, isolated);
      const sets = clustersOf(placed);
      const sizes = sets.map((s) => s.length).sort();
      for (const size of sizes) expect([1, 3]).toContain(size);
      expect(sizes.filter((n) => n === 3).length).toBeLessThanOrEqual(2);
      whole += sizes.filter((n) => n === 3).length;
      for (const set of sets)
        for (const a of set)
          for (const b of set) if (a !== b) expect(d(a, b)).toBeLessThanOrEqual(clusterMax + EPS);
    }
    expect(whole).toBeGreaterThan(16);
  });

  it('counts each keg of a cluster against the cap, and lays a cluster whole or not at all', () => {
    const lot = { mode: 'crown', count: 2, size: 'small', cluster: 3 } as const;
    for (const [cap, kegs] of [
      [8, 6],
      [5, 3],
      [2, 0],
    ] as const) {
      const wave = walkersWavePlan([0], { kegs: [lot], kegCap: cap });
      for (let seed = 1; seed <= 6; seed++) {
        const state = stateFor(wave, seed);
        const placed = placeTurretFieldKegs(state, wave, START, flat);
        expect(placed.length).toBeLessThanOrEqual(kegs);
        expect(placed.length % 3).toBe(0);
        expect(state.barrels.length).toBeLessThanOrEqual(cap);
      }
    }
    // A pack's path cluster waits for room for every keg of it.
    const resolved = resolveTurretPlan(TURRET_BRICKS_SCENARIO);
    const wave = resolved.waves[1];
    expect(wave.kegs[0]).toMatchObject({ mode: 'path', cluster: 2 });
    const pathKegs = (seed: number, standing: number) => {
      const state = createTurretDefense(resolved, { x: 0, z: 0 }, seed, START);
      state.wave = 1;
      for (let i = 0; i < standing; i++) standTurretBarrel(state, 80 + 13 * i, 80, flat);
      openTurretRallies(state, wave);
      return clustersOf(placeTurretPathKegs(state, wave, START, flat)).map((set) => set.length);
    };
    let pairs = 0;
    for (let seed = 1; seed <= 8; seed++) {
      pairs += pathKegs(seed, 0).filter((n) => n === 2).length;
      expect(pathKegs(seed, (wave.kegCap ?? 0) - 1)).not.toContain(2);
    }
    expect(pairs).toBeGreaterThan(4);
  });

  /** Kegs of a cluster of three at (20, 0) on a quiet field, and the ticks each blows. */
  function cluster(seed: number) {
    const wave = walkersWavePlan([0]);
    const state = stateFor(wave, seed);
    for (let t = START + 1; t <= START + TURRET_TIMING.introTicks; t++)
      tickTurretDefense(state, t, flat);
    for (const g of state.spawning) g.nextTick = Number.MAX_SAFE_INTEGER;
    const site = { stream: TURRET_STREAM.kegCluster, index: 0, key: seed };
    const kegs = layTurretKegs(
      state,
      20,
      0,
      { spacing: isolated, kegs: 3 },
      site,
      state.tick,
      flat,
    );
    if (!kegs) throw new Error('a clear field');
    const blew = new Map<number, number>();
    const run = (toTick: number) => {
      for (let t = state.tick + 1; t <= toTick; t++)
        for (const e of tickTurretDefense(state, t, flat) as TurretEvent[])
          if (e.type === 'barrelExploded') blew.set(e.id, t);
    };
    return { state, kegs, blew, run };
  }

  it('sets the whole cluster off when one keg is lit: the others go up together a fuse later', () => {
    const fuse = TURRET_EXPLOSIVE_BARREL.fuseTicks;
    for (const seed of [1, 2, 3]) {
      const { state, kegs, blew, run } = cluster(seed);
      const t0 = state.tick;
      lightTurretBarrel(state, kegs[0], t0, []);
      run(t0 + 4 * fuse);
      expect(blew.get(kegs[0].id)).toBe(t0 + fuse);
      expect(blew.get(kegs[1].id)).toBe(t0 + 2 * fuse);
      expect(blew.get(kegs[2].id)).toBe(t0 + 2 * fuse);
    }
  });

  it('blows a whole cluster on one tick when a shell lands on it', () => {
    const { state, kegs, blew, run } = cluster(4);
    expect(fireTurret(state, state.tick, 20, 0, flat).ok).toBe(true);
    run(state.tick + 20 * 3);
    const ticks = new Set(kegs.map((k) => blew.get(k.id)));
    expect(ticks.size).toBe(1);
    expect([...ticks][0]).toBeDefined();
  });

  it('never lets an isolated keg set off one standing at the spacing', () => {
    const { state, kegs, blew, run } = cluster(5);
    state.barrels = state.barrels.filter((b) => b === kegs[0]);
    const far = standTurretBarrel(state, kegs[0].x + isolated, kegs[0].z, flat);
    lightTurretBarrel(state, kegs[0], state.tick, []);
    run(state.tick + 20 * 3);
    expect(blew.has(kegs[0].id)).toBe(true);
    expect(blew.has(far.id)).toBe(false);
  });
});

describe('validation', () => {
  const scenario = (kegs: TurretKegLotDef[]): TurretScenarioDef => ({
    ...TURRET_SCENARIO_STANDARD,
    id: 'test_keg_validation',
    boardKey: 'test',
    waves: [{ ...TURRET_SCENARIO_STANDARD.waves[0], kegs }],
  });
  const ring = { mode: 'random', count: 2, minRadius: 16, maxRadius: 30 } as const;

  it('resolves the new fields and refuses a lot that sets them wrong', () => {
    const good: TurretKegLotDef[] = [
      { ...ring, spaced: true, cluster: 2, clusters: 1 },
      { mode: 'crown', count: 2, size: 'small', cluster: 3 },
      { mode: 'crown', count: 1, size: 'large' },
    ];
    expect(resolveTurretPlan(scenario(good)).waves[0].kegs).toEqual(good);
    const bad = [
      { ...ring, cluster: 4 },
      { ...ring, cluster: 1 },
      { ...ring, cluster: 2, clusters: 0 },
      { ...ring, cluster: 2, clusters: 3 },
      { ...ring, cluster: 2, clusters: 1.5 },
      { ...ring, clusters: 1 },
      { ...ring, spaced: false },
      { mode: 'crown', count: 2 },
      { mode: 'crown', count: 2, size: 'medium' },
      { mode: 'crown', count: 2, size: 'huge' },
      // Nine clusters of three lay 27 kegs: past the plan's 24.
      { ...ring, count: 9, cluster: 3 },
    ] as unknown as TurretKegLotDef[];
    for (const lot of bad)
      expect(() => resolveTurretPlan(scenario([lot])), JSON.stringify(lot)).toThrow(/bad kegs/);
  });

  it('decodes the bricks plan as resolved, and refuses a forged keg lot', () => {
    const resolved = resolveTurretPlan(TURRET_BRICKS_SCENARIO);
    const wire = () => JSON.parse(JSON.stringify(resolved));
    expect(decodeTurretPlan(wire())).toEqual(resolved);
    const kegs = resolved.waves.flatMap((w) => w.kegs);
    expect(kegs).toContainEqual(expect.objectContaining({ mode: 'crown', size: 'small' }));
    expect(kegs).toContainEqual(expect.objectContaining({ mode: 'crown', size: 'large' }));
    expect(kegs.some((k) => k.mode === 'random' && k.cluster === 3)).toBe(true);
    expect(kegs.some((k) => k.mode === 'path' && k.cluster === 2)).toBe(true);
    expect(TURRET_KEG_CROWN).toHaveProperty('small');
    const forges: ((p: { waves: { kegs: Record<string, unknown>[] }[] }) => void)[] = [
      (p) => (p.waves[0].kegs[0].cluster = 4),
      (p) => (p.waves[0].kegs[0].clusters = 3),
      (p) => (p.waves[0].kegs[0].clusters = 0),
      (p) => delete p.waves[0].kegs[0].cluster,
      (p) => (p.waves[0].kegs[0].spaced = false),
      (p) => (p.waves[0].kegs[1].size = 'huge'),
      (p) => delete p.waves[0].kegs[1].size,
      (p) => (p.waves[1].kegs[0].cluster = 1),
      (p) => (p.waves[0].kegs[2].spaced = 'yes'),
      // 22 spots, the first a cluster of three: past the plan's 24 kegs with the other lots.
      (p) => (p.waves[0].kegs[0].count = 22),
    ];
    for (const forge of forges) {
      const forged = wire();
      forge(forged);
      expect(decodeTurretPlan(forged), forge.toString()).toBeNull();
    }
  });
});
