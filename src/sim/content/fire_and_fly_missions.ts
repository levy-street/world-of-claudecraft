// Fire and Fly missions, data only: the five runs a recruited gunner can take any
// day (fire_and_fly_recruitment.ts unlocks them), each built around one idea. Every
// number here is a first value: mini-game tuning, not classic-era formulas. A tuning
// change after boards open mints a new board version. Measured with the scripted
// aimers on the arena ground (24 seeds each): the clean and the quick aimers take gold
// on every mission; an aimer firing 0.8 s after each reload keeps gold on The Pack, Heavy
// Tread and The Powder Store, about half its runs on The Deluge and The Cracked
// Tower; 1 s splits gold and silver on the first three, silver or bronze on the other
// two; 1.5 s lands silver or bronze, and loses The Cracked Tower. The weapons barely
// move these, as on the trials.

import { DT, type TurretScenarioDef } from '../types';
import { TURRET_BARREL_RING } from './turret_defense';

const ticks = (seconds: number): number => Math.round(seconds / DT);

/** Every mission carries the trials' arsenal: one rule to learn, the idea stays in the waves. */
const MISSION_ARSENAL = { shockwave: 2, fragmentation: 3 } as const;
const KEGS = (count: number) => ({ count, ...TURRET_BARREL_RING });

/** A pack's members walk nearly in each other's steps. */
const PACK_GAP = { gapMinTicks: ticks(0.15), gapMaxTicks: ticks(0.25) } as const;
const pack = (groupSize: number, gapSeconds: number) =>
  ({ kind: 'burst', groupSize, groupGapTicks: ticks(gapSeconds), widthTurn: 0.03 }) as const;

/** Many monsters, always in tight packs: one well placed shell throws a whole pack. */
export const TURRET_MISSION_PACK: TurretScenarioDef = {
  id: 'fire_and_fly_pack',
  boardKey: 'pack',
  integrity: 100,
  medals: { gold: { minIntegrityShare: 0.97 }, silver: { minIntegrityShare: 0.6 } },
  arsenal: MISSION_ARSENAL,
  waves: [
    {
      entries: [{ templateId: 'forest_wolf', count: 12, level: 2 }],
      coreDamage: 60,
      ...PACK_GAP,
      barrels: KEGS(3),
      arrival: pack(6, 4),
    },
    {
      entries: [
        { templateId: 'forest_wolf', count: 8, level: 2 },
        { templateId: 'wild_boar', count: 8, level: 3 },
      ],
      coreDamage: 64,
      ...PACK_GAP,
      barrels: KEGS(3),
      arrival: pack(8, 4),
    },
    {
      entries: [
        { templateId: 'webwood_spider', count: 9, level: 4 },
        { templateId: 'vale_bandit', count: 9, level: 5 },
      ],
      coreDamage: 84,
      ...PACK_GAP,
      barrels: KEGS(4),
      arrival: pack(9, 4.5),
    },
    {
      entries: [
        { templateId: 'tunnel_rat', count: 12, level: 6 },
        { templateId: 'vale_bandit', count: 6, level: 5 },
        { templateId: 'fen_troll', count: 2, level: 11 },
      ],
      coreDamage: 100,
      ...PACK_GAP,
      barrels: KEGS(4),
      arrival: pack(10, 5),
    },
    {
      entries: [
        { templateId: 'deeprock_kobold', count: 10, level: 15 },
        { templateId: 'boneclad_revenant', count: 6, level: 19 },
        { templateId: 'thornpeak_ogre', count: 2, level: 16 },
      ],
      coreDamage: 130,
      ...PACK_GAP,
      barrels: KEGS(5),
      arrival: pack(6, 5),
    },
    {
      entries: [
        { templateId: 'boneclad_revenant', count: 10, level: 19 },
        { templateId: 'deeprock_kobold', count: 6, level: 15 },
        { templateId: 'frostmane_yeti', count: 2, level: 20 },
      ],
      coreDamage: 220,
      ...PACK_GAP,
      barrels: KEGS(5),
      arrival: pack(6, 5),
    },
  ],
};

const GIANT_GAP = { gapMinTicks: ticks(2), gapMaxTicks: ticks(3.2) } as const;
const SLOW = 0.75;

/** Few monsters, every one large or huge, slow and very tough: it takes many shells each. */
export const TURRET_MISSION_GIANTS: TurretScenarioDef = {
  id: 'fire_and_fly_giants',
  boardKey: 'giants',
  integrity: 100,
  medals: { gold: { minIntegrityShare: 0.95 }, silver: { minIntegrityShare: 0.6 } },
  arsenal: MISSION_ARSENAL,
  waves: [
    {
      entries: [{ templateId: 'fen_troll', count: 4, level: 11, hpScale: 1.2, speedScale: SLOW }],
      coreDamage: 100,
      ...GIANT_GAP,
      barrels: KEGS(3),
      arrival: { kind: 'arc', widthTurn: 0.3 },
    },
    {
      entries: [
        { templateId: 'fen_troll', count: 4, level: 12, hpScale: 1.45, speedScale: SLOW },
        { templateId: 'thornpeak_ogre', count: 2, level: 15, hpScale: 1.45, speedScale: SLOW },
      ],
      coreDamage: 110,
      ...GIANT_GAP,
      barrels: KEGS(3),
      arrival: { kind: 'flanks', count: 2, widthTurn: 0.14 },
    },
    {
      entries: [
        { templateId: 'thornpeak_ogre', count: 5, level: 16, hpScale: 1.6, speedScale: SLOW },
        { templateId: 'fen_troll', count: 2, level: 12, hpScale: 1.6, speedScale: SLOW },
      ],
      coreDamage: 130,
      ...GIANT_GAP,
      barrels: KEGS(4),
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.1 },
    },
    {
      entries: [
        { templateId: 'thornpeak_ogre', count: 4, level: 16, hpScale: 1.6, speedScale: SLOW },
        { templateId: 'frostmane_yeti', count: 2, level: 19, hpScale: 1.3, speedScale: SLOW },
      ],
      coreDamage: 180,
      ...GIANT_GAP,
      barrels: KEGS(4),
      arrival: { kind: 'arc', widthTurn: 0.35 },
    },
    {
      entries: [
        { templateId: 'thornpeak_ogre', count: 4, level: 16, hpScale: 1.75, speedScale: SLOW },
        { templateId: 'frostmane_yeti', count: 3, level: 20, hpScale: 1.45, speedScale: SLOW },
      ],
      coreDamage: 220,
      ...GIANT_GAP,
      barrels: KEGS(5),
      arrival: { kind: 'flanks', count: 2, widthTurn: 0.12 },
    },
    {
      entries: [
        { templateId: 'thornpeak_ogre', count: 3, level: 16, hpScale: 2, speedScale: SLOW },
        { templateId: 'frostmane_yeti', count: 3, level: 20, hpScale: 1.6, speedScale: SLOW },
        {
          templateId: 'idol_guardian',
          count: 1,
          level: 20,
          bossLast: true,
          hpScale: 1.6,
          speedScale: SLOW,
        },
      ],
      coreDamage: 260,
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
  arsenal: MISSION_ARSENAL,
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
  arsenal: MISSION_ARSENAL,
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
  medals: { gold: { minIntegrityShare: 0.97 }, silver: { minIntegrityShare: 0.6 } },
  arsenal: MISSION_ARSENAL,
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
