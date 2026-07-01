// The Southern Contested Territories (levels 28-50): the five-band no man's
// land between the three powers. Nobody governs here; everybody claims to.
// South to north: the cave-riddled Grey Hollows, the moving woodland of the
// Thornfen Border, the trade artery of Ironpass Crossing, the fog-drowned
// Emberveil Marshes, and Pale Crossing, where an ancient bridge spans a river
// no faction ever dared to name.
//
// Structure follows the ossara.ts exemplar; this module exports one combined
// set (zones, roads, mobs, npcs, camps, items, props) merged by
// content/valdris/index.ts. No quests live here: the contested strip is
// deliberately thin on friendly faces.

import type {
  CampDef,
  GroundObjectDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  QuestDef,
  ZoneDef,
  ZonePropsDef,
} from '../../types';

// ---------------------------------------------------------------------------
// Zones (strip order, south to north)
// ---------------------------------------------------------------------------

export const CONTESTED_SOUTH_ZONES: ZoneDef[] = [
  {
    id: 'grey_hollows',
    name: 'Grey Hollows',
    zMin: 2070,
    zMax: 2250,
    levelRange: [28, 45],
    biome: 'highlands',
    hub: { x: -30, z: 2115, radius: 13, name: 'The Underway Rest' },
    graveyard: { x: -42, z: 2103 },
    lakes: [],
    pois: [
      { x: -30, z: 2115, label: 'The Underway Rest' },
      { x: 0, z: 2090, label: 'The Old South Road' },
      { x: 55, z: 2100, label: 'Sunken Mouths' },
      { x: -50, z: 2175, label: 'The Gnaw Warrens' },
      { x: -90, z: 2215, label: 'Shale Gallery' },
      { x: 120, z: 2225, label: 'Smugglers Spoil' },
    ],
    welcome: 'Half of the Grey Hollows is underfoot, and none of it is empty.',
  },
  {
    id: 'thornfen_border',
    name: 'Thornfen Border',
    zMin: 2250,
    zMax: 2430,
    levelRange: [30, 46],
    biome: 'shadowwood',
    hub: { x: 25, z: 2295, radius: 13, name: 'Wardens Palisade' },
    graveyard: { x: 38, z: 2285 },
    lakes: [],
    pois: [
      { x: 25, z: 2295, label: 'Wardens Palisade' },
      { x: -55, z: 2270, label: 'Creeper Hollows' },
      { x: -80, z: 2320, label: 'The Moving Wood' },
      { x: 85, z: 2375, label: 'Troll Fen' },
      { x: -70, z: 2405, label: 'Briarheart Thicket' },
    ],
    welcome: 'The wardens mark the trees every night; by morning the marks have moved.',
  },
  {
    id: 'ironpass_crossing',
    name: 'Ironpass Crossing',
    zMin: 2430,
    zMax: 2610,
    levelRange: [30, 50],
    biome: 'peaks',
    hub: { x: -20, z: 2475, radius: 13, name: 'The Tollhouse' },
    graveyard: { x: -34, z: 2463 },
    lakes: [],
    pois: [
      { x: -20, z: 2475, label: 'The Tollhouse' },
      { x: 0, z: 2445, label: 'The Banner Road' },
      { x: 55, z: 2460, label: 'Raider Bluffs' },
      { x: 75, z: 2515, label: 'The Ogre Toll' },
      { x: -95, z: 2550, label: 'Cragfall Slopes' },
      { x: 95, z: 2590, label: 'Wyvern Eyries' },
    ],
    welcome: 'Every banner on the pass claims the road; the Tollhouse just charges them all.',
  },
  {
    id: 'emberveil_marshes',
    name: 'Emberveil Marshes',
    zMin: 2610,
    zMax: 2790,
    levelRange: [32, 48],
    biome: 'marsh',
    hub: { x: 30, z: 2655, radius: 13, name: 'Lanternfen Stilts' },
    graveyard: { x: 44, z: 2645 },
    lakes: [
      { x: -60, z: 2700, radius: 12 },
      { x: 70, z: 2740, radius: 10 },
    ],
    pois: [
      { x: 30, z: 2655, label: 'Lanternfen Stilts' },
      { x: -55, z: 2630, label: 'Bloatwater Shallows' },
      { x: -60, z: 2700, label: 'The Steaming Pools' },
      { x: 40, z: 2725, label: 'Silkstrand Mire' },
      { x: -65, z: 2760, label: 'The Fogwall' },
    ],
    welcome: 'The fog over Emberveil has never lifted; bring your own light.',
  },
  {
    id: 'pale_crossing',
    name: 'Pale Crossing',
    zMin: 2790,
    zMax: 2970,
    levelRange: [34, 50],
    biome: 'vale',
    hub: { x: -25, z: 2835, radius: 13, name: 'Bridgewatch' },
    graveyard: { x: -38, z: 2823 },
    lakes: [
      { x: -45, z: 2880, radius: 16 },
      { x: 45, z: 2880, radius: 16 },
    ],
    pois: [
      { x: -25, z: 2835, label: 'Bridgewatch' },
      { x: -90, z: 2815, label: 'The Kneeling Stones' },
      { x: 0, z: 2880, label: 'The Pale Bridge' },
      { x: -80, z: 2915, label: 'Drowned Banks' },
      { x: 90, z: 2950, label: 'Gullwatch Rise' },
    ],
    welcome: 'Every faction claims it built the Pale Bridge; the bridge has never agreed.',
  },
];

// ---------------------------------------------------------------------------
// Roads: the x=0 spine runs the whole contested strip in per-zone segments,
// with short spokes to each hub and one flavor landmark per zone.
// ---------------------------------------------------------------------------

export const CONTESTED_SOUTH_ROADS: { x: number; z: number }[][] = [
  [
    { x: 0, z: 2070 },
    { x: 0, z: 2160 },
    { x: 0, z: 2250 },
  ], // Grey Hollows spine
  [
    { x: 0, z: 2250 },
    { x: 0, z: 2340 },
    { x: 0, z: 2430 },
  ], // Thornfen Border spine
  [
    { x: 0, z: 2430 },
    { x: 0, z: 2520 },
    { x: 0, z: 2610 },
  ], // Ironpass Crossing spine
  [
    { x: 0, z: 2610 },
    { x: 0, z: 2700 },
    { x: 0, z: 2790 },
  ], // Emberveil Marshes spine
  [
    { x: 0, z: 2790 },
    { x: 0, z: 2880 },
    { x: 0, z: 2970 },
  ], // Pale Crossing spine (the road crosses the Pale Bridge between the pools)
  [
    { x: -6, z: 2112 },
    { x: -30, z: 2115 },
  ], // -> The Underway Rest
  [
    { x: 6, z: 2098 },
    { x: 55, z: 2100 },
  ], // -> Sunken Mouths
  [
    { x: 6, z: 2292 },
    { x: 25, z: 2295 },
  ], // -> Wardens Palisade
  [
    { x: -6, z: 2318 },
    { x: -45, z: 2319 },
    { x: -80, z: 2320 },
  ], // -> The Moving Wood
  [
    { x: -6, z: 2472 },
    { x: -20, z: 2475 },
  ], // -> The Tollhouse
  [
    { x: 6, z: 2512 },
    { x: 45, z: 2514 },
    { x: 75, z: 2515 },
  ], // -> The Ogre Toll
  [
    { x: 6, z: 2652 },
    { x: 30, z: 2655 },
  ], // -> Lanternfen Stilts
  [
    { x: -6, z: 2698 },
    { x: -30, z: 2702 },
    { x: -46, z: 2704 },
  ], // -> The Steaming Pools
  [
    { x: -6, z: 2832 },
    { x: -25, z: 2835 },
  ], // -> Bridgewatch
  [
    { x: 6, z: 2946 },
    { x: 50, z: 2948 },
    { x: 90, z: 2950 },
  ], // -> Gullwatch Rise
];

// ---------------------------------------------------------------------------
// Mobs. Camps grade south (zone level minimum) to north (toward the maximum);
// each rare elite sits near the top of its zone's range.
// ---------------------------------------------------------------------------

export const CONTESTED_SOUTH_MOBS: Record<string, MobTemplate> = {
  // --- Grey Hollows (28-45) ---
  hollow_lurker: {
    id: 'hollow_lurker',
    name: 'Hollow Lurker',
    minLevel: 28,
    maxLevel: 31,
    family: 'beast',
    hpBase: 85,
    hpPerLevel: 27,
    dmgBase: 16,
    dmgPerLevel: 3.3,
    attackSpeed: 1.9,
    armorPerLevel: 18,
    moveSpeed: 8.2,
    aggroRadius: 11,
    // It hunts from the cave dark: a raking pounce that leaves eyes watering.
    blind: { chance: 0.25, miss: 0.1, duration: 8, name: 'Gloom Rake' },
    loot: [
      { copper: 150, chance: 1 },
      { itemId: 'grey_shale_chip', chance: 0.35 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.0,
    color: 0x4a4a58,
  },
  underway_renegade: {
    id: 'underway_renegade',
    name: 'Underway Renegade',
    minLevel: 30,
    maxLevel: 34,
    family: 'humanoid',
    hpBase: 89,
    hpPerLevel: 28,
    dmgBase: 17,
    dmgPerLevel: 3.4,
    attackSpeed: 2.0,
    armorPerLevel: 21,
    moveSpeed: 7,
    aggroRadius: 11,
    // Smugglers who stopped paying the Underway its cut; they still carry saps.
    concuss: { chance: 0.12, duration: 2, name: 'Blackjack' },
    loot: [
      { copper: 180, chance: 1 },
      { itemId: 'smuggled_trinket', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.0,
    color: 0x6b5a44,
  },
  pale_gnawer: {
    id: 'pale_gnawer',
    name: 'Pale Gnawer',
    minLevel: 35,
    maxLevel: 39,
    family: 'kobold',
    hpBase: 96,
    hpPerLevel: 29,
    dmgBase: 18,
    dmgPerLevel: 3.6,
    attackSpeed: 2.0,
    armorPerLevel: 19,
    moveSpeed: 7,
    aggroRadius: 10,
    bleed: {
      chance: 0.3,
      perTick: 12,
      interval: 3,
      duration: 9,
      name: 'Gnawing Bite',
      school: 'physical',
    },
    loot: [
      { copper: 230, chance: 1 },
      { itemId: 'smuggled_trinket', chance: 0.3 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 0.95,
    color: 0xcabfa8,
  },
  deep_shale_elemental: {
    id: 'deep_shale_elemental',
    name: 'Deep Shale Elemental',
    minLevel: 40,
    maxLevel: 44,
    family: 'elemental',
    hpBase: 102,
    hpPerLevel: 31,
    dmgBase: 20,
    dmgPerLevel: 3.9,
    attackSpeed: 2.2,
    armorPerLevel: 27,
    moveSpeed: 6.5,
    aggroRadius: 11,
    // It sheathes itself in fresh shale when the pick-work gets rough.
    stoneskin: { amount: 140, every: 14, duration: 6, name: 'Shale Plating' },
    loot: [
      { copper: 290, chance: 1 },
      { itemId: 'grey_shale_chip', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.1,
    color: 0x5c6670,
  },
  // The Underway crowned him in the dark, and he taxes everything that moves
  // below ground. What he does to rivals is why the Rest asks no questions.
  vask_smuggler_king: {
    id: 'vask_smuggler_king',
    name: 'Vask the Smuggler King',
    minLevel: 44,
    maxLevel: 44,
    family: 'humanoid',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 630,
    hpPerLevel: 105,
    dmgBase: 35,
    dmgPerLevel: 6.4,
    attackSpeed: 2.1,
    armorPerLevel: 30,
    moveSpeed: 7.2,
    aggroRadius: 13,
    aoePulse: { min: 52, max: 70, radius: 9, every: 9, name: 'Powder Keg', school: 'fire' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.45, hasteMult: 1.25 },
    loot: [
      { copper: 1150, chance: 1 },
      { itemId: 'smuggler_kings_softsteps', chance: 1 },
    ],
    scale: 1.25,
    color: 0x8a6a3c,
  },

  // --- Thornfen Border (30-46) ---
  thornfen_creeper: {
    id: 'thornfen_creeper',
    name: 'Thornfen Creeper',
    minLevel: 30,
    maxLevel: 33,
    family: 'spider',
    hpBase: 88,
    hpPerLevel: 28,
    dmgBase: 16,
    dmgPerLevel: 3.4,
    attackSpeed: 2.1,
    armorPerLevel: 20,
    moveSpeed: 7,
    aggroRadius: 10,
    venom: {
      chance: 0.3,
      perTick: 12,
      interval: 3,
      duration: 12,
      name: 'Thornfen Venom',
      school: 'nature',
    },
    loot: [
      { copper: 160, chance: 1 },
      { itemId: 'barbed_thorn_husk', chance: 0.35 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.0,
    color: 0x3f5a3a,
  },
  thornwarped_stag: {
    id: 'thornwarped_stag',
    name: 'Thorn-Warped Stag',
    minLevel: 33,
    maxLevel: 36,
    family: 'beast',
    hpBase: 92,
    hpPerLevel: 28,
    dmgBase: 17,
    dmgPerLevel: 3.5,
    attackSpeed: 1.9,
    armorPerLevel: 18,
    moveSpeed: 8.4,
    aggroRadius: 11,
    // The wood grew back through the herd; the antlers came out wrong.
    bleed: {
      chance: 0.25,
      perTick: 13,
      interval: 3,
      duration: 9,
      name: 'Goring Antlers',
      school: 'physical',
    },
    loot: [
      { copper: 190, chance: 1 },
      { itemId: 'barbed_thorn_husk', chance: 0.3 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.1,
    color: 0x7a5f43,
  },
  thornfen_troll: {
    id: 'thornfen_troll',
    name: 'Thornfen Troll',
    minLevel: 37,
    maxLevel: 41,
    family: 'troll',
    hpBase: 99,
    hpPerLevel: 30,
    dmgBase: 19,
    dmgPerLevel: 3.7,
    attackSpeed: 2.3,
    armorPerLevel: 22,
    moveSpeed: 7.2,
    aggroRadius: 11,
    frenzyOnHit: { chance: 0.2, hasteMult: 1.3, duration: 6, name: 'Troll Fury' },
    desperateHeal: { belowHpPct: 0.35, healPct: 0.18 },
    loot: [
      { copper: 240, chance: 1 },
      { itemId: 'thornfen_tusk', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.2,
    color: 0x5d7a4e,
  },
  briar_horror: {
    id: 'briar_horror',
    name: 'Briar Horror',
    minLevel: 42,
    maxLevel: 46,
    family: 'elemental',
    hpBase: 105,
    hpPerLevel: 32,
    dmgBase: 20,
    dmgPerLevel: 4.1,
    attackSpeed: 2.2,
    armorPerLevel: 26,
    moveSpeed: 6.5,
    aggroRadius: 11,
    ensnare: { chance: 0.25, duration: 2.5, name: 'Grasping Briars', school: 'nature' },
    thorns: { value: 8, school: 'nature', name: 'Briar Hide' },
    loot: [
      { copper: 300, chance: 1 },
      { itemId: 'barbed_thorn_husk', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.15,
    color: 0x4c6b35,
  },
  // The oldest thing in the Moving Wood. The wardens' maps disagree about
  // everything except where not to cut.
  briarfather_yew: {
    id: 'briarfather_yew',
    name: 'Briarfather Yew',
    minLevel: 45,
    maxLevel: 45,
    family: 'elemental',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 640,
    hpPerLevel: 107,
    dmgBase: 36,
    dmgPerLevel: 6.6,
    attackSpeed: 2.4,
    armorPerLevel: 30,
    moveSpeed: 6.8,
    aggroRadius: 13,
    aoePulse: { min: 54, max: 72, radius: 10, every: 9, name: 'Thorn Nova', school: 'nature' },
    enrage: { belowHpPct: 0.35, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 1170, chance: 1 },
      { itemId: 'briarfather_bark_mitts', chance: 1 },
    ],
    scale: 1.4,
    color: 0x6e5a36,
  },

  // --- Ironpass Crossing (30-50) ---
  pass_raider: {
    id: 'pass_raider',
    name: 'Pass Raider',
    minLevel: 30,
    maxLevel: 34,
    family: 'humanoid',
    hpBase: 89,
    hpPerLevel: 28,
    dmgBase: 17,
    dmgPerLevel: 3.4,
    attackSpeed: 2.0,
    armorPerLevel: 22,
    moveSpeed: 7,
    aggroRadius: 11,
    expose: { chance: 0.25, dmgIncrease: 0.12, duration: 10, name: 'Break Guard' },
    loot: [
      { copper: 170, chance: 1 },
      { itemId: 'torn_caravan_banner', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.0,
    color: 0x7d5b48,
  },
  crag_toller: {
    id: 'crag_toller',
    name: 'Crag Ogre Toller',
    minLevel: 36,
    maxLevel: 40,
    family: 'ogre',
    hpBase: 97,
    hpPerLevel: 29,
    dmgBase: 19,
    dmgPerLevel: 3.7,
    attackSpeed: 2.6,
    armorPerLevel: 24,
    moveSpeed: 6.8,
    aggroRadius: 11,
    // The ogres collect their own toll, and their receipts are backhanded.
    knockback: { chance: 0.2, distance: 6, name: 'Toll Swipe' },
    loot: [
      { copper: 250, chance: 1 },
      { itemId: 'torn_caravan_banner', chance: 0.3 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.35,
    color: 0x9c8b70,
  },
  ironpass_crag_elemental: {
    id: 'ironpass_crag_elemental',
    name: 'Cragheart Elemental',
    minLevel: 41,
    maxLevel: 45,
    family: 'elemental',
    hpBase: 104,
    hpPerLevel: 32,
    dmgBase: 20,
    dmgPerLevel: 4.0,
    attackSpeed: 2.2,
    armorPerLevel: 28,
    moveSpeed: 6.5,
    aggroRadius: 11,
    corrode: {
      chance: 0.25,
      armor: 45,
      maxStacks: 3,
      duration: 12,
      name: 'Grinding Rubble',
    },
    loot: [
      { copper: 290, chance: 1 },
      { itemId: 'ironpass_rubble_core', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.15,
    color: 0x77706a,
  },
  ridge_wyvern: {
    id: 'ridge_wyvern',
    name: 'Ridge Wyvern',
    minLevel: 46,
    maxLevel: 50,
    family: 'dragonkin',
    hpBase: 110,
    hpPerLevel: 34,
    dmgBase: 22,
    dmgPerLevel: 4.4,
    attackSpeed: 2.0,
    armorPerLevel: 28,
    moveSpeed: 8,
    aggroRadius: 12,
    stackPoison: {
      chance: 0.25,
      perTick: 9,
      interval: 3,
      duration: 12,
      maxStacks: 3,
      name: 'Wyvern Sting',
      school: 'nature',
    },
    loot: [
      { copper: 370, chance: 1 },
      { itemId: 'wyvern_tail_barb', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.2,
    color: 0x8c4a3a,
  },
  // Skarn burned his own banner years ago. Now every caravan pays him or
  // feeds him, and the Tollhouse pretends very hard not to know his name.
  warlord_skarn: {
    id: 'warlord_skarn',
    name: 'Warlord Skarn',
    minLevel: 49,
    maxLevel: 49,
    family: 'humanoid',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 670,
    hpPerLevel: 114,
    dmgBase: 38,
    dmgPerLevel: 7.0,
    attackSpeed: 2.2,
    armorPerLevel: 30,
    moveSpeed: 7.2,
    aggroRadius: 13,
    aoePulse: {
      min: 58,
      max: 78,
      radius: 9,
      every: 9,
      name: 'Whirling Cleave',
      school: 'physical',
    },
    enrage: { belowHpPct: 0.3, dmgMult: 1.45, hasteMult: 1.25 },
    loot: [
      { copper: 1270, chance: 1 },
      { itemId: 'skarns_war_harness', chance: 1 },
    ],
    scale: 1.3,
    color: 0x9a4a2e,
  },

  // --- Emberveil Marshes (32-48) ---
  emberveil_bloat: {
    id: 'emberveil_bloat',
    name: 'Emberveil Bloat',
    minLevel: 32,
    maxLevel: 35,
    family: 'murloc',
    hpBase: 91,
    hpPerLevel: 28,
    dmgBase: 17,
    dmgPerLevel: 3.5,
    attackSpeed: 2.0,
    armorPerLevel: 18,
    moveSpeed: 7,
    aggroRadius: 10,
    // Swollen on reagent-rich bogwater; do not stand over the remains.
    deathThroes: {
      min: 34,
      max: 48,
      radius: 6,
      delay: 2,
      name: 'Gaseous Burst',
      school: 'nature',
    },
    loot: [
      { copper: 180, chance: 1 },
      { itemId: 'reagent_gland', chance: 0.35 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.05,
    color: 0x86a05a,
  },
  emberveil_leech: {
    id: 'emberveil_leech',
    name: 'Reagent-Fat Leech',
    minLevel: 35,
    maxLevel: 38,
    family: 'beast',
    hpBase: 95,
    hpPerLevel: 29,
    dmgBase: 18,
    dmgPerLevel: 3.6,
    attackSpeed: 2.1,
    armorPerLevel: 18,
    moveSpeed: 6.8,
    aggroRadius: 10,
    lifeleech: { healFrac: 0.5, name: 'Reagent Drain' },
    loot: [
      { copper: 200, chance: 1 },
      { itemId: 'reagent_gland', chance: 0.45 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 0.95,
    color: 0x6a4b52,
  },
  mire_strider: {
    id: 'mire_strider',
    name: 'Mire Strider',
    minLevel: 39,
    maxLevel: 43,
    family: 'spider',
    hpBase: 101,
    hpPerLevel: 31,
    dmgBase: 19,
    dmgPerLevel: 3.8,
    attackSpeed: 2.1,
    armorPerLevel: 20,
    moveSpeed: 7.4,
    aggroRadius: 11,
    ensnare: { chance: 0.2, duration: 2, name: 'Silkstrand Snare', school: 'nature' },
    loot: [
      { copper: 260, chance: 1 },
      { itemId: 'fogged_lantern_glass', chance: 0.35 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.1,
    color: 0x556655,
  },
  fog_wraith: {
    id: 'fog_wraith',
    name: 'Fog Wraith',
    minLevel: 44,
    maxLevel: 48,
    family: 'undead',
    hpBase: 108,
    hpPerLevel: 33,
    dmgBase: 21,
    dmgPerLevel: 4.2,
    attackSpeed: 2.3,
    armorPerLevel: 19,
    moveSpeed: 6.5,
    aggroRadius: 12,
    soulrot: {
      chance: 0.3,
      perTick: 14,
      interval: 3,
      duration: 12,
      name: 'Fogrot',
      school: 'shadow',
    },
    loot: [
      { copper: 360, chance: 1 },
      { itemId: 'fogged_lantern_glass', chance: 0.35 },
      { itemId: 'bone_fragments', chance: 0.3 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.05,
    color: 0xb8c4c8,
  },
  // When the fog thickens to walking depth, the stilt-folk snuff their
  // lanterns and wait for the ground to stop moving.
  emberveil_colossus: {
    id: 'emberveil_colossus',
    name: 'The Emberveil Colossus',
    minLevel: 47,
    maxLevel: 47,
    family: 'elemental',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 655,
    hpPerLevel: 110,
    dmgBase: 37,
    dmgPerLevel: 6.8,
    attackSpeed: 2.5,
    armorPerLevel: 30,
    moveSpeed: 6.5,
    aggroRadius: 13,
    aoePulse: { min: 56, max: 75, radius: 10, every: 9, name: 'Bog Eruption', school: 'nature' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.4, hasteMult: 1.25 },
    loot: [
      { copper: 1220, chance: 1 },
      { itemId: 'colossus_mireheart_girdle', chance: 1 },
    ],
    scale: 1.45,
    color: 0x4f6150,
  },

  // --- Pale Crossing (34-50) ---
  bridge_cultist: {
    id: 'bridge_cultist',
    name: 'Bridge Cultist',
    minLevel: 34,
    maxLevel: 37,
    family: 'humanoid',
    hpBase: 94,
    hpPerLevel: 29,
    dmgBase: 18,
    dmgPerLevel: 3.6,
    attackSpeed: 2.0,
    armorPerLevel: 20,
    moveSpeed: 7,
    aggroRadius: 11,
    // They kneel to the bridge itself and mutter its tolls in dead tongues.
    tongues: { chance: 0.25, mult: 1.5, duration: 8, name: 'Muttered Litany', school: 'shadow' },
    loot: [
      { copper: 190, chance: 1 },
      { itemId: 'river_worn_idol', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.0,
    color: 0x776688,
  },
  gullpicked_skeleton: {
    id: 'gullpicked_skeleton',
    name: 'Gull-Picked Skeleton',
    minLevel: 38,
    maxLevel: 41,
    family: 'undead',
    hpBase: 99,
    hpPerLevel: 30,
    dmgBase: 19,
    dmgPerLevel: 3.8,
    attackSpeed: 2.2,
    armorPerLevel: 20,
    moveSpeed: 6.6,
    aggroRadius: 11,
    demoralize: { ap: 24, duration: 10, chance: 0.3, name: 'Grave Chill' },
    loot: [
      { copper: 220, chance: 1 },
      { itemId: 'gull_picked_bone', chance: 0.4 },
      { itemId: 'bone_fragments', chance: 0.3 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.0,
    color: 0xd6d0bd,
  },
  riverbank_revenant: {
    id: 'riverbank_revenant',
    name: 'Riverbank Revenant',
    minLevel: 42,
    maxLevel: 46,
    family: 'undead',
    hpBase: 105,
    hpPerLevel: 32,
    dmgBase: 20,
    dmgPerLevel: 4.1,
    attackSpeed: 2.3,
    armorPerLevel: 21,
    moveSpeed: 6.8,
    aggroRadius: 11,
    enervate: { chance: 0.25, sta: 20, duration: 12, name: 'Riverbed Chill', school: 'frost' },
    loot: [
      { copper: 300, chance: 1 },
      { itemId: 'gull_picked_bone', chance: 0.35 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.05,
    color: 0x7c95a0,
  },
  pale_watcher: {
    id: 'pale_watcher',
    name: 'Pale Watcher',
    minLevel: 46,
    maxLevel: 50,
    family: 'elemental',
    hpBase: 110,
    hpPerLevel: 34,
    dmgBase: 22,
    dmgPerLevel: 4.4,
    attackSpeed: 2.2,
    armorPerLevel: 26,
    moveSpeed: 6.5,
    aggroRadius: 12,
    // Whatever raised the bridge left sentries; they are still on duty.
    spellVuln: { chance: 0.25, amp: 0.18, duration: 10, name: 'Unblinking Gaze', school: 'arcane' },
    loot: [
      { copper: 380, chance: 1 },
      { itemId: 'river_worn_idol', chance: 0.35 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.1,
    color: 0xdfe4e8,
  },
  // It repoints the stones by night and collects from anyone who lingers.
  // Kill it and the mortar is wet again by the next full moon.
  the_bridgekeeper: {
    id: 'the_bridgekeeper',
    name: 'The Bridgekeeper',
    minLevel: 50,
    maxLevel: 50,
    family: 'undead',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 675,
    hpPerLevel: 115,
    dmgBase: 39,
    dmgPerLevel: 7.2,
    attackSpeed: 2.3,
    armorPerLevel: 30,
    moveSpeed: 6.8,
    aggroRadius: 13,
    aoePulse: {
      min: 60,
      max: 80,
      radius: 10,
      every: 9,
      name: 'Toll of the Bridge',
      school: 'shadow',
    },
    summonAdds: { mobId: 'gullpicked_skeleton', count: 2, atHpPct: [0.5] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.45, hasteMult: 1.25 },
    loot: [
      { copper: 1300, chance: 1 },
      { itemId: 'bridgekeepers_tollstaff', chance: 1 },
    ],
    scale: 1.3,
    color: 0xcdd4d8,
  },
};

// ---------------------------------------------------------------------------
// NPCs: one provisioner per hub. The contested strip sells supplies, not
// causes; nobody here hands out work.
// ---------------------------------------------------------------------------

export const CONTESTED_SOUTH_NPCS: Record<string, NpcDef> = {
  fence_odrik: {
    id: 'fence_odrik',
    name: 'Fence Odrik',
    title: 'Underway Provisioner',
    pos: { x: -27, z: 2117 },
    facing: -1.2,
    color: 0x6f5a3e,
    questIds: [],
    vendorItems: ['healing_potion', 'mana_potion', 'underway_hardtack', 'smugglers_black_brew'],
    greeting: 'No questions in the Underway, friend. Coin buys bread, and bread asks nothing.',
  },
  quartermaster_senna: {
    id: 'quartermaster_senna',
    name: 'Quartermaster Senna',
    title: 'Palisade Provisioner',
    pos: { x: 20.5, z: 2296.5 },
    facing: 0.8,
    color: 0x4e6b45,
    questIds: [],
    vendorItems: ['healing_potion', 'mana_potion', 'thornberry_loaf', 'palisade_pine_tea'],
    greeting: 'Stay inside the stakes after dark, $C. The wood does not stay where we left it.',
  },
  tollkeeper_brann: {
    id: 'tollkeeper_brann',
    name: 'Tollkeeper Brann',
    title: 'Tollhouse Provisioner',
    pos: { x: -17, z: 2477 },
    facing: 1.4,
    color: 0x8a6f4d,
    questIds: [],
    vendorItems: ['healing_potion', 'mana_potion', 'tollhouse_stew', 'ironpass_mulled_cider'],
    greeting: 'Everyone pays at Ironpass: raiders, banners, and you. Lucky for you, I take copper.',
  },
  lanternkeeper_ketta: {
    id: 'lanternkeeper_ketta',
    name: 'Lanternkeeper Ketta',
    title: 'Stilts Provisioner',
    pos: { x: 26, z: 2657 },
    facing: -0.6,
    color: 0x5f7d6b,
    questIds: [],
    vendorItems: ['healing_potion', 'mana_potion', 'lanternfen_eel_skewer', 'fogberry_tonic'],
    greeting:
      'Keep to the stilts and mind your lantern, $C. The fog eats light out here, and worse.',
  },
  sutler_ives: {
    id: 'sutler_ives',
    name: 'Sutler Ives',
    title: 'Bridgewatch Sutler',
    pos: { x: -21, z: 2837 },
    facing: 0.7,
    color: 0x7a7290,
    questIds: [],
    vendorItems: ['healing_potion', 'mana_potion', 'bridgewatch_rations', 'nameless_river_water'],
    greeting: 'Rations, water, and no opinions on who built the bridge. That last keeps me alive.',
  },
};

// No quests in the contested strip: these bands are wilderness by design.
export const CONTESTED_SOUTH_QUESTS = {} as Record<string, QuestDef>;
export const CONTESTED_SOUTH_QUEST_ORDER: string[] = [];

// ---------------------------------------------------------------------------
// Camps, ordered south to north across all five zones. Southern camps in each
// zone sit at its level minimum; the northern camps climb toward the maximum.
// ---------------------------------------------------------------------------

export const CONTESTED_SOUTH_CAMPS: CampDef[] = [
  // Grey Hollows (2070-2250)
  { mobId: 'hollow_lurker', center: { x: -70, z: 2090 }, radius: 18, count: 7 },
  { mobId: 'hollow_lurker', center: { x: 55, z: 2100 }, radius: 18, count: 6 },
  { mobId: 'underway_renegade', center: { x: -75, z: 2130 }, radius: 16, count: 6 },
  { mobId: 'underway_renegade', center: { x: 60, z: 2140 }, radius: 16, count: 6 },
  { mobId: 'pale_gnawer', center: { x: -50, z: 2175 }, radius: 18, count: 7 },
  { mobId: 'pale_gnawer', center: { x: 90, z: 2185 }, radius: 16, count: 6 },
  { mobId: 'deep_shale_elemental', center: { x: -90, z: 2215 }, radius: 18, count: 7 },
  { mobId: 'deep_shale_elemental', center: { x: 45, z: 2225 }, radius: 16, count: 6 },
  { mobId: 'vask_smuggler_king', center: { x: 120, z: 2225 }, radius: 5, count: 1 },
  // Thornfen Border (2250-2430)
  { mobId: 'thornfen_creeper', center: { x: -55, z: 2270 }, radius: 18, count: 7 },
  { mobId: 'thornfen_creeper', center: { x: 70, z: 2280 }, radius: 16, count: 6 },
  { mobId: 'thornwarped_stag', center: { x: -80, z: 2320 }, radius: 18, count: 6 },
  { mobId: 'thornwarped_stag', center: { x: 60, z: 2330 }, radius: 16, count: 6 },
  { mobId: 'thornfen_troll', center: { x: -45, z: 2365 }, radius: 18, count: 7 },
  { mobId: 'thornfen_troll', center: { x: 85, z: 2375 }, radius: 16, count: 6 },
  { mobId: 'briar_horror', center: { x: -70, z: 2405 }, radius: 18, count: 7 },
  { mobId: 'briar_horror', center: { x: 50, z: 2412 }, radius: 14, count: 5 },
  { mobId: 'briarfather_yew', center: { x: -110, z: 2410 }, radius: 5, count: 1 },
  // Ironpass Crossing (2430-2610)
  { mobId: 'pass_raider', center: { x: -85, z: 2450 }, radius: 18, count: 7 },
  { mobId: 'pass_raider', center: { x: 55, z: 2460 }, radius: 18, count: 6 },
  { mobId: 'crag_toller', center: { x: -60, z: 2505 }, radius: 16, count: 5 },
  { mobId: 'crag_toller', center: { x: 75, z: 2515 }, radius: 16, count: 5 },
  { mobId: 'ironpass_crag_elemental', center: { x: -95, z: 2550 }, radius: 18, count: 7 },
  { mobId: 'ironpass_crag_elemental', center: { x: 50, z: 2560 }, radius: 16, count: 6 },
  { mobId: 'ridge_wyvern', center: { x: -55, z: 2585 }, radius: 16, count: 6 },
  { mobId: 'ridge_wyvern', center: { x: 95, z: 2590 }, radius: 16, count: 6 },
  { mobId: 'warlord_skarn', center: { x: 130, z: 2590 }, radius: 5, count: 1 },
  // Emberveil Marshes (2610-2790)
  { mobId: 'emberveil_bloat', center: { x: -55, z: 2630 }, radius: 18, count: 7 },
  { mobId: 'emberveil_bloat', center: { x: 85, z: 2640 }, radius: 16, count: 6 },
  { mobId: 'emberveil_leech', center: { x: -90, z: 2670 }, radius: 16, count: 6 },
  { mobId: 'emberveil_leech', center: { x: 60, z: 2680 }, radius: 16, count: 6 },
  { mobId: 'mire_strider', center: { x: -100, z: 2720 }, radius: 16, count: 6 },
  { mobId: 'mire_strider', center: { x: 40, z: 2725 }, radius: 16, count: 6 },
  { mobId: 'fog_wraith', center: { x: -65, z: 2760 }, radius: 16, count: 6 },
  { mobId: 'fog_wraith', center: { x: 100, z: 2765 }, radius: 16, count: 6 },
  { mobId: 'emberveil_colossus', center: { x: -30, z: 2770 }, radius: 5, count: 1 },
  // Pale Crossing (2790-2970)
  { mobId: 'bridge_cultist', center: { x: -90, z: 2815 }, radius: 18, count: 7 },
  { mobId: 'bridge_cultist', center: { x: 55, z: 2820 }, radius: 16, count: 6 },
  { mobId: 'gullpicked_skeleton', center: { x: -100, z: 2865 }, radius: 16, count: 6 },
  { mobId: 'gullpicked_skeleton', center: { x: 95, z: 2870 }, radius: 16, count: 6 },
  { mobId: 'the_bridgekeeper', center: { x: 18, z: 2895 }, radius: 4, count: 1 },
  { mobId: 'riverbank_revenant', center: { x: -80, z: 2915 }, radius: 16, count: 6 },
  { mobId: 'riverbank_revenant', center: { x: 70, z: 2920 }, radius: 16, count: 6 },
  { mobId: 'pale_watcher', center: { x: -60, z: 2945 }, radius: 16, count: 6 },
  { mobId: 'pale_watcher', center: { x: 90, z: 2950 }, radius: 14, count: 5 },
];

export const CONTESTED_SOUTH_OBJECTS: GroundObjectDef[] = [];

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const CONTESTED_SOUTH_ITEMS: Record<string, ItemDef> = {
  // --- junk / flavor drops ---
  grey_shale_chip: {
    id: 'grey_shale_chip',
    name: 'Grey Shale Chip',
    kind: 'junk',
    quality: 'poor',
    sellValue: 60,
  },
  smuggled_trinket: {
    id: 'smuggled_trinket',
    name: 'Smuggled Trinket',
    kind: 'junk',
    quality: 'poor',
    sellValue: 70,
  },
  barbed_thorn_husk: {
    id: 'barbed_thorn_husk',
    name: 'Barbed Thorn Husk',
    kind: 'junk',
    quality: 'poor',
    sellValue: 65,
  },
  thornfen_tusk: {
    id: 'thornfen_tusk',
    name: 'Thornfen Troll Tusk',
    kind: 'junk',
    quality: 'poor',
    sellValue: 75,
  },
  torn_caravan_banner: {
    id: 'torn_caravan_banner',
    name: 'Torn Caravan Banner',
    kind: 'junk',
    quality: 'poor',
    sellValue: 70,
  },
  ironpass_rubble_core: {
    id: 'ironpass_rubble_core',
    name: 'Ironpass Rubble Core',
    kind: 'junk',
    quality: 'poor',
    sellValue: 80,
  },
  wyvern_tail_barb: {
    id: 'wyvern_tail_barb',
    name: 'Wyvern Tail Barb',
    kind: 'junk',
    quality: 'poor',
    sellValue: 90,
  },
  reagent_gland: {
    id: 'reagent_gland',
    name: 'Reagent-Swollen Gland',
    kind: 'junk',
    quality: 'poor',
    sellValue: 75,
  },
  fogged_lantern_glass: {
    id: 'fogged_lantern_glass',
    name: 'Fogged Lantern Glass',
    kind: 'junk',
    quality: 'poor',
    sellValue: 80,
  },
  river_worn_idol: {
    id: 'river_worn_idol',
    name: 'River-Worn Idol',
    kind: 'junk',
    quality: 'poor',
    sellValue: 90,
  },
  gull_picked_bone: {
    id: 'gull_picked_bone',
    name: 'Gull-Picked Bone',
    kind: 'junk',
    quality: 'poor',
    sellValue: 80,
  },
  // --- vendor food / drink ---
  underway_hardtack: {
    id: 'underway_hardtack',
    name: 'Underway Hardtack',
    kind: 'food',
    quality: 'common',
    foodHp: 1100,
    sellValue: 140,
    buyValue: 2200,
  },
  smugglers_black_brew: {
    id: 'smugglers_black_brew',
    name: "Smuggler's Black Brew",
    kind: 'drink',
    quality: 'common',
    drinkMana: 1700,
    sellValue: 140,
    buyValue: 2200,
  },
  thornberry_loaf: {
    id: 'thornberry_loaf',
    name: 'Thornberry Loaf',
    kind: 'food',
    quality: 'common',
    foodHp: 1200,
    sellValue: 150,
    buyValue: 2400,
  },
  palisade_pine_tea: {
    id: 'palisade_pine_tea',
    name: 'Palisade Pine Tea',
    kind: 'drink',
    quality: 'common',
    drinkMana: 1800,
    sellValue: 150,
    buyValue: 2400,
  },
  tollhouse_stew: {
    id: 'tollhouse_stew',
    name: 'Tollhouse Stew',
    kind: 'food',
    quality: 'common',
    foodHp: 1400,
    sellValue: 170,
    buyValue: 2800,
  },
  ironpass_mulled_cider: {
    id: 'ironpass_mulled_cider',
    name: 'Ironpass Mulled Cider',
    kind: 'drink',
    quality: 'common',
    drinkMana: 2100,
    sellValue: 170,
    buyValue: 2800,
  },
  lanternfen_eel_skewer: {
    id: 'lanternfen_eel_skewer',
    name: 'Lanternfen Eel Skewer',
    kind: 'food',
    quality: 'common',
    foodHp: 1450,
    sellValue: 180,
    buyValue: 2900,
  },
  fogberry_tonic: {
    id: 'fogberry_tonic',
    name: 'Fogberry Tonic',
    kind: 'drink',
    quality: 'common',
    drinkMana: 2150,
    sellValue: 180,
    buyValue: 2900,
  },
  bridgewatch_rations: {
    id: 'bridgewatch_rations',
    name: 'Bridgewatch Rations',
    kind: 'food',
    quality: 'common',
    foodHp: 1600,
    sellValue: 200,
    buyValue: 3200,
  },
  nameless_river_water: {
    id: 'nameless_river_water',
    name: 'Nameless River Water',
    kind: 'drink',
    quality: 'common',
    drinkMana: 2400,
    sellValue: 200,
    buyValue: 3200,
  },
  // --- rare-elite drops ---
  smuggler_kings_softsteps: {
    id: 'smuggler_kings_softsteps',
    name: "Smuggler King's Softsteps",
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 160, agi: 14, sta: 10 },
    sellValue: 4400,
  },
  briarfather_bark_mitts: {
    id: 'briarfather_bark_mitts',
    name: 'Briarfather Bark Mitts',
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 140, int: 12, spi: 8 },
    sellValue: 4500,
  },
  skarns_war_harness: {
    id: 'skarns_war_harness',
    name: "Skarn's War Harness",
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 440, str: 16, sta: 13 },
    sellValue: 5600,
  },
  colossus_mireheart_girdle: {
    id: 'colossus_mireheart_girdle',
    name: 'Mireheart Girdle',
    kind: 'armor',
    armorType: 'leather',
    slot: 'waist',
    quality: 'rare',
    stats: { armor: 150, sta: 14, spi: 10 },
    sellValue: 5400,
  },
  bridgekeepers_tollstaff: {
    id: 'bridgekeepers_tollstaff',
    name: "Bridgekeeper's Tollstaff",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 46, max: 75, speed: 2.9 },
    stats: { int: 16, sta: 12 },
    sellValue: 6000,
  },
};

// ---------------------------------------------------------------------------
// Static props: one merged def for all five bands. Each hub gets an inn, a
// couple of tents, a fire, crates, a well, and the provisioner's stall; ruin
// rings mark the old places, and the twin rings at x 0 in Pale Crossing are
// the pylon stumps of the ancient bridge between its two pools.
// ---------------------------------------------------------------------------

export const CONTESTED_SOUTH_PROPS: ZonePropsDef = {
  buildings: [
    { kind: 'inn', x: -34, z: 2110, w: 6, d: 7, rot: 0.5 }, // The Underway Rest
    { kind: 'inn', x: 29, z: 2290, w: 6, d: 7, rot: -0.4 }, // Wardens Palisade longhouse
    { kind: 'inn', x: -24, z: 2470, w: 6, d: 7, rot: 0.3 }, // The Tollhouse
    { kind: 'inn', x: 34, z: 2650, w: 6, d: 7, rot: -0.6 }, // Lanternfen common house
    { kind: 'inn', x: -29, z: 2830, w: 6, d: 7, rot: 0.4 }, // Bridgewatch barracks
  ],
  wells: [
    { x: -31, z: 2121, r: 1.5 },
    { x: 22, z: 2290, r: 1.5 },
    { x: -21, z: 2481, r: 1.5 },
    { x: 27, z: 2650, r: 1.5 },
    { x: -27, z: 2841, r: 1.5 },
  ],
  stalls: [
    { x: -26.5, z: 2117.5, rot: 0.9, r: 1.7 }, // Fence Odrik
    { x: 21.5, z: 2297.5, rot: -0.7, r: 1.7 }, // Quartermaster Senna
    { x: -16.5, z: 2477.5, rot: 0.8, r: 1.7 }, // Tollkeeper Brann
    { x: 26.5, z: 2657.5, rot: -0.5, r: 1.7 }, // Lanternkeeper Ketta
    { x: -21.5, z: 2837.5, rot: 0.7, r: 1.7 }, // Sutler Ives
  ],
  mines: [
    { x: 58, z: 2103, rot: 1.2 }, // Sunken Mouths cave-in
    { x: -52, z: 2178, rot: -0.6 }, // Gnaw Warrens shaft
  ],
  docks: [],
  tents: [
    // The Underway Rest
    { x: -24, z: 2120, rot: 1.2, scale: 1 },
    { x: -37, z: 2119, rot: -0.8, scale: 1 },
    // Wardens Palisade
    { x: 19, z: 2299, rot: 0.7, scale: 1 },
    { x: 31, z: 2301, rot: 2.1, scale: 1 },
    // The Tollhouse
    { x: -14, z: 2479, rot: 1.0, scale: 1 },
    { x: -27, z: 2480, rot: -1.2, scale: 1 },
    // Lanternfen Stilts
    { x: 24, z: 2659, rot: 0.5, scale: 1 },
    { x: 36, z: 2661, rot: 1.8, scale: 1 },
    // Bridgewatch
    { x: -19, z: 2839, rot: 0.9, scale: 1 },
    { x: -32, z: 2840, rot: -1.0, scale: 1 },
  ],
  crates: [
    [-26, 2112],
    [28, 2293],
    [-16, 2472],
    [33, 2653],
    [-21, 2832],
  ],
  campfires: [
    [-29, 2116],
    [24, 2296],
    [-19, 2476],
    [29, 2656],
    [-24, 2836],
  ],
  mudHuts: [],
  ruinRings: [
    { x: 55, z: 2100, ringR: 6, columns: 5 }, // Sunken Mouths
    { x: -90, z: 2215, ringR: 7, columns: 6 }, // Shale Gallery
    { x: -80, z: 2320, ringR: 7, columns: 6 }, // The Moving Wood
    { x: -70, z: 2405, ringR: 6, columns: 5 }, // Briarheart Thicket
    { x: 75, z: 2515, ringR: 6, columns: 5 }, // The Ogre Toll
    { x: -95, z: 2550, ringR: 7, columns: 6 }, // Cragfall Slopes
    { x: -65, z: 2760, ringR: 6, columns: 5 }, // The Fogwall
    { x: 0, z: 2868, ringR: 5, columns: 6 }, // Pale Bridge south pylons
    { x: 0, z: 2892, ringR: 5, columns: 6 }, // Pale Bridge north pylons
  ],
  fences: [
    // the Wardens Palisade stake lines
    { x1: 17, z1: 2288, x2: 33, z2: 2288 },
    { x1: 17, z1: 2303, x2: 33, z2: 2303 },
  ],
  graveyards: [
    { x: -42, z: 2103 },
    { x: 38, z: 2285 },
    { x: -34, z: 2463 },
    { x: 44, z: 2645 },
    { x: -38, z: 2823 },
  ],
};
