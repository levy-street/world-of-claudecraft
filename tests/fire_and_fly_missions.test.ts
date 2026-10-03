// Fire and Fly's missions (src/sim/content/fire_and_fly_missions.ts) and the knobs
// they added to the plan: a march speed scale per entry, and a scenario's kegs (a
// count scale, a standing cap, and placement on the arrival lanes). Absent knobs keep
// every trial's plan and run exactly (the Standard digests in turret_scenarios and
// turret_defense_engine stay pinned).
import { describe, expect, it } from 'vitest';
import { decodeTurretPlan } from '../src/net/turret_session_wire';
import {
  TURRET_MISSION_BRITTLE,
  TURRET_MISSION_DELUGE,
  TURRET_MISSION_GIANTS,
  TURRET_MISSION_PACK,
  TURRET_MISSION_POWDER,
  TURRET_MISSIONS,
} from '../src/sim/content/fire_and_fly_missions';
import {
  FIRE_AND_FLY_MAX_KEG_CAP,
  FIRE_AND_FLY_SCENARIOS,
  FIRE_AND_FLY_SCORE_VERSIONS,
  TURRET_SCENARIO_STANDARD,
  TURRET_SCENARIOS,
} from '../src/sim/content/fire_and_fly_scenarios';
import {
  TURRET_EXPLOSIVE_BARREL,
  TURRET_TEMPLATE_SIZES,
  TURRET_TIMING,
} from '../src/sim/content/turret_defense';
import { MOBS } from '../src/sim/data';
import {
  fireAndFlyScoreboardId,
  fireAndFlyScoreboardInfo,
} from '../src/sim/fire_and_fly_scoreboards';
import { positionAt, type ThrowProbe } from '../src/sim/minigames/thrown_body';
import { turretWaveLanes } from '../src/sim/minigames/turret_arrival';
import { placeTurretBarrels } from '../src/sim/minigames/turret_barrels';
import {
  createTurretDefense,
  fireTurret,
  type TurretDefenseState,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import {
  resolveTurretPlan,
  TURRET_PLAN_LIMITS,
  turretChargesGiven,
} from '../src/sim/minigames/turret_defense_plan';
import { TURRET_POINTS } from '../src/sim/minigames/turret_result';
import type { TurretScenarioDef } from '../src/sim/types';

const TAU = Math.PI * 2;
const START = 1000;
const flat: ThrowProbe = { ground: () => 0, water: () => null };
const spawnsOf = (s: TurretScenarioDef) =>
  s.waves.map((wave) => wave.entries.reduce((n, e) => n + e.count, 0));

/** Signed angle from `b` to `a`, in (-PI, PI]. */
function angleOff(a: number, b: number): number {
  return ((((a - b + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

function variant(over: Partial<TurretScenarioDef>): TurretScenarioDef {
  return { ...TURRET_SCENARIO_STANDARD, id: 'test_scenario', boardKey: 'test', ...over };
}

/** Each mission's signature weapon: the one its idea asks for, in charges at the start. */
const MISSION_ARSENALS: Record<string, { shockwave: number; fragmentation: number }> = {
  pack: { shockwave: 0, fragmentation: 5 },
  giants: { shockwave: 4, fragmentation: 1 },
  deluge: { shockwave: 3, fragmentation: 2 },
  brittle: { shockwave: 3, fragmentation: 1 },
  powder: { shockwave: 1, fragmentation: 3 },
};

describe('the mission table', () => {
  it('offers five missions after the trials, with frozen ids, board keys and one version each', () => {
    expect(TURRET_MISSIONS.map((m) => [m.id, m.boardKey])).toEqual([
      ['fire_and_fly_pack', 'pack'],
      ['fire_and_fly_giants', 'giants'],
      ['fire_and_fly_deluge', 'deluge'],
      ['fire_and_fly_brittle', 'brittle'],
      ['fire_and_fly_powder', 'powder'],
    ]);
    expect(FIRE_AND_FLY_SCENARIOS).toEqual([...TURRET_SCENARIOS, ...TURRET_MISSIONS]);
    for (const mission of TURRET_MISSIONS) {
      expect(FIRE_AND_FLY_SCORE_VERSIONS[mission.boardKey]).toBe(1);
      expect(fireAndFlyScoreboardId(mission.id, 'daily')).toBeNull();
      const lifetime = fireAndFlyScoreboardId(mission.id, 'lifetime')!;
      expect(lifetime).toBe(`fire_and_fly_${mission.boardKey}_v1_lifetime`);
      expect(fireAndFlyScoreboardInfo(lifetime)).toMatchObject({ kind: 'mission' });
    }
  });

  it.each(TURRET_MISSIONS.map((m) => [m.boardKey, m] as const))(
    'resolves %s with its signature arsenal and supply, every template sized and inside its level band',
    (key, mission) => {
      const plan = resolveTurretPlan(mission);
      expect(plan.scenarioId).toBe(mission.id);
      expect(plan.arsenal).toEqual(MISSION_ARSENALS[key]);
      expect(plan.resupplyWaves).toEqual([2, 4]);
      expect(plan.chargeBonus).toBe(true);
      for (const wave of mission.waves) {
        for (const entry of wave.entries) {
          const template = MOBS[entry.templateId];
          expect(TURRET_TEMPLATE_SIZES[entry.templateId], entry.templateId).toBeDefined();
          expect(entry.level).toBeGreaterThanOrEqual(template.minLevel);
          expect(entry.level).toBeLessThanOrEqual(template.maxLevel);
        }
      }
      expect(decodeTurretPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    },
  );

  it('runs every mission on one eight-wave curve, overlapping, its last two waves the largest', () => {
    for (const mission of TURRET_MISSIONS) {
      const spawns = spawnsOf(mission);
      expect(spawns).toHaveLength(8);
      expect([2, 3]).toContain(mission.overlap);
      const last = Math.min(spawns[6], spawns[7]);
      for (const n of spawns.slice(0, 6)) expect(n).toBeLessThan(last);
      expect(spawns[7]).toBeGreaterThanOrEqual(spawns[6]);
      expect(spawns[0]).toBeLessThanOrEqual(Math.min(...spawns.slice(1)));
    }
  });

  it('sends The Pack in tight packs of twelve or more, each setting off at once from a narrow side', () => {
    for (const wave of TURRET_MISSION_PACK.waves) {
      const arrival = wave.arrival;
      expect(['burst', 'flanks']).toContain(arrival?.kind);
      if (arrival?.kind === 'burst') expect(arrival.groupSize).toBeGreaterThanOrEqual(12);
      if (arrival?.kind === 'flanks') {
        const total = wave.entries.reduce((n, e) => n + e.count, 0);
        expect(total / arrival.count).toBeGreaterThanOrEqual(12);
      }
      if (arrival?.kind === 'burst' || arrival?.kind === 'flanks')
        expect(arrival.widthTurn).toBeLessThanOrEqual(0.05);
      expect(wave.gapMaxTicks).toBeLessThanOrEqual(2);
    }
    expect(spawnsOf(TURRET_MISSION_PACK).reduce((a, b) => a + b)).toBeGreaterThan(
      1.5 * spawnsOf(TURRET_SCENARIO_STANDARD).reduce((a, b) => a + b),
    );
  });

  it('sends one pack, then two apart, then two and three at once, never slower wave on wave', () => {
    const waves = TURRET_MISSION_PACK.waves;
    expect(waves[0].arrival).toMatchObject({ kind: 'burst', groupSize: 14 });
    expect(spawnsOf(TURRET_MISSION_PACK)[0]).toBe(14);
    for (const wave of waves.slice(1, 3)) {
      expect(wave.arrival).toMatchObject({ kind: 'burst', groupSize: 14 });
      if (wave.arrival?.kind !== 'burst') continue;
      expect(wave.arrival.groupGapTicks).toBeGreaterThanOrEqual(40);
      expect(wave.entries.reduce((n, e) => n + e.count, 0)).toBe(28);
    }
    expect(waves.slice(3).map((w) => w.arrival)).toEqual([
      { kind: 'flanks', count: 2, widthTurn: 0.03 },
      { kind: 'flanks', count: 2, widthTurn: 0.03 },
      { kind: 'flanks', count: 3, widthTurn: 0.03 },
      { kind: 'flanks', count: 3, widthTurn: 0.03 },
      { kind: 'flanks', count: 3, widthTurn: 0.03 },
    ]);
    expect(spawnsOf(TURRET_MISSION_PACK).slice(6)).toEqual([48, 54]);
    const fastest = waves.map((w) => Math.max(...w.entries.map((e) => e.speedScale ?? 1)));
    for (const speed of fastest) expect(speed).toBeGreaterThan(2);
    for (let i = 1; i < fastest.length; i++)
      expect(fastest[i]).toBeGreaterThanOrEqual(fastest[i - 1]);
    for (let i = 3; i < fastest.length; i++) expect(fastest[i]).toBeGreaterThan(fastest[i - 1]);
    for (const wave of waves)
      for (const entry of wave.entries) expect(entry.hpScale).toBeUndefined();
  });

  it('makes Heavy Tread large or huge and tough, slow through the climb, then colossi from everywhere', () => {
    const plan = resolveTurretPlan(TURRET_MISSION_GIANTS);
    for (const kind of plan.kinds) expect(['large', 'huge']).toContain(kind.sizeClass);
    for (const wave of TURRET_MISSION_GIANTS.waves)
      for (const entry of wave.entries) expect(entry.hpScale).toBeGreaterThan(1);
    for (const wave of TURRET_MISSION_GIANTS.waves.slice(0, 5))
      for (const entry of wave.entries) expect(entry.speedScale).toBeLessThan(1);
    const colossi = TURRET_MISSION_GIANTS.waves.slice(5);
    let pace = 1;
    for (const wave of colossi) {
      expect(wave.arrival).toBeUndefined();
      for (const entry of wave.entries) {
        expect(['frostmane_yeti', 'idol_guardian']).toContain(entry.templateId);
        expect(entry.speedScale).toBeGreaterThan(1);
      }
      const fastest = Math.max(...wave.entries.map((e) => e.speedScale ?? 1));
      expect(fastest).toBeGreaterThan(pace);
      pace = fastest;
    }
    expect(spawnsOf(TURRET_MISSION_GIANTS).slice(5)).toEqual([12, 18, 26]);
  });

  it('makes The Deluge dozens of small monsters from everywhere, every wave bigger and quicker', () => {
    const plan = resolveTurretPlan(TURRET_MISSION_DELUGE);
    for (const kind of plan.kinds) {
      expect(kind.sizeClass).toBe('small');
      expect(kind.marchSpeed).toBeGreaterThan(
        MOBS[kind.templateId].moveSpeed * TURRET_TIMING.marchFactor,
      );
    }
    const spawns = spawnsOf(TURRET_MISSION_DELUGE);
    expect(Math.min(...spawns)).toBeGreaterThanOrEqual(14);
    expect(spawns.reduce((a, b) => a + b)).toBeGreaterThanOrEqual(100);
    const waves = TURRET_MISSION_DELUGE.waves;
    for (let i = 1; i < waves.length; i++) {
      expect(spawns[i]).toBeGreaterThan(spawns[i - 1]);
      expect(waves[i].entries[0].speedScale ?? 1).toBeGreaterThan(
        waves[i - 1].entries[0].speedScale ?? 1,
      );
      expect(waves[i].gapMaxTicks).toBeLessThanOrEqual(waves[i - 1].gapMaxTicks);
    }
    for (const wave of waves) expect(wave.arrival).toBeUndefined();
  });

  it('gives The Cracked Tower 10 tower points and no large or huge monster', () => {
    const plan = resolveTurretPlan(TURRET_MISSION_BRITTLE);
    expect(plan.integrity).toBe(10);
    for (const kind of plan.kinds) expect(['small', 'medium']).toContain(kind.sizeClass);
    // Gold is an untouched tower, silver six points of ten.
    expect(plan.medals).toEqual({
      gold: { minIntegrityShare: 1 },
      silver: { minIntegrityShare: 0.6 },
    });
  });

  it("puts twice the kegs on The Powder Store's lanes, sided waves, a cap of 12 the finale fills", () => {
    const plan = resolveTurretPlan(TURRET_MISSION_POWDER);
    plan.waves.forEach((wave, i) => {
      expect(wave.barrels).toEqual({
        ...TURRET_MISSION_POWDER.waves[i].barrels,
        count: TURRET_MISSION_POWDER.waves[i].barrels.count * 2,
        placement: 'lanes',
        cap: 12,
      });
      expect(wave.arrival.kind).not.toBe('ring');
    });
    expect(plan.waves.slice(6).map((w) => w.barrels.count)).toEqual([12, 12]);
    expect(plan.waves.slice(5).map((w) => w.arrival)).toEqual([
      { kind: 'flanks', count: 3, widthTurn: 0.06 },
      { kind: 'flanks', count: 3, widthTurn: 0.06 },
      { kind: 'flanks', count: 3, widthTurn: 0.06 },
    ]);
  });

  it('names the largest keg cap of every resolved plan, above the default one', () => {
    const caps = FIRE_AND_FLY_SCENARIOS.flatMap((s) =>
      resolveTurretPlan(s).waves.map((w) => w.barrels.cap ?? TURRET_EXPLOSIVE_BARREL.cap),
    );
    expect(FIRE_AND_FLY_MAX_KEG_CAP).toBe(Math.max(...caps));
    expect(FIRE_AND_FLY_MAX_KEG_CAP).toBe(12);
  });
});

describe('the plan knobs', () => {
  it('scales an entry march speed as a kind of its own, and keeps the unscaled speed exact', () => {
    const wolf = { templateId: 'forest_wolf', count: 2, level: 2 };
    const base = TURRET_SCENARIO_STANDARD.waves[0];
    const plan = resolveTurretPlan(
      variant({
        waves: [{ ...base, entries: [wolf, { ...wolf, speedScale: 1.5 }, { ...wolf }] }],
      }),
    );
    expect(plan.kinds).toHaveLength(2);
    const speed = MOBS.forest_wolf.moveSpeed * TURRET_TIMING.marchFactor;
    expect(plan.kinds[0].marchSpeed).toBe(speed);
    expect(plan.kinds[1].marchSpeed).toBeCloseTo(speed * 1.5, 12);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        resolveTurretPlan(
          variant({ waves: [{ ...base, entries: [{ ...wolf, speedScale: bad }] }] }),
        ),
      ).toThrow(/speed scale/);
    }
  });

  it('scales, caps and places the kegs, refusing values past the plan limits', () => {
    const scaled = resolveTurretPlan(variant({ kegs: { countScale: 1.5, cap: 9 } }));
    const standard = resolveTurretPlan(TURRET_SCENARIO_STANDARD);
    scaled.waves.forEach((wave, i) => {
      expect(wave.barrels.count).toBe(Math.round(standard.waves[i].barrels.count * 1.5));
      expect(wave.barrels.cap).toBe(9);
      expect(wave.barrels.placement).toBeUndefined();
    });
    const tooMany = { countScale: TURRET_PLAN_LIMITS.barrels };
    expect(() => resolveTurretPlan(variant({ kegs: tooMany }))).toThrow(/too many kegs/);
    for (const cap of [0, 1.5, TURRET_PLAN_LIMITS.barrels + 1])
      expect(() => resolveTurretPlan(variant({ kegs: { cap } }))).toThrow(/keg cap/);
    expect(() => resolveTurretPlan(variant({ kegs: { countScale: 0 } }))).toThrow(/count scale/);
    expect(() =>
      resolveTurretPlan(variant({ kegs: { placement: 'road' as unknown as 'lanes' } })),
    ).toThrow(/placement/);
    // A forged plan past the limits never decodes.
    const wire = JSON.parse(JSON.stringify(resolveTurretPlan(TURRET_MISSION_POWDER)));
    expect(decodeTurretPlan(wire)).not.toBeNull();
    for (const barrels of [
      { ...wire.waves[0].barrels, cap: TURRET_PLAN_LIMITS.barrels + 1 },
      { ...wire.waves[0].barrels, placement: 'ring' },
      { ...wire.waves[0].barrels, count: TURRET_PLAN_LIMITS.barrels + 1 },
    ]) {
      const forged = { ...wire, waves: [{ ...wire.waves[0], barrels }, ...wire.waves.slice(1)] };
      expect(decodeTurretPlan(forged)).toBeNull();
    }
  });

  it('places lane kegs inside the wave arrival sides, each side in turn', () => {
    const plan = resolveTurretPlan(TURRET_MISSION_POWDER);
    for (const seed of [3, 8, 21]) {
      for (const [w, wave] of plan.waves.entries()) {
        const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, START);
        state.wave = w;
        const lanes = turretWaveLanes(state, w, wave)!;
        expect(lanes.length).toBeGreaterThan(0);
        const placed = placeTurretBarrels(state, wave.barrels, START, flat);
        expect(placed.length).toBeGreaterThan(0);
        expect(placed.length).toBeLessThanOrEqual(wave.barrels.count);
        for (const [i, barrel] of placed.entries()) {
          const bearing = Math.atan2(barrel.x, barrel.z);
          const inSome = lanes.some(
            (lane) =>
              Math.abs(angleOff(bearing, lane.from + lane.width / 2)) <= lane.width / 2 + 1e-9,
          );
          expect(inSome, `seed ${seed} wave ${w} keg ${i}`).toBe(true);
        }
      }
    }
  });

  it('stops placing at the wave cap, standing kegs included', () => {
    const plan = resolveTurretPlan(TURRET_SCENARIO_STANDARD);
    const state = createTurretDefense(plan, { x: 0, z: 0 }, 5, START);
    const def = { count: 20, minRadius: 10, maxRadius: 34 };
    expect(placeTurretBarrels(state, def, START, flat).length).toBeLessThanOrEqual(
      TURRET_EXPLOSIVE_BARREL.cap,
    );
    const capped = createTurretDefense(plan, { x: 0, z: 0 }, 5, START);
    expect(placeTurretBarrels(capped, { ...def, cap: 3 }, START, flat)).toHaveLength(3);
    expect(placeTurretBarrels(capped, { ...def, cap: 3 }, START, flat)).toEqual([]);
  });

  it('draws the evenly spread kegs of a ring wave exactly as before, lanes or not', () => {
    const plan = resolveTurretPlan(TURRET_SCENARIO_STANDARD);
    const a = createTurretDefense(plan, { x: 0, z: 0 }, 9, START);
    const b = createTurretDefense(plan, { x: 0, z: 0 }, 9, START);
    const def = plan.waves[2].barrels;
    expect(placeTurretBarrels(b, { ...def, placement: 'lanes' }, START, flat)).toEqual(
      placeTurretBarrels(a, def, START, flat),
    );
  });
});

function nearestLive(state: TurretDefenseState, tick: number) {
  let best: { x: number; z: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const p = positionAt(m.seg, tick, flat);
    const d = Math.hypot(p.x - state.cx, p.z - state.cz);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** One mission run by the clean nearest-first aimer, to the end or the ten-minute bound. */
function aimedRun(mission: TurretScenarioDef, seed: number) {
  const plan = resolveTurretPlan(mission);
  const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, START);
  let t = START;
  while (t < START + 20 * 60 * 10 && state.phase !== 'won' && state.phase !== 'lost') {
    t++;
    tickTurretDefense(state, t, flat);
    const target = t >= state.readyTick ? nearestLive(state, t) : null;
    if (target) fireTurret(state, t, target.x, target.z, flat);
  }
  return { plan, state, endTick: t };
}

describe('full mission runs', () => {
  it.each(TURRET_MISSIONS.map((m) => [m.boardKey, m] as const))(
    'medals the clean nearest-first aimer gold on %s, every monster killed or struck',
    (_key, mission) => {
      const { plan, state } = aimedRun(mission, 42);
      expect(state.phase).toBe('won');
      expect(state.result?.medal).toBe('gold');
      const monsters = plan.waves.reduce((n, w) => n + w.spawns.length, 0);
      expect(state.stats.kills + state.stats.breaches).toBe(monsters);
      // Resupplied twice, and this aimer spends nothing: every charge given scores.
      expect(state.stats.resupplies).toBe(2);
      const given = turretChargesGiven(plan, 2);
      expect(state.result?.breakdown.charges).toBe(
        (given.shockwave + given.fragmentation) * TURRET_POINTS.unusedCharge,
      );
    },
    60_000,
  );

  it.each(TURRET_MISSIONS.map((m) => [m.boardKey, m] as const))(
    'plays %s the same twice from one seed, and differently from another',
    (_key, mission) => {
      const first = aimedRun(mission, 7);
      const again = aimedRun(mission, 7);
      expect(again.endTick).toBe(first.endTick);
      expect(again.state.result).toEqual(first.state.result);
      expect(again.state.stats).toEqual(first.state.stats);
      expect(again.state.monsters).toEqual(first.state.monsters);
      const other = aimedRun(mission, 8);
      expect(other.state.monsters).not.toEqual(first.state.monsters);
    },
    120_000,
  );
});
