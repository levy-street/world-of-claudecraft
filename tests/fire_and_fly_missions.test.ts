// Fire and Fly's missions (src/sim/content/fire_and_fly_missions.ts) and the knobs
// they added to the plan: a march speed scale per entry, and a wave's kegs (a random lot's
// count, a standing cap, and placement on the arrival lanes). Absent knobs keep every
// trial's plan and run exactly (the digests in turret_wave_groups_digest stay pinned).
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
import { turretGroupStart } from '../src/sim/minigames/turret_group_plan';
import { placeTurretFieldKegs } from '../src/sim/minigames/turret_keg_lots';
import { TURRET_POINTS } from '../src/sim/minigames/turret_result';
import { turretWaveLanes } from '../src/sim/minigames/turret_wave_groups';
import type {
  TurretGroupDef,
  TurretKegLotDef,
  TurretScenarioDef,
  TurretWaveDef,
} from '../src/sim/types';

const TAU = Math.PI * 2;
const START = 1000;
const flat: ThrowProbe = { ground: () => 0, water: () => null };
const entriesOf = (wave: TurretWaveDef) => wave.groups.flatMap((g) => g.entries);
const spawnsOf = (s: TurretScenarioDef) =>
  s.waves.map((wave) => entriesOf(wave).reduce((n, e) => n + e.count, 0));
type PackDef = Extract<TurretGroupDef, { brick: 'pack' }>;
const packsOf = (wave: TurretWaveDef) =>
  wave.groups.filter((g): g is PackDef => g.brick === 'pack');
/** A one-group wave's walking group (or small group), its gap band and sides. */
function walkersOf(wave: TurretWaveDef) {
  expect(wave.groups).toHaveLength(1);
  const g = wave.groups[0];
  if (g.brick !== 'walkers' && g.brick !== 'smallGroup') throw new Error(`a ${g.brick} wave`);
  return g;
}
/** A one-group wave's sides: its walkers', bunches, or the ring. */
function sidesOf(wave: TurretWaveDef): string {
  const g = walkersOf(wave);
  return g.brick === 'smallGroup' ? 'bunches' : (g.sides?.kind ?? 'ring');
}
/** A wave's one random keg lot, or none. */
function ringLot(wave: { readonly kegs?: readonly TurretKegLotDef[] }) {
  const lots = wave.kegs ?? [];
  expect(lots.length).toBeLessThanOrEqual(1);
  const lot = lots[0];
  if (lot && lot.mode !== 'random') throw new Error(`a ${lot.mode} lot`);
  return lot;
}

/** Signed angle from `b` to `a`, in (-PI, PI]. */
function angleOff(a: number, b: number): number {
  return ((((a - b + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

function variant(over: Partial<TurretScenarioDef>): TurretScenarioDef {
  return { ...TURRET_SCENARIO_STANDARD, id: 'test_scenario', boardKey: 'test', ...over };
}

/** Each mission's signature weapon: the one its idea asks for, in charges at the start. */
const MISSION_ARSENALS: Record<string, { shockwave: number; fragmentation: number }> = {
  pack: { shockwave: 1, fragmentation: 5 },
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
      // Resupplied as waves 3, 5 and 7 end: the finale always starts with charges.
      expect(plan.resupplyWaves).toEqual([2, 4, 6]);
      expect(plan.chargeBonus).toBe(true);
      for (const wave of mission.waves) {
        for (const entry of entriesOf(wave)) {
          const template = MOBS[entry.templateId];
          expect(TURRET_TEMPLATE_SIZES[entry.templateId], entry.templateId).toBeDefined();
          expect(entry.level).toBeGreaterThanOrEqual(template.minLevel);
          expect(entry.level).toBeLessThanOrEqual(template.maxLevel);
        }
      }
      expect(decodeTurretPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    },
  );

  it('runs every mission over eight waves, the last one the largest', () => {
    // Recomposed missions (The Deluge first) climb with lulls between strong moments, so only
    // the length, a gentle first wave and the largest last wave hold across the table.
    for (const mission of TURRET_MISSIONS) {
      const spawns = spawnsOf(mission);
      expect(spawns).toHaveLength(8);
      expect(spawns[7]).toBe(Math.max(...spawns));
      expect(spawns[0]).toBeLessThanOrEqual(Math.min(...spawns.slice(1)));
    }
  });

  it('hunts The Pack in packs that gather at rallies, one wave by one, fewer than the R3 draft', () => {
    const waves = TURRET_MISSION_PACK.waves;
    const plan = resolveTurretPlan(TURRET_MISSION_PACK);
    expect(spawnsOf(TURRET_MISSION_PACK)).toEqual([8, 11, 18, 20, 20, 24, 28, 34]);
    // Under the R3 draft wave by wave (10, 14, 24, 24, 24, 36, 48, 54): a monster at the
    // foot now strikes in 0.8 s, so fewer of them, the last two waves in smaller packs.
    const r3 = [10, 14, 24, 24, 24, 36, 48, 54];
    for (const [i, n] of spawnsOf(TURRET_MISSION_PACK).entries()) expect(n).toBeLessThan(r3[i]);
    expect(waves.map((w) => packsOf(w).length)).toEqual([1, 1, 2, 2, 2, 3, 4, 4]);
    for (const [i, wave] of waves.entries()) {
      const packs = packsOf(wave);
      // One hold per wave, from 6 s down to 2 s.
      const hold = [6, 6, 4, 4, 4, 3, 2, 2][i];
      for (const p of packs) expect(p.holdTicks / 20).toBe(hold);
      // Far enough out that a front keg a dozen yards ahead still stands off the tower foot.
      const band = i < 6 ? [30, 36] : [30, 33];
      for (const p of packs) expect([p.minRadius, p.maxRadius]).toEqual(band);
      // A hunt wave lays its kegs on its packs' paths, none on the ring.
      for (const lot of wave.kegs ?? []) expect(lot.mode).toBe('path');
      // Every group a pack but the finale's sprint group, last.
      const sprint = wave.groups.filter((g) => g.brick === 'sprint');
      expect(sprint).toHaveLength(i === 7 ? 1 : 0);
      expect(packs.length + sprint.length).toBe(wave.groups.length);
      const scouts = entriesOf(wave).filter((e) => e.role === 'scout');
      const perPack = scouts.reduce((n, e) => n + e.count, 0) / packs.length;
      expect(perPack).toBe(i === 0 ? 0 : 2);
      // The last three waves: a tenth quicker to rally and run, never tougher than the
      // template (lot R5: the owner's playtest found the sponges a chore).
      const late = i >= 5 ? 1.1 : 1;
      for (const group of wave.groups) {
        for (const entry of group.entries) {
          const [min, max] =
            entry.role === 'scout' ? [2.2, 2.6] : group.brick === 'sprint' ? [2.4, 2.4] : [1, 1.35];
          expect(entry.speedScale).toBeCloseTo(min * late, 12);
          expect(entry.speedScaleMax ?? entry.speedScale).toBeCloseTo(max * late, 12);
          expect(entry.hpScale).toBeUndefined();
        }
      }
      for (const p of packs) {
        expect(p.advanceScale).toBeGreaterThanOrEqual(1.1);
        expect(p.advanceScale).toBeLessThanOrEqual(1.35);
      }
    }
    // The first wave teaches the rally with a front keg.
    expect(waves[0].kegs).toEqual([{ mode: 'path', group: 0, placement: 'front' }]);
    expect(plan.waves.every((w) => w.groups.some((g) => g.brick === 'pack'))).toBe(true);
  });

  it("fells The Pack's members in two core hits at most and its leaders in a handful, every wave", () => {
    // Lots R5 and R5b, the owner's playtest: no sponge that is thrown back and walks in again
    // and again. Each wave's shell damage is matched to its members' health.
    const plan = resolveTurretPlan(TURRET_MISSION_PACK);
    const most = { member: 0, leader: 0 };
    for (const [w, wave] of plan.waves.entries()) {
      const leaders = new Set(
        wave.groups.flatMap((g, i) =>
          g.brick === 'pack' ? [wave.spawns[turretGroupStart(wave, i) + g.leader]] : [],
        ),
      );
      for (const kind of new Set(wave.spawns)) {
        const hits = Math.ceil(plan.kinds[kind].maxHp / wave.coreDamage);
        const role = leaders.has(kind) ? 'leader' : 'member';
        expect(hits, `wave ${w + 1} ${plan.kinds[kind].templateId}`).toBeLessThanOrEqual(
          role === 'leader' ? 6 : 2,
        );
        most[role] = Math.max(most[role], hits);
      }
    }
    expect(most).toEqual({ member: 2, leader: 6 });
  });

  it('paces The Pack at a walk: members to the rally, one advance per pack, scouts at a run', () => {
    const plan = resolveTurretPlan(TURRET_MISSION_PACK);
    for (const [k, kind] of plan.kinds.entries()) {
      const base = MOBS[kind.templateId].moveSpeed * TURRET_TIMING.marchFactor;
      const top = (kind.marchSpeedMax ?? kind.marchSpeed) / base;
      // The last three waves' kinds gather and run a tenth quicker.
      const late = plan.waves.slice(5).some((w) => w.spawns.includes(k)) ? 1.1 : 1;
      if (kind.role === 'scout') {
        expect(kind.marchSpeed / base).toBeCloseTo(2.2 * late, 12);
        expect(top).toBeCloseTo(2.6 * late, 12);
      } else if (kind.role === 'sprint') expect(kind.marchSpeed / base).toBeCloseTo(2.4 * late, 12);
      else {
        expect(kind.marchSpeed / base).toBeCloseTo(late, 12);
        expect(top).toBeCloseTo(1.35 * late, 12);
      }
    }
    for (const [w, wave] of plan.waves.entries()) {
      for (const [g, pack] of wave.groups.entries()) {
        if (pack.brick !== 'pack') continue;
        const start = turretGroupStart(wave, g);
        const gatherers = wave.spawns
          .slice(start, start + pack.count)
          .filter((kind) => plan.kinds[kind].role !== 'scout');
        const slowest = Math.min(
          ...gatherers.map(
            (k) => MOBS[plan.kinds[k].templateId].moveSpeed * TURRET_TIMING.marchFactor,
          ),
        );
        const def = TURRET_MISSION_PACK.waves[w].groups[g] as PackDef;
        expect(pack.pace).toBeCloseTo(slowest * def.advanceScale, 12);
        // A walk: never past 1.35 times the slowest template's march.
        expect(pack.pace).toBeLessThanOrEqual(slowest * 1.35 + 1e-9);
      }
    }
  });

  it('makes Heavy Tread large or huge and tough, slow through the climb, then colossi from everywhere', () => {
    const plan = resolveTurretPlan(TURRET_MISSION_GIANTS);
    for (const kind of plan.kinds) expect(['large', 'huge']).toContain(kind.sizeClass);
    for (const wave of TURRET_MISSION_GIANTS.waves)
      for (const entry of entriesOf(wave)) expect(entry.hpScale).toBeGreaterThan(1);
    for (const wave of TURRET_MISSION_GIANTS.waves.slice(0, 5))
      for (const entry of entriesOf(wave)) expect(entry.speedScale).toBeLessThan(1);
    const colossi = TURRET_MISSION_GIANTS.waves.slice(5);
    let pace = 1;
    for (const wave of colossi) {
      expect(sidesOf(wave)).toBe('ring');
      for (const entry of entriesOf(wave)) {
        expect(['frostmane_yeti', 'idol_guardian']).toContain(entry.templateId);
        expect(entry.speedScale).toBeGreaterThan(1);
      }
      const fastest = Math.max(...entriesOf(wave).map((e) => e.speedScale ?? 1));
      expect(fastest).toBeGreaterThan(pace);
      pace = fastest;
    }
    expect(spawnsOf(TURRET_MISSION_GIANTS).slice(5)).toEqual([12, 18, 26]);
  });

  it('makes The Deluge a tide of small beasts, quicker than any mission, with surges and surprises', () => {
    const plan = resolveTurretPlan(TURRET_MISSION_DELUGE);
    const waves = TURRET_MISSION_DELUGE.waves;
    const bricks = waves.map((w) => w.groups.map((g) => g.brick));
    // Varied waves, not one shape: walkers, small groups, a pack, surgers, two surges, one big one.
    const all = new Set(bricks.flat());
    for (const b of ['walkers', 'smallGroup', 'pack', 'surgers', 'surge', 'bigOne'] as const)
      expect(all.has(b), b).toBe(true);
    // The two strong moments: the fourth wave's surge from one side, the last wave's from two.
    const surges = waves.flatMap((w, i) =>
      w.groups.flatMap((g) => (g.brick === 'surge' ? [[i, g.sides] as const] : [])),
    );
    expect(surges).toEqual([
      [3, 1],
      [7, 2],
    ]);
    // Small beasts only, but for the one big monster with its escort.
    const big = plan.kinds.filter((k) => k.sizeClass !== 'small');
    expect(big.map((k) => k.templateId)).toEqual(['fen_troll']);
    expect(waves.flatMap((w) => w.groups).filter((g) => g.brick === 'bigOne')).toHaveLength(1);
    // No sponge: a small beast falls to two good shells at most, the troll to a handful.
    plan.waves.forEach((wave) => {
      for (const kind of new Set(wave.spawns)) {
        const shells = Math.ceil(plan.kinds[kind].maxHp / wave.coreDamage);
        expect(shells).toBeLessThanOrEqual(plan.kinds[kind].sizeClass === 'small' ? 2 : 6);
      }
    });
    // Its accent: about half its monsters run at one and a half times their template's pace or
    // more. (Compared with the other missions once they are recomposed too.)
    const entries = waves.flatMap((w) => w.groups.flatMap((g) => g.entries));
    const total = entries.reduce((a, e) => a + e.count, 0);
    const quick = entries.filter((e) => (e.speedScale ?? 1) >= 1.5);
    expect(quick.reduce((a, e) => a + e.count, 0) / total).toBeGreaterThan(0.4);
    expect(spawnsOf(TURRET_MISSION_DELUGE).reduce((a, b) => a + b)).toBeGreaterThanOrEqual(100);
  });

  it('gives The Cracked Tower 7 tower points and no large or huge monster', () => {
    const plan = resolveTurretPlan(TURRET_MISSION_BRITTLE);
    expect(plan.integrity).toBe(7);
    for (const kind of plan.kinds) expect(['small', 'medium']).toContain(kind.sizeClass);
    // Gold is an untouched tower, silver at 60 percent of it.
    expect(plan.medals).toEqual({
      gold: { minIntegrityShare: 1 },
      silver: { minIntegrityShare: 0.6 },
    });
  });

  it("puts twice the kegs on The Powder Store's lanes, sided waves, a cap of 12 the finale fills", () => {
    const plan = resolveTurretPlan(TURRET_MISSION_POWDER);
    // Each wave lays twice the kegs of the Standing Watch wave its size, on its lanes.
    expect(TURRET_MISSION_POWDER.waves.map((w) => ringLot(w)?.count)).toEqual([
      6, 6, 8, 8, 10, 10, 12, 12,
    ]);
    plan.waves.forEach((wave, i) => {
      expect(ringLot(wave)).toMatchObject({
        mode: 'random',
        minRadius: 16,
        maxRadius: 30,
        lanes: true,
      });
      expect(wave.kegCap).toBe(12);
      expect(sidesOf(TURRET_MISSION_POWDER.waves[i])).not.toBe('ring');
    });
    expect(TURRET_MISSION_POWDER.waves.slice(5).map((w) => walkersOf(w))).toMatchObject([
      { sides: { kind: 'flanks', count: 3, widthTurn: 0.06 } },
      { sides: { kind: 'flanks', count: 3, widthTurn: 0.06 } },
      { sides: { kind: 'flanks', count: 3, widthTurn: 0.06 } },
    ]);
  });

  it('names the largest keg cap of every resolved plan, above the default one', () => {
    const caps = FIRE_AND_FLY_SCENARIOS.flatMap((s) =>
      resolveTurretPlan(s).waves.map((w) => w.kegCap ?? TURRET_EXPLOSIVE_BARREL.cap),
    );
    expect(FIRE_AND_FLY_MAX_KEG_CAP).toBe(Math.max(...caps));
    expect(FIRE_AND_FLY_MAX_KEG_CAP).toBe(12);
  });
});

describe('the plan knobs', () => {
  it('scales an entry march speed as a kind of its own, and keeps the unscaled speed exact', () => {
    const wolf = { templateId: 'forest_wolf', count: 2, level: 2 };
    const base = TURRET_SCENARIO_STANDARD.waves[0];
    const walking = (entries: TurretGroupDef['entries']): TurretWaveDef => ({
      ...base,
      groups: [{ brick: 'walkers', entries, gapMinTicks: 1, gapMaxTicks: 2 }],
    });
    const plan = resolveTurretPlan(
      variant({ waves: [walking([wolf, { ...wolf, speedScale: 1.5 }, { ...wolf }])] }),
    );
    expect(plan.kinds).toHaveLength(2);
    const speed = MOBS.forest_wolf.moveSpeed * TURRET_TIMING.marchFactor;
    expect(plan.kinds[0].marchSpeed).toBe(speed);
    expect(plan.kinds[1].marchSpeed).toBeCloseTo(speed * 1.5, 12);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        resolveTurretPlan(variant({ waves: [walking([{ ...wolf, speedScale: bad }])] })),
      ).toThrow(/speed scale/);
    }
  });

  it('caps and places the kegs, refusing values past the plan limits', () => {
    const lots = (kegs: TurretKegLotDef[], kegCap?: number) =>
      variant({
        waves: TURRET_SCENARIO_STANDARD.waves.map((w) => ({
          ...w,
          kegs,
          ...(kegCap !== undefined ? { kegCap } : {}),
        })),
      });
    const ring = { mode: 'random', count: 4, minRadius: 16, maxRadius: 30 } as const;
    const capped = resolveTurretPlan(lots([ring, { mode: 'crown', count: 3, size: 'large' }], 9));
    for (const wave of capped.waves) {
      expect(wave.kegs).toEqual([ring, { mode: 'crown', count: 3, size: 'large' }]);
      expect(wave.kegCap).toBe(9);
    }
    const tooMany = { ...ring, count: TURRET_PLAN_LIMITS.barrels / 2 + 1 };
    expect(() => resolveTurretPlan(lots([tooMany, tooMany]))).toThrow(/bad kegs/);
    for (const cap of [0, 1.5, TURRET_PLAN_LIMITS.barrels + 1])
      expect(() => resolveTurretPlan(lots([ring], cap))).toThrow(/keg cap/);
    for (const lot of [
      { ...ring, count: 0 },
      { ...ring, minRadius: 30, maxRadius: 16 },
      { ...ring, lanes: false as unknown as true },
      { mode: 'scatter', count: 2 } as unknown as TurretKegLotDef,
      // Standing Watch's walkers come from the whole ring: no route a path keg can stand on.
      { mode: 'path', group: 0, placement: 'front' } as const,
      { mode: 'path', group: 3, placement: 'front' } as const,
    ])
      expect(() => resolveTurretPlan(lots([lot]))).toThrow(/bad kegs/);
    // A forged plan past the limits never decodes.
    const wire = JSON.parse(JSON.stringify(resolveTurretPlan(TURRET_MISSION_POWDER)));
    expect(decodeTurretPlan(wire)).not.toBeNull();
    for (const edit of [
      { kegCap: TURRET_PLAN_LIMITS.barrels + 1 },
      { kegs: [{ ...wire.waves[0].kegs[0], lanes: 'ring' }] },
      { kegs: [{ ...wire.waves[0].kegs[0], count: TURRET_PLAN_LIMITS.barrels + 1 }] },
      { kegs: [{ ...wire.waves[0].kegs[0], mode: 'scatter' }] },
      { kegs: [{ mode: 'path', group: 1, placement: 'front' }, ...wire.waves[0].kegs] },
    ]) {
      const forged = { ...wire, waves: [{ ...wire.waves[0], ...edit }, ...wire.waves.slice(1)] };
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
        const placed = placeTurretFieldKegs(state, wave, START, flat);
        expect(placed.length).toBeGreaterThan(0);
        expect(placed.length).toBeLessThanOrEqual(ringLot(wave)?.count ?? 0);
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
    expect(placeTurretBarrels(capped, def, START, flat, { cap: 3 })).toHaveLength(3);
    expect(placeTurretBarrels(capped, def, START, flat, { cap: 3 })).toEqual([]);
  });

  it('draws the evenly spread kegs of a ring wave exactly as before, lanes or not', () => {
    const plan = resolveTurretPlan(TURRET_SCENARIO_STANDARD);
    const a = createTurretDefense(plan, { x: 0, z: 0 }, 9, START);
    const b = createTurretDefense(plan, { x: 0, z: 0 }, 9, START);
    const def = ringLot(plan.waves[2])!;
    a.wave = 2;
    b.wave = 2;
    const lanes = turretWaveLanes(b, 2, plan.waves[2]);
    expect(lanes).toBeNull();
    expect(placeTurretBarrels(b, def, START, flat, { lanes })).toEqual(
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

/**
 * The clean nearest-first aimer's medal on seed 42: gold everywhere under the one medal
 * rule (lot R5b, gold keeps 95 percent of the tower), which lets Heavy Tread and The Powder
 * Store keep the gold the 0.8 s strike and the chained waves had cost them on this seed.
 */
const CLEAN_MEDAL: Record<string, 'gold' | 'silver'> = {
  pack: 'gold',
  giants: 'gold',
  deluge: 'gold',
  brittle: 'gold',
  powder: 'gold',
};

describe('full mission runs', () => {
  it.each(TURRET_MISSIONS.map((m) => [m.boardKey, m] as const))(
    'wins %s with the clean nearest-first aimer, every monster killed or struck',
    (key, mission) => {
      const { plan, state } = aimedRun(mission, 42);
      expect(state.phase).toBe('won');
      expect(state.result?.medal).toBe(CLEAN_MEDAL[key]);
      const monsters = plan.waves.reduce((n, w) => n + w.spawns.length, 0);
      expect(state.stats.kills + state.stats.breaches).toBe(monsters);
      // Resupplied three times, and this aimer spends nothing: every charge given scores.
      expect(state.stats.resupplies).toBe(3);
      const given = turretChargesGiven(plan, 3);
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
