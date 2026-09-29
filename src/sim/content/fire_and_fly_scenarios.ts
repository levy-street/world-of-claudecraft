// Fire and Fly scenarios, data only: the difficulties a run can take, resolved into
// a plan by src/sim/minigames/turret_defense_plan.ts. Standard is the original run
// (TURRET_WAVES and 100 tower points) and must replay it exactly. Introduction and
// Hard, and every medal bar, are first values to tune by playtest: mini-game tuning,
// not classic-era formulas. A tuning change after boards open mints a new board
// version.

import { DT, type TurretScenarioDef } from '../types';
import { TURRET_BARREL_RING, TURRET_WAVES } from './turret_defense';

const ticks = (seconds: number): number => Math.round(seconds / DT);

/** Slower spawns than Standard's 0.8 to 1.6 s: time to aim each one. */
const INTRO_GAP = { gapMinTicks: ticks(1.4), gapMaxTicks: ticks(2.4) } as const;
const HARD_GAP = { gapMinTicks: ticks(0.6), gapMaxTicks: ticks(1.2) } as const;
/** Inside a pack, the members follow each other closely. */
const PACK_GAP = { gapMinTicks: ticks(0.2), gapMaxTicks: ticks(0.4) } as const;
const HARD_HP = 1.4;

/** Three short waves of the smallest monsters on the whole ring, with room for mistakes. */
export const TURRET_SCENARIO_INTRODUCTION: TurretScenarioDef = {
  id: 'fire_and_fly_introduction',
  boardKey: 'introduction',
  integrity: 150,
  medals: { gold: { minIntegrity: 140 }, silver: { minIntegrity: 110 } },
  waves: [
    {
      entries: [{ templateId: 'forest_wolf', count: 5, level: 1 }],
      coreDamage: 60,
      ...INTRO_GAP,
      barrels: { count: 2, ...TURRET_BARREL_RING },
    },
    {
      entries: [
        { templateId: 'wild_boar', count: 5, level: 3 },
        { templateId: 'forest_wolf', count: 3, level: 2 },
      ],
      coreDamage: 60,
      ...INTRO_GAP,
      barrels: { count: 2, ...TURRET_BARREL_RING },
    },
    {
      entries: [
        { templateId: 'tunnel_rat', count: 5, level: 4 },
        { templateId: 'webwood_spider', count: 4, level: 3 },
      ],
      coreDamage: 64,
      ...INTRO_GAP,
      barrels: { count: 2, ...TURRET_BARREL_RING },
    },
  ],
};

export const TURRET_SCENARIO_STANDARD: TurretScenarioDef = {
  id: 'fire_and_fly_standard',
  boardKey: 'standard',
  integrity: 100,
  medals: { gold: { minIntegrity: 80 }, silver: { minIntegrity: 50 } },
  waves: TURRET_WAVES,
};

/**
 * Standard's six waves made meaner: tougher monsters (40 percent more health), more
 * of the large ones, faster spawns, and arrivals from one side, from pincers, or in
 * packs, so the cannon has to swing.
 */
export const TURRET_SCENARIO_HARD: TurretScenarioDef = {
  id: 'fire_and_fly_hard',
  boardKey: 'hard',
  integrity: 100,
  medals: { gold: { minIntegrity: 60 }, silver: { minIntegrity: 30 } },
  waves: [
    {
      entries: [
        { templateId: 'forest_wolf', count: 8, level: 2 },
        { templateId: 'wild_boar', count: 4, level: 3 },
      ],
      coreDamage: 60,
      ...HARD_GAP,
      barrels: { count: 3, ...TURRET_BARREL_RING },
      arrival: { kind: 'arc', widthTurn: 0.3 },
    },
    {
      entries: [
        { templateId: 'wild_boar', count: 6, level: 3, hpScale: HARD_HP },
        { templateId: 'vale_bandit', count: 6, level: 5, hpScale: HARD_HP },
      ],
      coreDamage: 64,
      ...HARD_GAP,
      barrels: { count: 3, ...TURRET_BARREL_RING },
      arrival: { kind: 'flanks', count: 2, widthTurn: 0.12 },
    },
    {
      entries: [
        { templateId: 'webwood_spider', count: 8, level: 4, hpScale: HARD_HP },
        { templateId: 'fen_troll', count: 4, level: 11, hpScale: HARD_HP },
      ],
      coreDamage: 84,
      ...PACK_GAP,
      barrels: { count: 4, ...TURRET_BARREL_RING },
      arrival: { kind: 'burst', groupSize: 4, groupGapTicks: ticks(3.5), widthTurn: 0.06 },
    },
    {
      entries: [
        { templateId: 'tunnel_rat', count: 6, level: 6, hpScale: HARD_HP },
        { templateId: 'fen_troll', count: 6, level: 12, hpScale: HARD_HP },
      ],
      coreDamage: 100,
      ...HARD_GAP,
      barrels: { count: 4, ...TURRET_BARREL_RING },
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.1 },
    },
    {
      entries: [
        { templateId: 'deeprock_kobold', count: 6, level: 15, hpScale: HARD_HP },
        { templateId: 'thornpeak_ogre', count: 6, level: 16, hpScale: HARD_HP },
        { templateId: 'boneclad_revenant', count: 4, level: 19, hpScale: HARD_HP },
      ],
      coreDamage: 130,
      ...HARD_GAP,
      barrels: { count: 5, ...TURRET_BARREL_RING },
      arrival: { kind: 'arc', widthTurn: 0.4 },
    },
    {
      entries: [
        { templateId: 'boneclad_revenant', count: 6, level: 19, hpScale: HARD_HP },
        { templateId: 'thornpeak_ogre', count: 4, level: 16, hpScale: HARD_HP },
        { templateId: 'frostmane_yeti', count: 3, level: 20, hpScale: HARD_HP },
        { templateId: 'idol_guardian', count: 1, level: 20, bossLast: true, hpScale: HARD_HP },
      ],
      coreDamage: 220,
      ...PACK_GAP,
      barrels: { count: 5, ...TURRET_BARREL_RING },
      arrival: { kind: 'burst', groupSize: 3, groupGapTicks: ticks(4), widthTurn: 0.08 },
    },
  ],
};

/** In the order an instructor offers them. */
export const TURRET_SCENARIOS: readonly TurretScenarioDef[] = [
  TURRET_SCENARIO_INTRODUCTION,
  TURRET_SCENARIO_STANDARD,
  TURRET_SCENARIO_HARD,
];

export const TURRET_DEFAULT_SCENARIO = TURRET_SCENARIO_STANDARD;
