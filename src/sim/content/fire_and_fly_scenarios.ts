// Fire and Fly scenarios, data only: the difficulties a run can take, resolved into
// a plan by src/sim/minigames/turret_defense_plan.ts. Standard is the original run
// (TURRET_WAVES and 100 tower points) and must replay it exactly. Every wave, shell
// damage, medal bar and arsenal here is mini-game tuning, not a classic-era formula. A
// tuning change after boards open mints a new board version. The trials bring in one
// weapon each: the Recruit's Trial the cannon alone, Standing Watch the Shockwave,
// the Veterans' Test the fragmentation shell. Measured with scripted aimers on the
// arena ground, up to 3 yd off, firing a set delay after each reload, bare or with a
// plain weapon policy (a Shockwave at the HUD's nudge or once a pending strike costs 5
// percent of the tower, a frag on a group of 4 coming within 30 yd): the Recruit's
// Trial golds aimers within 0.8 s and gives one at 1 s mostly silver, 2 s silver or
// bronze, never a loss; Standing Watch's gold goes from about half to three quarters
// of the 0.8 s aimers' runs and from none to about half of the 1 s aimer's with the
// Shockwave. The Veterans' Test is measured against a sharper policy too, the best
// scripted stand-in for a good player (a Shockwave at 3 windups, a frag on the pack
// about to strike once several close in at once): the 0.4 s aimer golds about a
// fifth of its runs bare and over half with it, nearly all the gold lost in the last
// wave; the 0.8 s aimers never gold, and the 1 s aimer wins with silver or bronze,
// losing about one run in ten bare and none with that policy. The armed figures hold
// for those policies only. The pause between waves went from 5 s to 2 s (lot N2d)
// without moving any of them past the noise of 24 seeds.

import { DT, type TurretScenarioDef } from '../types';
import { TURRET_MISSIONS } from './fire_and_fly_missions';
import { TURRET_BARREL_RING, TURRET_EXPLOSIVE_BARREL, TURRET_WAVES } from './turret_defense';

const ticks = (seconds: number): number => Math.round(seconds / DT);

/** The first wave's slow spawns: time to aim each one. */
const INTRO_GAP = { gapMinTicks: ticks(1.4), gapMaxTicks: ticks(2.4) } as const;
const HARD_GAP = { gapMinTicks: ticks(0.4), gapMaxTicks: ticks(0.8) } as const;
/** Inside a pack, the members follow each other closely. */
const PACK_GAP = { gapMinTicks: ticks(0.15), gapMaxTicks: ticks(0.25) } as const;
/** A rush: every side's monsters set off together. */
const RUSH_GAP = { gapMinTicks: ticks(0.05), gapMaxTicks: ticks(0.1) } as const;
const HARD_HP = 1.8;
const BRUTE_HP = 1.4;
/** The Veterans' Test's last charge: armoured dead as tough as its giants. */
const CHARGER_HP = 6.2;

/**
 * Three short waves of the smallest monsters on the whole ring, with room for mistakes:
 * one shell fells a first-wave wolf, then each monster takes two, and the spawns quicken
 * to about Standing Watch's pace over shorter waves.
 */
export const TURRET_SCENARIO_INTRODUCTION: TurretScenarioDef = {
  id: 'fire_and_fly_introduction',
  boardKey: 'introduction',
  integrity: 150,
  // Its small monsters cost 1 or 2 of 150 points a strike: gold lets 2 tower points go,
  // so an aimer firing within 0.8 s of each reload keeps it and one at 1 s mostly misses
  // it; silver holds an aimer as slow as 2 s half the time, and nobody loses.
  medals: { gold: { minIntegrityShare: 0.985 }, silver: { minIntegrityShare: 0.85 } },
  // The cannon and the kegs only: the weapons come one per trial after it.
  waves: [
    {
      entries: [{ templateId: 'forest_wolf', count: 5, level: 1 }],
      coreDamage: 60,
      ...INTRO_GAP,
      barrels: { count: 2, ...TURRET_BARREL_RING },
    },
    {
      entries: [
        { templateId: 'wild_boar', count: 6, level: 3 },
        { templateId: 'forest_wolf', count: 4, level: 2 },
      ],
      coreDamage: 36,
      gapMinTicks: ticks(0.9),
      gapMaxTicks: ticks(1.5),
      barrels: { count: 2, ...TURRET_BARREL_RING },
    },
    {
      entries: [
        { templateId: 'tunnel_rat', count: 9, level: 4 },
        { templateId: 'webwood_spider', count: 8, level: 3 },
      ],
      coreDamage: 40,
      gapMinTicks: ticks(0.85),
      gapMaxTicks: ticks(1.25),
      barrels: { count: 2, ...TURRET_BARREL_RING },
    },
  ],
};

export const TURRET_SCENARIO_STANDARD: TurretScenarioDef = {
  id: 'fire_and_fly_standard',
  boardKey: 'standard',
  integrity: 100,
  // Gold lets one point go: the Shockwave's cancelled strikes are what keep it for the
  // aimers firing 0.8 to 1 s after each reload (TURRET_WAVES stay the original run).
  medals: { gold: { minIntegrityShare: 0.99 }, silver: { minIntegrityShare: 0.6 } },
  // It brings in the Shockwave, generously so it can be tried freely.
  arsenal: { shockwave: 4 },
  waves: TURRET_WAVES,
};

/**
 * Standard's six waves made meaner: tight fast packs, a rush on three sides at once
 * (the Shockwave's), a stream from one side, a second rush, then the giants walking in
 * with a charge of armoured dead hard on their heels from three sides. The fodder
 * takes 80 percent more health, the large ones 40, and the kegs stay as many as
 * Standard's.
 */
export const TURRET_SCENARIO_HARD: TurretScenarioDef = {
  id: 'fire_and_fly_hard',
  boardKey: 'hard',
  // A sturdier tower than the other trials: gold still lets 3 points go, but a run the
  // last wave mauls stays winnable, so the recruitment it closes stays open.
  integrity: 150,
  medals: { gold: { minIntegrityShare: 0.98 }, silver: { minIntegrityShare: 0.6 } },
  // It brings in the fragmentation shell beside fewer Shockwaves.
  arsenal: { shockwave: 2, fragmentation: 4 },
  // One Shockwave and one frag more as the fifth wave ends, so every gunner meets the
  // last charge with a tool for the giants and the dead; no bonus for charges left.
  supply: { resupplyAfterWaves: [5], unusedChargeBonus: false },
  waves: [
    {
      entries: [
        { templateId: 'forest_wolf', count: 12, level: 2 },
        { templateId: 'wild_boar', count: 8, level: 3 },
      ],
      coreDamage: 60,
      ...HARD_GAP,
      barrels: { count: 3, ...TURRET_BARREL_RING },
      arrival: { kind: 'flanks', count: 2, widthTurn: 0.14 },
    },
    {
      entries: [
        { templateId: 'webwood_spider', count: 10, level: 4, hpScale: HARD_HP, speedScale: 1.5 },
        { templateId: 'vale_bandit', count: 8, level: 5, hpScale: HARD_HP, speedScale: 1.5 },
        { templateId: 'fen_troll', count: 2, level: 11, hpScale: BRUTE_HP },
      ],
      coreDamage: 110,
      ...PACK_GAP,
      barrels: { count: 3, ...TURRET_BARREL_RING },
      arrival: { kind: 'burst', groupSize: 10, groupGapTicks: ticks(0.4), widthTurn: 0.04 },
    },
    {
      entries: [
        { templateId: 'vale_bandit', count: 12, level: 5, hpScale: HARD_HP, speedScale: 1.5 },
        { templateId: 'fen_troll', count: 6, level: 11, hpScale: BRUTE_HP, speedScale: 1.3 },
      ],
      coreDamage: 130,
      ...RUSH_GAP,
      barrels: { count: 4, ...TURRET_BARREL_RING },
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.1 },
    },
    {
      entries: [
        { templateId: 'tunnel_rat', count: 20, level: 6, hpScale: HARD_HP, speedScale: 1.5 },
        { templateId: 'fen_troll', count: 4, level: 12, hpScale: BRUTE_HP, speedScale: 1.2 },
      ],
      coreDamage: 160,
      ...PACK_GAP,
      barrels: { count: 4, ...TURRET_BARREL_RING },
      arrival: { kind: 'arc', widthTurn: 0.1 },
    },
    {
      entries: [
        { templateId: 'deeprock_kobold', count: 9, level: 15, hpScale: HARD_HP, speedScale: 1.5 },
        { templateId: 'thornpeak_ogre', count: 6, level: 16, hpScale: BRUTE_HP, speedScale: 1.3 },
      ],
      coreDamage: 330,
      ...RUSH_GAP,
      barrels: { count: 5, ...TURRET_BARREL_RING },
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.1 },
    },
    {
      // The giants set off first, a little quicker than their templates; the charge
      // spawns behind them and runs them down, so both reach the tower together. Each
      // charger is nearly as tough as a giant: the cannon alone lets one through in most
      // runs, while the Shockwave and frags saved for this wave turn most charges back.
      entries: [
        { templateId: 'frostmane_yeti', count: 3, level: 20, hpScale: HARD_HP, speedScale: 1.15 },
        { templateId: 'idol_guardian', count: 1, level: 20, hpScale: HARD_HP, speedScale: 1.15 },
        {
          templateId: 'boneclad_revenant',
          count: 21,
          level: 19,
          bossLast: true,
          hpScale: CHARGER_HP,
          speedScale: 3.2,
        },
      ],
      coreDamage: 360,
      gapMinTicks: 3,
      gapMaxTicks: 7,
      barrels: { count: 5, ...TURRET_BARREL_RING },
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.1 },
    },
  ],
};

/** The trials, in the order an instructor offers them: winning each opens the next. */
export const TURRET_SCENARIOS: readonly TurretScenarioDef[] = [
  TURRET_SCENARIO_INTRODUCTION,
  TURRET_SCENARIO_STANDARD,
  TURRET_SCENARIO_HARD,
];

/** Every scenario a seat can run: the trials, then the missions (fire_and_fly_missions.ts). */
export const FIRE_AND_FLY_SCENARIOS: readonly TurretScenarioDef[] = [
  ...TURRET_SCENARIOS,
  ...TURRET_MISSIONS,
];

export const TURRET_DEFAULT_SCENARIO = TURRET_SCENARIO_STANDARD;

/** The most kegs any scenario lets stand at once: the render pools are sized to it. */
export const FIRE_AND_FLY_MAX_KEG_CAP = Math.max(
  ...FIRE_AND_FLY_SCENARIOS.flatMap((scenario) =>
    scenario.waves.map(
      (wave) => scenario.kegs?.cap ?? wave.barrels.cap ?? TURRET_EXPLOSIVE_BARREL.cap,
    ),
  ),
);

/**
 * Each scenario's scoreboard version, by board key (fire_and_fly_scoreboards.ts). Any
 * tuning change of a trial or a mission (its waves, health, speed, arrivals, kegs,
 * integrity, medal bars or arsenal, or the points in minigames/turret_result.ts, which
 * move every one) must raise its version, so runs under the old and the new tuning never
 * share a ladder. Trials' version 2: the arsenal.
 */
export const FIRE_AND_FLY_SCORE_VERSIONS: Readonly<Record<string, number>> = {
  introduction: 2,
  standard: 2,
  hard: 2,
  pack: 1,
  giants: 1,
  deluge: 1,
  brittle: 1,
  powder: 1,
};

/**
 * The Gunner's Mastery board's version (fire_and_fly_scoreboards.ts). It sums the
 * missions' current bests, so raise it whenever any mission's version above changes or a
 * mission is added or removed; never lower it, or an old board id comes back.
 */
export const FIRE_AND_FLY_MASTERY_VERSION = 1;
