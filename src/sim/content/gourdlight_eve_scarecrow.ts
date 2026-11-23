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
//   - Thatchbound, his mind control (phase 5, owner direction: "curse one or two players,
//     turn them into a crow or a little scarecrow, they lose control and swing at their
//     friends for a few seconds"): its cadence (first at 25 s, then every 35 s), its 2.5 s
//     cast, who it takes (one victim in a pair, two from three fighters up, never his
//     current target, never the same player twice running when anyone else is free, and
//     nobody at all when he is fought alone, since a lone puppet has nobody to turn on),
//     its 8 s hold, its ways out (an ally's Magic dispel, or taking 15% of maximum health
//     in damage from any source, the classic break-on-damage threshold) and the puppet's
//     swing (8 to 12 every 2 s, before his mechanic level scale: about a third of his
//     chaff's burn per second, the owner's "hits soft").
//   - The charm's drop chance, in the buddy-drop convention (content/buddy_sources.ts:
//     CALIBRATE). The pumpkin head is guaranteed but never duplicated; the broom is
//     bought from Hester for five Emberwoven Sheaves, one per daily kill, or, rarely
//     (3%, round 10), dropped outright on a daily looted kill.
//
// Everything he pays is cosmetic or event currency: no stat, no gear, no power.

import type { ItemDef, MobTemplate } from '../types';
import {
  CARVED_PUMPKIN_HEAD_ID,
  GOURDLIGHT_BROOM_DROP_CHANCE,
  GOURDLIGHT_BROOM_ID,
  GOURDLIGHT_EVE_ID,
  GOURDLIGHT_POUCH_SWEETS,
  GOURDLIGHT_SHEAF_ID,
} from './gourdlight_eve';
import { CROW_FEATHER_ID, GOURDLIGHT_DAILY_FEATHERS_QUEST_ID } from './gourdlight_eve_dailies';

export const THATCHGRIN_ID = 'gourdlight_thatchgrin';
/** His night-hours English (the slumber block below): the state's name on his pole by
 *  day and the yells of his dusk wake and dawn climb. Exported so the client re-localizes
 *  exactly these strings (src/ui/sim_i18n.ts, keys under seasonal.thatchgrin). */
export const THATCHGRIN_SLUMBER = Object.freeze({
  auraName: 'Pole-Bound',
  wakeYell: 'NIGHT falls on the patch! Who walks in MY field?',
  sleepYell: 'Sun is up. Back on the post, back to watching.',
});
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
/** Thatchbound's cues: the cast's mark on each victim, the curse landing, the puppet's
 *  swing and the strings snapping (scarecrow_puppet.ts). */
export const THATCHGRIN_PUPPET_ABILITY = 'mob_thatchgrin_puppet';

/** Thatchbound's two bodies: a victim is turned into a little straw scarecrow or a crow
 *  (the first victim of a cast the scarecrow, the second the crow). Kind 'incapacitate'
 *  (the victim's own control is gone); the client draws the body from the id. */
export const THATCHBOUND_STRAWLING_AURA_ID = 'thatchbound_strawling';
export const THATCHBOUND_CROW_AURA_ID = 'thatchbound_crow';
export const THATCHBOUND_AURA_IDS: readonly string[] = Object.freeze([
  THATCHBOUND_STRAWLING_AURA_ID,
  THATCHBOUND_CROW_AURA_ID,
]);

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
  /** Thatchbound, his mind control (DESIGN, header; scarecrow_puppet.ts). */
  puppet: {
    name: 'Thatchbound',
    /** Seconds into a pull before the first, then between casts. */
    first: 25,
    every: 35,
    /** The cast bar (an interrupt that clears it fizzles the curse). */
    cast: 2.5,
    /** Reach of the curse from him (yards). */
    range: 40,
    /** One victim from two fighters, two from three or more, never more. */
    maxVictims: 2,
    twoFrom: 3,
    /** The hold, and the share of maximum health in damage that snaps the strings. */
    seconds: 8,
    breakShare: 0.15,
    /** The puppet's swing at its friend: reach, cadence, first swing, damage. */
    swing: { name: "Puppet's Flail", reach: 4, every: 2, first: 0.6, min: 8, max: 12 },
    school: 'shadow' as const,
  },
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
    // A NIGHT boss (owner direction, round 10): by day he hangs lifeless on his pole in
    // the middle of his field, neutral and unattackable like any sleeper (mob/slumber.ts:
    // the one isHostileTo rule, no damage branch); at nightfall he wakes, tears himself
    // off the post and the field is his again; at dawn, once out of combat, he climbs
    // back onto it. A fight running at dawn is fought to its end. The Foreman's slumber
    // inverted (awakeAt 'night'), so the sky and his pole agree on when night falls.
    slumber: {
      auraName: THATCHGRIN_SLUMBER.auraName,
      sleepYell: THATCHGRIN_SLUMBER.sleepYell,
      wakeYell: THATCHGRIN_SLUMBER.wakeYell,
      yellRange: 120,
      // his pole stands on his spawn point: he hangs on it exactly, facing his field
      bedRadius: 1.5,
      snapToBed: true,
      awakeAt: 'night',
      // the Awaken clip (scarecrow_clips.py awaken_keys) runs 3.0 s; the hold covers it
      riseSeconds: 3,
    },
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
    // Personal loot (world_boss.ts rollWorldBossLoot), once a day per player under his
    // world-boss lockout: the sack always, the charm rarely, the Carved Pumpkin Head
    // when the contributor does not own one (so a first kill always pays it), and one
    // Emberwoven Sheaf, the broom's token (Hester trades five for the Emberbristle
    // Broom), for every contributor who does not keep the broom yet. The broom itself
    // is a rare drop on top (GOURDLIGHT_BROOM_DROP_CHANCE, owner direction round 10):
    // rolled for every contributor so the draw order stays a function of the roster,
    // and discarded for one who already keeps it. Five days of sheaves stay the sure way.
    loot: [
      { itemId: THATCHGRIN_SACK_ID, chance: 1 },
      { itemId: STRAWLING_CHARM_ID, chance: STRAWLING_CHARM_CHANCE },
      { itemId: CARVED_PUMPKIN_HEAD_ID, chance: 1, unlessOwned: true },
      { itemId: GOURDLIGHT_SHEAF_ID, chance: 1, unlessOwnedItem: GOURDLIGHT_BROOM_ID },
      { itemId: GOURDLIGHT_BROOM_ID, chance: GOURDLIGHT_BROOM_DROP_CHANCE, unlessOwned: true },
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
    // a feather for Hester's bonfire, only for a player on her Feathers for the Fire
    // daily (content/gourdlight_eve_dailies.ts; the questId gate drops it to nobody else)
    loot: [{ itemId: CROW_FEATHER_ID, chance: 1, questId: GOURDLIGHT_DAILY_FEATHERS_QUEST_ID }],
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
