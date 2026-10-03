// Fire and Fly scenarios, data only: the difficulties a run can take, resolved into
// a plan by src/sim/minigames/turret_defense_plan.ts. Standard is the original run
// (TURRET_WAVES), retuned for the 0.8 s strike and again for the one medal rule. Every wave,
// shell damage, medal bar and arsenal here is mini-game tuning, not a classic-era
// formula. A tuning change after boards open mints a new board version. The trials
// bring in one weapon each: the Recruit's Trial the cannon alone, Standing Watch the
// Shockwave, the Veterans' Test the fragmentation shell. Measured with scripted aimers
// on the arena ground, up to 3 yd off, firing a set delay after each reload, bare or
// with a plain weapon policy (a Shockwave at the HUD's nudge or once a pending strike
// costs 5 percent of the tower, a frag on a group of 4 coming within 30 yd), and with
// a field-aware one, the stand-in for a good player (shells led onto the strike that
// comes first, a keg as a group passes it, a frag on a pack standing clear of any
// keg, a Shockwave at 2 strikes due), which reads the field exactly, and the same policy
// reading it 0.4 s late. Every trial's tower holds 100 points under the one medal rule
// (gold keeps 95 percent, silver 60), so the waves carry the difficulty (lot R5b): a
// player firing 0.4 s after each reload and reading the field exactly golds the
// Recruit's Trial about three runs in five, and everyone up to 1 s wins it; Standing
// Watch nearly always (its gold target of about half is set aside: every wave set that
// reached it left the 1 s player, who must win it most runs, losing them all), its
// Shockwaves carrying a 1 s player to a win about three runs in four; the Veterans' Test about a third, under a tenth bare, the gold lost
// in the last wave, where a 1 s player now loses most runs. A monster at the foot
// strikes 0.8 s after it gets there, every wave sets off on the tick the one before is
// cleared, and no monster is a sponge: a few good shells fell anything but a giant.

import { DT, type TurretScenarioDef } from '../types';
import { TURRET_MISSIONS } from './fire_and_fly_missions';
import {
  TURRET_BARREL_RING,
  TURRET_EXPLOSIVE_BARREL,
  TURRET_MEDALS,
  TURRET_TOWER_POINTS,
  TURRET_WAVES,
} from './turret_defense';

const ticks = (seconds: number): number => Math.round(seconds / DT);

/** The first wave's spawns: under a second and a half apart, room to aim each one. */
const INTRO_GAP = { gapMinTicks: ticks(0.75), gapMaxTicks: ticks(1.25) } as const;
/** The trial's monsters run nearly twice their templates' march: the cannon is tested. */
const INTRO_PACE = 1.87;
const HARD_GAP = { gapMinTicks: ticks(0.4), gapMaxTicks: ticks(0.8) } as const;
/** Inside a pack, the members follow each other closely. */
const PACK_GAP = { gapMinTicks: ticks(0.15), gapMaxTicks: ticks(0.25) } as const;
/** A rush: every side's monsters set off together. */
const RUSH_GAP = { gapMinTicks: ticks(0.05), gapMaxTicks: ticks(0.1) } as const;
const HARD_HP = 1.8;
const BRUTE_HP = 1.4;
/** The Veterans' Test's last charge: armoured dead three good shells each. */
const CHARGER_HP = 2.2;
/** Its giants: a handful of good shells each, never a wall of health. */
const GIANT_HP = 1.1;

/**
 * Three short waves of the smallest monsters on the whole ring, running in quickly
 * from every side, with room for mistakes: one shell fells a first-wave wolf, then each
 * monster takes two, and the spawns close up wave by wave. A small monster's strike costs
 * 2 points, so gold forgives two of them: a player firing 0.4 s after each reload keeps
 * it about two runs in three, and anyone up to 1 s still wins.
 */
export const TURRET_SCENARIO_INTRODUCTION: TurretScenarioDef = {
  id: 'fire_and_fly_introduction',
  boardKey: 'introduction',
  integrity: TURRET_TOWER_POINTS,
  medals: TURRET_MEDALS,
  // The cannon and the kegs only: the weapons come one per trial after it.
  waves: [
    {
      entries: [{ templateId: 'forest_wolf', count: 8, level: 1, speedScale: INTRO_PACE }],
      coreDamage: 78,
      ...INTRO_GAP,
      barrels: { count: 2, ...TURRET_BARREL_RING },
    },
    {
      entries: [
        { templateId: 'wild_boar', count: 9, level: 3, speedScale: INTRO_PACE },
        { templateId: 'forest_wolf', count: 6, level: 2, speedScale: INTRO_PACE },
      ],
      coreDamage: 47,
      gapMinTicks: ticks(0.45),
      gapMaxTicks: ticks(0.8),
      barrels: { count: 2, ...TURRET_BARREL_RING },
    },
    {
      entries: [
        { templateId: 'tunnel_rat', count: 14, level: 4, speedScale: INTRO_PACE },
        { templateId: 'webwood_spider', count: 12, level: 3, speedScale: INTRO_PACE },
      ],
      coreDamage: 52,
      gapMinTicks: ticks(0.45),
      gapMaxTicks: ticks(0.65),
      barrels: { count: 2, ...TURRET_BARREL_RING },
    },
  ],
};

export const TURRET_SCENARIO_STANDARD: TurretScenarioDef = {
  id: 'fire_and_fly_standard',
  boardKey: 'standard',
  integrity: TURRET_TOWER_POINTS,
  medals: TURRET_MEDALS,
  // It brings in the Shockwave, generously: eight, so a slower gunner can lean on it.
  arsenal: { shockwave: 8 },
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
  integrity: TURRET_TOWER_POINTS,
  medals: TURRET_MEDALS,
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
      // spawns behind them and runs them down, so both reach the tower together. No
      // sponge: a charger falls to three good shells, a giant to five or six; the charge
      // is many (18 at 2.4 times their pace) so the cannon alone lets several through,
      // while the Shockwave and frags saved for this wave turn most of it back.
      entries: [
        { templateId: 'frostmane_yeti', count: 3, level: 20, hpScale: GIANT_HP, speedScale: 1.15 },
        { templateId: 'idol_guardian', count: 1, level: 20, hpScale: GIANT_HP, speedScale: 1.15 },
        {
          templateId: 'boneclad_revenant',
          count: 18,
          level: 19,
          bossLast: true,
          hpScale: CHARGER_HP,
          speedScale: 2.4,
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
