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
// reading it 0.4 s late. Every trial's tower holds 70 points under the one medal rule
// (gold keeps 95 percent, silver 60), so the waves carry the difficulty: a
// player firing 0.4 s after each reload golds the Recruit's Trial
// every run (a school, not a test: everyone up to 2 s wins it, with silver at 1 s); Standing
// Watch nearly always (its gold target of about half is set aside: every wave set that
// reached it left the 1 s player, who must win it most runs, losing them all), its
// Shockwaves carrying a 1 s player to a win about three runs in four; the Veterans' Test
// about two runs in five, resupplied after its fourth and fifth waves, the gold lost
// in the last wave, where a 1 s player now loses most runs. A monster at the foot
// strikes 0.8 s after it gets there, every wave sets off on the tick the one before is
// cleared, and no monster is a sponge: a few good shells fell anything but a giant.

import { DT, type TurretScenarioDef } from '../types';
import { TURRET_MISSIONS } from './fire_and_fly_missions';
import {
  TURRET_EXPLOSIVE_BARREL,
  TURRET_MEDALS,
  TURRET_TOWER_POINTS,
  TURRET_WAVES,
  turretKegRing,
} from './turret_defense';

const ticks = (seconds: number): number => Math.round(seconds / DT);

/** The first waves' spawns: two seconds and more apart, time to aim each one. */
const INTRO_GAP = { gapMinTicks: ticks(2), gapMaxTicks: ticks(3) } as const;
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
 * The cannon's school: seven waves of the smallest monsters at their own pace, the load
 * climbing a step a wave, never a flood: a lone wolf at a time, then pairs, small groups,
 * a group walking past the kegs, and the busiest wave last. A first-wave wolf falls to one
 * shell, the rest to two. A small monster's strike costs 2 points, so gold forgives two.
 */
export const TURRET_SCENARIO_INTRODUCTION: TurretScenarioDef = {
  id: 'fire_and_fly_introduction',
  boardKey: 'introduction',
  integrity: TURRET_TOWER_POINTS,
  medals: TURRET_MEDALS,
  // The cannon and the kegs only: the weapons come one per trial after it.
  waves: [
    {
      groups: [
        {
          brick: 'walkers',
          entries: [{ templateId: 'forest_wolf', count: 4, level: 1 }],
          ...INTRO_GAP,
        },
      ],
      coreDamage: 60,
      kegs: turretKegRing(2),
    },
    {
      groups: [
        {
          brick: 'walkers',
          entries: [{ templateId: 'forest_wolf', count: 6, level: 1 }],
          gapMinTicks: ticks(1.6),
          gapMaxTicks: ticks(2.4),
        },
      ],
      coreDamage: 60,
      kegs: turretKegRing(2),
    },
    {
      groups: [
        {
          brick: 'walkers',
          entries: [
            { templateId: 'wild_boar', count: 5, level: 2 },
            { templateId: 'forest_wolf', count: 3, level: 2 },
          ],
          gapMinTicks: ticks(1.4),
          gapMaxTicks: ticks(2),
        },
      ],
      coreDamage: 36,
      kegs: turretKegRing(2),
    },
    {
      groups: [
        {
          brick: 'walkers',
          sides: { kind: 'flanks', count: 2, widthTurn: 0.14 },
          entries: [
            { templateId: 'forest_wolf', count: 5, level: 2 },
            { templateId: 'wild_boar', count: 5, level: 3 },
          ],
          gapMinTicks: ticks(1.2),
          gapMaxTicks: ticks(1.8),
        },
      ],
      coreDamage: 36,
      kegs: turretKegRing(2),
    },
    {
      groups: [
        {
          brick: 'smallGroup',
          size: 5,
          bunchGapTicks: ticks(6),
          widthTurn: 0.04,
          entries: [
            { templateId: 'wild_boar', count: 6, level: 3 },
            { templateId: 'forest_wolf', count: 4, level: 2 },
          ],
          gapMinTicks: ticks(0.3),
          gapMaxTicks: ticks(0.5),
        },
      ],
      coreDamage: 38,
      kegs: turretKegRing(3, 'lanes'),
    },
    {
      groups: [
        {
          brick: 'walkers',
          entries: [
            { templateId: 'tunnel_rat', count: 8, level: 4 },
            { templateId: 'webwood_spider', count: 7, level: 3 },
          ],
          gapMinTicks: ticks(0.85),
          gapMaxTicks: ticks(1.3),
        },
      ],
      coreDamage: 40,
      kegs: turretKegRing(2),
    },
    {
      groups: [
        {
          brick: 'walkers',
          sides: { kind: 'flanks', count: 3, widthTurn: 0.14 },
          entries: [
            { templateId: 'tunnel_rat', count: 10, level: 4 },
            { templateId: 'webwood_spider', count: 10, level: 3 },
          ],
          gapMinTicks: ticks(0.7),
          gapMaxTicks: ticks(1.05),
        },
      ],
      coreDamage: 40,
      kegs: turretKegRing(3),
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
  // One Shockwave and one frag more as the fourth and the fifth waves end, so even a
  // gunner who fires each charge the moment it comes meets the last charge with two of
  // each for the giants and the dead; no bonus for charges left.
  supply: { resupplyAfterWaves: [4, 5], unusedChargeBonus: false },
  waves: [
    {
      groups: [
        {
          brick: 'walkers',
          sides: { kind: 'flanks', count: 2, widthTurn: 0.14 },
          entries: [
            { templateId: 'forest_wolf', count: 12, level: 2 },
            { templateId: 'wild_boar', count: 8, level: 3 },
          ],
          ...HARD_GAP,
        },
      ],
      coreDamage: 60,
      kegs: turretKegRing(3),
    },
    {
      groups: [
        {
          brick: 'smallGroup',
          size: 10,
          bunchGapTicks: ticks(0.4),
          widthTurn: 0.04,
          entries: [
            {
              templateId: 'webwood_spider',
              count: 10,
              level: 4,
              hpScale: HARD_HP,
              speedScale: 1.5,
            },
            { templateId: 'vale_bandit', count: 8, level: 5, hpScale: HARD_HP, speedScale: 1.5 },
            { templateId: 'fen_troll', count: 2, level: 11, hpScale: BRUTE_HP },
          ],
          ...PACK_GAP,
        },
      ],
      coreDamage: 110,
      kegs: turretKegRing(3),
    },
    {
      groups: [
        {
          brick: 'walkers',
          sides: { kind: 'flanks', count: 3, widthTurn: 0.1 },
          entries: [
            { templateId: 'vale_bandit', count: 12, level: 5, hpScale: HARD_HP, speedScale: 1.5 },
            { templateId: 'fen_troll', count: 6, level: 11, hpScale: BRUTE_HP, speedScale: 1.3 },
          ],
          ...RUSH_GAP,
        },
      ],
      coreDamage: 130,
      kegs: turretKegRing(4),
    },
    {
      groups: [
        {
          brick: 'walkers',
          sides: { kind: 'arc', widthTurn: 0.1 },
          entries: [
            { templateId: 'tunnel_rat', count: 20, level: 6, hpScale: HARD_HP, speedScale: 1.5 },
            { templateId: 'fen_troll', count: 4, level: 12, hpScale: BRUTE_HP, speedScale: 1.2 },
          ],
          ...PACK_GAP,
        },
      ],
      coreDamage: 160,
      kegs: turretKegRing(4),
    },
    {
      groups: [
        {
          brick: 'walkers',
          sides: { kind: 'flanks', count: 3, widthTurn: 0.1 },
          entries: [
            {
              templateId: 'deeprock_kobold',
              count: 9,
              level: 15,
              hpScale: HARD_HP,
              speedScale: 1.5,
            },
            {
              templateId: 'thornpeak_ogre',
              count: 6,
              level: 16,
              hpScale: BRUTE_HP,
              speedScale: 1.3,
            },
          ],
          ...RUSH_GAP,
        },
      ],
      coreDamage: 330,
      kegs: turretKegRing(5),
    },
    {
      // The giants set off first, a little quicker than their templates; the charge
      // spawns behind them and runs them down, so both reach the tower together. No
      // sponge: a charger falls to three good shells, a giant to five or six; the charge
      // is many (19 at 2.4 times their pace) so the cannon alone lets several through,
      // while the Shockwave and frags saved for this wave turn most of it back.
      groups: [
        {
          brick: 'walkers',
          sides: { kind: 'flanks', count: 3, widthTurn: 0.1 },
          entries: [
            {
              templateId: 'frostmane_yeti',
              count: 3,
              level: 20,
              hpScale: GIANT_HP,
              speedScale: 1.15,
            },
            {
              templateId: 'idol_guardian',
              count: 1,
              level: 20,
              hpScale: GIANT_HP,
              speedScale: 1.15,
            },
            {
              templateId: 'boneclad_revenant',
              count: 19,
              level: 19,
              bossLast: true,
              hpScale: CHARGER_HP,
              speedScale: 2.4,
            },
          ],
          gapMinTicks: 3,
          gapMaxTicks: 7,
        },
      ],
      coreDamage: 360,
      kegs: turretKegRing(5),
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
    scenario.waves.map((wave) => wave.kegCap ?? TURRET_EXPLOSIVE_BARREL.cap),
  ),
);

/**
 * Each scenario's scoreboard version, by board key (fire_and_fly_scoreboards.ts). Once the
 * boards are open to players, any tuning change of a trial or a mission (its waves, health,
 * speed, arrivals, kegs, integrity, medal bars or arsenal, or the points in
 * minigames/turret_result.ts, which move every one) must raise its version, so runs under
 * the old and the new tuning never share a ladder. Until the boards open no run has been
 * ranked, so a retune or a removed mission keeps the versions as they are. Trials'
 * version 2: the arsenal.
 */
export const FIRE_AND_FLY_SCORE_VERSIONS: Readonly<Record<string, number>> = {
  introduction: 2,
  standard: 2,
  hard: 2,
  pack: 1,
  deluge: 1,
  brittle: 1,
  powder: 1,
};

/**
 * The Gunner's Mastery board's version (fire_and_fly_scoreboards.ts). It sums the
 * missions' current bests, so once the boards are open, raise it whenever any mission's
 * version above changes or a mission is added or removed; never lower it, or an old board
 * id comes back. Until the boards open, a retune or a removed mission keeps it.
 */
export const FIRE_AND_FLY_MASTERY_VERSION = 1;
