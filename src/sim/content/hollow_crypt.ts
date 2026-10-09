// The Hollow Crypt rework (docs/design/dungeon-rework/hollow_crypt.md): the
// boss templates, the trash packs (hollow_crypt_trash.ts) placed on the open-air layout
// (hollow_crypt_layout.ts), the patrols, and the gates and encounter seals
// that make every pack mandatory. Merged by data.ts (mobs) and dungeons.ts
// (spawns, gates, gate objects).
//
// FIRST PLAYABLE SLICE: the bosses are functional placeholders built from the
// existing mob kit (bigCast, summonAdds, stackPoison, stomp, aoePulse); their
// full encounter modules (graves, cocoons, the LOS dirge, the three-act rite)
// land in later passes. Health is placeholder too, to be set from the meters
// harness through NormalDungeonTuning.healthMultiplierByMob.

import {
  CRYPT_BARROWFLAME_BREATH,
  CRYPT_TAIL_LASH,
  CRYPT_WING_GUST,
} from '../mob/trash_kit/cast_ids';
import type { DungeonGateDef, DungeonObjectSpawn, DungeonSpawn, MobTemplate } from '../types';
import { ARCADE_TOP_Y, BONECHILL_LANTERN_SPOTS } from './hollow_crypt_layout';

// ---- Templates ------------------------------------------------------------

export const HOLLOW_CRYPT_MOBS: Record<string, MobTemplate> = {
  // P3: the large skeleton that teaches tank positioning with a slow,
  // telegraphed Bone Rattle (the first stomp lands one full interval in).
  ossuary_sentinel: {
    id: 'ossuary_sentinel',
    name: 'Ossuary Sentinel',
    minLevel: 8,
    maxLevel: 8,
    family: 'undead',
    elite: true,
    hpBase: 80,
    hpPerLevel: 24,
    dmgBase: 9,
    dmgPerLevel: 2.4,
    attackSpeed: 2.6,
    armorPerLevel: 22,
    moveSpeed: 6,
    aggroRadius: 12,
    stomp: { radius: 8, every: 12, duration: 1.5, min: 8, max: 12, name: 'Bone Rattle' },
    loot: [
      { copper: 140, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.9 },
    ],
    scale: 1.55,
    color: 0xcfc6b0,
  },
  // P4 and P5: the sexton's diggers (their Open Graves come with Marrow's
  // encounter module; tonight they are plain elites).
  hollow_gravedigger: {
    id: 'hollow_gravedigger',
    name: 'Hollow Gravedigger',
    minLevel: 8,
    maxLevel: 8,
    family: 'undead',
    elite: true,
    hpBase: 50,
    hpPerLevel: 20,
    dmgBase: 8,
    dmgPerLevel: 2.3,
    attackSpeed: 2.4,
    armorPerLevel: 16,
    moveSpeed: 6.5,
    aggroRadius: 12,
    loot: [
      { copper: 110, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.7 },
    ],
    scale: 1.05,
    color: 0x8a7a64,
  },
  // P6: the rime egg sacs. One hit breaks a sac; a boot beside one springs it.
  rime_egg_sac: {
    id: 'rime_egg_sac',
    name: 'Rime Egg Sac',
    minLevel: 8,
    maxLevel: 8,
    family: 'spider',
    hpBase: 8,
    hpPerLevel: 0,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 999,
    armorPerLevel: 0,
    moveSpeed: 0,
    aggroRadius: 0,
    loot: [],
    scale: 1,
    color: 0xcfe3f0,
    xpMult: 0,
    offStreamIdle: true,
    broodEgg: {
      chainRadius: 5,
      chainDelay: 0.3,
      proximityRadius: 4,
      hatchMobId: 'rimeweb_hatchling',
    },
  },
  // The hatchlings pounce the soft targets (healer or damage dealer first).
  rimeweb_hatchling: {
    id: 'rimeweb_hatchling',
    name: 'Rimeweb Hatchling',
    minLevel: 7,
    maxLevel: 8,
    family: 'spider',
    hpBase: 20,
    hpPerLevel: 2,
    dmgBase: 6.5,
    dmgPerLevel: 2.1,
    attackSpeed: 1.6,
    armorPerLevel: 4,
    moveSpeed: 10,
    aggroRadius: 12,
    loot: [{ copper: 8, chance: 1 }],
    scale: 0.55,
    color: 0xd6eaf8,
    xpMult: 0.3,
    offStreamIdle: true,
    broodWhelp: {
      leapRange: 20,
      leapSpeedMult: 2.4,
      leapSeconds: 1.2,
      burn: { perTick: 2, interval: 1, duration: 6, name: 'Rime Bite', school: 'frost' },
    },
  },
  // P7: the caster spider on the rim walk (the gallery's rimeweb spiders keep
  // their species name; the ravine's boss is now the Lady of the Bonechill):
  // its bite carries the stacking rime venom.
  rimeweb_spinner: {
    id: 'rimeweb_spinner',
    name: 'Rimeweb Spinner',
    minLevel: 9,
    maxLevel: 9,
    family: 'spider',
    elite: true,
    hpBase: 50,
    hpPerLevel: 20,
    dmgBase: 8,
    dmgPerLevel: 2.4,
    attackSpeed: 2.0,
    armorPerLevel: 12,
    moveSpeed: 8,
    aggroRadius: 13,
    stackPoison: {
      chance: 0.5,
      perTick: 2,
      interval: 3,
      duration: 9,
      maxStacks: 3,
      name: 'Rime Venom',
      school: 'frost',
    },
    loot: [
      { copper: 130, chance: 1 },
      { itemId: 'spider_leg', chance: 0.7 },
    ],
    scale: 1.35,
    color: 0xe4f0fa,
  },
  // P8 and P9: the tallow-sect acolytes (their interruptible casts arrive
  // with Ilvane's module).
  candlewright_acolyte: {
    id: 'candlewright_acolyte',
    name: 'Candlewright Acolyte',
    minLevel: 9,
    maxLevel: 9,
    family: 'undead',
    elite: true,
    hpBase: 46,
    hpPerLevel: 19,
    dmgBase: 8,
    dmgPerLevel: 2.4,
    attackSpeed: 2.0,
    armorPerLevel: 14,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [
      { copper: 130, chance: 1 },
      { itemId: 'linen_scrap', chance: 0.6 },
    ],
    scale: 1.0,
    color: 0xe8a64a,
  },
  // P8 and Ilvane's arena: the hooded choir (Harmony arrives with her module).
  hollow_chorister: {
    id: 'hollow_chorister',
    name: 'Hollow Chorister',
    minLevel: 8,
    maxLevel: 8,
    family: 'undead',
    elite: true,
    hpBase: 44,
    hpPerLevel: 18,
    dmgBase: 7,
    dmgPerLevel: 2.2,
    attackSpeed: 2.2,
    armorPerLevel: 12,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [
      { copper: 110, chance: 1 },
      { itemId: 'linen_scrap', chance: 0.5 },
    ],
    scale: 1.0,
    color: 0x7b4fa0,
  },
  // P9: the procession's walkers (and later Morthen's Gravecall souls).
  bound_soul: {
    id: 'bound_soul',
    name: 'Bound Soul',
    minLevel: 8,
    maxLevel: 8,
    family: 'undead',
    hpBase: 40,
    hpPerLevel: 4,
    dmgBase: 4,
    dmgPerLevel: 1.2,
    attackSpeed: 2.2,
    armorPerLevel: 6,
    moveSpeed: 5,
    aggroRadius: 10,
    loot: [{ copper: 20, chance: 1 }],
    scale: 0.95,
    color: 0x6fd6a8,
    xpMult: 0.5,
  },
  // A Remembrance Candle guttered by Morthen's Rite of the Unquiet
  // (encounters/hollow_crypt/morthen_candles.ts): the encounter sets one at the
  // foot of each candle pillar while the Rite holds and takes it away once the
  // candle burns again. Never hostile, never fights (the encounter holds it:
  // nothing can strike it); a player targets it and presses interact to
  // relight the candle, the G3 use (mob/trash_kit/encounter_use.ts): a 4 s
  // channel a landed hit does NOT break (holdsThroughHits), while the Rite
  // drains the lighter's health every second of it (the healer heals them
  // through); a step, a stun or death breaks it. Its literals are
  // morthen_ids.ts MORTHEN_CANDLE_ID and MORTHEN_RELIGHT_CAST (pinned by
  // tests/hollow_crypt_morthen.test.ts). No body is drawn: the pillar is the
  // kit's, the flame the crypt's own painter.
  crypt_remembrance_candle: {
    id: 'crypt_remembrance_candle',
    name: 'Remembrance Candle',
    minLevel: 10,
    maxLevel: 10,
    family: 'elemental',
    untameable: true,
    ccImmune: true,
    slowImmune: true,
    hpBase: 50,
    hpPerLevel: 0,
    dmgBase: 1,
    dmgPerLevel: 0,
    attackSpeed: 30,
    armorPerLevel: 0,
    moveSpeed: 0,
    aggroRadius: 0,
    idleStationary: true,
    xpMult: 0,
    trashKit: {
      usable: {
        castId: 'kituse_crypt_relight_candle',
        name: 'Relight the Candle',
        channel: 4,
        range: 4,
        holdsThroughHits: true,
        effect: { kind: 'relight', school: 'holy' },
      },
    },
    loot: [],
    scale: 1,
    color: 0xd8f5c8,
  },
  // Sexton Marrow's dead: every Open Grave gives one up at his Burial Toll
  // (encounters/hollow_crypt/marrow.ts), and on heroic a player lingering in
  // a grave stirs one. A summoned add (the heroic add multiplier prices it):
  // the zone's Restless Bones at the crypt's level, without its quest drops.
  marrow_restless_bones: {
    id: 'marrow_restless_bones',
    name: 'Restless Bones',
    minLevel: 8,
    maxLevel: 8,
    family: 'undead',
    hpBase: 46,
    hpPerLevel: 19,
    dmgBase: 7,
    dmgPerLevel: 2.1,
    attackSpeed: 2.3,
    armorPerLevel: 14,
    moveSpeed: 6.5,
    aggroRadius: 14,
    loot: [{ copper: 12, chance: 1 }],
    scale: 1.0,
    color: 0xd5dbdb,
    xpMult: 0.3,
  },
  // Boss 2: the Lady of the Bonechill, the ghost of a bride buried in the
  // ravine's ice (the id stays `rimeweb`, frozen since the spider placeholder:
  // spawns, loot, the gates and the deeds key on it). Her whole kit is the
  // encounter module (encounters/hollow_crypt/lady.ts): Bride's Lament and the
  // grave lanterns, the Frozen Embrace, the Rime Path, the Bridal Freeze.
  rimeweb: {
    id: 'rimeweb',
    name: 'Lady of the Bonechill',
    // A 6.5 yd ghost in a wide gown (the Blender body): melee reaches her from
    // her hem, and her claws reach as far (MobTemplate.bodyRadius).
    bodyRadius: 2.4,
    minLevel: 9,
    maxLevel: 9,
    family: 'undead',
    elite: true,
    ccImmune: true,
    slowImmune: true,
    hpBase: 120,
    hpPerLevel: 26,
    dmgBase: 9,
    dmgPerLevel: 2.5,
    attackSpeed: 2.0,
    armorPerLevel: 20,
    moveSpeed: 7,
    aggroRadius: 14,
    loot: [
      { copper: 1000, chance: 1 },
      {
        itemId: 'rimesilk_mantle',
        chance: 0.34,
        rollGroup: 'rimeweb_guaranteed',
        normalOnly: true,
      },
      {
        itemId: 'bonechill_carapace_vest',
        chance: 0.33,
        rollGroup: 'rimeweb_guaranteed',
        normalOnly: true,
      },
      {
        itemId: 'rimeweb_hunters_leggings',
        chance: 0.33,
        rollGroup: 'rimeweb_guaranteed',
        normalOnly: true,
      },
      // The normal blue (hollow_crypt_items.ts): one draw, 35 percent in equal
      // shares, the helm trio and the Bride's Icicle (once its own 0.10 row).
      { itemId: 'rimewreath_coif', chance: 0.0875, rollGroup: 'rimeweb_blue', normalOnly: true },
      { itemId: 'rime_laced_hood', chance: 0.0875, rollGroup: 'rimeweb_blue', normalOnly: true },
      { itemId: 'lamenting_veil', chance: 0.0875, rollGroup: 'rimeweb_blue', normalOnly: true },
      { itemId: 'rimeweb_fang', chance: 0.0875, rollGroup: 'rimeweb_blue', normalOnly: true },
    ],
    scale: 1,
    color: 0xd8ecff,
  },
  // Boss 3: Cantor Ilvane and the Hollow Choir. Her whole kit is the encounter
  // module (encounters/hollow_crypt/ilvane.ts): the Dirge of the Hollow (kick
  // it or hide from it), Harmony with her Choristers, the Bone Organ, Crescendo.
  cantor_ilvane: {
    id: 'cantor_ilvane',
    name: 'Cantor Ilvane',
    minLevel: 9,
    maxLevel: 9,
    family: 'undead',
    elite: true,
    ccImmune: true,
    slowImmune: true,
    hpBase: 110,
    hpPerLevel: 24,
    dmgBase: 8,
    dmgPerLevel: 2.4,
    attackSpeed: 2.2,
    armorPerLevel: 18,
    moveSpeed: 7,
    aggroRadius: 14,
    loot: [
      { copper: 1000, chance: 1 },
      { itemId: 'cantors_cassock', chance: 0.34, rollGroup: 'ilvane_guaranteed', normalOnly: true },
      {
        itemId: 'choirward_leggings',
        chance: 0.33,
        rollGroup: 'ilvane_guaranteed',
        normalOnly: true,
      },
      {
        itemId: 'choristers_gloves',
        chance: 0.33,
        rollGroup: 'ilvane_guaranteed',
        normalOnly: true,
      },
      // The normal blue (hollow_crypt_items.ts): one draw, 35 percent in equal
      // shares, the shoulder trio and the Cantor's Hymnal (once its own row).
      {
        itemId: 'choirward_pauldrons',
        chance: 0.0875,
        rollGroup: 'ilvane_blue',
        normalOnly: true,
      },
      {
        itemId: 'choristers_spaulders',
        chance: 0.0875,
        rollGroup: 'ilvane_blue',
        normalOnly: true,
      },
      { itemId: 'cantors_stole', chance: 0.0875, rollGroup: 'ilvane_blue', normalOnly: true },
      { itemId: 'cantors_hymnal', chance: 0.0875, rollGroup: 'ilvane_blue', normalOnly: true },
    ],
    scale: 1.1,
    color: 0x9d6cd0,
  },
  // The finale: the Knellwyrm, the great bone wyrm Morthen's dying rite calls
  // down on the Rite Ring (encounters/hollow_crypt/knellwyrm.ts). Never placed:
  // the encounter summons it out of the sky after Morthen falls. The Ossuary
  // Drake's kit (the breath cone and its telegraph are the drake's geometry,
  // so the painted cone is the one that burns), plus Pyre Strafe and Dread
  // Bellow from its module. Boss rule: CC- and snare-immune (see morthen).
  // Morthen keeps the run's loot; the wyrm pays a modest purse and reagents.
  crypt_knellwyrm: {
    id: 'crypt_knellwyrm',
    name: 'Knellwyrm',
    // A wyrm drawn 19 yd tall: melee reaches it from its flank (8.5 yd), its
    // own swing reaches 9.5 (MobTemplate.bodyRadius).
    bodyRadius: 5.5,
    minLevel: 10,
    maxLevel: 10,
    family: 'undead',
    elite: true,
    ccImmune: true,
    slowImmune: true,
    hpBase: 200,
    hpPerLevel: 30,
    dmgBase: 11,
    dmgPerLevel: 2.8,
    attackSpeed: 2.4,
    armorPerLevel: 26,
    moveSpeed: 7.5,
    aggroRadius: 20,
    breathCone: {
      castId: CRYPT_BARROWFLAME_BREATH,
      name: 'Barrowflame Breath',
      castTime: 2,
      every: 13,
      range: 14,
      arcDeg: 70,
      min: 30,
      max: 38,
      school: 'fire',
    },
    trashKit: {
      tailLash: {
        castId: CRYPT_TAIL_LASH,
        name: 'Tail Lash',
        castTime: 1,
        every: 10,
        first: 7,
        school: 'physical',
        range: 10,
        arcDeg: 120,
        min: 20,
        max: 28,
      },
      wingGust: {
        castId: CRYPT_WING_GUST,
        name: 'Wing Gust',
        castTime: 1.5,
        every: 19,
        first: 11,
        school: 'physical',
        radius: 10,
        knockback: 8,
        min: 12,
        max: 18,
      },
    },
    loot: [
      { copper: 1500, chance: 1 },
      { itemId: 'bone_fragments', chance: 1 },
      { itemId: 'arcane_essence', chance: 0.5 },
    ],
    // A quarter again over the Ossuary Drake: its head rides some 12 yd up.
    scale: 1.25,
    color: 0x3b3a34,
  },
};

// ---- Spawns ---------------------------------------------------------------

const FACE_SOUTH = Math.PI; // toward the entrance
const FACE_NORTH = 0;

// Pack ids read as <area><n>: c cloister, p processional, w west wing, e east
// wing, q choir, s stair. Four patrols: the skeleton squad round the ossuary
// monument (c2), the crow flock circling the Sexton's Yard (w2), the Ossuary
// Drake flying the length of the Processional (drake) and the choir watch
// pacing the nave aisle (q2).

/** The skeleton squad's loop round the ossuary monument. */
const C2_LOOP = [
  { x: -16, z: -46 },
  { x: 16, z: -46 },
  { x: 16, z: -14 },
  { x: -16, z: -14 },
];
/** The crow flock's circle over the Sexton's Yard (flown over the headstones). */
const W2_LOOP = [
  { x: -96, z: 34 },
  { x: -70, z: 30 },
  { x: -64, z: 56 },
  { x: -80, z: 74 },
  { x: -100, z: 62 },
];
/** The Ossuary Drake's flight over the Processional and the choir approach. */
const DRAKE_LOOP = [
  { x: -14, z: 28 },
  { x: 14, z: 28 },
  { x: 14, z: 104 },
  { x: -14, z: 104 },
];
/** The choir watch pacing the nave aisle between the pews. */
const Q2_LOOP = [
  { x: -6, z: 116 },
  { x: 6, z: 116 },
  { x: 6, z: 144 },
  { x: -6, z: 144 },
];

/** A gargoyle perched on the cap of a whole cloister arch (see the layout's
 *  hollowCryptArcadeBays; tests/hollow_crypt_trash_layout.test.ts pins it). */
function gargoyle(x: number, z: number, packId: string, facing = FACE_SOUTH): DungeonSpawn {
  return {
    mobId: 'crypt_chapel_gargoyle',
    x,
    z,
    facing,
    packId,
    idleStationary: true,
    perch: { y: ARCADE_TOP_Y },
  };
}

/** A pack member holding formation until pulled. */
function held(
  mobId: string,
  x: number,
  z: number,
  packId: string,
  facing = FACE_SOUTH,
): DungeonSpawn {
  return { mobId, x, z, facing, packId, idleStationary: true };
}

export const HOLLOW_CRYPT_SPAWNS: DungeonSpawn[] = [
  // ---- The Ossuary Cloister --------------------------------------------------
  // c1: the stair foot. Two warriors and an adept, and a gargoyle watching
  // from the south arcade that dives in on the pull.
  held('crypt_ossuary_warrior', -5, -60, 'c1'),
  held('crypt_ossuary_warrior', 5, -60, 'c1'),
  held('crypt_gravecaller_adept', 0, -54, 'c1'),
  gargoyle(33, -70, 'c1'),
  // c2: the skeleton squad walking the monument loop.
  {
    mobId: 'crypt_ossuary_warrior',
    x: -16,
    z: -46,
    packId: 'c2',
    patrol: { points: C2_LOOP, offset: 6 },
  },
  {
    mobId: 'crypt_ossuary_warrior',
    x: -13,
    z: -46,
    packId: 'c2',
    patrol: { points: C2_LOOP, offset: 3 },
  },
  {
    mobId: 'crypt_ossuary_cutthroat',
    x: -10,
    z: -46,
    packId: 'c2',
    patrol: { points: C2_LOOP, offset: 0 },
  },
  // c3: the east arcade, two gargoyles on the arches over an adept and a warrior.
  held('crypt_gravecaller_adept', 30, -44, 'c3', -Math.PI / 2),
  held('crypt_ossuary_warrior', 30, -36, 'c3', -Math.PI / 2),
  gargoyle(38, -45, 'c3', -Math.PI / 2),
  gargoyle(38, -35, 'c3', -Math.PI / 2),
  // c4: the Undercroft Grille's guard, a necromancer between two warriors,
  // with a gargoyle on each north corner arch.
  held('crypt_gravecaller_necromancer', 0, 10, 'c4'),
  held('crypt_ossuary_warrior', -5, 5, 'c4'),
  held('crypt_ossuary_warrior', 5, 5, 'c4'),
  gargoyle(-38, 5, 'c4', Math.PI / 2),
  gargoyle(38, 5, 'c4', -Math.PI / 2),
  // ---- The Processional -----------------------------------------------------
  // p1: past the Grille, two adepts behind a warrior and a cutthroat.
  held('crypt_ossuary_warrior', 0, 31, 'p1'),
  held('crypt_ossuary_cutthroat', 0, 36, 'p1'),
  held('crypt_gravecaller_adept', -6, 38, 'p1'),
  held('crypt_gravecaller_adept', 6, 38, 'p1'),
  // The Ossuary Drake flies the Processional; a pass overhead is a pull.
  {
    mobId: 'crypt_ossuary_drake',
    x: -14,
    z: 28,
    packId: 'drake',
    patrol: { points: DRAKE_LOOP, offset: 0, pace: 0.8, altitude: 22 },
  },
  // p2: the choir approach before the Twin Seals.
  held('crypt_gravecaller_necromancer', 0, 98, 'p2'),
  held('crypt_ossuary_warrior', -5, 93, 'p2'),
  held('crypt_ossuary_warrior', 5, 93, 'p2'),
  held('crypt_gravecaller_adept', 0, 102, 'p2'),
  // ---- West wing: the Sexton's Yard -------------------------------------------
  // w1: a Crow Caller and its flock on the graves by the causeway.
  held('crypt_crow_caller', -70, 36, 'w1', -Math.PI / 2),
  held('crypt_carrion_crow', -67, 32, 'w1', -Math.PI / 2),
  held('crypt_carrion_crow', -73, 31, 'w1', -Math.PI / 2),
  held('crypt_carrion_crow', -66, 40, 'w1', -Math.PI / 2),
  held('crypt_carrion_crow', -73, 41, 'w1', -Math.PI / 2),
  // w2: a flock circling over the yard.
  ...[0, 3, 6, 9, 12].map(
    (offset): DungeonSpawn => ({
      mobId: 'crypt_carrion_crow',
      x: -96,
      z: 34,
      packId: 'w2',
      patrol: { points: W2_LOOP, offset, pace: 0.45, altitude: 9 },
    }),
  ),
  // w3: the yard trench, a necromancer with a warrior and a cutthroat.
  held('crypt_gravecaller_necromancer', -88, 44, 'w3', -Math.PI / 2),
  held('crypt_ossuary_warrior', -84, 49, 'w3', -Math.PI / 2),
  held('crypt_ossuary_cutthroat', -92, 49, 'w3', -Math.PI / 2),
  // w4: the bell pit below the Bell Yard ramp, a second caller with a warrior.
  held('crypt_crow_caller', -86, 64, 'w4'),
  held('crypt_ossuary_warrior', -80, 61, 'w4'),
  held('crypt_carrion_crow', -90, 60, 'w4'),
  held('crypt_carrion_crow', -78, 57, 'w4'),
  held('crypt_carrion_crow', -84, 57, 'w4'),
  // Boss 1: Sexton Marrow in the Bell Yard.
  { mobId: 'sexton_marrow', x: -82, z: 122, facing: FACE_SOUTH, idleStationary: true },
  // ---- East wing: the Widow's Gallery ---------------------------------------
  // e1: the gallery nest, two widows and an adept over four rime egg sacs.
  { mobId: 'bonechill_widow', x: 70, z: 44, packId: 'e1' },
  { mobId: 'bonechill_widow', x: 78, z: 48, packId: 'e1' },
  held('crypt_gravecaller_adept', 74, 54, 'e1'),
  { mobId: 'rime_egg_sac', x: 58, z: 32 },
  { mobId: 'rime_egg_sac', x: 58, z: 50 },
  { mobId: 'rime_egg_sac', x: 93, z: 48 },
  { mobId: 'rime_egg_sac', x: 92, z: 62 },
  // e2: the rim walk, three skeletons above the ravine.
  held('crypt_ossuary_warrior', 104, 66, 'e2'),
  held('crypt_ossuary_cutthroat', 106, 72, 'e2'),
  held('crypt_gravecaller_adept', 104, 80, 'e2'),
  // e3: the web neck, a necromancer and a warrior before the Great Web.
  held('crypt_gravecaller_necromancer', 80, 72, 'e3'),
  held('crypt_ossuary_warrior', 76, 68, 'e3'),
  held('crypt_ossuary_warrior', 84, 68, 'e3'),
  // Boss 2: the Lady of the Bonechill, hanging over the ravine floor before
  // her frozen bridal grave.
  { mobId: 'rimeweb', x: 80, z: 118, facing: FACE_SOUTH, idleStationary: true },
  // ---- The Choir Ruin ---------------------------------------------------------
  // q1: the nave, a necromancer and an adept behind two warriors.
  held('crypt_ossuary_warrior', -4, 124, 'q1'),
  held('crypt_ossuary_warrior', 4, 124, 'q1'),
  held('crypt_gravecaller_necromancer', 0, 130, 'q1'),
  held('crypt_gravecaller_adept', 0, 135, 'q1'),
  // q2: the choir watch pacing the aisle.
  {
    mobId: 'crypt_ossuary_warrior',
    x: -6,
    z: 116,
    packId: 'q2',
    patrol: { points: Q2_LOOP, offset: 3 },
  },
  {
    mobId: 'crypt_ossuary_cutthroat',
    x: -3,
    z: 116,
    packId: 'q2',
    patrol: { points: Q2_LOOP, offset: 0 },
  },
  // Boss 3: Cantor Ilvane on the loft with her two choristers at the rail.
  {
    mobId: 'cantor_ilvane',
    x: 0,
    z: 163,
    facing: FACE_SOUTH,
    packId: 'ilvane',
    idleStationary: true,
  },
  {
    mobId: 'hollow_chorister',
    x: -7,
    z: 154,
    facing: FACE_SOUTH,
    packId: 'ilvane',
    idleStationary: true,
  },
  {
    mobId: 'hollow_chorister',
    x: 7,
    z: 154,
    facing: FACE_SOUTH,
    packId: 'ilvane',
    idleStationary: true,
  },
  // ---- The Stair Landing ----------------------------------------------------
  // s1: the last guard before the Bone Stair.
  held('crypt_gravecaller_necromancer', 46, 161, 's1', -Math.PI / 2),
  held('crypt_ossuary_warrior', 41, 158, 's1', -Math.PI / 2),
  held('crypt_ossuary_warrior', 41, 164, 's1', -Math.PI / 2),
  held('crypt_ossuary_cutthroat', 49, 165, 's1', -Math.PI / 2),
  // Boss 4: Morthen at the altar of the Rite Ring, facing the stair.
  { mobId: 'morthen', x: 0, z: 212, facing: FACE_NORTH, idleStationary: true },
];

/** Every mandatory trash pull, patrols included, in route order (dev helpers, tests). */
export const HOLLOW_CRYPT_PACKS = [
  'c1',
  'c2',
  'c3',
  'c4',
  'p1',
  'drake',
  'p2',
  'w1',
  'w2',
  'w3',
  'w4',
  'e1',
  'e2',
  'e3',
  'q1',
  'q2',
  's1',
] as const;

/** The four patrols (dev helpers, tests). */
export const HOLLOW_CRYPT_PATROLS = ['c2', 'w2', 'drake', 'q2'] as const;

// ---- Gates and seals --------------------------------------------------------

/** Yaw of a gate box spanning a passage that runs along (dx, dz). */
function across(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export const HOLLOW_CRYPT_GATES: DungeonGateDef[] = [
  {
    id: 'grille',
    name: 'Undercroft Grille',
    kind: 'portcullis',
    x: 0,
    z: 21,
    hw: 7,
    rot: 0,
    packs: ['c1', 'c2', 'c3', 'c4'],
    openText: 'The Undercroft Grille grinds open.',
  },
  {
    id: 'yard_barrier',
    name: 'Bone Barrier',
    kind: 'bone_barrier',
    x: -82,
    z: 93,
    hw: 7,
    rot: 0,
    packs: ['w1', 'w2', 'w3', 'w4'],
    sealWhileEngaged: 'sexton_marrow',
    openText: 'The bone barrier before the Bell Yard crumbles.',
  },
  {
    id: 'web_curtain',
    name: 'Frost-Web Curtain',
    kind: 'web_curtain',
    x: 80,
    z: 88,
    hw: 7,
    rot: 0,
    packs: ['e1', 'e2', 'e3'],
    sealWhileEngaged: 'rimeweb',
    openText: 'The frost-web curtain tears apart.',
  },
  {
    id: 'web_bridge',
    name: 'Webbed Causeway',
    kind: 'web_curtain',
    x: 60,
    z: 102,
    hw: 6,
    rot: across(-24, -2),
    bosses: ['rimeweb'],
    openText: 'The webs over the eastern causeway fall away.',
  },
  {
    id: 'twin_seals',
    name: 'Twin Seals',
    kind: 'warded_arch',
    x: 0,
    z: 113,
    hw: 7,
    rot: 0,
    packs: ['p1', 'drake', 'p2'],
    bosses: ['sexton_marrow', 'rimeweb'],
    sealWhileEngaged: 'cantor_ilvane',
    openText: 'Both sigils gutter out. The Twin Seals open.',
  },
  {
    id: 'choir_door',
    name: 'Choir Door',
    kind: 'warded_arch',
    x: 31,
    z: 161,
    hw: 7,
    rot: across(1, 0),
    packs: ['q1', 'q2'],
    bosses: ['cantor_ilvane'],
    openText: 'The choir door opens onto the Bone Stair.',
  },
  {
    id: 'stair_gate',
    name: 'Bone Stair Gate',
    kind: 'bone_barrier',
    x: 56,
    z: 161,
    hw: 6,
    rot: across(1, 0),
    packs: ['s1'],
    openText: 'The gate at the foot of the Bone Stair collapses.',
  },
  {
    id: 'rite_ward',
    name: 'Unquiet Ward',
    kind: 'rite_ward',
    x: 5.8,
    z: 233.6,
    hw: 6,
    rot: across(-4, -8),
    sealWhileEngaged: 'morthen',
  },
];

/** One inert ground object per gate: its template id carries the state. And
 *  the Lady of the Bonechill's three grave lanterns: each one's lit, dark or
 *  kindling state rides its template id (encounters/hollow_crypt/
 *  lady_lanterns.ts; the literal is LADY_LANTERN_TEMPLATES.lit). */
export const HOLLOW_CRYPT_GATE_OBJECTS: DungeonObjectSpawn[] = [
  ...HOLLOW_CRYPT_GATES.map(
    (g): DungeonObjectSpawn => ({
      itemId: '',
      name: g.name,
      x: g.x,
      z: g.z,
      templateId: 'dungeon_gate_closed',
      dungeonId: 'hollow_crypt',
      lootable: false,
    }),
  ),
  ...BONECHILL_LANTERN_SPOTS.map(
    (l): DungeonObjectSpawn => ({
      itemId: '',
      name: 'Grave Lantern',
      x: l.x,
      z: l.z,
      templateId: 'crypt_lady_lantern_lit',
      dungeonId: 'hollow_crypt',
      lootable: false,
    }),
  ),
];
