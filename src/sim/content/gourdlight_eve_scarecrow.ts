// Gourdlight Eve's field boss (data only): Old Thatchgrin, the scarecrow that walks
// the pumpkin patch past Boar Meadow while the event runs, his crows and his
// strawlings, his telegraphed kit, and what he pays. The rules live in
// src/sim/seasonal/ (scarecrow.ts raises and clears him with the event,
// scarecrow_kit.ts runs his fight, scarecrow_field.ts finds his field).
//
// TUNING (owner direction after the phase 2 playtest, 2026-10-17: "low damage, very high
// health that grows with the crowd, friendly from about level 10"). What is SOURCED and
// what is a DESIGN value is kept apart here, so a maintainer can see at a glance which
// numbers came from a formula and which were picked:
//   SOURCED
//   - Melee, armour, speed and the health ladder are THE WAKING WARDEN's (content/realm.ts),
//     the shipped named open-world elite built for "bring a friend, bring two", read at
//     THATCHGRIN_LEVEL and run through the open-world curve (mob/open_world_tuning.ts) at
//     spawn exactly as a camp spawn of it would be.
//   - The pool grows per extra participant by Balgath's world-boss step ratio
//     (world_boss.ts: 3 500 on a 24 000 base) and caps at Balgath's cap ratio, the way
//     every world boss scales with a crowd.
//   - The enrage is the Warden's (below 30%, x1.35 damage, x1.25 haste).
//   - The rain's cadence (every 20 s) is Balgath's Boulder Toss (content/zone2.ts), the
//     burning chaff ticks once a second like his Molten Fen pool, and every mechanic hit
//     rides Balgath's level scale (mob/mechanic_level_scale.ts), measured against the
//     TARGET's level: a level-10 player takes about half of what a level-20 player does.
//   - The adds ride the Hollow Crypt's ladders (content/hollow_crypt_trash.ts): the crows
//     the Carrion Crow's, the strawlings the Crow Caller's, without the elite flag.
//   DESIGN values (flagged for maintainer review, no classic formula covers them):
//   - THATCHGRIN_LEVEL (12, so a level-10 group meets him inside the classic hit table),
//     THATCHGRIN_HP_MULT (x4 over the curved Warden pool: "very high health") and
//     THATCHGRIN_DAMAGE_MULT (x0.55 on his melee: "low damage").
//   - The rain's opening delay (7 s), its shape: one burning pumpkin on each fighter (up
//     to five) plus a few on open ground, the ring radius, the stagger between landings,
//     and its damage (about half of Balgath's boulder, the owner's "low damage").
//   - The chaff's duration (6 s, shorter than Molten Fen's 8 so the field clears between
//     rains), its radius (2.5) and its tick (6 to 9).
//   - The Swelling Gourd: when it grows (70% and 35%), its fuse (30 s), its pool (a share
//     of his current pool, so it scales with the crowd too), the ward while it lives (80%
//     less damage), the stun and the opening when it falls (6 s stunned, then 50% more
//     damage for 10 s), and its burst (75% of each fighter's maximum health, CLAMPED one
//     point short of it so it can never kill a fighter at full health).
//   - The calls' thresholds and add counts, the call's windup (matched to the Summon clip).
//   - The charm's drop chance, in the buddy-drop convention (content/buddy_sources.ts:
//     CALIBRATE). The pumpkin head and the broom are guaranteed but never duplicated.
//
// Everything he pays is cosmetic or event currency: no stat, no gear, no power.
import type { ItemDef, MobTemplate } from '../types';
import {
  CARVED_PUMPKIN_HEAD_ID,
  GOURDLIGHT_BROOM_ID,
  GOURDLIGHT_EVE_ID,
  GOURDLIGHT_POUCH_SWEETS,
} from './gourdlight_eve';

export const THATCHGRIN_ID = 'gourdlight_thatchgrin';
export const GOURDLIGHT_CROW_ID = 'gourdlight_crow';
export const STRAWLING_ID = 'gourdlight_strawling';

/** His daily spoils: a sack of sweets (opened like the rounds pouch). */
export const THATCHGRIN_SACK_ID = 'thatchgrin_sweet_sack';
/** The cosmetic: a charm that turns its user into a strawling for a short while. */
export const STRAWLING_CHARM_ID = 'strawling_charm';
/** The charm's look (a seasonal_cosmetic aura the client draws as a body swap). */
export const STRAWLING_GUISE_AURA_ID = 'gourdlight_trick_strawling';
export const STRAWLING_GUISE = Object.freeze({
  id: STRAWLING_GUISE_AURA_ID,
  name: 'Strawling Guise',
  duration: 30,
});

/** The sack holds two rounds pouches' worth: one kill pays a full day of rounds. */
export const THATCHGRIN_SACK_SWEETS = GOURDLIGHT_POUCH_SWEETS * 2;
/** CALIBRATE: the charm's per-contributor drop chance (a cosmetic, never power). */
export const STRAWLING_CHARM_CHANCE = 0.05;

/** Animation and render cue ids (the `ability` on every event his kit emits). The rain
 *  keeps the old thrown gourd's id: it drives the same Throw clip (he hurls one lit gourd
 *  into the sky and the sky answers with a dozen). */
export const THATCHGRIN_GOURD_ABILITY = 'mob_thatchgrin_gourd';
export const THATCHGRIN_CHAFF_ABILITY = 'mob_thatchgrin_chaff';
export const THATCHGRIN_SUMMON_ABILITY = 'mob_thatchgrin_summon';
/** The Swelling Gourd's cues: it bursts out of the stubble, its burst, its fall. */
export const THATCHGRIN_SWELL_ABILITY = 'mob_thatchgrin_swell';

/** DESIGN: his level, so a level-10 group meets him inside the classic hit table. */
export const THATCHGRIN_LEVEL = 12;
/** DESIGN: his solo pool over the curved Warden pool at his level ("very high health"). */
export const THATCHGRIN_HP_MULT = 4;
/** DESIGN: his melee under the curved Warden swing at his level ("low damage"). */
export const THATCHGRIN_DAMAGE_MULT = 0.55;

/** The Swelling Gourd: the giant pumpkin his patch heaves up mid-fight. */
export const SWELLING_GOURD_ID = 'gourdlight_swelling_gourd';

/** His encounter kit (scarecrow_kit.ts, scarecrow_swell.ts). Numbers per the header. */
export const THATCHGRIN_KIT = Object.freeze({
  /** Gourdfall: he hurls a lit gourd at the sky and burning pumpkins rain on his field. */
  rain: {
    name: 'Gourdfall',
    /** Balgath's Boulder Toss cadence (sourced); the opening delay is DESIGN. */
    every: 20,
    first: 7,
    /** Seconds from the cue to the FIRST landing (the Throw clip's release plus the fall). */
    windup: 2.4,
    /** Seconds between one landing and the next, so the rain reads as a cascade. */
    stagger: 0.3,
    /** Ring radius (DESIGN): the true radius each pumpkin bursts over. */
    radius: 4,
    maxRange: 60,
    /** One pumpkin on each fighter in reach, up to this many (DESIGN). */
    maxTargeted: 5,
    /** Plus pumpkins on open ground round him: base, one more per this many fighters,
     *  up to the cap (DESIGN). */
    scatterBase: 2,
    scatterPerFighters: 2,
    scatterMax: 4,
    /** How far from him the open-ground pumpkins land (yards, DESIGN). */
    scatterMin: 4,
    scatterReach: 13,
    /** Half Balgath's boulder (46 to 64), the owner's "low damage" (DESIGN). */
    min: 22,
    max: 30,
    school: 'fire' as const,
  },
  /** Smoldering Chaff: each pumpkin's landing burns on, ticking each second like Balgath's
   *  Molten Fen pool (the tick cadence sourced; duration, radius and damage DESIGN). */
  chaff: {
    name: 'Smoldering Chaff',
    seconds: 6,
    interval: 1,
    radius: 2.5,
    min: 6,
    max: 9,
    school: 'fire' as const,
  },
  /** The Swelling Gourd (DESIGN, header). */
  swell: {
    name: 'Swelling Gourd',
    /** Health fractions at which a gourd heaves up, once each per pull. */
    atHpPct: [0.7, 0.35] as readonly number[],
    /** Seconds from its rise to its burst: its cast bar ("Ripening"). */
    fuse: 30,
    fuseName: 'Ripening',
    /** Its pool, as a share of his maximum health at the moment it rises. */
    hpShare: 0.06,
    /** How far from him it heaves up (yards), behind him so the group has to turn. */
    distance: 8,
    /** His ward while it lives: this share of every hit is shrugged off. */
    ward: { name: 'Harvest Ward', reduction: 0.8 },
    /** When it falls: stunned, then opened up. */
    stagger: { name: 'Uprooted', seconds: 6 },
    exposed: { name: 'Split Rind', amp: 0.5, seconds: 10 },
    /** Its burst when the fuse runs out: a share of each fighter's MAXIMUM health,
     *  clamped one point short of it, over the whole fight. */
    burst: { name: 'Gourd Burst', maxHpShare: 0.75, radius: 40 },
    school: 'fire' as const,
  },
  /** The calls: crows first, then strawlings, at falling health (once per pull each). */
  calls: [
    { atHpPct: 0.8, mobId: GOURDLIGHT_CROW_ID, count: 3, name: 'Crowcall' },
    { atHpPct: 0.6, mobId: STRAWLING_ID, count: 2, name: 'Chaff Rising' },
    { atHpPct: 0.4, mobId: GOURDLIGHT_CROW_ID, count: 3, name: 'Crowcall' },
    { atHpPct: 0.2, mobId: STRAWLING_ID, count: 2, name: 'Chaff Rising' },
  ],
  /** The summon's raised-arms windup before the adds land (his cast, his bark). */
  callWindup: 1.4,
  /** Seconds of quiet each telegraph holds after it lands (no two wind-ups share the ground). */
  spacing: 2,
});

/** His participant health scale: the curved, multiplied Warden pool solo, then Balgath's
 *  per-player step and cap as RATIOS of it (scarecrow.ts computes the pool). */
export const THATCHGRIN_HP_STEP_RATIO = 3_500 / 24_000;
export const THATCHGRIN_HP_CAP_RATIO = 600_000 / 24_000;

/** Seconds his lootable corpse lingers (the world-boss window is 15 minutes; his field
 *  rises again sooner, so a smaller crowd can take him twice in an evening). */
export const THATCHGRIN_CORPSE_SECONDS = 300;
/** Seconds after his corpse is gone before he stands up in his field again. */
export const THATCHGRIN_RESPAWN_SECONDS = 300;

export const GOURDLIGHT_SCARECROW_MOBS: Record<string, MobTemplate> = {
  [THATCHGRIN_ID]: {
    id: THATCHGRIN_ID,
    name: 'Old Thatchgrin',
    minLevel: THATCHGRIN_LEVEL,
    maxLevel: THATCHGRIN_LEVEL,
    family: 'elemental',
    // A world boss in the system's sense: personal loot for every contributor, the
    // daily loot lockout, participant health scaling. Raised by the seasonal module,
    // never by the world-boss scheduler (he is in no WORLD_BOSSES slot).
    worldBoss: true,
    seasonalEvent: GOURDLIGHT_EVE_ID,
    boss: true,
    elite: true,
    ccImmune: true,
    untameable: true,
    // He stands guard over his patch while idle instead of wandering out of it.
    idleStationary: true,
    // No kiting him into town: past this from his post he evades home.
    hardLeashRadius: 40,
    // The Waking Warden's ladder (header).
    hpBase: 420,
    hpPerLevel: 60,
    dmgBase: 18,
    dmgPerLevel: 4.0,
    attackSpeed: 2.1,
    armorPerLevel: 32,
    moveSpeed: 7,
    aggroRadius: 10,
    // He towers: about three players tall, so a player's melee reaches him from his
    // body's edge and his scythe from one yard past it (combat/player_attack_reach.ts).
    bodyRadius: 1.8,
    enrage: { belowHpPct: 0.3, dmgMult: 1.35, hasteMult: 1.25 },
    mechanicLevelScale: { fromLevel: 6, toLevel: 20, toMult: 3 },
    quietMechanics: true,
    yells: {
      engage: 'Off my field! The harvest is MINE!',
      summon: 'Up, up, little ones! Pick them clean!',
      enrage: 'Burn the stubble! Burn it ALL!',
    },
    // Personal loot (world_boss.ts rollWorldBossLoot): the sack always, the charm rarely,
    // and the two keepsakes a contributor does not own yet, never a second copy: the
    // Carved Pumpkin Head (so a first kill always pays it) and the Emberbristle Broom.
    loot: [
      { itemId: THATCHGRIN_SACK_ID, chance: 1 },
      { itemId: STRAWLING_CHARM_ID, chance: STRAWLING_CHARM_CHANCE },
      { itemId: CARVED_PUMPKIN_HEAD_ID, chance: 1, unlessOwned: true },
      { itemId: GOURDLIGHT_BROOM_ID, chance: 1, unlessOwned: true },
    ],
    // Falls apart into a heap of straw and lies in the stubble for his corpse window,
    // then settles into it rather than blinking out (mob/boss_corpse_sink.ts).
    corpseSink: { seconds: 4, depth: 2 },
    scale: 1,
    color: 0xc98a2e,
  },
  [GOURDLIGHT_CROW_ID]: {
    id: GOURDLIGHT_CROW_ID,
    name: 'Gourdlight Crow',
    minLevel: THATCHGRIN_LEVEL - 1,
    maxLevel: THATCHGRIN_LEVEL,
    family: 'beast',
    // The Carrion Crow's ladder (header).
    hpBase: 18,
    hpPerLevel: 7,
    dmgBase: 3,
    dmgPerLevel: 1,
    attackSpeed: 2,
    armorPerLevel: 4,
    moveSpeed: 11,
    aggroRadius: 12,
    untameable: true,
    blind: { chance: 0.08, miss: 0.2, duration: 4, name: 'Gouging Beak', school: 'physical' },
    loot: [],
    scale: 1,
    color: 0x2b2830,
  },
  [STRAWLING_ID]: {
    id: STRAWLING_ID,
    name: 'Strawling',
    minLevel: THATCHGRIN_LEVEL - 1,
    maxLevel: THATCHGRIN_LEVEL,
    family: 'elemental',
    // The Crow Caller's ladder without the elite flag (header).
    hpBase: 42,
    hpPerLevel: 17,
    dmgBase: 6,
    dmgPerLevel: 1.8,
    attackSpeed: 2.2,
    armorPerLevel: 12,
    moveSpeed: 7,
    aggroRadius: 12,
    untameable: true,
    loot: [],
    scale: 1,
    color: 0xd8b25a,
  },
  // The Swelling Gourd (scarecrow_swell.ts): a giant pumpkin his patch heaves up behind
  // him. It never moves, aggroes or swings; while it lives he shrugs off most of every hit,
  // and when its fuse runs out it bursts. Its pool is set when it rises, as a share of his
  // (THATCHGRIN_KIT.swell.hpShare), so the ladder here only seeds createMob. xpMult 0:
  // breaking it is the counterplay, never a kill worth experience.
  [SWELLING_GOURD_ID]: {
    id: SWELLING_GOURD_ID,
    name: 'Swelling Gourd',
    minLevel: THATCHGRIN_LEVEL,
    maxLevel: THATCHGRIN_LEVEL,
    family: 'elemental',
    ccImmune: true,
    slowImmune: true,
    ignoreTaunt: true,
    quietMechanics: true,
    untameable: true,
    xpMult: 0,
    hpBase: 100,
    hpPerLevel: 0,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 2.6,
    armorPerLevel: 0,
    moveSpeed: 0,
    aggroRadius: 0,
    // Big: about two players across, so it reads as the fight's second target at once.
    bodyRadius: 1.6,
    loot: [],
    scale: 1,
    color: 0xe0761c,
  },
};

export const GOURDLIGHT_SCARECROW_ITEMS: Record<string, ItemDef> = {
  [THATCHGRIN_SACK_ID]: {
    id: THATCHGRIN_SACK_ID,
    name: "Thatchgrin's Sweet Sack",
    kind: 'tool',
    quality: 'rare',
    use: { type: 'container', container: 'thatchgrin_sack' },
    stackSize: 10,
    sellValue: 0,
    soulbound: true,
    noVendorSell: true,
    noSalvage: true,
  },
  [STRAWLING_CHARM_ID]: {
    id: STRAWLING_CHARM_ID,
    name: 'Strawling Charm',
    kind: 'tool',
    quality: 'epic',
    use: { type: 'seasonal', action: 'strawlingCharm' },
    unique: true,
    sellValue: 0,
    soulbound: true,
    noVendorSell: true,
    noSalvage: true,
  },
};
