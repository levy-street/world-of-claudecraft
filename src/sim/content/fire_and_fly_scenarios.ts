// Fire and Fly scenarios, data only: the difficulties a run can take, resolved into
// a plan by src/sim/minigames/turret_defense_plan.ts. Standard is the original run
// (TURRET_WAVES and 100 tower points) and must replay it exactly. Introduction and
// Hard, and every medal bar, are first values to tune by playtest: mini-game tuning,
// not classic-era formulas. A tuning change after boards open mints a new board
// version. The medal bars come from scripted aimers on the arena ground, up to 3 yd
// off: on Standard, firing within about 0.4 s of each reload keeps gold, 0.8 s gold
// or silver, 1 s silver, 1.5 s bronze; on Hard, 0.4 s gold, 0.8 s mostly silver, 1 s
// bronze or a loss.

import { DT, type TurretScenarioDef } from '../types';
import { TURRET_BARREL_RING, TURRET_WAVES } from './turret_defense';

const ticks = (seconds: number): number => Math.round(seconds / DT);

/** Slower spawns than Standard's 0.8 to 1.6 s: time to aim each one. */
const INTRO_GAP = { gapMinTicks: ticks(1.4), gapMaxTicks: ticks(2.4) } as const;
const HARD_GAP = { gapMinTicks: ticks(0.4), gapMaxTicks: ticks(0.8) } as const;
/** Inside a pack, the members follow each other closely. */
const PACK_GAP = { gapMinTicks: ticks(0.2), gapMaxTicks: ticks(0.4) } as const;
const HARD_HP = 1.8;

/** Three short waves of the smallest monsters on the whole ring, with room for mistakes. */
export const TURRET_SCENARIO_INTRODUCTION: TurretScenarioDef = {
  id: 'fire_and_fly_introduction',
  boardKey: 'introduction',
  integrity: 150,
  // Its small monsters cost 1 or 2 of 150 points a strike, so even a slow aimer keeps
  // most of the tower: gold is a nearly untouched one.
  medals: { gold: { minIntegrityShare: 0.98 }, silver: { minIntegrityShare: 0.9 } },
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
  medals: { gold: { minIntegrityShare: 0.97 }, silver: { minIntegrityShare: 0.6 } },
  waves: TURRET_WAVES,
};

/**
 * Standard's six waves made meaner: tougher monsters (80 percent more health from the
 * second wave), more of them and far more of the large and huge ones, faster spawns,
 * and arrivals from pincers or in packs more often than from one side, so the cannon
 * has to swing. The kegs stay as many as Standard's.
 */
export const TURRET_SCENARIO_HARD: TurretScenarioDef = {
  id: 'fire_and_fly_hard',
  boardKey: 'hard',
  integrity: 100,
  medals: { gold: { minIntegrityShare: 0.95 }, silver: { minIntegrityShare: 0.6 } },
  waves: [
    {
      entries: [
        { templateId: 'forest_wolf', count: 10, level: 2 },
        { templateId: 'wild_boar', count: 6, level: 3 },
      ],
      coreDamage: 60,
      ...HARD_GAP,
      barrels: { count: 3, ...TURRET_BARREL_RING },
      arrival: { kind: 'flanks', count: 2, widthTurn: 0.14 },
    },
    {
      entries: [
        { templateId: 'wild_boar', count: 7, level: 3, hpScale: HARD_HP },
        { templateId: 'vale_bandit', count: 7, level: 5, hpScale: HARD_HP },
        { templateId: 'fen_troll', count: 2, level: 11, hpScale: HARD_HP },
      ],
      coreDamage: 64,
      ...HARD_GAP,
      barrels: { count: 3, ...TURRET_BARREL_RING },
      arrival: { kind: 'arc', widthTurn: 0.3 },
    },
    {
      entries: [
        { templateId: 'webwood_spider', count: 10, level: 4, hpScale: HARD_HP },
        { templateId: 'fen_troll', count: 6, level: 11, hpScale: HARD_HP },
      ],
      coreDamage: 84,
      ...PACK_GAP,
      barrels: { count: 4, ...TURRET_BARREL_RING },
      arrival: { kind: 'burst', groupSize: 5, groupGapTicks: ticks(2.5), widthTurn: 0.06 },
    },
    {
      entries: [
        { templateId: 'tunnel_rat', count: 9, level: 6, hpScale: HARD_HP },
        { templateId: 'fen_troll', count: 6, level: 12, hpScale: HARD_HP },
        { templateId: 'thornpeak_ogre', count: 2, level: 16, hpScale: HARD_HP },
      ],
      coreDamage: 100,
      ...HARD_GAP,
      barrels: { count: 4, ...TURRET_BARREL_RING },
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.1 },
    },
    {
      entries: [
        { templateId: 'deeprock_kobold', count: 7, level: 15, hpScale: HARD_HP },
        { templateId: 'thornpeak_ogre', count: 5, level: 16, hpScale: HARD_HP },
        { templateId: 'boneclad_revenant', count: 5, level: 19, hpScale: HARD_HP },
        { templateId: 'frostmane_yeti', count: 1, level: 20, hpScale: HARD_HP },
      ],
      coreDamage: 130,
      ...HARD_GAP,
      barrels: { count: 5, ...TURRET_BARREL_RING },
      arrival: { kind: 'flanks', count: 2, widthTurn: 0.12 },
    },
    {
      entries: [
        { templateId: 'boneclad_revenant', count: 7, level: 19, hpScale: HARD_HP },
        { templateId: 'thornpeak_ogre', count: 5, level: 16, hpScale: HARD_HP },
        { templateId: 'frostmane_yeti', count: 3, level: 20, hpScale: HARD_HP },
        { templateId: 'idol_guardian', count: 1, level: 20, bossLast: true, hpScale: HARD_HP },
      ],
      coreDamage: 220,
      ...PACK_GAP,
      barrels: { count: 5, ...TURRET_BARREL_RING },
      arrival: { kind: 'burst', groupSize: 4, groupGapTicks: ticks(3), widthTurn: 0.08 },
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

/**
 * Each trial's scoreboard version, by board key (fire_and_fly_scoreboards.ts). Any tuning
 * change of a trial (its waves, health, arrivals, integrity or medal bars, or the points
 * in minigames/turret_result.ts, which move every trial) must raise its version, so runs
 * under the old and the new tuning never share a ladder.
 */
export const FIRE_AND_FLY_SCORE_VERSIONS: Readonly<Record<string, number>> = {
  introduction: 1,
  standard: 1,
  hard: 1,
};
