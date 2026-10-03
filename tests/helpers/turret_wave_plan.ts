// Fire and Fly test plans: a resolved wave of one group, the spawn clocks of a running one
// held, released or run out, so a suite that hand-builds its plan states only the numbers it
// is about (the group shape is src/sim/minigames/turret_group_plan.ts's), and a scenario that
// plays every brick and keg mode no content uses yet.
import { TURRET_SCENARIO_STANDARD } from '../../src/sim/content/fire_and_fly_scenarios';
import type { TurretDefenseState } from '../../src/sim/minigames/turret_defense';
import type { TurretArrivalPlan, TurretWavePlan } from '../../src/sim/minigames/turret_group_plan';
import type { TurretKegLotDef, TurretScenarioDef } from '../../src/sim/types';

export interface TestWaveOptions {
  coreDamage?: number;
  gapMinTicks?: number;
  gapMaxTicks?: number;
  sides?: TurretArrivalPlan;
  kegs?: readonly TurretKegLotDef[];
  kegCap?: number;
}

/** A wave plan of one group of walkers spawning `spawns` (kind indices) from the ring. */
export function walkersWavePlan(
  spawns: readonly number[],
  options: TestWaveOptions = {},
): TurretWavePlan {
  return {
    spawns,
    coreDamage: options.coreDamage ?? 60,
    groups: [
      {
        brick: 'walkers',
        sides: options.sides ?? { kind: 'ring' },
        gapMinTicks: options.gapMinTicks ?? 16,
        gapMaxTicks: options.gapMaxTicks ?? 32,
        count: spawns.length,
        delayTicks: 0,
      },
    ],
    kegs: options.kegs ?? [],
    ...(options.kegCap !== undefined ? { kegCap: options.kegCap } : {}),
  };
}

/** The current wave's monsters spawned so far, every group's. */
export function turretSpawned(state: TurretDefenseState): number {
  return state.spawning.reduce((n, run) => n + run.cursor, 0);
}

/** Every group of the current wave spawns its next monster on the next tick it runs. */
export function releaseTurretSpawns(state: TurretDefenseState): void {
  for (const run of state.spawning) run.nextTick = 0;
}

/** No group of the current wave spawns again. */
export function holdTurretSpawns(state: TurretDefenseState): void {
  for (const run of state.spawning) run.nextTick = Number.MAX_SAFE_INTEGER;
}

/** The current wave counts as fully spawned. */
export function markTurretWaveSpawned(state: TurretDefenseState): void {
  const wave = state.plan.waves[state.wave];
  state.spawning = wave.groups.map((group) => ({
    cursor: group.count,
    nextTick: Number.MAX_SAFE_INTEGER,
  }));
}

const t = (seconds: number) => Math.round(seconds * 20);

/**
 * A scenario no content uses yet, built to play every brick and every keg mode: walkers from
 * one side with surgers setting off away from them, a pack beside a small group, a big one,
 * a surge, a second set of surgers and a sprint group, and kegs at random (spread, one spot a
 * cluster of three, and on the lanes), on the tower crown for small bodies and for large ones,
 * and on routes (one spaced, one in its own distance band, a pack's a cluster of two).
 */
export const TURRET_BRICKS_SCENARIO: TurretScenarioDef = {
  ...TURRET_SCENARIO_STANDARD,
  id: 'fire_and_fly_test_bricks',
  boardKey: 'testbricks',
  arsenal: { shockwave: 2, fragmentation: 2 },
  waves: [
    {
      coreDamage: 75,
      groups: [
        {
          brick: 'walkers',
          sides: { kind: 'arc', widthTurn: 0.15 },
          entries: [{ templateId: 'forest_wolf', count: 6, level: 2 }],
          gapMinTicks: t(0.5),
          gapMaxTicks: t(1),
        },
        {
          brick: 'surgers',
          sides: 2,
          widthTurn: 0.05,
          entries: [{ templateId: 'wild_boar', count: 4, level: 3, speedScale: 2 }],
          gapMinTicks: 2,
          gapMaxTicks: 4,
          delayTicks: t(4),
        },
      ],
      kegs: [
        { mode: 'random', count: 2, minRadius: 16, maxRadius: 30, cluster: 3, clusters: 1 },
        { mode: 'crown', count: 2, size: 'small' },
        { mode: 'path', group: 0, placement: 'front', spaced: true },
      ],
      kegCap: 8,
    },
    {
      coreDamage: 90,
      groups: [
        {
          brick: 'pack',
          entries: [{ templateId: 'forest_wolf', count: 5, level: 2, leads: true }],
          minRadius: 30,
          maxRadius: 34,
          holdTicks: t(4),
          spreadTicks: t(2),
          widthTurn: 0.1,
          advanceScale: 1.2,
        },
        {
          brick: 'smallGroup',
          size: 3,
          bunchGapTicks: t(2),
          widthTurn: 0.05,
          entries: [{ templateId: 'webwood_spider', count: 6, level: 3 }],
          gapMinTicks: 2,
          gapMaxTicks: 5,
          delayTicks: t(1),
        },
        {
          brick: 'bigOne',
          widthTurn: 0.08,
          entries: [
            { templateId: 'fen_troll', count: 1, level: 11 },
            { templateId: 'wild_boar', count: 2, level: 3 },
          ],
          gapMinTicks: t(0.5),
          gapMaxTicks: t(0.8),
          delayTicks: t(2),
        },
        {
          brick: 'surge',
          sides: 2,
          widthTurn: 0.06,
          entries: [{ templateId: 'tunnel_rat', count: 6, level: 6, speedScale: 2 }],
          gapMinTicks: 1,
          gapMaxTicks: 3,
          delayTicks: t(3),
        },
        {
          brick: 'surgers',
          sides: 3,
          widthTurn: 0.05,
          entries: [{ templateId: 'forest_wolf', count: 6, level: 2, speedScale: 2.2 }],
          gapMinTicks: 1,
          gapMaxTicks: 2,
          delayTicks: t(6),
        },
        {
          brick: 'sprint',
          spreadTicks: t(1),
          widthTurn: 0.08,
          entries: [{ templateId: 'tunnel_rat', count: 3, level: 6, speedScale: 1.8 }],
          delayTicks: t(2),
        },
      ],
      kegs: [
        { mode: 'path', group: 0, placement: 'front', cluster: 2 },
        { mode: 'path', group: 1, placement: 'side', minRadius: 20, maxRadius: 26 },
        { mode: 'path', group: 2, placement: 'axis', fromTower: 22 },
        { mode: 'crown', count: 2, size: 'large' },
        { mode: 'random', count: 2, minRadius: 18, maxRadius: 28, lanes: true },
      ],
      kegCap: 12,
    },
    {
      coreDamage: 75,
      groups: [
        {
          brick: 'walkers',
          entries: [{ templateId: 'forest_wolf', count: 4, level: 2 }],
          gapMinTicks: t(0.5),
          gapMaxTicks: t(1),
        },
      ],
    },
  ],
};
