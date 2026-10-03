// Fire and Fly missions, data only: the five runs a recruited gunner can take any
// day (fire_and_fly_recruitment.ts unlocks them), each built around one idea and
// carrying the weapon that idea asks for. Every number here is a first value:
// mini-game tuning, not classic-era formulas. A tuning change after boards open mints
// a new board version. Measured with the scripted aimers of the scenarios file (12
// seeds each, The Pack 24 and 96): the clean aimer golds every mission bare; with the
// weapons, the 0.8 s aimer's gold rate rises on The Cracked Tower and The Powder Store
// (by about half its runs), Heavy Tread and The Deluge (a quarter to a third), and the
// 1 s aimer's from none or one to most runs on Heavy Tread and The Cracked Tower, while
// it gains nothing on The Deluge. The Pack is measured against the good-player policy
// of the scenarios file: the 0.4 s aimer golds about three runs in ten bare and about
// half with its frags, nobody slower golds, and the 1 s aimer mostly wins with bronze.

import { DT, type TurretScenarioDef } from '../types';
import { TURRET_BARREL_RING } from './turret_defense';

const ticks = (seconds: number): number => Math.round(seconds / DT);

/**
 * Every mission is resupplied as its third and fifth waves end, and a won one scores the
 * charges it leaves: each mission's arsenal is its signature, the weapon its idea asks for.
 */
const MISSION_SUPPLY = { resupplyAfterWaves: [3, 5], unusedChargeBonus: true } as const;
const KEGS = (count: number) => ({ count, ...TURRET_BARREL_RING });

/** A pack's members walk nearly in each other's steps. */
const PACK_GAP = { gapMinTicks: ticks(0.15), gapMaxTicks: ticks(0.25) } as const;
/** The Pack's packs set off at once: their members a tick or two apart. */
const HUNT_GAP = { gapMinTicks: 1, gapMaxTicks: 2 } as const;
const packs = (groupSize: number, gapSeconds: number) =>
  ({ kind: 'burst', groupSize, groupGapTicks: ticks(gapSeconds), widthTurn: 0.03 }) as const;
/** Two packs at once, from opposite sides of the tower. */
const TWO_AT_ONCE = { kind: 'flanks', count: 2, widthTurn: 0.03 } as const;

/**
 * Many monsters, always in tight packs of a dozen or more, far quicker than their
 * templates. The first three waves send two packs of fourteen a few seconds apart, each
 * from its own side; the last three send two packs of twelve at once from opposite sides,
 * each a notch faster and tougher than the last, beasts with an alpha or two among them.
 * A shell throws a pack and the throws scatter it; a frag on a pack at the foot of the
 * tower strikes most of it. The tower takes 150 points, gold still letting one go, so a
 * run the packs maul stays winnable.
 */
export const TURRET_MISSION_PACK: TurretScenarioDef = {
  id: 'fire_and_fly_pack',
  boardKey: 'pack',
  integrity: 150,
  medals: { gold: { minIntegrityShare: 0.99 }, silver: { minIntegrityShare: 0.6 } },
  arsenal: { fragmentation: 5 },
  supply: MISSION_SUPPLY,
  waves: [
    {
      entries: [{ templateId: 'forest_wolf', count: 28, level: 2, speedScale: 2.4 }],
      coreDamage: 45,
      ...HUNT_GAP,
      barrels: KEGS(3),
      arrival: packs(14, 4),
    },
    {
      entries: [
        { templateId: 'forest_wolf', count: 14, level: 2, speedScale: 2.4 },
        { templateId: 'wild_boar', count: 14, level: 3, speedScale: 2.4 },
      ],
      coreDamage: 44,
      ...HUNT_GAP,
      barrels: KEGS(3),
      arrival: packs(14, 3),
    },
    {
      entries: [
        { templateId: 'webwood_spider', count: 11, level: 4, speedScale: 2.6 },
        { templateId: 'vale_bandit', count: 17, level: 5, speedScale: 2.6 },
      ],
      coreDamage: 62,
      ...HUNT_GAP,
      barrels: KEGS(4),
      arrival: packs(14, 3),
    },
    {
      entries: [
        { templateId: 'tunnel_rat', count: 14, level: 6, speedScale: 3.2 },
        { templateId: 'vale_bandit', count: 7, level: 5, speedScale: 3.2 },
        { templateId: 'fen_troll', count: 3, level: 11, speedScale: 2.85 },
      ],
      coreDamage: 48,
      ...HUNT_GAP,
      barrels: KEGS(4),
      arrival: TWO_AT_ONCE,
    },
    {
      entries: [
        { templateId: 'deeprock_kobold', count: 12, level: 15, speedScale: 3.4 },
        { templateId: 'boneclad_revenant', count: 10, level: 19, speedScale: 3.4 },
        { templateId: 'thornpeak_ogre', count: 2, level: 16, speedScale: 3.05 },
      ],
      coreDamage: 149,
      ...HUNT_GAP,
      barrels: KEGS(5),
      arrival: TWO_AT_ONCE,
    },
    {
      entries: [
        { templateId: 'boneclad_revenant', count: 14, level: 19, speedScale: 3.6 },
        { templateId: 'deeprock_kobold', count: 7, level: 15, speedScale: 3.6 },
        { templateId: 'frostmane_yeti', count: 3, level: 20, speedScale: 3.25 },
      ],
      coreDamage: 148,
      ...HUNT_GAP,
      barrels: KEGS(5),
      arrival: TWO_AT_ONCE,
    },
  ],
};

const GIANT_GAP = { gapMinTicks: ticks(1), gapMaxTicks: ticks(1.8) } as const;
const SLOW = 0.9;

/**
 * Few monsters, every one large or huge, slow and very tough: it takes many shells each,
 * and they come close behind each other, so several reach the tower together and the
 * Shockwave is what throws them back. Toughness was cut by a fifth (floored above each
 * template's own) and the shells hit 15 percent softer, so a run by an aimer firing 1 s
 * after each reload lasts about five minutes.
 */
export const TURRET_MISSION_GIANTS: TurretScenarioDef = {
  id: 'fire_and_fly_giants',
  boardKey: 'giants',
  integrity: 100,
  medals: { gold: { minIntegrityShare: 0.99 }, silver: { minIntegrityShare: 0.6 } },
  arsenal: { shockwave: 4, fragmentation: 1 },
  supply: MISSION_SUPPLY,
  waves: [
    {
      entries: [{ templateId: 'fen_troll', count: 4, level: 11, hpScale: 1.05, speedScale: SLOW }],
      coreDamage: 85,
      ...GIANT_GAP,
      barrels: KEGS(3),
      arrival: { kind: 'arc', widthTurn: 0.3 },
    },
    {
      entries: [
        { templateId: 'fen_troll', count: 4, level: 12, hpScale: 1.16, speedScale: SLOW },
        { templateId: 'thornpeak_ogre', count: 2, level: 15, hpScale: 1.16, speedScale: SLOW },
      ],
      coreDamage: 94,
      ...GIANT_GAP,
      barrels: KEGS(3),
      arrival: { kind: 'flanks', count: 2, widthTurn: 0.14 },
    },
    {
      entries: [
        { templateId: 'thornpeak_ogre', count: 5, level: 16, hpScale: 1.28, speedScale: SLOW },
        { templateId: 'fen_troll', count: 2, level: 12, hpScale: 1.28, speedScale: SLOW },
      ],
      coreDamage: 111,
      ...GIANT_GAP,
      barrels: KEGS(4),
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.1 },
    },
    {
      entries: [
        { templateId: 'thornpeak_ogre', count: 4, level: 16, hpScale: 1.28, speedScale: SLOW },
        { templateId: 'frostmane_yeti', count: 2, level: 19, hpScale: 1.05, speedScale: SLOW },
      ],
      coreDamage: 153,
      ...GIANT_GAP,
      barrels: KEGS(4),
      arrival: { kind: 'arc', widthTurn: 0.35 },
    },
    {
      entries: [
        { templateId: 'thornpeak_ogre', count: 4, level: 16, hpScale: 1.4, speedScale: SLOW },
        { templateId: 'frostmane_yeti', count: 3, level: 20, hpScale: 1.16, speedScale: SLOW },
      ],
      coreDamage: 187,
      ...GIANT_GAP,
      barrels: KEGS(5),
      arrival: { kind: 'flanks', count: 2, widthTurn: 0.12 },
    },
    {
      entries: [
        { templateId: 'thornpeak_ogre', count: 3, level: 16, hpScale: 1.6, speedScale: SLOW },
        { templateId: 'frostmane_yeti', count: 3, level: 20, hpScale: 1.28, speedScale: SLOW },
        {
          templateId: 'idol_guardian',
          count: 1,
          level: 20,
          bossLast: true,
          hpScale: 1.28,
          speedScale: SLOW,
        },
      ],
      coreDamage: 221,
      ...GIANT_GAP,
      barrels: KEGS(5),
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.1 },
    },
  ],
};

const SWARM_GAP = { gapMinTicks: ticks(0.3), gapMaxTicks: ticks(0.6) } as const;
const FAST = 1.6;
const FRAIL = 0.8;

/**
 * Dozens of small, fast monsters from everywhere. Consecutive waves change templates,
 * so a template's rigs never have to cover two full waves at once.
 */
export const TURRET_MISSION_DELUGE: TurretScenarioDef = {
  id: 'fire_and_fly_deluge',
  boardKey: 'deluge',
  integrity: 100,
  medals: { gold: { minIntegrityShare: 0.9 }, silver: { minIntegrityShare: 0.5 } },
  arsenal: { shockwave: 3, fragmentation: 2 },
  supply: MISSION_SUPPLY,
  waves: [
    {
      entries: [{ templateId: 'forest_wolf', count: 14, level: 2, speedScale: FAST }],
      coreDamage: 60,
      ...SWARM_GAP,
      barrels: KEGS(3),
    },
    {
      entries: [
        { templateId: 'wild_boar', count: 8, level: 3, speedScale: FAST, hpScale: FRAIL },
        { templateId: 'webwood_spider', count: 8, level: 3, speedScale: FAST, hpScale: FRAIL },
      ],
      coreDamage: 64,
      ...SWARM_GAP,
      barrels: KEGS(3),
    },
    {
      entries: [
        { templateId: 'forest_wolf', count: 10, level: 2, speedScale: FAST },
        { templateId: 'tunnel_rat', count: 8, level: 5, speedScale: FAST, hpScale: FRAIL },
      ],
      coreDamage: 84,
      ...SWARM_GAP,
      barrels: KEGS(4),
    },
    {
      entries: [
        { templateId: 'wild_boar', count: 10, level: 3, speedScale: FAST },
        { templateId: 'webwood_spider', count: 10, level: 4, speedScale: FAST, hpScale: FRAIL },
      ],
      coreDamage: 100,
      ...SWARM_GAP,
      barrels: KEGS(4),
    },
    {
      entries: [
        { templateId: 'tunnel_rat', count: 12, level: 6, speedScale: FAST, hpScale: FRAIL },
        { templateId: 'forest_wolf', count: 10, level: 2, speedScale: FAST },
      ],
      coreDamage: 110,
      ...SWARM_GAP,
      barrels: KEGS(5),
    },
    {
      entries: [
        { templateId: 'webwood_spider', count: 12, level: 4, speedScale: FAST },
        { templateId: 'wild_boar', count: 12, level: 3, speedScale: FAST },
      ],
      coreDamage: 120,
      ...SWARM_GAP,
      barrels: KEGS(5),
    },
  ],
};

const STEADY_GAP = { gapMinTicks: ticks(0.9), gapMaxTicks: ticks(1.7) } as const;

/**
 * The tower holds only 10 points: a small monster's strike costs 1 or 2 of them, a
 * medium's up to 4, so every monster must fall before it winds up. No large or huge
 * one comes: a single full-health strike of theirs would end the run.
 */
export const TURRET_MISSION_BRITTLE: TurretScenarioDef = {
  id: 'fire_and_fly_brittle',
  boardKey: 'brittle',
  integrity: 10,
  medals: { gold: { minIntegrityShare: 1 }, silver: { minIntegrityShare: 0.6 } },
  arsenal: { shockwave: 3, fragmentation: 1 },
  supply: MISSION_SUPPLY,
  waves: [
    {
      entries: [{ templateId: 'forest_wolf', count: 8, level: 2 }],
      coreDamage: 60,
      ...STEADY_GAP,
      barrels: KEGS(3),
    },
    {
      entries: [
        { templateId: 'forest_wolf', count: 6, level: 2 },
        { templateId: 'wild_boar', count: 6, level: 3 },
      ],
      coreDamage: 64,
      ...STEADY_GAP,
      barrels: KEGS(3),
    },
    {
      entries: [
        { templateId: 'vale_bandit', count: 8, level: 5 },
        { templateId: 'webwood_spider', count: 6, level: 4 },
      ],
      coreDamage: 84,
      ...STEADY_GAP,
      barrels: KEGS(4),
    },
    {
      entries: [
        { templateId: 'tunnel_rat', count: 8, level: 6 },
        { templateId: 'vale_bandit', count: 6, level: 5 },
      ],
      coreDamage: 100,
      ...STEADY_GAP,
      barrels: KEGS(4),
    },
    {
      entries: [
        { templateId: 'deeprock_kobold', count: 8, level: 15 },
        { templateId: 'boneclad_revenant', count: 4, level: 19 },
      ],
      coreDamage: 130,
      ...STEADY_GAP,
      barrels: KEGS(5),
    },
    {
      entries: [
        { templateId: 'boneclad_revenant', count: 8, level: 19 },
        { templateId: 'deeprock_kobold', count: 6, level: 15 },
      ],
      coreDamage: 180,
      ...STEADY_GAP,
      barrels: KEGS(5),
    },
  ],
};

/**
 * Standard's six waves, arriving from one side, two flanks or in packs, with twice the
 * kegs placed on the sides the monsters come through: a keg shot as a group passes
 * clears it. The cap lets a whole wave's kegs stand beside the ones still intact.
 */
export const TURRET_MISSION_POWDER: TurretScenarioDef = {
  id: 'fire_and_fly_powder',
  boardKey: 'powder',
  integrity: 100,
  medals: { gold: { minIntegrityShare: 0.99 }, silver: { minIntegrityShare: 0.6 } },
  arsenal: { shockwave: 1, fragmentation: 3 },
  supply: MISSION_SUPPLY,
  kegs: { placement: 'lanes', countScale: 2, cap: 12 },
  waves: [
    {
      entries: [{ templateId: 'forest_wolf', count: 8, level: 2 }],
      coreDamage: 60,
      ...STEADY_GAP,
      barrels: KEGS(3),
      arrival: { kind: 'arc', widthTurn: 0.3 },
    },
    {
      entries: [
        { templateId: 'forest_wolf', count: 6, level: 2 },
        { templateId: 'wild_boar', count: 6, level: 3 },
      ],
      coreDamage: 64,
      ...STEADY_GAP,
      barrels: KEGS(3),
      arrival: { kind: 'flanks', count: 2, widthTurn: 0.2 },
    },
    {
      entries: [
        { templateId: 'vale_bandit', count: 8, level: 5 },
        { templateId: 'webwood_spider', count: 6, level: 4 },
      ],
      coreDamage: 84,
      ...PACK_GAP,
      barrels: KEGS(4),
      arrival: { kind: 'burst', groupSize: 5, groupGapTicks: ticks(3), widthTurn: 0.08 },
    },
    {
      entries: [
        { templateId: 'tunnel_rat', count: 8, level: 6 },
        { templateId: 'fen_troll', count: 4, level: 11 },
      ],
      coreDamage: 100,
      ...STEADY_GAP,
      barrels: KEGS(4),
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.14 },
    },
    {
      entries: [
        { templateId: 'deeprock_kobold', count: 8, level: 15 },
        { templateId: 'thornpeak_ogre', count: 4, level: 16 },
        { templateId: 'boneclad_revenant', count: 4, level: 19 },
      ],
      coreDamage: 130,
      ...STEADY_GAP,
      barrels: KEGS(5),
      arrival: { kind: 'arc', widthTurn: 0.35 },
    },
    {
      entries: [
        { templateId: 'boneclad_revenant', count: 6, level: 19 },
        { templateId: 'frostmane_yeti', count: 2, level: 20 },
        { templateId: 'idol_guardian', count: 1, level: 20, bossLast: true },
      ],
      coreDamage: 220,
      ...PACK_GAP,
      barrels: KEGS(5),
      arrival: { kind: 'burst', groupSize: 3, groupGapTicks: ticks(3), widthTurn: 0.08 },
    },
  ],
};

/** In the order Master Gunner Alder offers them. */
export const TURRET_MISSIONS: readonly TurretScenarioDef[] = [
  TURRET_MISSION_PACK,
  TURRET_MISSION_GIANTS,
  TURRET_MISSION_DELUGE,
  TURRET_MISSION_BRITTLE,
  TURRET_MISSION_POWDER,
];
