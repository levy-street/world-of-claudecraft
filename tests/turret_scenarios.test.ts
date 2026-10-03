import { describe, expect, it } from 'vitest';
import {
  TURRET_DEFAULT_SCENARIO,
  TURRET_SCENARIO_HARD,
  TURRET_SCENARIO_INTRODUCTION,
  TURRET_SCENARIO_STANDARD,
  TURRET_SCENARIOS,
} from '../src/sim/content/fire_and_fly_scenarios';
import {
  TURRET_BOWLING,
  TURRET_EXPLOSIVE_BARREL,
  TURRET_SIZE_CLASSES,
  TURRET_TEMPLATE_SIZES,
  TURRET_TIMING,
  TURRET_WAVES,
} from '../src/sim/content/turret_defense';
import { MOBS } from '../src/sim/data';
import { mobMaxHp } from '../src/sim/entity';
import { positionAt, type ThrowProbe } from '../src/sim/minigames/thrown_body';
import { turretArrivalGap, turretArrivalSector } from '../src/sim/minigames/turret_arrival';
import {
  type TurretBearingSector,
  turretFreeBearing,
  turretSpawnBearing,
} from '../src/sim/minigames/turret_barrels';
import {
  createTurretDefense,
  fireTurret,
  type TurretDefenseState,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import {
  resolveTurretPlan,
  TURRET_PLAN_LIMITS,
  type TurretKind,
  type TurretPlan,
} from '../src/sim/minigames/turret_defense_plan';
import { TURRET_STREAM, turretDraw } from '../src/sim/minigames/turret_defense_rng';
import { turretResult } from '../src/sim/minigames/turret_result';
import type { TurretArrivalDef, TurretScenarioDef, TurretWaveDef } from '../src/sim/types';

const TAU = Math.PI * 2;
const START = 1000;
const INTRO_END = START + TURRET_TIMING.introTicks;
const flat: ThrowProbe = { ground: () => 0, water: () => null };
const hills: ThrowProbe = {
  ground: (x, z) => 2 * Math.sin(x * 0.11) + 1.5 * Math.cos(z * 0.13) + 0.04 * x,
  water: () => null,
};
const NO_BARRELS = { count: 0, minRadius: 0, maxRadius: 0 };

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Signed angle from `b` to `a`, in (-PI, PI]. */
function angleOff(a: number, b: number): number {
  return ((((a - b + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

function scenario(waves: TurretWaveDef[], integrity = 100): TurretScenarioDef {
  return { ...TURRET_SCENARIO_STANDARD, id: 'test_scenario', boardKey: 'test', waves, integrity };
}

function wolves(count: number, arrival?: TurretArrivalDef): TurretWaveDef {
  return {
    entries: [{ templateId: 'forest_wolf', count, level: 2 }],
    coreDamage: 60,
    gapMinTicks: 16,
    gapMaxTicks: 32,
    barrels: NO_BARRELS,
    ...(arrival ? { arrival } : {}),
  };
}

function sectorOf(...args: Parameters<typeof turretArrivalSector>): TurretBearingSector {
  const sector = turretArrivalSector(...args);
  if (!sector) throw new Error('expected an arrival sector');
  return sector;
}

interface Spawn {
  id: number;
  tick: number;
  bearing: number;
}

/** Runs the first wave unshot until every monster spawned; each spawn's tick and bearing. */
function spawns(plan: TurretPlan, seed: number, setup?: (s: TurretDefenseState) => void) {
  const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, START);
  const seen: Spawn[] = [];
  const total = plan.waves[0].spawns.length;
  for (let t = START + 1; seen.length < total && t < INTRO_END + 20 * 120; t++) {
    if (t === INTRO_END && setup) setup(state);
    tickTurretDefense(state, t, flat);
    for (const m of state.monsters) {
      if (seen.some((s) => s.id === m.id)) continue;
      const { x, z } = m.seg;
      seen.push({ id: m.id, tick: t, bearing: Math.atan2(x, z) });
    }
  }
  expect(seen).toHaveLength(total);
  return { state, seen };
}

/**
 * One weapon brought in per trial, generously the first time: the cannon and the kegs
 * alone, then the Shockwave, then the fragmentation shell beside fewer Shockwaves.
 */
const TRIAL_ARSENALS: Record<string, { shockwave: number; fragmentation: number }> = {
  introduction: { shockwave: 0, fragmentation: 0 },
  standard: { shockwave: 4, fragmentation: 0 },
  hard: { shockwave: 2, fragmentation: 4 },
};

describe('the scenario table', () => {
  it('offers Introduction, Standard and Hard, with frozen unique ids and board keys', () => {
    expect(TURRET_SCENARIOS.map((s) => [s.id, s.boardKey])).toEqual([
      ['fire_and_fly_introduction', 'introduction'],
      ['fire_and_fly_standard', 'standard'],
      ['fire_and_fly_hard', 'hard'],
    ]);
    expect(TURRET_DEFAULT_SCENARIO).toBe(TURRET_SCENARIO_STANDARD);
    for (const s of TURRET_SCENARIOS) {
      expect(s.boardKey).toMatch(/^[a-z]+$/);
      expect(s.supply).toBeUndefined();
      expect(s.medals.silver.minIntegrityShare).toBeGreaterThan(0);
      expect(s.medals.silver.minIntegrityShare).toBeLessThan(s.medals.gold.minIntegrityShare);
      expect(s.medals.gold.minIntegrityShare).toBeLessThanOrEqual(1);
    }
  });

  it('keeps Standard the original run: the same wave table and 100 tower points', () => {
    expect(TURRET_SCENARIO_STANDARD.waves).toBe(TURRET_WAVES);
    expect(TURRET_SCENARIO_STANDARD.integrity).toBe(100);
    for (const wave of TURRET_WAVES) expect(wave.arrival).toBeUndefined();
    for (const e of TURRET_WAVES.flatMap((w) => w.entries)) expect(e.hpScale).toBeUndefined();
  });

  it('makes Introduction short, small, on the whole ring, with more tower points', () => {
    const intro = TURRET_SCENARIO_INTRODUCTION;
    expect(intro.waves).toHaveLength(3);
    expect(intro.integrity).toBeGreaterThan(TURRET_SCENARIO_STANDARD.integrity);
    for (const wave of intro.waves) {
      expect(wave.arrival).toBeUndefined();
      expect(wave.gapMinTicks).toBeGreaterThan(TURRET_WAVES[0].gapMinTicks);
      for (const e of wave.entries) {
        expect(TURRET_TEMPLATE_SIZES[e.templateId]).toBe('small');
        expect(e.hpScale).toBeUndefined();
      }
    }
    const count = (s: TurretScenarioDef) =>
      s.waves.reduce((n, w) => n + w.entries.reduce((m, e) => m + e.count, 0), 0);
    expect(count(intro)).toBeLessThan(count(TURRET_SCENARIO_STANDARD) / 2);
  });

  it('makes Hard use every arrival pattern, tougher monsters and more of the large ones', () => {
    const hard = TURRET_SCENARIO_HARD;
    expect(new Set(hard.waves.map((w) => w.arrival?.kind))).toEqual(
      new Set(['arc', 'flanks', 'burst']),
    );
    expect(hard.waves.filter((w) => w.arrival?.kind !== 'arc').length).toBeGreaterThan(4);
    expect(Math.max(...hard.waves.flatMap((w) => w.entries).map((e) => e.hpScale ?? 1))).toBe(1.8);
    const count = (s: TurretScenarioDef, sizes: readonly string[]) =>
      s.waves
        .flatMap((w) => w.entries)
        .filter((e) => sizes.includes(TURRET_TEMPLATE_SIZES[e.templateId]))
        .reduce((n, e) => n + e.count, 0);
    const all = ['small', 'medium', 'large', 'huge'];
    const std = TURRET_SCENARIO_STANDARD;
    expect(count(hard, all)).toBeGreaterThanOrEqual(count(std, all) * 1.3);
    expect(count(hard, ['large', 'huge'])).toBeGreaterThan(count(std, ['large', 'huge']) * 2.5);
    expect(count(hard, ['huge'])).toBeGreaterThan(count(std, ['huge']));
    expect(hard.waves[0].gapMinTicks).toBeLessThan(TURRET_WAVES[0].gapMinTicks);
    expect(hard.waves[0].gapMaxTicks).toBeLessThan(TURRET_WAVES[0].gapMaxTicks);
  });

  it('gives Hard tight packs, two rushes on three sides at once, the giant last', () => {
    const [, packs, rush, , lastRush, last] = TURRET_SCENARIO_HARD.waves;
    expect(packs.arrival).toMatchObject({ kind: 'burst', groupSize: 10 });
    expect(packs.gapMaxTicks).toBeLessThanOrEqual(5);
    for (const wave of [rush, lastRush]) {
      expect(wave.arrival).toMatchObject({ kind: 'flanks', count: 3 });
      expect(wave.gapMaxTicks).toBeLessThanOrEqual(2);
    }
    expect(last.entries.at(-1)).toMatchObject({ templateId: 'idol_guardian', bossLast: true });
  });

  it("keeps Hard's kegs wave by wave as many as Standard's: they were barely used", () => {
    expect(TURRET_SCENARIO_HARD.waves.map((w) => w.barrels)).toEqual(
      TURRET_WAVES.map((w) => w.barrels),
    );
  });
});

describe('resolving a scenario into a plan', () => {
  it('resolves Standard (the default) to the plan the original table resolved to', () => {
    const plan = resolveTurretPlan();
    expect(resolveTurretPlan(TURRET_SCENARIO_STANDARD)).toEqual(plan);
    expect(plan.scenarioId).toBe('fire_and_fly_standard');
    expect(plan.integrity).toBe(100);
    expect(plan.arsenal).toEqual({ shockwave: 4, fragmentation: 0 });
    for (const wave of plan.waves) expect(wave.arrival).toEqual({ kind: 'ring' });
    // The resolved plan as the resolver built it before scenarios, byte for byte.
    const before = { kinds: plan.kinds, waves: plan.waves.map(({ arrival, ...w }) => w) };
    expect(fnv(JSON.stringify({ ...before, bowling: plan.bowling }))).toBe('25a6e680');
  });

  it.each(TURRET_SCENARIOS.map((s) => [s.boardKey, s] as const))(
    'carries %s: its id, tower points and the arsenal it brings in, deep-frozen',
    (key, s) => {
      const plan = resolveTurretPlan(s);
      expect(plan.scenarioId).toBe(s.id);
      expect(plan.integrity).toBe(s.integrity);
      expect(plan.arsenal).toEqual(TRIAL_ARSENALS[key]);
      expect(plan.resupplyWaves).toEqual([]);
      expect(plan.chargeBonus).toBe(false);
      expect(plan.waves).toHaveLength(s.waves.length);
      expect(Object.isFrozen(plan.arsenal)).toBe(true);
      expect(Object.isFrozen(plan.waves[0].arrival)).toBe(true);
      plan.waves.forEach((wave, i) => {
        expect(wave.arrival).toEqual(s.waves[i].arrival ?? { kind: 'ring' });
        expect(wave.arrival).not.toBe(s.waves[i].arrival);
        expect(wave.spawns).toHaveLength(s.waves[i].entries.reduce((n, e) => n + e.count, 0));
      });
    },
  );

  it('carries the medal bars, and refuses bars that are not silver under gold within the tower', () => {
    for (const s of TURRET_SCENARIOS) expect(resolveTurretPlan(s).medals).toEqual(s.medals);
    const plan = resolveTurretPlan();
    expect(plan.medals).not.toBe(TURRET_SCENARIO_STANDARD.medals);
    expect(Object.isFrozen(plan.medals.gold)).toBe(true);
    const bars = (gold: number, silver: number) => () =>
      resolveTurretPlan({
        ...TURRET_SCENARIO_STANDARD,
        medals: { gold: { minIntegrityShare: gold }, silver: { minIntegrityShare: silver } },
      });
    expect(bars(1, 0.99)).not.toThrow();
    for (const [gold, silver] of [
      [0.6, 0.6],
      [0.5, 0.6],
      [1.1, 0.6],
      [0.9, 0],
      [0.9, -0.2],
      [Number.NaN, 0.5],
    ]) {
      expect(bars(gold, silver)).toThrow(/bad medal bars/);
    }
  });

  it('refuses bars that leave a medal out of reach once rounded to whole tower points', () => {
    const bars = (integrity: number, gold: number, silver: number) => () =>
      resolveTurretPlan({
        ...TURRET_SCENARIO_STANDARD,
        integrity,
        medals: { gold: { minIntegrityShare: gold }, silver: { minIntegrityShare: silver } },
      });
    expect(bars(3, 0.9, 0.6)).not.toThrow();
    // Gold and silver at the same whole point: no win is silver.
    expect(bars(10, 0.95, 0.91)).toThrow(/bad medal bars/);
    expect(bars(2, 0.9, 0.6)).toThrow(/bad medal bars/);
    // Silver at a win's last point: no win is bronze.
    expect(bars(100, 0.9, 0.01)).toThrow(/bad medal bars/);
    expect(bars(1, 1, 0.5)).toThrow(/bad medal bars/);
  });

  it('carries a scenario arsenal, absent charges as 0', () => {
    const plan = resolveTurretPlan({ ...TURRET_SCENARIO_STANDARD, arsenal: { shockwave: 3 } });
    expect(plan.arsenal).toEqual({ shockwave: 3, fragmentation: 0 });
    expect(resolveTurretPlan({ ...TURRET_SCENARIO_STANDARD, arsenal: undefined }).arsenal).toEqual({
      shockwave: 0,
      fragmentation: 0,
    });
  });

  it('scales health by the entry, rounded, as a kind of its own', () => {
    const waves = [
      {
        ...wolves(0),
        entries: [
          { templateId: 'fen_troll', count: 1, level: 11 },
          { templateId: 'fen_troll', count: 1, level: 11, hpScale: 1.4 },
          { templateId: 'fen_troll', count: 1, level: 11, hpScale: 1 },
        ],
      },
    ];
    const plan = resolveTurretPlan(scenario(waves));
    const base = mobMaxHp(MOBS.fen_troll, 11);
    expect(plan.kinds.map((k) => k.maxHp)).toEqual([base, Math.round(base * 1.4)]);
    expect(plan.waves[0].spawns).toEqual([0, 1, 0]);
    const hard = resolveTurretPlan(TURRET_SCENARIO_HARD);
    const yeti = hard.kinds.find((k) => k.templateId === 'frostmane_yeti') as TurretKind;
    expect(yeti.maxHp).toBe(Math.round(mobMaxHp(MOBS.frostmane_yeti, 20) * 1.8));
    expect(yeti.breachValue).toBe(TURRET_SIZE_CLASSES.huge.breachValue);
  });

  it.each([
    ['a zero health scale', { hpScale: 0 }, /bad health scale/],
    ['a non-finite health scale', { hpScale: Number.NaN }, /bad health scale/],
  ])('refuses %s', (_name, extra, message) => {
    const waves = [{ ...wolves(1), entries: [{ ...wolves(1).entries[0], ...extra }] }];
    expect(() => resolveTurretPlan(scenario(waves))).toThrow(message);
  });

  it.each([
    ['an empty arc', { kind: 'arc', widthTurn: 0 }],
    ['an arc wider than the ring', { kind: 'arc', widthTurn: 1.5 }],
    ['four flanks', { kind: 'flanks', count: 4, widthTurn: 0.1 }],
    ['an empty pack', { kind: 'burst', groupSize: 0, groupGapTicks: 20, widthTurn: 0.1 }],
    ['a fractional pause', { kind: 'burst', groupSize: 3, groupGapTicks: 2.5, widthTurn: 0.1 }],
    ['an unknown pattern', { kind: 'spiral' }],
  ])('refuses %s', (_name, arrival) => {
    const waves = [wolves(4, arrival as unknown as TurretArrivalDef)];
    expect(() => resolveTurretPlan(scenario(waves))).toThrow(/bad \w+ arrival in test_scenario/);
  });

  it('refuses a tower with no points or fractional ones', () => {
    expect(() => resolveTurretPlan(scenario([wolves(1)], 0))).toThrow(/bad integrity/);
    expect(() => resolveTurretPlan(scenario([wolves(1)], 12.5))).toThrow(/bad integrity/);
  });

  const LIMITS = TURRET_PLAN_LIMITS;
  const pack = (groupSize: number, groupGapTicks: number): TurretArrivalDef => ({
    kind: 'burst',
    groupSize,
    groupGapTicks,
    widthTurn: 0.1,
  });
  // The online client's plan decoder rejects each of these: the server must never seat one.
  it.each([
    ['an id out of the wire alphabet', { id: 'Hard <b>' }, /bad scenario id/],
    ['an oversized id', { id: 'x'.repeat(LIMITS.scenarioIdLength + 1) }, /bad scenario id/],
    ['more tower points than the wire carries', { integrity: LIMITS.integrity + 1 }, /integrity/],
    ['negative charges', { arsenal: { shockwave: -1 } }, /bad shockwave charges/],
    ['fractional charges', { arsenal: { fragmentation: 1.5 } }, /bad fragmentation charges/],
    ['non-finite charges', { arsenal: { shockwave: Number.NaN } }, /bad shockwave charges/],
    ['too many charges', { arsenal: { fragmentation: LIMITS.charges + 1 } }, /fragmentation/],
    ['no wave', { waves: [] }, /bad wave count/],
    [
      'more waves than the wire carries',
      { waves: Array.from({ length: LIMITS.waves + 1 }, () => wolves(1)) },
      /bad wave count/,
    ],
    [
      'a wave spawning more than the wire carries',
      { waves: [wolves(LIMITS.spawnsPerWave + 1)] },
      /too many spawns/,
    ],
    [
      'more monster kinds than the wire carries',
      {
        waves: [
          {
            ...wolves(0),
            entries: Array.from({ length: LIMITS.kinds + 1 }, (_, i) => ({
              ...wolves(1).entries[0],
              hpScale: 1 + i / 100,
            })),
          },
        ],
      },
      /too many monster kinds/,
    ],
    [
      'a pack larger than the wire carries',
      { waves: [wolves(4, pack(LIMITS.spawnsPerWave + 1, 20))] },
      /bad burst arrival/,
    ],
    [
      'a pause longer than the wire carries',
      { waves: [wolves(4, pack(2, LIMITS.groupGapTicks + 1))] },
      /bad burst arrival/,
    ],
  ] as const)('refuses %s', (_name, override, message) => {
    const def = { ...scenario([wolves(1)]), ...override } as TurretScenarioDef;
    expect(() => resolveTurretPlan(def)).toThrow(message);
  });

  it('keeps the bowling rule a parameter', () => {
    const off = resolveTurretPlan(TURRET_SCENARIO_HARD, MOBS, {
      ...TURRET_BOWLING,
      enabled: false,
    });
    expect(off.bowling.enabled).toBe(false);
    expect(off.waves).toEqual(resolveTurretPlan(TURRET_SCENARIO_HARD).waves);
  });
});

describe('arrival sectors', () => {
  it('opens no sector on the ring, and one drawn side per wave for an arc', () => {
    expect(turretArrivalSector({ seed: 9 }, 0, { kind: 'ring' }, 3)).toBeNull();
    const arc = { kind: 'arc', widthTurn: 0.25 } as const;
    const w = sectorOf({ seed: 9 }, 2, arc, 0);
    expect(w.width).toBeCloseTo(TAU / 4, 12);
    const side = turretDraw({ seed: 9 }, TURRET_STREAM.arrivalSide, 2, 0) * TAU;
    expect(w.from + w.width / 2).toBeCloseTo(side, 12);
    expect(turretArrivalSector({ seed: 9 }, 2, arc, 7)).toEqual(w);
    expect(turretArrivalSector({ seed: 10 }, 2, arc, 0)).not.toEqual(w);
    expect(turretArrivalSector({ seed: 9 }, 3, arc, 0)).not.toEqual(w);
  });

  it('turns flanks evenly apart, the wave taking them in turn', () => {
    for (const count of [2, 3] as const) {
      const flanks = { kind: 'flanks', count, widthTurn: 0.1 } as const;
      const centers = [0, 1, 2, 3, 4, 5].map((i) => {
        const w = sectorOf({ seed: 4 }, 1, flanks, i);
        return w.from + w.width / 2;
      });
      for (let i = 0; i < centers.length; i++) {
        expect(angleOff(centers[i], centers[i % count])).toBeCloseTo(0, 9);
        expect(angleOff(centers[(i + 1) % centers.length], centers[i])).not.toBeCloseTo(0, 3);
      }
      expect(Math.abs(angleOff(centers[1], centers[0]))).toBeCloseTo(TAU / count, 9);
    }
  });

  it('gives each pack of a burst its own side and a pause after its last member', () => {
    const burst = { kind: 'burst', groupSize: 3, groupGapTicks: 70, widthTurn: 0.05 } as const;
    const packOf = (i: number) => sectorOf({ seed: 5 }, 0, burst, i);
    expect(packOf(1)).toEqual(packOf(0));
    expect(packOf(2)).toEqual(packOf(0));
    expect(packOf(3)).not.toEqual(packOf(0));
    expect(packOf(5)).toEqual(packOf(3));
    const wave = resolveTurretPlan(scenario([wolves(9, burst)])).waves[0];
    expect(turretArrivalGap({ seed: 5 }, wave, 2, 3)).toBe(70);
    expect(turretArrivalGap({ seed: 5 }, wave, 5, 6)).toBe(70);
    for (const index of [0, 1, 3, 4]) {
      const gap = turretArrivalGap({ seed: 5 }, wave, index, index + 1);
      expect(gap).toBeGreaterThanOrEqual(16);
      expect(gap).toBeLessThanOrEqual(32);
    }
  });

  it('keeps the ring gap draw exactly the one the engine always drew', () => {
    const wave = resolveTurretPlan().waves[0];
    for (let id = 1; id < 40; id++) {
      const draw = turretDraw({ seed: 3 }, TURRET_STREAM.spawnGap, id);
      expect(turretArrivalGap({ seed: 3 }, wave, id - 1, id)).toBe(16 + Math.floor(draw * 17));
    }
  });
});

describe('arrival bearings on the field', () => {
  it('spreads a ring wave all around', () => {
    const plan = resolveTurretPlan(scenario([wolves(40)]));
    const { seen } = spawns(plan, 3);
    const quarters = new Set(seen.map((s) => Math.floor(((s.bearing + TAU) % TAU) / (TAU / 4))));
    expect(quarters.size).toBe(4);
  });

  it('brings an arc wave through its one side, across the whole width', () => {
    const arrival = { kind: 'arc', widthTurn: 0.2 } as const;
    const plan = resolveTurretPlan(scenario([wolves(24, arrival)]));
    for (const seed of [1, 2, 3]) {
      const { seen } = spawns(plan, seed);
      const sector = sectorOf({ seed }, 0, arrival, 0);
      const mid = sector.from + sector.width / 2;
      const offs = seen.map((s) => angleOff(s.bearing, mid));
      for (const off of offs) expect(Math.abs(off)).toBeLessThanOrEqual(sector.width / 2 + 1e-9);
      expect(Math.max(...offs) - Math.min(...offs)).toBeGreaterThan(sector.width * 0.6);
    }
  });

  it('brings a flanks wave through its sides in turn', () => {
    const arrival = { kind: 'flanks', count: 3, widthTurn: 0.08 } as const;
    const plan = resolveTurretPlan(scenario([wolves(12, arrival)]));
    const { seen } = spawns(plan, 8);
    seen.forEach((s, i) => {
      const w = sectorOf({ seed: 8 }, 0, arrival, i);
      expect(Math.abs(angleOff(s.bearing, w.from + w.width / 2))).toBeLessThanOrEqual(
        w.width / 2 + 1e-9,
      );
    });
  });

  it('brings a burst wave as packs: close in time and side, a pause between packs', () => {
    const arrival = { kind: 'burst', groupSize: 4, groupGapTicks: 60, widthTurn: 0.05 } as const;
    const wave = { ...wolves(12, arrival), gapMinTicks: 4, gapMaxTicks: 8 };
    const plan = resolveTurretPlan(scenario([wave]));
    const { seen } = spawns(plan, 6);
    for (let i = 1; i < seen.length; i++) {
      const gap = seen[i].tick - seen[i - 1].tick;
      if (i % 4 === 0) expect(gap).toBe(60);
      else expect(gap).toBeGreaterThanOrEqual(4);
      if (i % 4 !== 0) expect(gap).toBeLessThanOrEqual(8);
      const w = sectorOf({ seed: 6 }, 0, arrival, i);
      expect(Math.abs(angleOff(seen[i].bearing, w.from + w.width / 2))).toBeLessThanOrEqual(
        w.width / 2 + 1e-9,
      );
    }
  });

  it('replays the same bearings from the same seed, and other sides from another', () => {
    const plan = resolveTurretPlan(TURRET_SCENARIO_HARD);
    const a = spawns(plan, 17).seen;
    const b = spawns(plan, 17).seen;
    const c = spawns(plan, 18).seen;
    expect(b).toEqual(a);
    expect(c.map((s) => s.bearing)).not.toEqual(a.map((s) => s.bearing));
  });

  it('keeps every lane of a one-sided wave clear of the standing barrels', () => {
    const arrival = { kind: 'arc', widthTurn: 0.3 } as const;
    const plan = resolveTurretPlan(scenario([wolves(30, arrival)]));
    const radius = plan.kinds[0].radius;
    const reach = TURRET_EXPLOSIVE_BARREL.radius + radius + TURRET_EXPLOSIVE_BARREL.laneMargin;
    for (const seed of [2, 5, 11]) {
      const sector = sectorOf({ seed }, 0, arrival, 0);
      const mid = sector.from + sector.width / 2;
      const { state, seen } = spawns(plan, seed, (s) => {
        for (const [i, off] of [-0.3, 0, 0.25].entries()) {
          const at = mid + off;
          s.barrels.push({
            id: 100 + i,
            x: Math.sin(at) * 20,
            y: 0,
            z: Math.cos(at) * 20,
            litTick: -1,
            blowTick: -1,
          });
        }
      });
      for (const s of seen) {
        expect(Math.abs(angleOff(s.bearing, mid))).toBeLessThanOrEqual(sector.width / 2 + 1e-9);
        for (const b of state.barrels) {
          const d = Math.hypot(b.x, b.z);
          expect(Math.abs(angleOff(s.bearing, Math.atan2(b.x, b.z)))).toBeGreaterThanOrEqual(
            Math.asin(reach / d) - 1e-9,
          );
        }
      }
    }
  });

  it('falls back to the whole ring free of barrels when they close the sector', () => {
    const arcs = [{ center: 1, half: 0.2 }];
    expect(turretFreeBearing(0.5, arcs, { from: 0.9, width: 0.2 })).toBe(
      turretFreeBearing(0.5, arcs),
    );
    expect(turretFreeBearing(0.5, [], { from: 0.9, width: 0.2 })).toBeCloseTo(1, 12);
    // An arc outside the sector changes nothing inside it; one across its edge trims it.
    expect(turretFreeBearing(0.25, [{ center: 3, half: 0.1 }], { from: 0, width: 1 })).toBe(0.25);
    expect(turretFreeBearing(0, [{ center: 0, half: 0.1 }], { from: 0, width: 1 })).toBeCloseTo(
      0.1,
      12,
    );
  });

  it('draws no bearing inside a sector when no barrel stands', () => {
    const state = createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, 1, START);
    expect(turretSpawnBearing(state, 0.5, 0.6, { from: 1, width: 0.4 })).toBeCloseTo(1.2, 12);
    expect(turretSpawnBearing(state, 0.5, 0.6)).toBe(0.5 * TAU);
  });
});

describe('the tower points come from the plan', () => {
  it('starts each scenario at its own integrity and loses when it runs out', () => {
    for (const s of TURRET_SCENARIOS) {
      const plan = resolveTurretPlan(s);
      expect(createTurretDefense(plan, { x: 0, z: 0 }, 1, START).integrity).toBe(s.integrity);
    }
    const plan = resolveTurretPlan(scenario([wolves(6)], 5));
    const state = createTurretDefense(plan, { x: 0, z: 0 }, 4, START);
    for (let t = START + 1; t < START + 20 * 120 && state.phase !== 'lost'; t++) {
      tickTurretDefense(state, t, flat);
    }
    expect(state.phase).toBe('lost');
    expect(state.integrity).toBe(0);
    expect(state.stats.breaches).toBe(3);
    expect(state.stats.pointsLost).toBe(6);
  });
});

type Aim = (
  state: TurretDefenseState,
  tick: number,
  probe: ThrowProbe,
) => { x: number; z: number } | null;

function nearestLive(state: TurretDefenseState, tick: number, probe: ThrowProbe) {
  let best: { x: number; z: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const p = positionAt(m.seg, tick, probe);
    const d = Math.hypot(p.x - state.cx, p.z - state.cz);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

const aimNearest: Aim = (state, tick, probe) =>
  tick >= state.readyTick ? nearestLive(state, tick, probe) : null;

/** `delay` ticks after each reload, up to 3 yd off the nearest monster. */
const aimLate =
  (delay: number): Aim =>
  (state, tick, probe) => {
    if (tick < state.readyTick + delay) return null;
    const p = nearestLive(state, tick, probe);
    if (!p) return null;
    return {
      x: p.x + ((tick * 7919) % 600) / 100 - 3,
      z: p.z + ((tick * 104729) % 600) / 100 - 3,
    };
  };

/** At most every 1.2 s, up to 3 yd off the nearest monster: nearer a person than the other. */
const aimSloppily = aimLate(15);
/** 1.2 s after each reload, up to 3 yd off: slower than a clean hand. */
const aimSlowly = aimLate(24);

function fullRun(s: TurretScenarioDef, seed: number, probe: ThrowProbe, aim: Aim) {
  const plan = resolveTurretPlan(s);
  const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, START);
  let t = START;
  while (t < START + 20 * 60 * 10 && state.phase !== 'won' && state.phase !== 'lost') {
    t++;
    tickTurretDefense(state, t, probe);
    const target = aim(state, t, probe);
    if (target) fireTurret(state, t, target.x, target.z, probe);
  }
  const monsters = plan.waves.reduce((n, w) => n + w.spawns.length, 0);
  return { plan, state, seconds: (t - START) / 20, monsters };
}

describe('full runs of every scenario with the scripted aimers', () => {
  it.each([
    ['introduction', TURRET_SCENARIO_INTRODUCTION],
    ['standard', TURRET_SCENARIO_STANDARD],
  ] as const)('%s is won by both aimers, every monster killed or struck', (_key, s) => {
    for (const [probe, aim] of [
      [flat, aimNearest],
      [hills, aimSloppily],
    ] as const) {
      const r = fullRun(s, 42, probe, aim);
      expect(r.state.phase).toBe('won');
      expect(r.state.wave).toBe(s.waves.length - 1);
      expect(r.state.stats.kills + r.state.stats.breaches).toBe(r.monsters);
      expect(r.state.integrity).toBe(s.integrity - r.state.stats.pointsLost);
      expect(r.state.result).toEqual(turretResult(r.plan, r.state));
    }
  });

  it.each(TURRET_SCENARIOS.map((s) => [s.boardKey, s] as const))(
    'medals the clean nearest-first aimer gold on %s',
    (_key, s) => {
      expect(fullRun(s, 42, flat, aimNearest).state.result?.medal).toBe('gold');
    },
  );

  it('keeps gold out of reach of an aimer firing 1.2 s after each reload on Standard', () => {
    const r = fullRun(TURRET_SCENARIO_STANDARD, 42, hills, aimSlowly);
    expect(r.state.phase).toBe('won');
    expect(r.state.result?.medal).not.toBe('gold');
  });

  it('Hard runs to an end with both aimers, its numbers consistent', () => {
    for (const [probe, aim] of [
      [flat, aimNearest],
      [hills, aimSloppily],
    ] as const) {
      const r = fullRun(TURRET_SCENARIO_HARD, 42, probe, aim);
      expect(['won', 'lost']).toContain(r.state.phase);
      expect(r.state.integrity).toBe(Math.max(0, 100 - r.state.stats.pointsLost));
      if (r.state.phase === 'won') {
        expect(r.state.stats.kills + r.state.stats.breaches).toBe(r.monsters);
      }
    }
  });

  // The Veterans' Test is the hardest by its medals, not its length: its rushes end
  // sooner than Standard's steady waves, so the two last about as long. The 2 to 4 minute
  // band is the design's for a 1 s aimer; this sloppy one fires sooner, so its runs are a
  // little shorter.
  it('keeps Introduction the shortest and the other two within 2 to 4 minutes for the same aimer', () => {
    const [intro, standard, hard] = TURRET_SCENARIOS.map(
      (s) => fullRun(s, 42, hills, aimSloppily).seconds,
    );
    expect(intro).toBeLessThan(standard);
    expect(intro).toBeLessThan(hard);
    for (const seconds of [standard, hard]) {
      expect(seconds).toBeGreaterThan(120);
      expect(seconds).toBeLessThan(240);
    }
  });
});
