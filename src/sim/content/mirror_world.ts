// Zone 4 — the Mirror World (levels 15-20). A surreal, mist-drowned mountain
// vale north of Thornpeak: the Vale of Glass. Sheer ridges seal it on every
// side — no road leads here, and the only ways in or out are the standing
// MIRRORS (portal pads — see PORTAL_PADS below and Sim.updatePortalPadTriggers;
// the renderer draws every pad as a mirror).
//
// The flow: the Thornpeak mirror lands on the OVERLOOK, a shelf high on the
// south wall with the whole vale below. One stone stair descends to the TOWN
// RISE (inn, market, the keeper and the trader) and the MIRROR COURT at its
// edge, where the three town mirrors stand in stone niches, each watched by
// its gargoyle statue (the tolls). East lies the MIRRORMERE — one real lake,
// fishable shores, deep enough to swim. A loop road circles the vale; camps
// sit off it at readable distances, harder the further you walk clockwise:
// ghosts on the south shore, unicorns in the east moonmeadow, reapers on the
// graveyard knoll, sentries in the north ruin field, gloomhulks in the NW
// crags, mistshades in the western darkwood — and the Gloaming Maw prowls the
// lake's north inlet. The witch waits in a hollow at the end of a winding NW
// spur; the Lumen Lift pairs the town with Stargazer's Ledge high on the
// south wall; a clouded mirror hides the grotto pocket in the SE cliffs; and
// the BLACK CANYON cuts the NE rim — a walkable stone floor between sheer
// walls, past three dread sentinels, to the sealed Sable Mirror gate.
//
// Layout numbers here are load-bearing: src/sim/world.ts shapes the terrain
// from MIRROR_LAYOUT.

import type {
  CampDef,
  GroundObjectDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  PortalPadDef,
  QuestDef,
  ZoneDef,
  ZonePropsDef,
} from '../types';

// ---------------------------------------------------------------------------
// Shared layout constants — the single source for terrain + colliders + spawns
// ---------------------------------------------------------------------------

export const MIRROR_LAYOUT = {
  /** zone band */
  zMin: 900,
  zMax: 1260,
  /** sheer trench wall on the zone-3 seam; unlike inter-zone ridges it has NO
   * road pass and is too steep to climb (slope > PLAYER_MAX_CLIMB_SLOPE) */
  sealRidge: { z: 900, height: 48, sigma: 10 },
  /** THE VALE OF GLASS: everything walkable sits inside this mountain bowl.
   * The rim is a natural wall (slope ~1.7, unclimbable); beyond it there is
   * only highland lost in the night fog. No dome, no moat — mountains. */
  vale: { x: 0, z: 1085, rx: 150, rz: 138, rimHeight: 48 },
  valeFloor: 3,
  /** arrival overlook: a shelf high on the south wall. The Thornpeak mirror
   * lands here; one stone stair descends to the town — the vista frames the
   * whole vale on arrival. */
  overlook: { x: 0, z: 962, r: 15, h: 22 },
  stairs: { x: 0, zTop: 970, zBottom: 1004, halfWidth: 6, hTop: 22, hBottom: 8 },
  /** the town rise and the Mirror Court crescent at its north edge — all
   * three town mirrors stand together in stone niches, statues beside them */
  townRise: { x: -8, z: 1022, r: 30, h: 8 },
  court: { x: -8, z: 1055, r: 15, h: 9 },
  /** the Mirrormere — ONE real lake: fishable shoreline, swimmable middle */
  lake: { x: 62, z: 1088, r: 27, floor: -6.5 },
  /** graveyard knoll (NE) and the witch's hollow (NW) */
  knoll: { x: 96, z: 1148, r: 18, h: 10 },
  hollow: { x: -112, z: 1168, r: 14, h: 0.5 },
  /** Stargazer's Ledge: a lift-only vista pocket high on the south wall */
  ledge: { x: -52, z: 950, r: 10, h: 30 },
  /** hidden grotto pocket in the SE wall (clouded-mirror pair only) */
  grotto: { x: 146, z: 928, r: 9, h: 4 },
  /** the black canyon: a walkable stone floor between sheer walls, winding
   * through the NE rim to the Sable Mirror gate. The dread sentinels wait
   * along it. Walk-in from the loop road — no mirror needed. */
  canyon: {
    halfWidth: 5,
    points: [
      { x: 92, z: 1172 }, // mouth, off the loop road
      { x: 108, z: 1192 },
      { x: 126, z: 1204 },
      { x: 144, z: 1216 },
      { x: 158, z: 1228 }, // the Sable Mirror plinth
    ],
  },
} as const;

export const MIRROR_WORLD_ZONE: ZoneDef = {
  id: 'mirror_world',
  name: 'The Mirror World',
  biome: 'mirror',
  sideZone: true,
  zMin: MIRROR_LAYOUT.zMin,
  zMax: MIRROR_LAYOUT.zMax,
  levelRange: [15, 20],
  lakes: [{ x: 62, z: 1088, radius: 27 }], // the Mirrormere — the fishing water
  hub: { x: -8, z: 1022, radius: 30, name: 'the Lumen Hollow' },
  graveyard: { x: -30, z: 1004 },
  pois: [
    { x: -8, z: 1022, label: 'the Lumen Hollow' },
    { x: -8, z: 1055, label: 'the Mirror Court' },
    { x: 0, z: 962, label: 'the Overlook' },
    { x: 62, z: 1088, label: 'The Mirrormere' },
    { x: 108, z: 1096, label: 'the Moonmeadow' },
    { x: 96, z: 1148, label: 'the Sorrowstones' },
    { x: -72, z: 1140, label: 'the Gloomcrags' },
    { x: -76, z: 1084, label: 'the Darkwood' },
    { x: -112, z: 1168, label: "Witch's Hollow" },
    { x: -52, z: 950, label: "Stargazer's Ledge" },
    { x: 126, z: 1204, label: 'the Black Canyon' },
  ],
  welcome: 'The glass remembers you. Mind which side of it you walk.',
};

// Paths — the intended routes: plaza → stairs → market → crown, and the belt
// ring that threads every district through its berm gate. Roads render as
// worn track in the terrain splat and keep decorations off the walkway.
export const MIRROR_WORLD_ROADS: { x: number; z: number }[][] = [
  // the arrival stair: overlook -> town gate
  [
    { x: 0, z: 966 },
    { x: 0, z: 1004 },
    { x: -8, z: 1016 },
  ],
  // the loop road: town -> court -> lake south shore -> moonmeadow ->
  // graveyard knoll -> ruin field -> crags -> darkwood -> back to town
  [
    { x: -8, z: 1040 },
    { x: -8, z: 1052 },
    { x: 18, z: 1064 },
    { x: 38, z: 1058 },
    { x: 62, z: 1054 },
    { x: 88, z: 1066 },
    { x: 100, z: 1090 },
    { x: 100, z: 1120 },
    { x: 96, z: 1140 },
    { x: 76, z: 1160 },
    { x: 52, z: 1162 },
    { x: 20, z: 1150 },
    { x: -12, z: 1140 },
    { x: -40, z: 1130 },
    { x: -64, z: 1120 },
    { x: -80, z: 1100 },
    { x: -76, z: 1076 },
    { x: -56, z: 1052 },
    { x: -30, z: 1040 },
    { x: -8, z: 1040 },
  ],
  // the witch spur: crags corner -> the hollow
  [
    { x: -80, z: 1100 },
    { x: -96, z: 1128 },
    { x: -108, z: 1150 },
    { x: -112, z: 1164 },
  ],
  // the canyon spur: loop road -> the canyon mouth
  [
    { x: 76, z: 1160 },
    { x: 92, z: 1172 },
  ],
];

// ---------------------------------------------------------------------------
// Portal pads — every one a standing MIRROR (the renderer draws templateId
// 'portal_pad' as a framed mirror). Walk-in proximity teleports (see
// Sim.updatePortalPadTriggers). Pads come in pairs; every `dest` lands more
// than the trigger radius away from the reverse pad so a round trip never
// ping-pongs.
// ---------------------------------------------------------------------------

export const MIRROR_WORLD_PORTAL_PADS: PortalPadDef[] = [
  {
    id: 'mirrorgate_thornpeak',
    name: 'The Mirrorgate',
    pos: { x: 110, z: 800 }, // Stormcrag ridge, zone 3 — a mirror on a mountainside
    dest: { x: 0, z: 958 }, // the Overlook — the whole vale below you
  },
  // The Mirror Court: the three town mirrors stand together in stone niches,
  // each watched by its statue. Sealed until that statue's toll is paid.
  {
    id: 'mirrorgate_return',
    name: 'Mirror of Highwatch',
    pos: { x: -18, z: 1054 },
    dest: { x: 8, z: 652 }, // Highwatch town edge, zone 3
  },
  {
    id: 'mirrorgate_eastbrook',
    name: 'Mirror of Eastbrook',
    pos: { x: -8, z: 1058 },
    dest: { x: 3, z: 8 }, // Eastbrook town square, zone 1
  },
  {
    id: 'mirrorgate_fenbridge',
    name: 'Mirror of Fenbridge',
    pos: { x: 2, z: 1054 },
    dest: { x: 3, z: 306 }, // Fenbridge town center, zone 2
  },
  // the Lumen Lift: town gate <-> Stargazer's Ledge (the vista pocket)
  {
    id: 'lumen_lift_up',
    name: 'Lumen Lift',
    pos: { x: -24, z: 1034 },
    dest: { x: -52, z: 954 },
  },
  {
    id: 'lumen_lift_down',
    name: 'Lumen Lift',
    pos: { x: -52, z: 946 },
    dest: { x: -20, z: 1030 },
  },
  // the clouded pair: behind the Archive on the west loop, out to the grotto
  {
    id: 'archive_hidden_passage',
    name: 'Clouded Mirror',
    pos: { x: -60, z: 1048 },
    dest: { x: 146, z: 924 },
  },
  {
    id: 'grotto_return',
    name: 'Clouded Mirror',
    pos: { x: 146, z: 932 },
    dest: { x: -56, z: 1044 },
  },
  // The Sable Mirror: the sealed dungeon gate at the canyon's end.
  {
    id: 'black_mirror_gate',
    name: 'The Sable Mirror',
    pos: { x: 158, z: 1228 },
    dest: { x: 158, z: 1228 }, // nowhere: it never fires while sealed to all
  },
];

// Pads sealed unconditionally (no quest opens them yet).
export const PAD_LOCKED_ALL: ReadonlySet<string> = new Set(['black_mirror_gate']);

// ---------------------------------------------------------------------------
// Items — the witch's recipe parts (drop from the belt's beasts), her draught,
// and the once-ever Mirror Shard the Echo yields.
// ---------------------------------------------------------------------------

export const MIRROR_WORLD_ITEMS: Record<string, ItemDef> = {
  white_sheet: {
    id: 'white_sheet',
    name: 'White Sheet',
    kind: 'quest',
    quality: 'common',
    sellValue: 0,
  },
  spirit_horn: {
    id: 'spirit_horn',
    name: 'Spirit Horn',
    kind: 'quest',
    quality: 'common',
    sellValue: 0,
  },
  black_hood: {
    id: 'black_hood',
    name: 'Black Hood',
    kind: 'quest',
    quality: 'common',
    sellValue: 0,
  },
  // The Keeper's Vigil — Nerissa's Lumen Crown arc. Two quest tokens: a warden's
  // sigil the black glass tore loose onto the causeway reapers, and the Crown's
  // last spark the Gloaming Maw swallowed in the mere.
  warden_sigil: {
    id: 'warden_sigil',
    name: 'Warden Sigil',
    kind: 'quest',
    quality: 'common',
    sellValue: 0,
  },
  drowned_lumen: {
    id: 'drowned_lumen',
    name: 'Drowned Lumen',
    kind: 'quest',
    quality: 'common',
    sellValue: 0,
  },
  // Ghost-gear: the Echo's spoils — pale twins of honest equipment. Uncommon
  // by default, two scarce rares, nothing higher (no legendaries by design).
  ghostly_mirrorblade: {
    id: 'ghostly_mirrorblade',
    name: 'Ghostly Mirrorblade',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 17, max: 29, speed: 2.4 },
    stats: { str: 8, sta: 5 },
    sellValue: 420,
  },
  ghostly_shroudmantle: {
    id: 'ghostly_shroudmantle',
    name: 'Ghostly Shroudmantle',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'rare',
    stats: { armor: 28, int: 6, spi: 4 },
    sellValue: 380,
  },
  ghostly_wraithjerkin: {
    id: 'ghostly_wraithjerkin',
    name: 'Ghostly Wraithjerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 62, agi: 5, sta: 3 },
    sellValue: 260,
  },
  ghostly_palegrips: {
    id: 'ghostly_palegrips',
    name: 'Ghostly Palegrips',
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'uncommon',
    stats: { armor: 48, str: 4, sta: 2 },
    sellValue: 240,
  },
  ghostly_hushboots: {
    id: 'ghostly_hushboots',
    name: 'Ghostly Hushboots',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 24, spi: 3, int: 2 },
    sellValue: 230,
  },
  ghostly_glasscord: {
    id: 'ghostly_glasscord',
    name: 'Ghostly Glasscord',
    kind: 'armor',
    armorType: 'leather',
    slot: 'waist',
    quality: 'uncommon',
    stats: { armor: 34, agi: 4, sta: 2 },
    sellValue: 230,
  },
  // Drinking it starts the slumber sequence → the shadow-realm Echo duel
  // (Sim.useItem 'slumber' branch).
  deepdream_draught: {
    id: 'deepdream_draught',
    name: 'Deepdream Draught',
    kind: 'potion',
    quality: 'uncommon',
    use: { type: 'slumber' },
    sellValue: 0,
  },
  // Consumed for a permanent primary-stat increase (once ever — it only drops
  // from the first Echo you defeat).
  mirror_shard: {
    id: 'mirror_shard',
    name: 'Mirror Shard',
    kind: 'potion',
    quality: 'epic',
    use: { type: 'mirrorShard' },
    sellValue: 0,
  },
};

// ---------------------------------------------------------------------------
// Mobs — the belt's mirror-fauna (levels 15-18). The city terraces stay safe;
// these haunt the district wilds and drop the witch's recipe parts.
// ---------------------------------------------------------------------------

export const MIRROR_WORLD_MOBS: Record<string, MobTemplate> = {
  poverty_ghost: {
    id: 'poverty_ghost',
    name: 'Poverty Ghost',
    minLevel: 15,
    maxLevel: 15,
    family: 'undead',
    canSwim: true, // drifts over the Mistfen pools as easily as over ground
    hpBase: 48,
    hpPerLevel: 18,
    dmgBase: 9,
    dmgPerLevel: 2.2,
    attackSpeed: 1.9,
    armorPerLevel: 10,
    moveSpeed: 8,
    aggroRadius: 9,
    loot: [
      { copper: 55, chance: 1 },
      { itemId: 'white_sheet', chance: 0.85 },
    ],
    scale: 0.9,
    color: 0xe8e8f2,
  },
  // A spectral steed that grazes the gloom-meadows, horn alight.
  spirit_unicorn: {
    id: 'spirit_unicorn',
    name: 'Spirit Unicorn',
    minLevel: 15,
    maxLevel: 16,
    family: 'beast',
    canSwim: true,
    hpBase: 62,
    hpPerLevel: 22,
    dmgBase: 11,
    dmgPerLevel: 2.5,
    attackSpeed: 1.8,
    armorPerLevel: 12,
    moveSpeed: 8.5,
    aggroRadius: 11,
    // Spirit Gore: the horn leaves a wound that keeps burning cold.
    venom: {
      chance: 0.2,
      perTick: 4,
      interval: 3,
      duration: 9,
      name: 'Spirit Gore',
      school: 'nature',
    },
    loot: [
      { copper: 70, chance: 1 },
      { itemId: 'spirit_horn', chance: 0.75 },
    ],
    scale: 1.0,
    color: 0xd8e8ff,
  },
  hooded_reaper: {
    id: 'hooded_reaper',
    name: 'Reaper',
    minLevel: 15,
    maxLevel: 16,
    family: 'undead',
    canSwim: true,
    hpBase: 74,
    hpPerLevel: 24,
    dmgBase: 10,
    dmgPerLevel: 2.4,
    attackSpeed: 2.4,
    armorPerLevel: 26, // robes woven of night: notably tougher hide than its level
    moveSpeed: 7,
    aggroRadius: 10,
    loot: [
      { copper: 85, chance: 1 },
      { itemId: 'black_hood', chance: 0.75 },
      // the black glass has spread from the wardens to the reapers that swarm the
      // causeway; they carry the sigils torn loose (quest: q_the_wardens_names)
      { itemId: 'warden_sigil', chance: 0.5 },
    ],
    scale: 1.05,
    color: 0x1a1622,
  },
  mistshade_lurker: {
    id: 'mistshade_lurker',
    name: 'Mistshade Lurker',
    minLevel: 16,
    maxLevel: 17,
    family: 'undead',
    hpBase: 70,
    hpPerLevel: 23,
    dmgBase: 12,
    dmgPerLevel: 2.6,
    attackSpeed: 2.0,
    armorPerLevel: 14,
    moveSpeed: 8,
    aggroRadius: 12,
    loot: [
      { copper: 95, chance: 1 },
      { itemId: 'linen_scrap', chance: 0.4 },
    ],
    scale: 1.0,
    color: 0x3c4452,
  },
  // Rare of the mere: something vast that lives under the still black water.
  // Same reuse-only recipe as Old Cragmaw (zone 3): existing mechanics, long
  // respawn, elite+rare flags.
  gloaming_maw: {
    id: 'gloaming_maw',
    name: 'The Gloaming Maw',
    minLevel: 18,
    maxLevel: 18,
    family: 'demon',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 7.2,
    hpBase: 340,
    hpPerLevel: 58,
    dmgBase: 15,
    dmgPerLevel: 2.8,
    attackSpeed: 2.6,
    armorPerLevel: 20,
    moveSpeed: 8.5,
    aggroRadius: 14,
    aoePulse: { min: 14, max: 20, radius: 10, every: 9, name: 'Gloaming' },
    // the Crown's last true spark, swallowed when it fell in the mere — this is
    // why it glows from the inside (quest: q_relight_the_lumen_crown)
    loot: [
      { copper: 2200, chance: 1 },
      { itemId: 'drowned_lumen', chance: 1 },
    ],
    scale: 1.45,
    color: 0x241f38,
  },
  // The shadow-realm duelist. This template is only a registry anchor (name,
  // family, kill-quest credit): every real stat is overwritten at spawn with a
  // clone of the dreaming player's own numbers (Sim dream machinery). It never
  // spawns from a camp and drops nothing — the Mirror Shard grant is code-side
  // and once-ever.
  player_echo: {
    id: 'player_echo',
    name: 'Echo',
    minLevel: 15,
    maxLevel: 20,
    family: 'humanoid',
    ccImmune: true,
    hpBase: 100,
    hpPerLevel: 20,
    dmgBase: 10,
    dmgPerLevel: 2.5,
    attackSpeed: 2.0,
    armorPerLevel: 15,
    moveSpeed: 8,
    aggroRadius: 40,
    // Normal humanoid drops for the level band. Only rolled by the dream win
    // branch AFTER q_face_your_echo is done (the quest's own xp/gold pay once;
    // the first win pays the Mirror Shard instead of a purse).
    // One exclusive ghost-gear draw per win (~58% something, rares scarce),
    // plus a purse and a consumable sprinkle. No legendaries, ever.
    loot: [
      { copper: 320, chance: 1 },
      { itemId: 'lesser_healing_potion', chance: 0.3 },
      { itemId: 'ghostly_mirrorblade', chance: 0.05, rollGroup: 'ghostgear' },
      { itemId: 'ghostly_shroudmantle', chance: 0.05, rollGroup: 'ghostgear' },
      { itemId: 'ghostly_wraithjerkin', chance: 0.12, rollGroup: 'ghostgear' },
      { itemId: 'ghostly_palegrips', chance: 0.12, rollGroup: 'ghostgear' },
      { itemId: 'ghostly_hushboots', chance: 0.12, rollGroup: 'ghostgear' },
      { itemId: 'ghostly_glasscord', chance: 0.12, rollGroup: 'ghostgear' },
    ],
    scale: 1.0,
    color: 0x241d33,
  },
  gloomhulk: {
    id: 'gloomhulk',
    name: 'Gloomhulk',
    minLevel: 16,
    maxLevel: 17,
    family: 'ogre',
    hpBase: 120,
    hpPerLevel: 30,
    dmgBase: 13,
    dmgPerLevel: 2.7,
    attackSpeed: 2.8,
    armorPerLevel: 16,
    moveSpeed: 7,
    aggroRadius: 11,
    rampage: { ap: 4, maxStacks: 5, duration: 8, name: 'Mounting Gloom' },
    loot: [{ copper: 120, chance: 1 }],
    scale: 1.2,
    color: 0x3a3648,
  },
  mirrorbound_sentry: {
    id: 'mirrorbound_sentry',
    name: 'Mirrorbound Sentry',
    minLevel: 15,
    maxLevel: 16,
    family: 'undead',
    hpBase: 80,
    hpPerLevel: 24,
    dmgBase: 11,
    dmgPerLevel: 2.5,
    attackSpeed: 2.2,
    armorPerLevel: 20,
    moveSpeed: 8,
    aggroRadius: 12,
    cleave: { radius: 5, mult: 0.5, name: 'Glass Sweep' },
    loot: [{ copper: 95, chance: 1 }],
    scale: 1.05,
    color: 0x8a93b8,
  },
  voidfang_stalker: {
    id: 'voidfang_stalker',
    name: 'Palefang Stalker',
    minLevel: 15,
    maxLevel: 15,
    family: 'beast',
    hpBase: 52,
    hpPerLevel: 18,
    dmgBase: 10,
    dmgPerLevel: 2.4,
    attackSpeed: 1.6,
    armorPerLevel: 10,
    moveSpeed: 9.5,
    aggroRadius: 13,
    bleed: { chance: 0.25, perTick: 3, interval: 2, duration: 8, name: 'Palefang Rake' },
    loot: [{ copper: 70, chance: 1 }],
    scale: 0.95,
    color: 0x241f38,
  },
  // The mirror-guardians. Sentinels stand as NPCs beside the three town
  // mirrors; challenging one (gossip "Attack") swaps the statue for this — a
  // skull-level horror with the full boss toolkit. Waking it is voluntary.
  gargoyle_awakened: {
    id: 'gargoyle_awakened',
    name: 'Gargoyle Sentinel',
    minLevel: 99,
    maxLevel: 99,
    family: 'elemental',
    boss: true,
    ccImmune: true,
    hpBase: 4000,
    hpPerLevel: 560,
    dmgBase: 30,
    dmgPerLevel: 1.9,
    attackSpeed: 2.4,
    armorPerLevel: 20,
    moveSpeed: 9,
    aggroRadius: 12,
    stomp: { radius: 8, every: 14, duration: 2, min: 60, max: 90, name: 'Granite Stomp' },
    aoePulse: { min: 45, max: 70, radius: 11, every: 8, name: 'Stonewing Squall', fx: 'nova' },
    stoneskin: { amount: 900, every: 20, duration: 8, name: 'Stoneskin' },
    terrify: { radius: 10, every: 18, duration: 3, name: 'Petrifying Screech', school: 'shadow' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.5, hasteMult: 1.3 },
    cleave: { radius: 5, mult: 0.6, name: 'Wing Sweep' },
    loot: [
      { copper: 9000, chance: 1 },
      { itemId: 'healing_potion', chance: 0.8 },
    ],
    scale: 1.5,
    color: 0x8f8fa0,
  },
};

// Camps sit on wading rims and dry banks, never in swim-deep water: the engine
// never SPAWNS a mob below wading depth (findSafePos floors swimmers at
// WATER_LEVEL - 0.5 — see tests/fixes.test.ts "mobs spawn out of deep water").
// The beasts still swim: they wander and chase into the mere freely.
export const MIRROR_WORLD_CAMPS: CampDef[] = [
  // clockwise from town, harder the further you walk; every camp sits off the
  // loop road so travelers do not get pulled from the walkway. Counts ~1.5x and
  // wider scatter radii so the vale reads populated but SPREAD, not clumped.
  { mobId: 'poverty_ghost', center: { x: 44, z: 1076 }, radius: 8, count: 5 },
  { mobId: 'poverty_ghost', center: { x: 74, z: 1062 }, radius: 8, count: 5 },
  { mobId: 'spirit_unicorn', center: { x: 114, z: 1100 }, radius: 9, count: 5 },
  { mobId: 'hooded_reaper', center: { x: 100, z: 1150 }, radius: 8, count: 5 },
  { mobId: 'mirrorbound_sentry', center: { x: 46, z: 1180 }, radius: 8, count: 5 },
  { mobId: 'gloomhulk', center: { x: -72, z: 1142 }, radius: 8, count: 3 },
  { mobId: 'mistshade_lurker', center: { x: -84, z: 1088 }, radius: 8, count: 5 },
  { mobId: 'voidfang_stalker', center: { x: -44, z: 1104 }, radius: 8, count: 5 },
  // the rare prowls the lake's deep north inlet (stays a lone elite)
  { mobId: 'gloaming_maw', center: { x: 74, z: 1114 }, radius: 5, count: 1 },
];

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------

export const MIRROR_WORLD_NPCS: Record<string, NpcDef> = {
  keeper_nerissa: {
    id: 'keeper_nerissa',
    name: 'Nerissa the Unresting',
    title: 'Ghost-Keeper of the Lumen Crown',
    pos: { x: -12, z: 1016 },
    facing: 2.6,
    color: 0xbfe4f2,
    questIds: [
      'q_the_failing_radiance',
      'q_what_the_poor_keep',
      'q_the_wardens_names',
      'q_relight_the_lumen_crown',
    ],
    greeting:
      'I kept the Lumen Crown in life, and the Crown keeps the glass honest - every mirror in this vale shows a true thing, save one. Death has not excused me from the post, $N, because that one is not done pressing. The light of the Crown is failing, and where it fails, the vale bleeds through. Mind which side of the glass you walk. Lately it has trouble telling.',
  },
  veilwright_ollo: {
    id: 'veilwright_ollo',
    name: 'Veilwright Ollo',
    title: 'Shroud-Market Trader',
    pos: { x: 0, z: 1028 },
    facing: 1.4,
    color: 0x4a4066,
    questIds: [],
    vendorItems: ['healing_potion', 'mana_potion'],
    greeting:
      "Dead men's coats, bottled sighs, honest prices - the veil provides. Everything on my table was set down by someone who owns nothing now; the trick is telling what the dead are DONE with from what they still clutch. Get it wrong and they come to the stall at midnight. Ask the Keeper about the light in the well, if you want the sad version. I only sell the coats.",
  },
  // One colossal statue beside each town mirror. Gossip offers "Bow down" (a
  // courtesy that stirs it — the statue shimmers and its toll-quest opens) or
  // "Attack" (swaps the statue for the level-99 gargoyle_awakened — see
  // Sim.wakeGargoyle). Its mirror stays sealed until its quest is done.
  gargoyle_sentinel_south: {
    id: 'gargoyle_sentinel_south',
    name: 'Gargoyle Statue',
    title: 'Guardian of the Mirror',
    // directly behind its mirror (mirrorgate_return, -18,1054), facing south
    // over it toward the visitor climbing up from the town
    pos: { x: -18, z: 1061 },
    facing: Math.PI,
    color: 0x8f8fa0,
    questIds: ['q_gargoyle_south'],
    greeting: 'Weathered stone, crouched and waiting. It does not move. It is listening.',
  },
  gargoyle_sentinel_west: {
    id: 'gargoyle_sentinel_west',
    name: 'Gargoyle Statue',
    title: 'Guardian of the Mirror',
    // directly behind its mirror (mirrorgate_eastbrook, -8,1058), facing south
    pos: { x: -8, z: 1064 },
    facing: Math.PI,
    color: 0x8f8fa0,
    questIds: ['q_gargoyle_west'],
    greeting: 'Weathered stone, crouched and waiting. It does not move. It is listening.',
  },
  gargoyle_sentinel_north: {
    id: 'gargoyle_sentinel_north',
    name: 'Gargoyle Statue',
    title: 'Guardian of the Mirror',
    // directly behind its mirror (mirrorgate_fenbridge, 2,1054), facing south
    pos: { x: 2, z: 1061 },
    facing: Math.PI,
    color: 0x8f8fa0,
    questIds: ['q_gargoyle_north'],
    greeting: 'Weathered stone, crouched and waiting. It does not move. It is listening.',
  },
  // The dread sentinels of the Black Mirror causeway. No courtesy moves them
  // and no toll opens their gate — they only warn, and they only wake to kill.
  dread_sentinel_a: {
    id: 'dread_sentinel_a',
    name: 'Dread Sentinel',
    title: 'Warden of the Sable Mirror',
    // flank the canyon floor (off its centre so they don't block it) and face
    // back down toward the mouth (92,1172) where intruders climb in
    pos: { x: 106, z: 1194 },
    facing: Math.atan2(92 - 106, 1172 - 1194),
    color: 0x4a4a58,
    questIds: [],
    greeting: 'Your death awaits.',
  },
  dread_sentinel_b: {
    id: 'dread_sentinel_b',
    name: 'Dread Sentinel',
    title: 'Warden of the Sable Mirror',
    pos: { x: 128, z: 1202 },
    facing: Math.atan2(92 - 128, 1172 - 1202),
    color: 0x4a4a58,
    questIds: [],
    greeting: 'We held the causeway in life. We hold it still.',
  },
  dread_sentinel_c: {
    id: 'dread_sentinel_c',
    name: 'Dread Sentinel',
    title: 'Warden of the Sable Mirror',
    pos: { x: 142, z: 1218 },
    facing: Math.atan2(92 - 142, 1172 - 1218),
    color: 0x4a4a58,
    questIds: [],
    greeting: 'Turn back. The black glass is not for the living - nor was it ever for us.',
  },
  mistwitch_morwen: {
    id: 'mistwitch_morwen',
    name: 'Morwen the Mistwitch',
    title: 'Dreambrewer of the Hollow',
    pos: { x: -112, z: 1166 },
    facing: 0.9,
    color: 0x7a5f9e,
    questIds: ['q_deepdream_recipe', 'q_face_your_echo', 'q_what_the_glass_wants'],
    greeting:
      'The mist keeps most of you awake. I can brew you the other kind of sleep — the kind that answers back.',
  },
};

// ---------------------------------------------------------------------------
// Quests — the witch's chain. The first brew is the quest reward; after that,
// bring her the same parts again and she brews on demand (Sim.brewDraught,
// gated on q_deepdream_recipe being done). The Mirror Shard only ever drops
// from your FIRST defeated Echo.
// ---------------------------------------------------------------------------

export const MIRROR_WORLD_QUESTS: Record<string, QuestDef> = {
  // The gargoyle tolls. Each statue opens its quest only after a bow (the
  // gossip courtesy sets meta.bowedGargoyles; availability is gated on it).
  // Completing a toll unseals that statue's town mirror (PAD_QUEST_LOCKS).
  q_gargoyle_south: {
    id: 'q_gargoyle_south',
    name: "The Keeper's Toll",
    giverNpcId: 'gargoyle_sentinel_south',
    turnInNpcId: 'gargoyle_sentinel_south',
    requiresBow: true,
    text: 'The shimmer resolves into words behind your eyes: the reapers crowd my glass, $N. Thin them, and the way to Highwatch is yours.',
    completionText:
      'The stone hums once, satisfied. Behind it, the mirror clears like a held breath let go.',
    objectives: [{ type: 'kill', targetMobId: 'hooded_reaper', count: 6, label: 'Reaper culled' }],
    xpReward: 700,
    copperReward: 900,
    itemRewards: {},
  },
  q_gargoyle_west: {
    id: 'q_gargoyle_west',
    name: 'A Toll of Sheets',
    giverNpcId: 'gargoyle_sentinel_west',
    turnInNpcId: 'gargoyle_sentinel_west',
    requiresBow: true,
    text: 'The shimmer resolves into words behind your eyes: bring me four white sheets off the poor dead, $N. The road to Eastbrook opens for those who pay in cloth.',
    completionText:
      'The sheets sink into the stone and are gone. The mirror behind it wakes with light.',
    objectives: [{ type: 'collect', itemId: 'white_sheet', count: 4, label: 'White Sheet' }],
    xpReward: 700,
    copperReward: 900,
    itemRewards: {},
  },
  q_gargoyle_north: {
    id: 'q_gargoyle_north',
    name: 'Radiance Culled',
    giverNpcId: 'gargoyle_sentinel_north',
    turnInNpcId: 'gargoyle_sentinel_north',
    requiresBow: true,
    text: 'The shimmer resolves into words behind your eyes: the spirit herds burn too bright for the glass, $N. Cull five, and Fenbridge is a step away.',
    completionText:
      'The stone drinks the light you spilled. The mirror behind it opens like an eye.',
    objectives: [
      { type: 'kill', targetMobId: 'spirit_unicorn', count: 5, label: 'Spirit Unicorn culled' },
    ],
    xpReward: 700,
    copperReward: 900,
    itemRewards: {},
  },
  q_deepdream_recipe: {
    id: 'q_deepdream_recipe',
    name: 'A Recipe for Deep Sleep',
    giverNpcId: 'mistwitch_morwen',
    turnInNpcId: 'mistwitch_morwen',
    text: 'The draught wants three voices, $N: two white sheets off the poverty ghosts who own nothing else, two horns of the spirit unicorns that graze the gloom, and two hoods cut from the reapers who watch the belt. Bring them and I will brew you a sleep with teeth.',
    completionText:
      'Sheet, horn, hood — the poor, the radiant, the patient. The kettle likes you. Drink it somewhere soft, wanderer: you will meet whoever you have been carrying.',
    objectives: [
      { type: 'collect', itemId: 'white_sheet', count: 2, label: 'White Sheet' },
      { type: 'collect', itemId: 'spirit_horn', count: 2, label: 'Spirit Horn' },
      { type: 'collect', itemId: 'black_hood', count: 2, label: 'Black Hood' },
    ],
    xpReward: 900,
    copperReward: 1500,
    itemRewards: {
      warrior: 'deepdream_draught',
      rogue: 'deepdream_draught',
      mage: 'deepdream_draught',
    },
  },
  q_face_your_echo: {
    id: 'q_face_your_echo',
    name: 'Face Your Echo',
    giverNpcId: 'mistwitch_morwen',
    turnInNpcId: 'mistwitch_morwen',
    requiresQuest: 'q_deepdream_recipe',
    text: 'Drink the draught and the dream will set a mirror before you — your Echo, every scar and every trick of yours on the other side of it. Beat what you are, $N, and bring me back the look on your face.',
    completionText:
      'You came back, and the mirror did not. Whatever it left in your hand is yours — the dream only pays that price once.',
    objectives: [
      { type: 'kill', targetMobId: 'player_echo', count: 1, label: 'Your Echo defeated' },
    ],
    xpReward: 1400,
    copperReward: 2500,
    itemRewards: {},
  },

  // ---- The Keeper's Vigil — Nerissa and the Lumen Crown ------------------
  // Why the vale is a mirror/dream world: the Lumen Crown is the light in every
  // mirror that keeps the seam between the living world and its reflection whole.
  // King Nythraxis's iron/deathless crown (broken by the player in Thornpeak,
  // zone 3) was its opposite; its rising dimmed the Lumen light and softened the
  // vale into a dream, and Nerissa died at her post unable to leave. Now the iron
  // crown is broken, the Crown can be relit one last time so she can rest. The
  // Sable Mirror is the wound it tore — the arc SHORES it, leaves it sealed.
  q_the_failing_radiance: {
    id: 'q_the_failing_radiance',
    name: 'The Failing Radiance',
    giverNpcId: 'keeper_nerissa',
    turnInNpcId: 'keeper_nerissa',
    text: "You feel the cold of me and think I am a story. I am a post, $N. The Lumen Crown I kept is no gold circlet — it is the light in every mirror here, the seam that holds the living and the dead in separate reflections so neither drowns the other. That light is failing, and you can see it in the Mirrorbound Sentries: once they were the Crown's own radiance walking guard, now they are glass full of stolen light, crowding the north ruins because the seam no longer tells them where to stand. Break eight. Each shard you scatter is a little light returned — and a little proof you can be trusted with the rest.",
    completionText:
      'The shards drift back toward the well like snow falling upward, and for one breath the whole vale is a shade brighter. It will not last. But you mend seams instead of cutting them, $N — that is rarer here than you would think. You broke the OTHER crown too, did you not — the iron one, beneath Thornpeak. Then for the first time in three hundred years, this light might come back. Stay. The vale has been waiting for hands that close wounds.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'mirrorbound_sentry',
        count: 8,
        label: 'Mirrorbound Sentry shattered',
      },
    ],
    xpReward: 800,
    copperReward: 900,
    itemRewards: {},
  },
  q_what_the_poor_keep: {
    id: 'q_what_the_poor_keep',
    name: 'What the Poor Still Keep',
    giverNpcId: 'keeper_nerissa',
    turnInNpcId: 'keeper_nerissa',
    requiresQuest: 'q_the_failing_radiance',
    text: "The Poverty Ghosts on the south shore owned nothing in life, $N — nothing but the sheet they were buried in, because the parish could spare no coffin. Now the Crown's light is too thin to loose their grip, so they wander clutching the one thing that was ever theirs. Do not think this cruelty; it is love with nowhere to put itself. Bring me five of their sheets. I will lay each in the well and speak the name that was too poor to be carved. That is the whole of the rite: to be poor, and dead, and still called by name.",
    completionText:
      'Five sheets, five names. I say them into the well and the water takes them the way a mother lifts a coat off a sleeping child. The ghosts on the shore are fewer tonight, $N — not slain, released. This is what the Crown did when it was whole: it held the dead close enough to let them go. We do it by hand now, you and I, five names at a time. It is slower. It is not nothing.',
    objectives: [{ type: 'collect', itemId: 'white_sheet', count: 5, label: 'White Sheet' }],
    xpReward: 900,
    copperReward: 1100,
    itemRewards: {},
  },
  q_the_wardens_names: {
    id: 'q_the_wardens_names',
    name: "The Wardens' Names",
    giverNpcId: 'keeper_nerissa',
    turnInNpcId: 'keeper_nerissa',
    requiresQuest: 'q_what_the_poor_keep',
    text: "The three that pace the Black Canyon are called Dread Sentinels by those who flee them. I called them by name once — they were my order, $N, the last men to hold the Sable Mirror's causeway in life, and they never stood down, not even when their hearts did. No blade frees them now; the black glass rides them too deep to fall. But that glass has crept from the wardens into the reapers that swarm the causeway, and over the long years the reapers have torn the wardens' sigils loose. Bring me three, cut from the reapers at the canyon, so I may say the three names aloud one final time.",
    completionText:
      'Corwin. Aldous. Brenna. There — said, and the saying is lighter than the holding ever was. They can stop soon; I will see to it. But mind what draws near, $N: the sigils torn loose mean the glass on that causeway is thinning, and the wound at its end has been waiting exactly this long. I must relight the Crown and shore the Sable before something on the far side notices the door is going bare. There is one last thing I need — and it is under the black water.',
    objectives: [{ type: 'collect', itemId: 'warden_sigil', count: 3, label: 'Warden Sigil' }],
    xpReward: 1100,
    copperReward: 1400,
    itemRewards: {},
  },
  q_what_the_glass_wants: {
    id: 'q_what_the_glass_wants',
    name: 'What the Glass Wants',
    giverNpcId: 'mistwitch_morwen',
    turnInNpcId: 'mistwitch_morwen',
    requiresQuest: 'q_face_your_echo',
    text: "You beat your Echo and thought it a trial of self, $N. It was not. I brew the Deepdream from sheet and horn and hood — but the thing your dream set a mirror against, the thing that walked in wearing your face, that I do not brew. It leaks in, from the black glass in the canyon. The reapers crowding the canyon mouth are thick with the same leak; cull eight of them and mark which way their shadows crawl. Then I will show Nerissa's own eyes where her wound truly weeps.",
    completionText:
      'Northeast. Always northeast, always toward the Sable — did you mark it? Your Echo was not YOU, wanderer. It was a splinter of whatever lives behind that gate, dressed in the nearest reflection it could steal: yours. The dream is only the thinnest place the leak has found; the canyon is the widest. Tell Nerissa. She has earned the truth of it, and so have you.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'hooded_reaper',
        count: 8,
        label: 'Reaper culled at the canyon mouth',
      },
    ],
    xpReward: 1200,
    copperReward: 1800,
    itemRewards: {},
  },
  q_relight_the_lumen_crown: {
    id: 'q_relight_the_lumen_crown',
    name: 'Relight the Lumen Crown',
    giverNpcId: 'keeper_nerissa',
    turnInNpcId: 'keeper_nerissa',
    requiresQuest: 'q_the_wardens_names',
    text: "The wardens are named and the causeway thins, so I must do now what I have put off since I died: light the Lumen Crown one last time and press the Sable shut from this side. The Crown's last true spark was swallowed by the Gloaming Maw when it fell in the mere — that is why the thing glows from the inside. Cut the light back out of it, $N. The black glass will send its gloomhulks to stop the rite; put four of them down. Bring me a drowned spark while I still remember how to hold one. A keeper's last duty is to become someone who no longer needs to keep.",
    completionText:
      'It burns. After all this dark it still knows my hand. Look — the glass is TRUE again: no heartbeat behind the water, no soul lost between a world and its reflection. And the weight is off me at last. I am not vanishing, $N; I am being RELIEVED. This is not the breaking of the Sable — only the holding of it; I have not the strength to break what waits there, and I would not dare. But held one more age, it is held. When some braver company than us finally walks INTO that gate, they will find the far side ready. Tell them in Highwatch that their keeper stood the vigil to the end, and then was let go. The glass will remember you. See that you give it something worth reflecting.',
    objectives: [
      { type: 'kill', targetMobId: 'gloaming_maw', count: 1, label: 'The Gloaming Maw slain' },
      { type: 'collect', itemId: 'drowned_lumen', count: 1, label: 'Drowned Lumen' },
      { type: 'kill', targetMobId: 'gloomhulk', count: 4, label: 'Gloomhulk broken' },
    ],
    xpReward: 1500,
    copperReward: 2200,
    itemRewards: {
      warrior: 'ghostly_wraithjerkin',
      rogue: 'ghostly_glasscord',
      mage: 'ghostly_hushboots',
    },
  },
};

export const MIRROR_WORLD_QUEST_ORDER: string[] = [
  // Nerissa's Keeper's Vigil spine first (the vale's narrative through-line),
  // then Morwen's Deepdream chain + its Echo side-branch, then the gargoyle tolls.
  'q_the_failing_radiance',
  'q_what_the_poor_keep',
  'q_the_wardens_names',
  'q_relight_the_lumen_crown',
  'q_deepdream_recipe',
  'q_face_your_echo',
  'q_what_the_glass_wants',
  'q_gargoyle_south',
  'q_gargoyle_west',
  'q_gargoyle_north',
];

// Town mirrors stay dark until their statue's toll is paid. The walk-in
// trigger (Sim.updatePortalPadTriggers) refuses locked pads; the client draws
// a locked pad as dead glass and lights it on the mirrorUnlocked event.
export const PAD_QUEST_LOCKS: Record<string, string> = {
  mirrorgate_return: 'q_gargoyle_south',
  mirrorgate_eastbrook: 'q_gargoyle_west',
  mirrorgate_fenbridge: 'q_gargoyle_north',
};

// No collectible sparkle objects in this slice.
export const MIRROR_WORLD_OBJECTS: GroundObjectDef[] = [];

// ---------------------------------------------------------------------------
// Props. Positions respect the layout: crown r < 20 (around 0,1080), market
// terrace r 20-45, the belt r 47-147 split into districts. The single `domes`
// entry is the glass: colliders.ts turns it into a sealed wall ring (no gaps —
// the grotto island outside is mirror-only).
// ---------------------------------------------------------------------------

export const MIRROR_WORLD_PROPS: ZonePropsDef = {
  buildings: [
    // the Lumen Hollow — the town on the rise
    { kind: 'inn', x: -18, z: 1012, w: 10, d: 8, rot: 0.35 },
    { kind: 'house', x: -2, z: 1010, w: 7, d: 6, rot: -0.5 },
    { kind: 'house', x: -20, z: 1030, w: 7, d: 6, rot: 1.1 },
    { kind: 'house', x: 4, z: 1034, w: 7, d: 6, rot: 2.5 },
    // the Silent Archive keeps its clouded secret on the west loop
    { kind: 'chapel', x: -58, z: 1042, w: 9, d: 7, rot: 2.1 },
  ],
  wells: [{ x: -8, z: 1022, r: 1.6 }], // the Lumen Well, heart of the town
  stalls: [
    { x: 2, z: 1024, rot: 0.8, r: 2.2 },
    { x: -4, z: 1030, rot: -0.7, r: 2.2 },
  ],
  mines: [],
  docks: [],
  tents: [],
  crates: [
    [-14, 1008],
    [6, 1030],
    [90, 1156],
  ],
  campfires: [
    [-8, 1016], // the town square
    [2, 956], // the Overlook brazier
    [88, 1154], // the graveyard spur
    [-108, 1160], // the witch's porch
  ],
  mudHuts: [],
  ruinRings: [
    { x: 46, z: 1178, ringR: 7, columns: 6 }, // the north ruin field
    { x: 56, z: 1170, ringR: 5, columns: 4 },
  ],
  fences: [],
  graveyards: [
    { x: 96, z: 1146 }, // the Sorrowstones
    { x: 102, z: 1152 },
  ],
  domes: [], // the dome is gone — the vale's mountain rim does the sealing
};
