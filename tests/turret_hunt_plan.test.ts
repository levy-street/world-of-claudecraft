// Fire and Fly hunts, the plan half (src/sim/minigames/turret_hunt_plan.ts with the group
// resolver, turret_group_plan.ts) and the speed spread (turret_pace.ts): a wave's pack and
// sprint groups resolved into their schedules, paces and leaders, the client decoder
// refusing a forged one, and each monster's own pace drawn once by id.

import { describe, expect, it } from 'vitest';
import { decodeTurretPlan } from '../src/net/turret_session_wire';
import { TURRET_MISSION_PACK } from '../src/sim/content/fire_and_fly_missions';
import { TURRET_SCENARIO_STANDARD } from '../src/sim/content/fire_and_fly_scenarios';
import { TURRET_TIMING } from '../src/sim/content/turret_defense';
import { MOBS } from '../src/sim/data';
import { resolveTurretPlan, TURRET_PLAN_LIMITS } from '../src/sim/minigames/turret_defense_plan';
import {
  turretGroupStart,
  turretSpreadTick,
  turretWavePlanValid,
} from '../src/sim/minigames/turret_group_plan';
import { TURRET_HUNT_LIMITS } from '../src/sim/minigames/turret_hunt_plan';
import { turretDrawPace } from '../src/sim/minigames/turret_pace';
import type {
  TurretGroupDef,
  TurretKegLotDef,
  TurretScenarioDef,
  TurretWaveEntry,
} from '../src/sim/types';
import { TURRET_BRICKS_SCENARIO } from './helpers/turret_wave_plan';

const march = (templateId: string) => MOBS[templateId].moveSpeed * TURRET_TIMING.marchFactor;

type PackDef = Extract<TurretGroupDef, { brick: 'pack' }>;

function packGroup(entries: TurretWaveEntry[], extra: Partial<PackDef> = {}): TurretGroupDef {
  return {
    brick: 'pack',
    entries,
    minRadius: 26,
    maxRadius: 34,
    holdTicks: 80,
    spreadTicks: 40,
    widthTurn: 0.1,
    advanceScale: 1.2,
    ...extra,
  };
}

function scenario(
  groups: TurretGroupDef[],
  kegs: TurretKegLotDef[] = [{ mode: 'path', group: 0, placement: 'front' }],
): TurretScenarioDef {
  return {
    ...TURRET_SCENARIO_STANDARD,
    id: 'test_hunt',
    boardKey: 'test',
    waves: [{ groups, coreDamage: 10, kegs }],
  };
}

const PACK_0: TurretWaveEntry[] = [
  { templateId: 'forest_wolf', count: 3, level: 2 },
  { templateId: 'boneclad_revenant', count: 2, level: 19, leads: true },
  { templateId: 'forest_wolf', count: 1, level: 2, role: 'scout', speedScale: 2.2 },
];
const PACK_1: TurretWaveEntry[] = [{ templateId: 'wild_boar', count: 4, level: 3 }];
const SPRINT: TurretGroupDef = {
  brick: 'sprint',
  entries: [{ templateId: 'tunnel_rat', count: 2, level: 6, speedScale: 2.4 }],
  spreadTicks: 40,
  widthTurn: 0.1,
  delayTicks: 10,
};
const GROUPS: TurretGroupDef[] = [
  packGroup(PACK_0),
  packGroup(PACK_1, { advanceScale: 1.1, delayTicks: 30 }),
  SPRINT,
];

describe('a hunt wave in the plan', () => {
  it('schedules every pack from its delay over its window, the sprint group on its own', () => {
    const plan = resolveTurretPlan(scenario(GROUPS));
    const wave = plan.waves[0];
    expect(wave.spawns).toHaveLength(12);
    expect(wave.groups.map((g) => [g.brick, g.count, g.delayTicks])).toEqual([
      ['pack', 6, 0],
      ['pack', 4, 30],
      ['sprint', 2, 10],
    ]);
    const ticksOf = (g: number) => {
      const group = wave.groups[g];
      if (group.brick !== 'pack' && group.brick !== 'sprint') throw new Error('not spread');
      return Array.from(
        { length: group.count },
        (_, j) => group.delayTicks + turretSpreadTick(group.spreadTicks, group.count, j),
      );
    };
    expect(ticksOf(0)).toEqual([0, 6, 13, 20, 26, 33]);
    expect(ticksOf(1)).toEqual([30, 40, 50, 60]);
    expect(ticksOf(2)).toEqual([10, 30]);
    // A sprint kind exactly in the sprint group; the kinds keep each role and band apart.
    wave.groups.forEach((group, g) => {
      const start = turretGroupStart(wave, g);
      for (const kind of wave.spawns.slice(start, start + group.count))
        expect(plan.kinds[kind].role === 'sprint').toBe(group.brick === 'sprint');
    });
    const roles = plan.kinds.map((k) => k.role);
    expect(turretWavePlanValid(wave, roles, TURRET_PLAN_LIMITS.barrels)).toBe(true);
    expect(decodeTurretPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });

  it("paces each pack's advance from its slowest gathering member, and names its leader", () => {
    const plan = resolveTurretPlan(scenario(GROUPS));
    const [first, second] = plan.waves[0].groups;
    if (first.brick !== 'pack' || second.brick !== 'pack') throw new Error('not packs');
    // The revenant is the slowest of pack 0 (the wolf scout does not count); the boars pace pack 1.
    expect(first.pace).toBeCloseTo(march('boneclad_revenant') * 1.2, 12);
    expect(second.pace).toBeCloseTo(march('wild_boar') * 1.1, 12);
    expect([first.pack, second.pack]).toEqual([0, 1]);
    const leader = plan.waves[0].spawns[first.leader];
    expect(plan.kinds[leader].templateId).toBe('boneclad_revenant');
    // No leading entry: the pack's first spawn leads.
    expect(second.leader).toBe(0);
    expect(plan.waves[0].kegs).toEqual([{ mode: 'path', group: 0, placement: 'front' }]);
  });

  it('refuses a hunt the engine cannot play', () => {
    const bad = (groups: TurretGroupDef[], kegs?: TurretKegLotDef[]) => () =>
      resolveTurretPlan(scenario(groups, kegs));
    const wolf = { templateId: 'forest_wolf', count: 2, level: 2 };
    expect(bad([packGroup([{ ...wolf, count: 0 }])])).toThrow(/empty/);
    expect(
      bad([
        packGroup([
          { ...wolf, leads: true },
          { ...wolf, leads: true },
        ]),
      ]),
    ).toThrow(/two leading/);
    expect(bad([{ ...SPRINT }], [])).toThrow(/sprint group with no pack/);
    expect(bad([packGroup([{ ...wolf, bossLast: true }])])).toThrow(/boss-last/);
    for (const band of [
      { minRadius: 1, maxRadius: 30 },
      { minRadius: 30, maxRadius: 20 },
      { minRadius: 26, maxRadius: 60 },
    ])
      expect(bad([packGroup([wolf], band)])).toThrow(/rally band/);
    expect(
      bad([packGroup([wolf])], [{ mode: 'path', group: 0, placement: 'axis', fromTower: 80 }]),
    ).toThrow(/bad kegs/);
    expect(
      bad(Array.from({ length: TURRET_HUNT_LIMITS.packs + 1 }, () => packGroup([wolf]))),
    ).toThrow(/too many packs/);
    // Scouts and leaders belong to packs only, a sprint group's included.
    const plain = { ...TURRET_SCENARIO_STANDARD, id: 'test_plain', boardKey: 'test' };
    for (const entry of [
      { ...wolf, role: 'scout' as const },
      { ...wolf, leads: true },
    ]) {
      for (const group of [
        { brick: 'walkers' as const, entries: [entry], gapMinTicks: 1, gapMaxTicks: 2 },
        { ...SPRINT, entries: [entry] },
      ]) {
        const waves = [{ ...plain.waves[0], groups: [packGroup([wolf]), group] }];
        expect(() => resolveTurretPlan({ ...plain, waves })).toThrow(/outside a pack/);
      }
    }
    const band = { ...wolf, speedScale: 1.2, speedScaleMax: 1.1 };
    expect(() =>
      resolveTurretPlan({
        ...plain,
        waves: [
          {
            ...plain.waves[0],
            groups: [{ brick: 'walkers', entries: [band], gapMinTicks: 1, gapMaxTicks: 2 }],
          },
        ],
      }),
    ).toThrow(/speed band/);
  });

  it('never decodes a forged hunt', () => {
    const plan = JSON.parse(JSON.stringify(resolveTurretPlan(TURRET_MISSION_PACK)));
    expect(decodeTurretPlan(plan)).not.toBeNull();
    const forge = (wave: number, edit: (w: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(plan));
      edit(copy.waves[wave]);
      return decodeTurretPlan(copy);
    };
    type G = Record<string, unknown>;
    const groups = (w: Record<string, unknown>) => w.groups as G[];
    for (const edit of [
      (w: G) => (groups(w)[0].count = (groups(w)[0].count as number) + 1),
      (w: G) => (w.spawns as number[]).pop(),
      (w: G) => (groups(w)[0].leader = 99),
      (w: G) => (groups(w)[1].pack = 0),
      (w: G) => (groups(w)[0].pace = -1),
      (w: G) => (groups(w)[0].maxRadius = 90),
      (w: G) => (groups(w)[0].widthTurn = 2),
      (w: G) => (groups(w)[0].brick = 'herd'),
      (w: G) => ((w.kegs as G[])[0].group = 5),
      (w: G) => ((w.kegs as G[])[0].placement = 'ring'),
      (w: G) => ((w.kegs as G[])[0].mode = 'scatter'),
      (w: G) => (w.kegCap = 0),
    ])
      expect(forge(2, edit)).toBeNull();
    // A sprint kind spawned inside a pack, or a sprint group with no pack, is no plan the
    // resolver makes (on the bricks plan: no shipped mission keeps a sprint group).
    const bricks = JSON.parse(JSON.stringify(resolveTurretPlan(TURRET_BRICKS_SCENARIO)));
    expect(decodeTurretPlan(bricks)).not.toBeNull();
    const sw = bricks.waves.findIndex((w: { groups: G[] }) =>
      w.groups.some((g) => g.brick === 'sprint'),
    );
    expect(sw).toBeGreaterThanOrEqual(0);
    const forgeBricks = (edit: (w: G) => void) => {
      const copy = JSON.parse(JSON.stringify(bricks));
      edit(copy.waves[sw]);
      return decodeTurretPlan(copy);
    };
    const sprintKind = bricks.kinds.findIndex((k: { role?: string }) => k.role === 'sprint');
    expect(sprintKind).toBeGreaterThanOrEqual(0);
    const packStart = (w: G) => {
      let at = 0;
      for (const g of groups(w)) {
        if (g.brick === 'pack') return at;
        at += g.count as number;
      }
      return -1;
    };
    expect(forgeBricks((w) => ((w.spawns as number[])[packStart(w)] = sprintKind))).toBeNull();
    expect(
      forgeBricks((w) => {
        for (const g of groups(w)) if (g.brick === 'pack') g.brick = 'sprint';
      }),
    ).toBeNull();
    const bandless = JSON.parse(JSON.stringify(plan));
    bandless.kinds[0].marchSpeedMax = bandless.kinds[0].marchSpeed / 2;
    expect(decodeTurretPlan(bandless)).toBeNull();
  });
});

describe('the speed spread', () => {
  it("draws each monster's pace once in its kind's band, keyed by id, and none without a band", () => {
    const plan = resolveTurretPlan(TURRET_MISSION_PACK);
    const banded = plan.kinds.find((k) => k.marchSpeedMax !== undefined)!;
    const source = { seed: 42 };
    const paces = Array.from({ length: 200 }, (_, id) => turretDrawPace(source, banded, id)!);
    for (const pace of paces) {
      expect(pace).toBeGreaterThanOrEqual(banded.marchSpeed);
      expect(pace).toBeLessThan(banded.marchSpeedMax!);
    }
    expect(paces.map((_, id) => turretDrawPace(source, banded, id))).toEqual(paces);
    expect(Math.max(...paces) - Math.min(...paces)).toBeGreaterThan(
      0.8 * (banded.marchSpeedMax! - banded.marchSpeed),
    );
    const plain = resolveTurretPlan().kinds[0];
    expect(turretDrawPace(source, plain, 3)).toBeUndefined();
    // A band is a kind of its own: the same template unbanded stays its own kind.
    const both = resolveTurretPlan({
      ...TURRET_SCENARIO_STANDARD,
      id: 'test_band',
      boardKey: 'test',
      waves: [
        {
          ...TURRET_SCENARIO_STANDARD.waves[0],
          groups: [
            {
              brick: 'walkers',
              entries: [
                { templateId: 'forest_wolf', count: 2, level: 2 },
                { templateId: 'forest_wolf', count: 2, level: 2, speedScaleMax: 1.35 },
              ],
              gapMinTicks: 1,
              gapMaxTicks: 2,
            },
          ],
        },
      ],
    });
    expect(both.kinds).toHaveLength(2);
    expect(both.kinds[0].marchSpeedMax).toBeUndefined();
    expect(both.kinds[1].marchSpeedMax).toBeCloseTo(march('forest_wolf') * 1.35, 12);
  });
});
