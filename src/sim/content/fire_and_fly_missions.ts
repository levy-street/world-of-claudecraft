// Fire and Fly missions, data only: the five runs a recruited gunner can take any
// day (fire_and_fly_recruitment.ts unlocks them), each built around one idea and
// carrying the weapon that idea asks for. Every number here is a first value:
// mini-game tuning, not classic-era formulas. A tuning change after boards open mints
// a new board version. Each runs eight waves on one curve: a warm-up, a fast climb,
// then the last two or three waves pushing its idea to the extreme, each wave setting
// off on the tick the one before is cleared. Every tower holds 100 points (The Cracked
// Tower's 10 are its idea) under one medal rule (turret_defense.ts). The Pack is set (lot
// R5b) against the field-aware policy of the scenarios file at a 0.4 s pace: a member
// falls to two good shells, a leader to five or six, and at the worst moment of a run
// three to five monsters stand at the tower's foot (median; up to eight); that player golds
// about nine runs in ten reading the field exactly and three to four in five reading it
// 0.4 s late (a few points lost in the last two waves), while a 0.8 s player wins with
// silver or bronze and a 1 s player loses nearly half its runs. The other four were tuned (lot N2d) for a strike 1.5 s after a monster
// reaches the tower; at the 0.8 s strike of lot R4 they are far harder until their own
// redesign.

import {
  DT,
  type TurretHuntDef,
  type TurretPackDef,
  type TurretRallyKegDef,
  type TurretScenarioDef,
} from '../types';
import { TURRET_BARREL_RING, TURRET_MEDALS, TURRET_TOWER_POINTS } from './turret_defense';

const ticks = (seconds: number): number => Math.round(seconds / DT);
const gap = (min: number, max: number) =>
  ({ gapMinTicks: ticks(min), gapMaxTicks: ticks(max) }) as const;

/**
 * Every mission is resupplied as its third, fifth and seventh waves end, so its finale always
 * starts with charges, and a won one scores the charges it leaves: each mission's arsenal is
 * its signature, the weapon its idea asks for.
 */
const MISSION_SUPPLY = { resupplyAfterWaves: [3, 5, 7], unusedChargeBonus: true } as const;
const KEGS = (count: number) => ({ count, ...TURRET_BARREL_RING });

/** A member's own pace on its way to its rally: from its template's to a third quicker. */
const MUSTER = { speedScale: 1, speedScaleMax: 1.35 } as const;
/** Light, quick monsters that gather with the pack and break out at the departure. */
const SCOUT = { role: 'scout', speedScale: 2.2, speedScaleMax: 2.6 } as const;
/** The wave-8 pincer: a group that never gathers and runs straight in. */
const SPRINT = { role: 'sprint', speedScale: 2.4 } as const;
/**
 * The last three waves: every monster a tenth quicker to its rally or the tower, never
 * tougher than its template. Their difficulty is in the packs, not in the health.
 */
const LATE = 1.1;
const late = <T extends { speedScale: number; speedScaleMax?: number }>(role: T) => ({
  ...role,
  speedScale: role.speedScale * LATE,
  ...(role.speedScaleMax !== undefined ? { speedScaleMax: role.speedScaleMax * LATE } : {}),
});
const MUSTER_LATE = late(MUSTER);
const SCOUT_LATE = late(SCOUT);
const FRONT = { placement: 'rally-front' } as const;
const SIDE = { placement: 'rally-side' } as const;
/** A hunt wave lays its kegs at its rallies, none on the ring. */
const RALLY_KEGS_ONLY = KEGS(0);
/** A hunt wave's packs: each its advance scale, its kegs and its delay (s) from the wave's start. */
const pack = (advanceScale: number, kegs: readonly TurretRallyKegDef[], delay = 0) => ({
  advanceScale,
  kegs,
  delayTicks: ticks(delay),
});
/** The gathering: members spawn over 2 s on an arc of the pack's side, then walk to its rally. */
const hunt = (
  packs: readonly TurretPackDef[],
  band: readonly [number, number],
  holdSeconds: number,
  sprintDelay?: number,
): TurretHuntDef => ({
  packs,
  minRadius: band[0],
  maxRadius: band[1],
  holdTicks: ticks(holdSeconds),
  spreadTicks: ticks(2),
  widthTurn: 0.1,
  ...(sprintDelay !== undefined ? { sprintDelayTicks: ticks(sprintDelay) } : {}),
});
/**
 * The rally bands: far enough that a front keg, a dozen yards and more tower-side of its
 * rally, still stands outside the keg ring's inner edge.
 */
const FIELD = [30, 36] as const;
const CLOSE = [30, 33] as const;
/** Gaps between spawns are the hunt's schedule; these stand unused. */
const HUNT_GAP = { gapMinTicks: 1, gapMaxTicks: 2 } as const;

/**
 * The hunt. Each wave comes as packs: the members walk in dispersed from their pack's
 * side, each at its own pace, to a rally in the field, and stand there; once all of them
 * stand (or the hold timer since the first arrival runs out) the leader cries and, a
 * second later, the pack advances on the tower together at one walking pace, past the keg
 * laid on its path, while its scouts break out at a run. The rallies carry no marker: the
 * standing pack and the cry are the telegraph. One pack, then scouts, then two packs and
 * three, the gathering windows closing as the hold timer shortens from 6 s to 2.5 s; the
 * finale adds a sprint group that never gathers. A monster at the tower's foot strikes
 * fast, so the hunt is won in the field: the keg as a pack walks past it, the frag on a
 * pack standing clear of any keg, the shells on the scouts. No monster is tougher than its
 * template: each wave's shell damage, matched to its members' health, fells a member in
 * two good hits and a leader in five or six, so the last two waves are four packs at
 * once, not a crowd of sponges at the tower's foot.
 */
export const TURRET_MISSION_PACK: TurretScenarioDef = {
  id: 'fire_and_fly_pack',
  boardKey: 'pack',
  integrity: TURRET_TOWER_POINTS,
  medals: TURRET_MEDALS,
  arsenal: { fragmentation: 5 },
  supply: MISSION_SUPPLY,
  waves: [
    {
      entries: [{ templateId: 'forest_wolf', count: 8, level: 2, ...MUSTER, pack: 0, leads: true }],
      coreDamage: 45,
      ...HUNT_GAP,
      barrels: RALLY_KEGS_ONLY,
      hunt: hunt([pack(1.1, [FRONT])], FIELD, 6),
    },
    {
      entries: [
        { templateId: 'forest_wolf', count: 5, level: 2, ...MUSTER, pack: 0, leads: true },
        { templateId: 'wild_boar', count: 4, level: 3, ...MUSTER, pack: 0 },
        { templateId: 'forest_wolf', count: 2, level: 2, ...SCOUT, pack: 0 },
      ],
      coreDamage: 52,
      ...HUNT_GAP,
      barrels: RALLY_KEGS_ONLY,
      hunt: hunt([pack(1.15, [FRONT])], FIELD, 6),
    },
    {
      entries: [0, 1].flatMap((p) => [
        { templateId: 'webwood_spider', count: 3, level: 4, ...MUSTER, pack: p, leads: true },
        { templateId: 'vale_bandit', count: 4, level: 5, ...MUSTER, pack: p },
        { templateId: 'tunnel_rat', count: 2, level: 6, ...SCOUT, pack: p },
      ]),
      coreDamage: 71,
      ...HUNT_GAP,
      barrels: RALLY_KEGS_ONLY,
      hunt: hunt([pack(1.2, [FRONT]), pack(1.2, [SIDE], 7)], FIELD, 4),
    },
    {
      entries: [0, 1].flatMap((p) => [
        { templateId: 'tunnel_rat', count: 5, level: 6, ...MUSTER, pack: p },
        { templateId: 'vale_bandit', count: 2, level: 5, ...MUSTER, pack: p },
        { templateId: 'fen_troll', count: 1, level: 12, ...MUSTER, pack: p, leads: true },
        { templateId: 'tunnel_rat', count: 2, level: 6, ...SCOUT, pack: p },
      ]),
      coreDamage: 89,
      ...HUNT_GAP,
      barrels: RALLY_KEGS_ONLY,
      hunt: hunt([pack(1.2, [FRONT]), pack(1.2, [], 0.5)], FIELD, 4),
    },
    {
      entries: [0, 1].flatMap((p) => [
        { templateId: 'deeprock_kobold', count: 3, level: 15, ...MUSTER, pack: p },
        { templateId: 'boneclad_revenant', count: 4, level: 19, ...MUSTER, pack: p },
        { templateId: 'thornpeak_ogre', count: 1, level: 16, ...MUSTER, pack: p, leads: true },
        { templateId: 'tunnel_rat', count: 2, level: 6, ...SCOUT, pack: p },
      ]),
      coreDamage: 261,
      ...HUNT_GAP,
      barrels: RALLY_KEGS_ONLY,
      hunt: hunt([pack(1.25, [FRONT]), pack(1.25, [FRONT], 2)], FIELD, 4),
    },
    {
      entries: [0, 1, 2].flatMap((p) => [
        { templateId: 'boneclad_revenant', count: 3, level: 19, ...MUSTER_LATE, pack: p },
        { templateId: 'deeprock_kobold', count: 2, level: 15, ...MUSTER_LATE, pack: p },
        { templateId: 'frostmane_yeti', count: 1, level: 19, ...MUSTER_LATE, pack: p, leads: true },
        { templateId: 'tunnel_rat', count: 2, level: 6, ...SCOUT_LATE, pack: p },
      ]),
      coreDamage: 256,
      ...HUNT_GAP,
      barrels: RALLY_KEGS_ONLY,
      hunt: hunt([pack(1.25, [FRONT]), pack(1.25, [SIDE], 3), pack(1.25, [], 6)], FIELD, 3),
    },
    {
      entries: [0, 1, 2, 3].flatMap((p) => [
        { templateId: 'tunnel_rat', count: 2, level: 6, ...MUSTER_LATE, pack: p },
        { templateId: 'vale_bandit', count: 2, level: 5, ...MUSTER_LATE, pack: p },
        { templateId: 'thornpeak_ogre', count: 1, level: 16, ...MUSTER_LATE, pack: p, leads: true },
        { templateId: 'tunnel_rat', count: 2, level: 6, ...SCOUT_LATE, pack: p },
      ]),
      coreDamage: 96,
      ...HUNT_GAP,
      barrels: RALLY_KEGS_ONLY,
      hunt: hunt(
        [pack(1.3, [FRONT]), pack(1.3, [FRONT], 1.5), pack(1.3, [], 3), pack(1.3, [SIDE], 4.5)],
        CLOSE,
        2,
      ),
    },
    {
      entries: [
        ...[0, 1, 2, 3].flatMap((p) => [
          { templateId: 'boneclad_revenant', count: 2, level: 19, ...MUSTER_LATE, pack: p },
          { templateId: 'deeprock_kobold', count: 2, level: 15, ...MUSTER_LATE, pack: p },
          {
            templateId: 'frostmane_yeti',
            count: 1,
            level: 19,
            ...MUSTER_LATE,
            pack: p,
            leads: true,
          },
          { templateId: 'tunnel_rat', count: 2, level: 6, ...SCOUT_LATE, pack: p },
        ]),
        { templateId: 'tunnel_rat', count: 6, level: 6, ...late(SPRINT) },
      ],
      coreDamage: 256,
      ...HUNT_GAP,
      barrels: RALLY_KEGS_ONLY,
      hunt: hunt(
        [pack(1.35, [FRONT]), pack(1.35, [SIDE], 1), pack(1.35, [], 2), pack(1.35, [FRONT], 3)],
        CLOSE,
        2,
        3,
      ),
    },
  ],
};

/** Heavy Tread's walkers: slower than their templates, a little tougher. */
const TREAD = 0.9;
/** Its colossi: the yetis and the guardians of the last three waves, tougher still. */
const COLOSSUS_HP = 1.25;

/**
 * Only large and huge monsters, every one tougher than its template. They walk in slowly
 * through the climb, from one side, two flanks or three, so several reach the tower
 * together and the Shockwave throws them back; then the colossi come from everywhere and
 * keep coming: a dozen yetis at twice their pace, eighteen quicker still, then twenty with
 * six guardians all but at once.
 */
export const TURRET_MISSION_GIANTS: TurretScenarioDef = {
  id: 'fire_and_fly_giants',
  boardKey: 'giants',
  integrity: TURRET_TOWER_POINTS,
  medals: TURRET_MEDALS,
  arsenal: { shockwave: 4, fragmentation: 1 },
  supply: MISSION_SUPPLY,
  waves: [
    {
      entries: [{ templateId: 'fen_troll', count: 3, level: 11, hpScale: 1.05, speedScale: TREAD }],
      coreDamage: 95,
      ...gap(1, 1.8),
      barrels: KEGS(3),
      arrival: { kind: 'arc', widthTurn: 0.3 },
    },
    {
      entries: [{ templateId: 'fen_troll', count: 4, level: 12, hpScale: 1.1, speedScale: TREAD }],
      coreDamage: 100,
      ...gap(0.8, 1.4),
      barrels: KEGS(3),
      arrival: { kind: 'flanks', count: 2, widthTurn: 0.14 },
    },
    {
      entries: [
        { templateId: 'thornpeak_ogre', count: 4, level: 16, hpScale: 1.1, speedScale: TREAD },
        { templateId: 'fen_troll', count: 2, level: 12, hpScale: 1.1, speedScale: TREAD },
      ],
      coreDamage: 120,
      ...gap(0.6, 1.2),
      barrels: KEGS(4),
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.1 },
    },
    {
      entries: [
        { templateId: 'thornpeak_ogre', count: 4, level: 16, hpScale: 1.1, speedScale: TREAD },
        { templateId: 'frostmane_yeti', count: 2, level: 19, hpScale: 1.05, speedScale: TREAD },
      ],
      coreDamage: 160,
      ...gap(0.5, 1),
      barrels: KEGS(4),
      arrival: { kind: 'flanks', count: 2, widthTurn: 0.12 },
    },
    {
      entries: [
        { templateId: 'thornpeak_ogre', count: 3, level: 16, hpScale: 1.1, speedScale: TREAD },
        { templateId: 'frostmane_yeti', count: 4, level: 20, hpScale: 1.05, speedScale: TREAD },
      ],
      coreDamage: 200,
      ...gap(0.3, 0.6),
      barrels: KEGS(5),
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.1 },
    },
    {
      entries: [
        { templateId: 'frostmane_yeti', count: 12, level: 20, hpScale: COLOSSUS_HP, speedScale: 2 },
      ],
      coreDamage: 240,
      ...gap(0.2, 0.4),
      barrels: KEGS(5),
    },
    {
      entries: [
        {
          templateId: 'frostmane_yeti',
          count: 18,
          level: 20,
          hpScale: COLOSSUS_HP,
          speedScale: 2.6,
        },
      ],
      coreDamage: 260,
      ...gap(0.1, 0.2),
      barrels: KEGS(5),
    },
    {
      entries: [
        {
          templateId: 'frostmane_yeti',
          count: 20,
          level: 20,
          hpScale: COLOSSUS_HP,
          speedScale: 2.9,
        },
        { templateId: 'idol_guardian', count: 6, level: 20, hpScale: COLOSSUS_HP, speedScale: 2.6 },
      ],
      coreDamage: 280,
      ...gap(0.05, 0.1),
      barrels: KEGS(5),
    },
  ],
};

const FRAIL = 0.8;

/**
 * Dozens of small, fast monsters from everywhere, never the same template two waves
 * running so its rigs never cover two full waves at once. Each wave is bigger, quicker and
 * closer-spaced than the last, the shells a little softer, until the last two pour in
 * forty-eight and sixty at three and four times their templates' pace: an unbroken swarm.
 */
export const TURRET_MISSION_DELUGE: TurretScenarioDef = {
  id: 'fire_and_fly_deluge',
  boardKey: 'deluge',
  integrity: TURRET_TOWER_POINTS,
  medals: TURRET_MEDALS,
  arsenal: { shockwave: 3, fragmentation: 2 },
  supply: MISSION_SUPPLY,
  waves: [
    {
      entries: [{ templateId: 'forest_wolf', count: 16, level: 2, speedScale: 1.6 }],
      coreDamage: 60,
      ...gap(0.3, 0.6),
      barrels: KEGS(3),
    },
    {
      entries: [
        { templateId: 'wild_boar', count: 10, level: 3, speedScale: 1.7, hpScale: FRAIL },
        { templateId: 'webwood_spider', count: 10, level: 3, speedScale: 1.7, hpScale: FRAIL },
      ],
      coreDamage: 56,
      ...gap(0.25, 0.5),
      barrels: KEGS(3),
    },
    {
      entries: [
        { templateId: 'forest_wolf', count: 12, level: 2, speedScale: 1.8 },
        { templateId: 'tunnel_rat', count: 12, level: 5, speedScale: 1.8, hpScale: FRAIL },
      ],
      coreDamage: 60,
      ...gap(0.2, 0.4),
      barrels: KEGS(4),
    },
    {
      entries: [
        { templateId: 'wild_boar', count: 14, level: 3, speedScale: 2 },
        { templateId: 'webwood_spider', count: 14, level: 4, speedScale: 2, hpScale: FRAIL },
      ],
      coreDamage: 60,
      ...gap(0.15, 0.35),
      barrels: KEGS(4),
    },
    {
      entries: [
        { templateId: 'tunnel_rat', count: 18, level: 6, speedScale: 2.2, hpScale: FRAIL },
        { templateId: 'forest_wolf', count: 18, level: 2, speedScale: 2.2 },
      ],
      coreDamage: 60,
      ...gap(0.1, 0.25),
      barrels: KEGS(5),
    },
    {
      entries: [
        { templateId: 'webwood_spider', count: 22, level: 4, speedScale: 3 },
        { templateId: 'wild_boar', count: 22, level: 3, speedScale: 3 },
      ],
      coreDamage: 55,
      ...gap(0.08, 0.18),
      barrels: KEGS(5),
    },
    {
      entries: [
        { templateId: 'forest_wolf', count: 26, level: 2, speedScale: 3.6 },
        { templateId: 'tunnel_rat', count: 22, level: 6, speedScale: 3.6, hpScale: FRAIL },
      ],
      coreDamage: 50,
      ...gap(0.06, 0.14),
      barrels: KEGS(5),
    },
    {
      entries: [
        { templateId: 'webwood_spider', count: 26, level: 4, speedScale: 4.2 },
        { templateId: 'wild_boar', count: 24, level: 3, speedScale: 4.2 },
        { templateId: 'forest_wolf', count: 10, level: 2, speedScale: 4.2 },
      ],
      coreDamage: 45,
      ...gap(0.05, 0.12),
      barrels: KEGS(5),
    },
  ],
};

const STEADY_GAP = gap(0.9, 1.7);

/**
 * The tower holds only 10 points: a small monster's strike costs 1 or 2 of them, a
 * medium's up to 4, so every monster must fall before it winds up. No large or huge
 * one comes: a single full-health strike of theirs would end the run. The fodder walks in
 * at its own pace, then the armoured dead come quicker from two and three flanks, and the
 * last two waves send thirty-two and forty-four of them from everywhere at two and a half
 * times their pace, hardly a breath between them.
 */
export const TURRET_MISSION_BRITTLE: TurretScenarioDef = {
  id: 'fire_and_fly_brittle',
  boardKey: 'brittle',
  integrity: 10,
  medals: { gold: { minIntegrityShare: 1 }, silver: TURRET_MEDALS.silver },
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
      ...gap(0.8, 1.5),
      barrels: KEGS(3),
    },
    {
      entries: [
        { templateId: 'vale_bandit', count: 8, level: 5 },
        { templateId: 'webwood_spider', count: 6, level: 4 },
      ],
      coreDamage: 84,
      ...gap(0.7, 1.3),
      barrels: KEGS(4),
    },
    {
      entries: [
        { templateId: 'tunnel_rat', count: 8, level: 6 },
        { templateId: 'vale_bandit', count: 8, level: 5 },
      ],
      coreDamage: 100,
      ...gap(0.6, 1.1),
      barrels: KEGS(4),
      arrival: { kind: 'flanks', count: 2, widthTurn: 0.14 },
    },
    {
      entries: [
        { templateId: 'deeprock_kobold', count: 10, level: 15 },
        { templateId: 'boneclad_revenant', count: 4, level: 19 },
      ],
      coreDamage: 130,
      ...gap(0.5, 0.9),
      barrels: KEGS(5),
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.1 },
    },
    {
      entries: [
        { templateId: 'boneclad_revenant', count: 8, level: 19, speedScale: 1.3 },
        { templateId: 'deeprock_kobold', count: 8, level: 15, speedScale: 1.3 },
      ],
      coreDamage: 160,
      ...gap(0.35, 0.7),
      barrels: KEGS(5),
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.1 },
    },
    {
      entries: [
        { templateId: 'boneclad_revenant', count: 20, level: 19, speedScale: 2.3 },
        { templateId: 'deeprock_kobold', count: 12, level: 15, speedScale: 2.3 },
      ],
      coreDamage: 170,
      ...gap(0.1, 0.25),
      barrels: KEGS(5),
    },
    {
      entries: [
        { templateId: 'boneclad_revenant', count: 26, level: 19, speedScale: 2.8 },
        { templateId: 'deeprock_kobold', count: 18, level: 15, speedScale: 2.8 },
      ],
      coreDamage: 180,
      ...gap(0.08, 0.2),
      barrels: KEGS(5),
    },
  ],
};

/** Inside a pack, the members follow each other closely. */
const PACK_GAP = gap(0.15, 0.25);
const RUSH_GAP = { gapMinTicks: 1, gapMaxTicks: 2 } as const;

/**
 * Twice the kegs on the sides the monsters come through, and a cap that lets a whole
 * wave's stand beside the ones still intact: a keg shot as a group passes clears it. The
 * waves arrive from one side, two flanks, in packs, then all at once from three sides,
 * growing and quickening, until the last two charge down twelve kegs each: forty-eight
 * then sixty-three monsters, the giants among the last.
 */
export const TURRET_MISSION_POWDER: TurretScenarioDef = {
  id: 'fire_and_fly_powder',
  boardKey: 'powder',
  integrity: TURRET_TOWER_POINTS,
  medals: TURRET_MEDALS,
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
        { templateId: 'tunnel_rat', count: 8, level: 6, speedScale: 1.2 },
        { templateId: 'fen_troll', count: 4, level: 11, speedScale: 1.1 },
      ],
      coreDamage: 100,
      ...gap(0.6, 1.2),
      barrels: KEGS(4),
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.14 },
    },
    {
      entries: [
        { templateId: 'deeprock_kobold', count: 10, level: 15, speedScale: 1.3 },
        { templateId: 'thornpeak_ogre', count: 4, level: 16, speedScale: 1.2 },
        { templateId: 'boneclad_revenant', count: 4, level: 19, speedScale: 1.3 },
      ],
      coreDamage: 130,
      ...PACK_GAP,
      barrels: KEGS(5),
      arrival: { kind: 'burst', groupSize: 6, groupGapTicks: ticks(2), widthTurn: 0.08 },
    },
    {
      entries: [
        { templateId: 'boneclad_revenant', count: 14, level: 19, speedScale: 2.4 },
        { templateId: 'deeprock_kobold', count: 12, level: 15, speedScale: 2.4 },
        { templateId: 'thornpeak_ogre', count: 6, level: 16, speedScale: 2 },
      ],
      coreDamage: 160,
      ...RUSH_GAP,
      barrels: KEGS(5),
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.06 },
    },
    {
      entries: [
        { templateId: 'boneclad_revenant', count: 24, level: 19, speedScale: 3 },
        { templateId: 'deeprock_kobold', count: 18, level: 15, speedScale: 3 },
        { templateId: 'fen_troll', count: 6, level: 12, speedScale: 2.6 },
      ],
      coreDamage: 180,
      ...RUSH_GAP,
      barrels: KEGS(6),
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.06 },
    },
    {
      entries: [
        { templateId: 'boneclad_revenant', count: 32, level: 19, speedScale: 3.3 },
        { templateId: 'deeprock_kobold', count: 22, level: 15, speedScale: 3.3 },
        { templateId: 'frostmane_yeti', count: 6, level: 20, speedScale: 2.8 },
        { templateId: 'idol_guardian', count: 3, level: 20, speedScale: 2.6 },
      ],
      coreDamage: 220,
      ...RUSH_GAP,
      barrels: KEGS(6),
      arrival: { kind: 'flanks', count: 3, widthTurn: 0.06 },
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
