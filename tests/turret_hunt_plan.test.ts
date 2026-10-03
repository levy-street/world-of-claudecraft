// Fire and Fly hunts, the plan half (src/sim/minigames/turret_hunt_plan.ts) and the speed
// spread (turret_pace.ts): a hunt wave resolved into its packs, schedule, paces and leaders,
// the client decoder refusing a forged one, and each monster's own pace drawn once by id.
import { describe, expect, it } from 'vitest';
import { decodeTurretPlan } from '../src/net/turret_session_wire';
import { TURRET_MISSION_PACK } from '../src/sim/content/fire_and_fly_missions';
import { TURRET_SCENARIO_STANDARD } from '../src/sim/content/fire_and_fly_scenarios';
import { TURRET_TIMING } from '../src/sim/content/turret_defense';
import { MOBS } from '../src/sim/data';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { TURRET_HUNT_LIMITS, turretHuntPlanValid } from '../src/sim/minigames/turret_hunt_plan';
import { turretDrawPace } from '../src/sim/minigames/turret_pace';
import type { TurretHuntDef, TurretScenarioDef, TurretWaveEntry } from '../src/sim/types';

const march = (templateId: string) => MOBS[templateId].moveSpeed * TURRET_TIMING.marchFactor;

function scenario(
  entries: TurretWaveEntry[],
  hunt: Partial<TurretHuntDef> = {},
): TurretScenarioDef {
  return {
    ...TURRET_SCENARIO_STANDARD,
    id: 'test_hunt',
    boardKey: 'test',
    waves: [
      {
        entries,
        coreDamage: 10,
        gapMinTicks: 1,
        gapMaxTicks: 2,
        barrels: { count: 0, minRadius: 16, maxRadius: 30 },
        hunt: {
          packs: [
            { advanceScale: 1.2, kegs: [{ placement: 'rally-front' }], delayTicks: 0 },
            { advanceScale: 1.1, kegs: [], delayTicks: 30 },
          ],
          minRadius: 26,
          maxRadius: 34,
          holdTicks: 80,
          spreadTicks: 40,
          widthTurn: 0.1,
          sprintDelayTicks: 10,
          ...hunt,
        },
      },
    ],
  };
}

const ENTRIES: TurretWaveEntry[] = [
  { templateId: 'forest_wolf', count: 3, level: 2, pack: 0 },
  { templateId: 'boneclad_revenant', count: 2, level: 19, pack: 0, leads: true },
  { templateId: 'forest_wolf', count: 1, level: 2, pack: 0, role: 'scout', speedScale: 2.2 },
  { templateId: 'wild_boar', count: 4, level: 3, pack: 1 },
  { templateId: 'tunnel_rat', count: 2, level: 6, role: 'sprint', speedScale: 2.4 },
];

describe('a hunt wave in the plan', () => {
  it('schedules every pack from its delay over the window, the sprint group on its own', () => {
    const plan = resolveTurretPlan(scenario(ENTRIES));
    const wave = plan.waves[0];
    const hunt = wave.hunt!;
    expect(wave.spawns).toHaveLength(12);
    expect(hunt.groups.filter((g) => g === 0)).toHaveLength(6);
    expect(hunt.groups.filter((g) => g === 1)).toHaveLength(4);
    expect(hunt.groups.filter((g) => g === -1)).toHaveLength(2);
    for (let i = 1; i < hunt.ticks.length; i++)
      expect(hunt.ticks[i]).toBeGreaterThanOrEqual(hunt.ticks[i - 1]);
    const ticksOf = (g: number) => hunt.ticks.filter((_, i) => hunt.groups[i] === g);
    expect(ticksOf(0)).toEqual([0, 6, 13, 20, 26, 33]);
    expect(ticksOf(1)).toEqual([30, 40, 50, 60]);
    expect(ticksOf(-1)).toEqual([10, 30]);
    // A sprint kind exactly where the group is -1; the kinds keep each role and band apart.
    for (const [i, kind] of wave.spawns.entries())
      expect(plan.kinds[kind].role === 'sprint').toBe(hunt.groups[i] === -1);
    expect(
      turretHuntPlanValid(
        hunt,
        wave.spawns,
        plan.kinds.map((k) => k.role),
      ),
    ).toBe(true);
    expect(decodeTurretPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });

  it("paces each pack's advance from its slowest gathering member, and names its leader", () => {
    const plan = resolveTurretPlan(scenario(ENTRIES));
    const hunt = plan.waves[0].hunt!;
    // The revenant is the slowest of pack 0 (the wolf scout does not count); the boars pace pack 1.
    expect(hunt.packs[0].pace).toBeCloseTo(march('boneclad_revenant') * 1.2, 12);
    expect(hunt.packs[1].pace).toBeCloseTo(march('wild_boar') * 1.1, 12);
    const leader = plan.waves[0].spawns[hunt.packs[0].leader];
    expect(plan.kinds[leader].templateId).toBe('boneclad_revenant');
    expect(hunt.groups[hunt.packs[0].leader]).toBe(0);
    // No leading entry: the pack's first spawn leads.
    expect(hunt.packs[1].leader).toBe(hunt.groups.indexOf(1));
    for (const [p, pack] of hunt.packs.entries())
      expect(pack.last).toBe(hunt.groups.lastIndexOf(p));
    expect(hunt.packs[0].kegs).toEqual([{ placement: 'rally-front' }]);
  });

  it('refuses a hunt the engine cannot play', () => {
    const bad =
      (entries: TurretWaveEntry[], hunt: Partial<TurretHuntDef> = {}) =>
      () =>
        resolveTurretPlan(scenario(entries, hunt));
    const wolf = { templateId: 'forest_wolf', count: 2, level: 2 };
    expect(bad([{ ...wolf }, { ...wolf, pack: 1 }])).toThrow(/no pack/);
    expect(
      bad([
        { ...wolf, pack: 0 },
        { ...wolf, pack: 1 },
        { ...wolf, pack: 2 },
      ]),
    ).toThrow(/no pack/);
    expect(bad([{ ...wolf, pack: 0 }])).toThrow(/empty pack/);
    expect(
      bad([
        { ...wolf, pack: 0, leads: true },
        { ...wolf, pack: 0, leads: true },
        { ...wolf, pack: 1 },
      ]),
    ).toThrow(/two leading/);
    expect(
      bad([
        { ...wolf, pack: 0 },
        { ...wolf, pack: 1 },
        { ...wolf, role: 'sprint', pack: 0 },
      ]),
    ).toThrow(/sprint entry in a pack/);
    expect(
      bad(
        [
          { ...wolf, pack: 0 },
          { ...wolf, pack: 1 },
          { ...wolf, role: 'sprint' },
        ],
        {
          sprintDelayTicks: undefined,
        },
      ),
    ).toThrow(/sprint group with no delay/);
    for (const band of [
      { minRadius: 1, maxRadius: 30 },
      { minRadius: 30, maxRadius: 20 },
      { minRadius: 26, maxRadius: 60 },
    ])
      expect(
        bad(
          [
            { ...wolf, pack: 0 },
            { ...wolf, pack: 1 },
          ],
          band,
        ),
      ).toThrow(/rally band/);
    expect(
      bad(
        [
          { ...wolf, pack: 0 },
          { ...wolf, pack: 1 },
        ],
        {
          packs: [
            { advanceScale: 1, kegs: [{ placement: 'axis', fromTower: 80 }], delayTicks: 0 },
            { advanceScale: 1, kegs: [], delayTicks: 0 },
          ],
        },
      ),
    ).toThrow(/rally kegs/);
    expect(
      bad([{ ...wolf, pack: 0 }], {
        packs: Array.from({ length: TURRET_HUNT_LIMITS.packs + 1 }, () => ({
          advanceScale: 1,
          kegs: [],
          delayTicks: 0,
        })),
      }),
    ).toThrow(/pack count/);
    // Roles and packs belong to hunts only.
    const plain = { ...TURRET_SCENARIO_STANDARD, id: 'test_plain', boardKey: 'test' };
    for (const entry of [
      { ...wolf, role: 'scout' as const },
      { ...wolf, pack: 0 },
      { ...wolf, leads: true },
    ]) {
      const waves = [{ ...plain.waves[0], entries: [entry] }];
      expect(() => resolveTurretPlan({ ...plain, waves })).toThrow(/outside a hunt/);
    }
    const band = { ...wolf, speedScale: 1.2, speedScaleMax: 1.1 };
    expect(() =>
      resolveTurretPlan({ ...plain, waves: [{ ...plain.waves[0], entries: [band] }] }),
    ).toThrow(/speed band/);
  });

  it('never decodes a forged hunt', () => {
    const plan = JSON.parse(JSON.stringify(resolveTurretPlan(TURRET_MISSION_PACK)));
    expect(decodeTurretPlan(plan)).not.toBeNull();
    const forge = (edit: (hunt: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(plan));
      edit(copy.waves[2].hunt);
      return decodeTurretPlan(copy);
    };
    const sprintKind = plan.kinds.findIndex((k: { role?: string }) => k.role === 'sprint');
    expect(sprintKind).toBeGreaterThanOrEqual(0);
    for (const edit of [
      (h: Record<string, unknown>) => (h.groups as number[]).pop(),
      (h: Record<string, unknown>) => (h.ticks as number[]).reverse(),
      (h: Record<string, unknown>) => ((h.groups as number[])[0] = 5),
      (h: Record<string, unknown>) =>
        ((h.packs as { leader: number }[])[0].leader = (h.groups as number[]).indexOf(1)),
      (h: Record<string, unknown>) => ((h.packs as { last: number }[])[1].last = 0),
      (h: Record<string, unknown>) => ((h.packs as { pace: number }[])[0].pace = -1),
      (h: Record<string, unknown>) =>
        ((h.packs as { kegs: unknown[] }[])[0].kegs = [{ placement: 'ring' }]),
      (h: Record<string, unknown>) => (h.maxRadius = 90),
      (h: Record<string, unknown>) => (h.widthTurn = 2),
    ])
      expect(forge(edit)).toBeNull();
    // A sprint kind spawned inside a pack is not a plan the resolver makes.
    const copy = JSON.parse(JSON.stringify(plan));
    copy.waves[2].spawns[0] = sprintKind;
    expect(decodeTurretPlan(copy)).toBeNull();
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
          entries: [
            { templateId: 'forest_wolf', count: 2, level: 2 },
            { templateId: 'forest_wolf', count: 2, level: 2, speedScaleMax: 1.35 },
          ],
        },
      ],
    });
    expect(both.kinds).toHaveLength(2);
    expect(both.kinds[0].marchSpeedMax).toBeUndefined();
    expect(both.kinds[1].marchSpeedMax).toBeCloseTo(march('forest_wolf') * 1.35, 12);
  });
});
