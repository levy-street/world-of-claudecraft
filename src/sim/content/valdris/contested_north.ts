// The Northern Contested Territories (levels 35-55): the endgame ring past the
// war zone. Everyone here crossed the Breach to arrive, so every road, market,
// and forge camp assumes you can hold your own. Five bands run south to north:
// the Ashveil Wastes (burned farmland), the Saltbone Flats (a blinding salt
// pan around colossal bones), the Duskwall Ruins (a city dead thirty years),
// Cindral Ridge (forge-metal the dwarves cannot hold), and Redspire Pass,
// the northern end of the known world, where the old war's deserters wait.
//
// Structure follows the ossara.ts exemplar: zones + roads + mobs + npcs +
// (empty) quests + camps + objects + items + one merged props def.

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

export const CONTESTED_NORTH_ZONES: ZoneDef[] = [
  {
    id: 'ashveil_wastes',
    name: 'Ashveil Wastes',
    zMin: 3330,
    zMax: 3510,
    levelRange: [35, 45],
    biome: 'scorched',
    hub: { x: 30, z: 3375, radius: 13, name: 'Cinderrest' },
    graveyard: { x: 40, z: 3368 },
    lakes: [],
    pois: [
      { x: 30, z: 3375, label: 'Cinderrest' },
      { x: -50, z: 3370, label: 'The Charred Furrows' },
      { x: 60, z: 3420, label: 'Bonewhite Tor' },
      { x: -80, z: 3440, label: 'The Smolder Line' },
      { x: 40, z: 3470, label: 'Ashfall Reach' },
    ],
    welcome:
      'These fields fed half a kingdom once. One battle burned them for years; Cinderrest is what grew back.',
  },
  {
    id: 'saltbone_flats',
    name: 'Saltbone Flats',
    zMin: 3510,
    zMax: 3690,
    levelRange: [36, 48],
    biome: 'salt',
    hub: { x: -30, z: 3555, radius: 13, name: 'Brinehollow' },
    graveyard: { x: -40, z: 3548 },
    lakes: [],
    pois: [
      { x: -30, z: 3555, label: 'Brinehollow' },
      { x: 50, z: 3560, label: 'The Glare Flats' },
      { x: -70, z: 3600, label: 'The Great Ribcage' },
      { x: 60, z: 3630, label: 'Bonepicker Trails' },
      { x: -20, z: 3660, label: 'The Sunken Vertebrae' },
    ],
    welcome:
      'A white glare, colossal bones, and no two stories about them that agree. Brinehollow trades with all of them.',
  },
  {
    id: 'duskwall_ruins',
    name: 'Duskwall Ruins',
    zMin: 3690,
    zMax: 3870,
    levelRange: [35, 50],
    biome: 'scorched',
    hub: { x: 25, z: 3735, radius: 13, name: 'the Exile Market' },
    graveyard: { x: 35, z: 3728 },
    lakes: [],
    pois: [
      { x: 25, z: 3735, label: 'The Exile Market' },
      { x: -60, z: 3740, label: 'The Broken Gate' },
      { x: 20, z: 3762, label: 'The Old Boulevard' },
      { x: 55, z: 3780, label: 'The Collapsed Quarter' },
      { x: -50, z: 3810, label: 'Old Duskwall Sewers' },
      { x: 45, z: 3840, label: "The King's Midden" },
    ],
    welcome:
      'Duskwall died in the war thirty years ago. Everything picking through it now claims to be a scavenger.',
  },
  {
    id: 'cindral_ridge',
    name: 'Cindral Ridge',
    zMin: 3870,
    zMax: 4050,
    levelRange: [38, 52],
    biome: 'scorched',
    hub: { x: -25, z: 3915, radius: 13, name: 'Forgefall Camp' },
    graveyard: { x: -35, z: 3908 },
    lakes: [],
    pois: [
      { x: -25, z: 3915, label: 'Forgefall Camp' },
      { x: 50, z: 3920, label: 'The Slag Steps' },
      { x: -70, z: 3960, label: 'The Abandoned Diggings' },
      { x: 60, z: 3990, label: 'Magmavein Gulch' },
      { x: -40, z: 4020, label: 'The Smeltheart Vent' },
    ],
    welcome:
      'The ridge is full of forge-metal, and the dwarves of Forgefall Camp have spent decades failing to hold it.',
  },
  {
    id: 'redspire_pass',
    name: 'Redspire Pass',
    zMin: 4050,
    zMax: 4230,
    levelRange: [40, 55],
    biome: 'scorched',
    hub: { x: 20, z: 4095, radius: 13, name: 'the Last Waymeet' },
    graveyard: { x: 30, z: 4088 },
    lakes: [],
    pois: [
      { x: 20, z: 4095, label: 'The Last Waymeet' },
      { x: -55, z: 4100, label: 'The Broken Teeth' },
      { x: 50, z: 4140, label: 'Deserter Hollows' },
      { x: -45, z: 4170, label: 'The Silent Muster' },
      { x: 0, z: 4210, label: 'The Rim of the World' },
    ],
    welcome:
      'Past the Last Waymeet there is only red rock, the old deserters, and the rim of the known world.',
  },
];

// The north road: one x = 0 spine through every band up to the world rim, with
// short spokes to each hub and one landmark per zone.
export const CONTESTED_NORTH_ROADS: { x: number; z: number }[][] = [
  [
    { x: 0, z: 3330 },
    { x: 0, z: 3420 },
    { x: 0, z: 3510 },
  ], // spine: Ashveil Wastes
  [
    { x: 0, z: 3510 },
    { x: 0, z: 3600 },
    { x: 0, z: 3690 },
  ], // spine: Saltbone Flats
  [
    { x: 0, z: 3690 },
    { x: 0, z: 3780 },
    { x: 0, z: 3870 },
  ], // spine: Duskwall Ruins
  [
    { x: 0, z: 3870 },
    { x: 0, z: 3960 },
    { x: 0, z: 4050 },
  ], // spine: Cindral Ridge
  [
    { x: 0, z: 4050 },
    { x: 0, z: 4140 },
    { x: 0, z: 4230 },
  ], // spine: Redspire Pass, to the rim
  [
    { x: 0, z: 3372 },
    { x: 16, z: 3374 },
    { x: 30, z: 3375 },
  ], // -> Cinderrest
  [
    { x: 0, z: 3424 },
    { x: 35, z: 3422 },
    { x: 55, z: 3421 },
  ], // -> Bonewhite Tor
  [
    { x: 0, z: 3552 },
    { x: -16, z: 3554 },
    { x: -30, z: 3555 },
  ], // -> Brinehollow
  [
    { x: 0, z: 3598 },
    { x: -40, z: 3600 },
    { x: -60, z: 3600 },
  ], // -> the Great Ribcage
  [
    { x: 0, z: 3732 },
    { x: 14, z: 3734 },
    { x: 25, z: 3735 },
  ], // -> the Exile Market
  [
    { x: 0, z: 3782 },
    { x: 30, z: 3781 },
    { x: 50, z: 3780 },
  ], // -> the Collapsed Quarter
  [
    { x: 0, z: 3912 },
    { x: -14, z: 3914 },
    { x: -25, z: 3915 },
  ], // -> Forgefall Camp
  [
    { x: 0, z: 3958 },
    { x: -40, z: 3960 },
    { x: -64, z: 3960 },
  ], // -> the Abandoned Diggings
  [
    { x: 0, z: 4092 },
    { x: 12, z: 4094 },
    { x: 20, z: 4095 },
  ], // -> the Last Waymeet
  [
    { x: 0, z: 4168 },
    { x: -25, z: 4170 },
    { x: -42, z: 4170 },
  ], // -> the Silent Muster
];

// ---------------------------------------------------------------------------
// Mobs, south to north. Levels grade within each zone: the southern camps sit
// at the zone's minimum, the northern camps at its maximum.
// ---------------------------------------------------------------------------

export const CONTESTED_NORTH_MOBS: Record<string, MobTemplate> = {
  // --- Ashveil Wastes (35-45) ---
  ash_ghoul: {
    id: 'ash_ghoul',
    name: 'Ash Ghoul',
    minLevel: 35,
    maxLevel: 37,
    family: 'undead',
    hpBase: 92,
    hpPerLevel: 28,
    dmgBase: 17,
    dmgPerLevel: 3.5,
    attackSpeed: 2.2,
    armorPerLevel: 18,
    moveSpeed: 6.6,
    aggroRadius: 10,
    // The farmers the fires took, still working fields that are only ash now.
    soulrot: {
      chance: 0.3,
      perTick: 14,
      interval: 3,
      duration: 12,
      name: 'Ashrot',
      school: 'shadow',
    },
    loot: [
      { copper: 225, chance: 1 },
      { itemId: 'melted_ration_tin', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.05,
    color: 0x9a9187,
  },
  cinder_hound: {
    id: 'cinder_hound',
    name: 'Cinder Hound',
    minLevel: 36,
    maxLevel: 38,
    family: 'beast',
    hpBase: 94,
    hpPerLevel: 28,
    dmgBase: 17,
    dmgPerLevel: 3.6,
    attackSpeed: 1.9,
    armorPerLevel: 19,
    moveSpeed: 8.2,
    aggroRadius: 11,
    // Farm dogs gone feral in the years the fields burned; their bite smolders.
    smolder: {
      chance: 0.3,
      perTick: 14,
      interval: 3,
      duration: 9,
      name: 'Cinderbite',
    },
    loot: [
      { copper: 230, chance: 1 },
      { itemId: 'ashcaked_fang', chance: 0.45 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 0.95,
    color: 0x8a4a2e,
  },
  veilstalker: {
    id: 'veilstalker',
    name: 'Veilstalker',
    minLevel: 38,
    maxLevel: 40,
    family: 'humanoid',
    hpBase: 97,
    hpPerLevel: 29,
    dmgBase: 18,
    dmgPerLevel: 3.7,
    attackSpeed: 2.0,
    armorPerLevel: 22,
    moveSpeed: 7.2,
    aggroRadius: 11,
    // Exile raiders who hunt the ash in grey rags; they mark a victim through
    // the veil of dust and everyone in the band knows where to cut.
    expose: {
      chance: 0.25,
      dmgIncrease: 0.12,
      duration: 10,
      name: "Raider's Mark",
    },
    loot: [
      { copper: 245, chance: 1 },
      { itemId: 'melted_ration_tin', chance: 0.35 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.0,
    color: 0x6f6a5e,
  },
  ash_elemental: {
    id: 'ash_elemental',
    name: 'Ash Elemental',
    minLevel: 41,
    maxLevel: 44,
    family: 'elemental',
    hpBase: 102,
    hpPerLevel: 31,
    dmgBase: 19,
    dmgPerLevel: 3.9,
    attackSpeed: 2.2,
    armorPerLevel: 24,
    moveSpeed: 6.6,
    aggroRadius: 11,
    // The fires never fully went out; some of the ash learned to walk.
    cinder: {
      chance: 0.3,
      perTick: 15,
      interval: 3,
      duration: 12,
      name: 'Choking Ash',
    },
    loot: [
      { copper: 265, chance: 1 },
      { itemId: 'ember_glass_shard', chance: 0.45 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.1,
    color: 0xcf7a3a,
  },
  // The lord whose fields these were. He rode back into the fire to save the
  // harvest and has been saving it ever since, thirty years of grey seasons.
  burnfield_revenant: {
    id: 'burnfield_revenant',
    name: 'Revenant of the Burned Fields',
    minLevel: 45,
    maxLevel: 45,
    family: 'undead',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 648,
    hpPerLevel: 109,
    dmgBase: 36,
    dmgPerLevel: 5.0,
    attackSpeed: 2.2,
    armorPerLevel: 32,
    moveSpeed: 7.0,
    aggroRadius: 13,
    aoePulse: { min: 52, max: 70, radius: 10, every: 9, name: 'Field of Cinders', school: 'fire' },
    soulrot: {
      chance: 0.35,
      perTick: 18,
      interval: 3,
      duration: 12,
      name: 'Revenant Rot',
      school: 'shadow',
    },
    enrage: { belowHpPct: 0.3, dmgMult: 1.45, hasteMult: 1.25 },
    loot: [
      { copper: 1300, chance: 1 },
      { itemId: 'revenant_cinderguard', chance: 1 },
    ],
    scale: 1.3,
    color: 0x7a2f22,
  },
  // --- Saltbone Flats (36-48) ---
  colossid_fragment: {
    id: 'colossid_fragment',
    name: 'Colossid Fragment',
    minLevel: 36,
    maxLevel: 39,
    family: 'elemental',
    hpBase: 94,
    hpPerLevel: 28,
    dmgBase: 17,
    dmgPerLevel: 3.6,
    attackSpeed: 2.6,
    armorPerLevel: 30,
    moveSpeed: 6.0,
    aggroRadius: 10,
    // Salt-crusted pieces of whatever the bones belonged to, still obeying an
    // order given before anyone alive was born.
    stoneskin: { amount: 220, every: 18, duration: 8, name: 'Salt Crust' },
    loot: [
      { copper: 235, chance: 1 },
      { itemId: 'saltglass_shard', chance: 0.45 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.2,
    color: 0xe8e3d5,
  },
  brine_scuttler: {
    id: 'brine_scuttler',
    name: 'Brine Scuttler',
    minLevel: 38,
    maxLevel: 41,
    family: 'spider',
    hpBase: 97,
    hpPerLevel: 29,
    dmgBase: 18,
    dmgPerLevel: 3.7,
    attackSpeed: 2.1,
    armorPerLevel: 22,
    moveSpeed: 7.4,
    aggroRadius: 10,
    venom: {
      chance: 0.3,
      perTick: 15,
      interval: 3,
      duration: 12,
      name: 'Brine Venom',
    },
    loot: [
      { copper: 250, chance: 1 },
      { itemId: 'salt_crusted_chitin', chance: 0.45 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 0.95,
    color: 0xbfd8d8,
  },
  bonepicker_renegade: {
    id: 'bonepicker_renegade',
    name: 'Bonepicker Renegade',
    minLevel: 41,
    maxLevel: 44,
    family: 'humanoid',
    hpBase: 102,
    hpPerLevel: 31,
    dmgBase: 19,
    dmgPerLevel: 3.9,
    attackSpeed: 2.0,
    armorPerLevel: 24,
    moveSpeed: 7.2,
    aggroRadius: 11,
    // Nomads cast out of the bonepicker clans for selling what the clans hold
    // sacred; their flensing hooks were made for larger carcasses than yours.
    bleed: {
      chance: 0.28,
      perTick: 15,
      interval: 3,
      duration: 9,
      name: 'Flensing Hook',
      school: 'physical',
    },
    loot: [
      { copper: 265, chance: 1 },
      { itemId: 'bleached_bone_charm', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.0,
    color: 0xa39272,
  },
  salt_wraith: {
    id: 'salt_wraith',
    name: 'Salt Wraith',
    minLevel: 44,
    maxLevel: 47,
    family: 'undead',
    hpBase: 106,
    hpPerLevel: 32,
    dmgBase: 21,
    dmgPerLevel: 4.1,
    attackSpeed: 2.3,
    armorPerLevel: 20,
    moveSpeed: 6.5,
    aggroRadius: 11,
    // Whatever died out here dried before it could rot; the flats keep it.
    enervate: {
      chance: 0.3,
      sta: 22,
      duration: 12,
      name: 'Salt-Leached Vigor',
      school: 'shadow',
    },
    loot: [
      { copper: 285, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.05,
    color: 0xdfe8e6,
  },
  // Something lairs inside the Great Ribcage and drags carcasses in at night.
  // The bonepickers will not follow it past the third rib; nobody has seen all
  // of it and come back to disagree about what it is.
  marrowfeaster: {
    id: 'marrowfeaster',
    name: 'The Marrowfeaster',
    minLevel: 48,
    maxLevel: 48,
    family: 'beast',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 672,
    hpPerLevel: 112,
    dmgBase: 37,
    dmgPerLevel: 5.2,
    attackSpeed: 1.9,
    armorPerLevel: 30,
    moveSpeed: 7.6,
    aggroRadius: 12,
    aoePulse: {
      min: 56,
      max: 76,
      radius: 9,
      every: 10,
      name: 'Bone-Splinter Burst',
      school: 'physical',
    },
    lifeleech: { healFrac: 0.3, name: 'Marrow Feast' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 1400, chance: 1 },
      { itemId: 'marrowhide_leggings', chance: 1 },
    ],
    scale: 1.35,
    color: 0xd9d2c0,
  },
  // --- Duskwall Ruins (35-50) ---
  duskwall_scavenger: {
    id: 'duskwall_scavenger',
    name: 'Duskwall Scavenger',
    minLevel: 35,
    maxLevel: 38,
    family: 'humanoid',
    hpBase: 92,
    hpPerLevel: 28,
    dmgBase: 17,
    dmgPerLevel: 3.5,
    attackSpeed: 2.0,
    armorPerLevel: 20,
    moveSpeed: 7.0,
    aggroRadius: 10,
    // Some dig for the dead city's silver; some dig for its secrets and only
    // dress like they want the silver. All of them fight dirty.
    staggerHit: { chance: 0.3, dodgeReduction: 0.05, duration: 8, name: 'Handful of Grit' },
    loot: [
      { copper: 230, chance: 1 },
      { itemId: 'tarnished_prewar_coin', chance: 0.45 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.0,
    color: 0x77705f,
  },
  rubble_haunt: {
    id: 'rubble_haunt',
    name: 'Rubble Haunt',
    minLevel: 39,
    maxLevel: 42,
    family: 'undead',
    hpBase: 97,
    hpPerLevel: 29,
    dmgBase: 18,
    dmgPerLevel: 3.7,
    attackSpeed: 2.3,
    armorPerLevel: 20,
    moveSpeed: 6.4,
    aggroRadius: 11,
    // Duskwall buried thousands under its own walls; the rubble remembers.
    plague: {
      chance: 0.28,
      sta: 20,
      duration: 12,
      name: 'Grave-Dust Chill',
      school: 'shadow',
    },
    loot: [
      { copper: 250, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.05,
    color: 0x8d8a93,
  },
  sewer_broodspider: {
    id: 'sewer_broodspider',
    name: 'Sewer Broodspider',
    minLevel: 43,
    maxLevel: 46,
    family: 'spider',
    hpBase: 105,
    hpPerLevel: 32,
    dmgBase: 20,
    dmgPerLevel: 4.0,
    attackSpeed: 2.1,
    armorPerLevel: 24,
    moveSpeed: 7.6,
    aggroRadius: 11,
    stackPoison: {
      chance: 0.3,
      perTick: 8,
      interval: 3,
      duration: 12,
      maxStacks: 3,
      name: 'Brood Toxin',
    },
    loot: [
      { copper: 270, chance: 1 },
      { itemId: 'sewer_silk_wad', chance: 0.45 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.05,
    color: 0x4a5a3d,
  },
  gutter_hound: {
    id: 'gutter_hound',
    name: 'Gutter Hound',
    minLevel: 46,
    maxLevel: 49,
    family: 'beast',
    hpBase: 110,
    hpPerLevel: 33,
    dmgBase: 21,
    dmgPerLevel: 4.3,
    attackSpeed: 1.9,
    armorPerLevel: 22,
    moveSpeed: 8.2,
    aggroRadius: 12,
    bleed: {
      chance: 0.3,
      perTick: 16,
      interval: 3,
      duration: 9,
      name: 'Mangy Bite',
      school: 'physical',
    },
    packFrenzy: { radius: 10, hasteMult: 1.3, duration: 6 },
    loot: [
      { copper: 290, chance: 1 },
      { itemId: 'gutter_hound_pelt', chance: 0.45 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 0.9,
    color: 0x6e5b43,
  },
  // The Scavenger King rules the Collapsed Quarter with a fence's smile and a
  // ledger too accurate for a man who claims he cannot read. Three factions
  // pay for what he digs up; none of them has worked out who he reports to.
  scavenger_king: {
    id: 'scavenger_king',
    name: 'The Scavenger King',
    minLevel: 50,
    maxLevel: 50,
    family: 'humanoid',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 690,
    hpPerLevel: 115,
    dmgBase: 39,
    dmgPerLevel: 5.5,
    attackSpeed: 1.8,
    armorPerLevel: 32,
    moveSpeed: 7.4,
    aggroRadius: 12,
    aoePulse: { min: 58, max: 78, radius: 9, every: 9, name: 'Fan of Knives', school: 'physical' },
    summonAdds: { mobId: 'duskwall_scavenger', count: 2, atHpPct: [0.5] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 1460, chance: 1 },
      { itemId: 'scavenger_kings_shiv', chance: 1 },
    ],
    scale: 1.1,
    color: 0x54504a,
  },
  // --- Cindral Ridge (38-52) ---
  forgefall_salamander: {
    id: 'forgefall_salamander',
    name: 'Forgefall Salamander',
    minLevel: 38,
    maxLevel: 41,
    family: 'dragonkin',
    hpBase: 97,
    hpPerLevel: 29,
    dmgBase: 18,
    dmgPerLevel: 3.7,
    attackSpeed: 2.1,
    armorPerLevel: 24,
    moveSpeed: 7.0,
    aggroRadius: 10,
    smolder: {
      chance: 0.3,
      perTick: 15,
      interval: 3,
      duration: 9,
      name: 'Forgefire Spittle',
    },
    loot: [
      { copper: 250, chance: 1 },
      { itemId: 'cracked_salamander_scale', chance: 0.45 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.0,
    color: 0xc2622f,
  },
  magma_serpent: {
    id: 'magma_serpent',
    name: 'Magma Serpent',
    minLevel: 41,
    maxLevel: 45,
    family: 'elemental',
    hpBase: 102,
    hpPerLevel: 31,
    dmgBase: 19,
    dmgPerLevel: 3.9,
    attackSpeed: 2.2,
    armorPerLevel: 24,
    moveSpeed: 7.0,
    aggroRadius: 11,
    cinder: {
      chance: 0.3,
      perTick: 16,
      interval: 3,
      duration: 12,
      name: 'Magma Spray',
    },
    loot: [
      { copper: 270, chance: 1 },
      { itemId: 'cooled_magma_bead', chance: 0.45 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.1,
    color: 0xd8542a,
  },
  claimjumper_sapper: {
    id: 'claimjumper_sapper',
    name: 'Claim-Jumper Sapper',
    minLevel: 45,
    maxLevel: 48,
    family: 'kobold',
    hpBase: 108,
    hpPerLevel: 33,
    dmgBase: 21,
    dmgPerLevel: 4.2,
    attackSpeed: 2.0,
    armorPerLevel: 26,
    moveSpeed: 7.2,
    aggroRadius: 11,
    // Kobold claim-jumpers working the dwarven diggings with stolen blasting
    // powder. They carry more of it than is wise; stand back when one drops.
    deathThroes: {
      min: 70,
      max: 95,
      radius: 7,
      delay: 2.5,
      name: 'Powder Charge',
      school: 'fire',
    },
    loot: [
      { copper: 290, chance: 1 },
      { itemId: 'slag_nugget', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 0.85,
    color: 0x8a6a3a,
  },
  slag_ogre: {
    id: 'slag_ogre',
    name: 'Slag Ogre',
    minLevel: 48,
    maxLevel: 51,
    family: 'ogre',
    hpBase: 113,
    hpPerLevel: 34,
    dmgBase: 22,
    dmgPerLevel: 4.5,
    attackSpeed: 2.5,
    armorPerLevel: 28,
    moveSpeed: 6.8,
    aggroRadius: 12,
    concuss: { chance: 0.15, duration: 2, name: 'Slagfist' },
    loot: [
      { copper: 310, chance: 1 },
      { itemId: 'slag_nugget', chance: 0.45 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.35,
    color: 0x5f5a52,
  },
  // The reason the dwarves keep losing the ridge. Smeltjaw sleeps coiled in
  // the Smeltheart Vent and wakes whenever the digging gets close to done.
  smeltjaw: {
    id: 'smeltjaw',
    name: 'Smeltjaw the Forge-Wyrm',
    minLevel: 52,
    maxLevel: 52,
    family: 'dragonkin',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 708,
    hpPerLevel: 119,
    dmgBase: 41,
    dmgPerLevel: 5.8,
    attackSpeed: 2.3,
    armorPerLevel: 32,
    moveSpeed: 7.0,
    aggroRadius: 13,
    aoePulse: { min: 62, max: 84, radius: 10, every: 9, name: 'Smelting Breath', school: 'fire' },
    cinder: {
      chance: 0.35,
      perTick: 18,
      interval: 3,
      duration: 12,
      name: 'Wyrmfire',
    },
    enrage: { belowHpPct: 0.3, dmgMult: 1.45, hasteMult: 1.25 },
    loot: [
      { copper: 1520, chance: 1 },
      { itemId: 'forgewyrm_scale_helm', chance: 1 },
    ],
    scale: 1.5,
    color: 0xb33a1e,
  },
  // --- Redspire Pass (40-55) ---
  deserter_wraith: {
    id: 'deserter_wraith',
    name: 'Deserter Wraith',
    minLevel: 40,
    maxLevel: 44,
    family: 'undead',
    hpBase: 100,
    hpPerLevel: 30,
    dmgBase: 19,
    dmgPerLevel: 3.8,
    attackSpeed: 2.3,
    armorPerLevel: 20,
    moveSpeed: 6.5,
    aggroRadius: 11,
    // They walked away from the old war and never made it home; the despair
    // that stopped them here is contagious.
    dread: { chance: 0.2, duration: 2.5, name: "Deserter's Despair", school: 'shadow' },
    loot: [
      { copper: 260, chance: 1 },
      { itemId: 'rusted_deserter_badge', chance: 0.45 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.05,
    color: 0x8f9bb0,
  },
  ridge_shrieker: {
    id: 'ridge_shrieker',
    name: 'Ridge Shrieker',
    minLevel: 43,
    maxLevel: 47,
    family: 'dragonkin',
    hpBase: 105,
    hpPerLevel: 32,
    dmgBase: 20,
    dmgPerLevel: 4.1,
    attackSpeed: 2.0,
    armorPerLevel: 22,
    moveSpeed: 8.0,
    aggroRadius: 11,
    // Winged things that nest in the red spires. The deserters say they used
    // to be carrion birds; the deserters would know.
    terrify: { radius: 8, every: 14, duration: 2, name: 'Ridge Shriek', school: 'shadow' },
    loot: [
      { copper: 280, chance: 1 },
      { itemId: 'redspire_rock_shard', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.0,
    color: 0xa5442f,
  },
  spire_stalker: {
    id: 'spire_stalker',
    name: 'Spire Stalker',
    minLevel: 47,
    maxLevel: 51,
    family: 'beast',
    hpBase: 111,
    hpPerLevel: 34,
    dmgBase: 22,
    dmgPerLevel: 4.3,
    attackSpeed: 1.9,
    armorPerLevel: 24,
    moveSpeed: 8.2,
    aggroRadius: 12,
    bleed: {
      chance: 0.3,
      perTick: 17,
      interval: 3,
      duration: 9,
      name: "Stalker's Rake",
      school: 'physical',
    },
    loot: [
      { copper: 300, chance: 1 },
      { itemId: 'spire_stalker_claw', chance: 0.45 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.05,
    color: 0x7d4f3a,
  },
  not_quite_man: {
    id: 'not_quite_man',
    name: 'Not-Quite-Man',
    minLevel: 51,
    maxLevel: 54,
    family: 'humanoid',
    hpBase: 117,
    hpPerLevel: 36,
    dmgBase: 23,
    dmgPerLevel: 4.7,
    attackSpeed: 2.1,
    armorPerLevel: 26,
    moveSpeed: 7.0,
    aggroRadius: 12,
    // Deserters of the old war who stayed in the pass too long. They still
    // wear the uniforms, mostly; they are still men, mostly.
    mortalStrike: {
      chance: 0.25,
      healReduction: 0.4,
      duration: 8,
      name: 'Wound of the Old War',
      school: 'shadow',
    },
    loot: [
      { copper: 315, chance: 1 },
      { itemId: 'rusted_deserter_badge', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.05,
    color: 0x9c8f7d,
  },
  // The general who ordered the retreat that never arrived anywhere. His
  // muster roll still has every name on it, and he is still calling them.
  deserter_king: {
    id: 'deserter_king',
    name: 'The Deserter King',
    minLevel: 55,
    maxLevel: 55,
    family: 'undead',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 725,
    hpPerLevel: 119,
    dmgBase: 41,
    dmgPerLevel: 5.8,
    attackSpeed: 2.2,
    armorPerLevel: 32,
    moveSpeed: 7.0,
    aggroRadius: 13,
    aoePulse: { min: 66, max: 90, radius: 10, every: 9, name: 'The Last Order', school: 'shadow' },
    summonAdds: { mobId: 'deserter_wraith', count: 2, atHpPct: [0.5] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.45, hasteMult: 1.25 },
    loot: [
      { copper: 1600, chance: 1 },
      { itemId: 'mantle_of_the_last_muster', chance: 1 },
    ],
    scale: 1.25,
    color: 0x6b7a94,
  },
};

// ---------------------------------------------------------------------------
// NPCs: one provisioner per hub. No quests north of the Breach yet; these
// camps sell what keeps you alive and buy what you drag back.
// ---------------------------------------------------------------------------

export const CONTESTED_NORTH_NPCS: Record<string, NpcDef> = {
  provisioner_hask: {
    id: 'provisioner_hask',
    name: 'Provisioner Hask',
    title: 'Cinderrest Quartermaster',
    pos: { x: 26, z: 3378 },
    facing: -1.2,
    color: 0x8f7a52,
    questIds: [],
    vendorItems: ['cinderrest_ashcake', 'boiled_cistern_water', 'healing_potion', 'mana_potion'],
    greeting:
      'Ash gets into everything out here, $C: bread, boots, lungs. I sell what keeps you moving anyway.',
  },
  provisioner_sela: {
    id: 'provisioner_sela',
    name: 'Provisioner Sela',
    title: 'Brinehollow Sutler',
    pos: { x: -27, z: 3558 },
    facing: 1.1,
    color: 0xb0a082,
    questIds: [],
    vendorItems: ['brinehollow_salt_jerky', 'desalted_waterskin', 'healing_potion', 'mana_potion'],
    greeting:
      'Salt cures meat and men both, $N. Drink before you cross the Glare; the flats do not forgive thirst.',
  },
  provisioner_varrow: {
    id: 'provisioner_varrow',
    name: 'Provisioner Varrow',
    title: 'Exile Market Stallkeeper',
    pos: { x: 22, z: 3738 },
    facing: -0.8,
    color: 0x77705f,
    questIds: [],
    vendorItems: ['gutter_stew', 'black_market_tea', 'healing_potion', 'mana_potion'],
    greeting:
      'Everything in the Exile Market fell off a wagon somewhere, $C. My stew fell slower than most.',
  },
  provisioner_bruna: {
    id: 'provisioner_bruna',
    name: 'Provisioner Bruna',
    title: 'Forgefall Camp Sutler',
    pos: { x: -22, z: 3918 },
    facing: 0.9,
    color: 0x8a5a3a,
    questIds: [],
    vendorItems: ['forgefall_hardtack', 'coalfire_stout', 'healing_potion', 'mana_potion'],
    greeting:
      'Hardtack, stout, and potions that work, $C. Forgefall runs on all three, and so will you.',
  },
  provisioner_odric: {
    id: 'provisioner_odric',
    name: 'Provisioner Odric',
    title: 'Keeper of the Last Waymeet',
    pos: { x: 17, z: 4098 },
    facing: -0.6,
    color: 0x9c8f7d,
    questIds: [],
    vendorItems: ['waymeet_marching_bread', 'bitterroot_brew', 'healing_potion', 'mana_potion'],
    greeting:
      'This is the last fire before the end of the world, $N. Fill your pack; past the Waymeet there is only the deserters and the wind.',
  },
};

// No quests in the northern contested ring yet: it launches as an open-world
// hunting ground. The empty tables keep the module shape uniform for data.ts.
export const CONTESTED_NORTH_QUESTS = {} as Record<string, QuestDef>;

export const CONTESTED_NORTH_QUEST_ORDER: string[] = [];

// ---------------------------------------------------------------------------
// Camps (spawn tables), ordered south to north across all five zones. Levels
// grade with z: each zone's southern camps sit at its minimum level, the
// northern camps at its maximum, and the rare lairs anchor the far end.
// ---------------------------------------------------------------------------

export const CONTESTED_NORTH_CAMPS: CampDef[] = [
  // Ashveil Wastes
  { mobId: 'ash_ghoul', center: { x: -55, z: 3350 }, radius: 20, count: 7 },
  { mobId: 'ash_ghoul', center: { x: 60, z: 3358 }, radius: 18, count: 6 },
  { mobId: 'cinder_hound', center: { x: -70, z: 3395 }, radius: 18, count: 6 },
  { mobId: 'cinder_hound', center: { x: 75, z: 3390 }, radius: 16, count: 5 },
  { mobId: 'veilstalker', center: { x: 55, z: 3430 }, radius: 18, count: 6 },
  { mobId: 'veilstalker', center: { x: -60, z: 3445 }, radius: 16, count: 5 },
  { mobId: 'burnfield_revenant', center: { x: -85, z: 3448 }, radius: 5, count: 1 },
  { mobId: 'ash_elemental', center: { x: 70, z: 3468 }, radius: 18, count: 6 },
  { mobId: 'ash_elemental', center: { x: -75, z: 3475 }, radius: 16, count: 5 },
  // Saltbone Flats
  { mobId: 'colossid_fragment', center: { x: 55, z: 3530 }, radius: 20, count: 7 },
  { mobId: 'colossid_fragment', center: { x: -70, z: 3538 }, radius: 16, count: 5 },
  { mobId: 'brine_scuttler', center: { x: 60, z: 3572 }, radius: 18, count: 6 },
  { mobId: 'brine_scuttler', center: { x: -75, z: 3585 }, radius: 16, count: 5 },
  { mobId: 'marrowfeaster', center: { x: -70, z: 3602 }, radius: 5, count: 1 },
  { mobId: 'bonepicker_renegade', center: { x: 65, z: 3618 }, radius: 18, count: 6 },
  { mobId: 'bonepicker_renegade', center: { x: -55, z: 3628 }, radius: 16, count: 5 },
  { mobId: 'salt_wraith', center: { x: -45, z: 3660 }, radius: 18, count: 6 },
  { mobId: 'salt_wraith', center: { x: 55, z: 3665 }, radius: 16, count: 5 },
  // Duskwall Ruins
  { mobId: 'duskwall_scavenger', center: { x: -55, z: 3710 }, radius: 18, count: 7 },
  { mobId: 'duskwall_scavenger', center: { x: 60, z: 3715 }, radius: 16, count: 5 },
  { mobId: 'rubble_haunt', center: { x: -60, z: 3745 }, radius: 18, count: 6 },
  { mobId: 'rubble_haunt', center: { x: 55, z: 3778 }, radius: 16, count: 5 },
  { mobId: 'sewer_broodspider', center: { x: -50, z: 3808 }, radius: 16, count: 6 },
  { mobId: 'gutter_hound', center: { x: 45, z: 3838 }, radius: 18, count: 6 },
  { mobId: 'gutter_hound', center: { x: -60, z: 3845 }, radius: 14, count: 5 },
  { mobId: 'scavenger_king', center: { x: 52, z: 3846 }, radius: 4, count: 1 },
  // Cindral Ridge
  { mobId: 'forgefall_salamander', center: { x: 55, z: 3892 }, radius: 20, count: 7 },
  { mobId: 'forgefall_salamander', center: { x: -65, z: 3888 }, radius: 16, count: 5 },
  { mobId: 'magma_serpent', center: { x: 60, z: 3930 }, radius: 18, count: 6 },
  { mobId: 'magma_serpent', center: { x: -70, z: 3948 }, radius: 16, count: 5 },
  { mobId: 'claimjumper_sapper', center: { x: -72, z: 3962 }, radius: 16, count: 6 },
  { mobId: 'claimjumper_sapper', center: { x: 62, z: 3985 }, radius: 16, count: 5 },
  { mobId: 'slag_ogre', center: { x: -50, z: 4010 }, radius: 18, count: 6 },
  { mobId: 'slag_ogre', center: { x: 55, z: 4022 }, radius: 16, count: 5 },
  { mobId: 'smeltjaw', center: { x: -40, z: 4024 }, radius: 5, count: 1 },
  // Redspire Pass (the rim rises past z 4200; nothing spawns above 4185)
  { mobId: 'deserter_wraith', center: { x: -55, z: 4068 }, radius: 18, count: 7 },
  { mobId: 'deserter_wraith', center: { x: 60, z: 4075 }, radius: 16, count: 5 },
  { mobId: 'ridge_shrieker', center: { x: -60, z: 4105 }, radius: 18, count: 6 },
  { mobId: 'ridge_shrieker', center: { x: 65, z: 4118 }, radius: 16, count: 5 },
  { mobId: 'spire_stalker', center: { x: -50, z: 4140 }, radius: 16, count: 6 },
  { mobId: 'spire_stalker', center: { x: 55, z: 4150 }, radius: 14, count: 5 },
  { mobId: 'not_quite_man', center: { x: -45, z: 4172 }, radius: 16, count: 6 },
  { mobId: 'not_quite_man', center: { x: 50, z: 4178 }, radius: 14, count: 5 },
  { mobId: 'deserter_king', center: { x: -45, z: 4180 }, radius: 4, count: 1 },
];

export const CONTESTED_NORTH_OBJECTS: GroundObjectDef[] = [];

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const CONTESTED_NORTH_ITEMS: Record<string, ItemDef> = {
  // --- junk / flavor drops: Ashveil Wastes ---
  melted_ration_tin: {
    id: 'melted_ration_tin',
    name: 'Melted Ration Tin',
    kind: 'junk',
    quality: 'poor',
    sellValue: 70,
  },
  ashcaked_fang: {
    id: 'ashcaked_fang',
    name: 'Ash-Caked Fang',
    kind: 'junk',
    quality: 'poor',
    sellValue: 65,
  },
  ember_glass_shard: {
    id: 'ember_glass_shard',
    name: 'Ember Glass Shard',
    kind: 'junk',
    quality: 'poor',
    sellValue: 80,
  },
  // --- junk / flavor drops: Saltbone Flats ---
  saltglass_shard: {
    id: 'saltglass_shard',
    name: 'Saltglass Shard',
    kind: 'junk',
    quality: 'poor',
    sellValue: 70,
  },
  salt_crusted_chitin: {
    id: 'salt_crusted_chitin',
    name: 'Salt-Crusted Chitin',
    kind: 'junk',
    quality: 'poor',
    sellValue: 70,
  },
  bleached_bone_charm: {
    id: 'bleached_bone_charm',
    name: 'Bleached Bone Charm',
    kind: 'junk',
    quality: 'poor',
    sellValue: 75,
  },
  // --- junk / flavor drops: Duskwall Ruins ---
  tarnished_prewar_coin: {
    id: 'tarnished_prewar_coin',
    name: 'Tarnished Prewar Coin',
    kind: 'junk',
    quality: 'poor',
    sellValue: 80,
  },
  sewer_silk_wad: {
    id: 'sewer_silk_wad',
    name: 'Sewer Silk Wad',
    kind: 'junk',
    quality: 'poor',
    sellValue: 85,
  },
  gutter_hound_pelt: {
    id: 'gutter_hound_pelt',
    name: 'Gutter Hound Pelt',
    kind: 'junk',
    quality: 'poor',
    sellValue: 85,
  },
  // --- junk / flavor drops: Cindral Ridge ---
  cracked_salamander_scale: {
    id: 'cracked_salamander_scale',
    name: 'Cracked Salamander Scale',
    kind: 'junk',
    quality: 'poor',
    sellValue: 80,
  },
  cooled_magma_bead: {
    id: 'cooled_magma_bead',
    name: 'Cooled Magma Bead',
    kind: 'junk',
    quality: 'poor',
    sellValue: 85,
  },
  slag_nugget: {
    id: 'slag_nugget',
    name: 'Slag Nugget',
    kind: 'junk',
    quality: 'poor',
    sellValue: 90,
  },
  // --- junk / flavor drops: Redspire Pass ---
  rusted_deserter_badge: {
    id: 'rusted_deserter_badge',
    name: 'Rusted Deserter Badge',
    kind: 'junk',
    quality: 'poor',
    sellValue: 90,
  },
  redspire_rock_shard: {
    id: 'redspire_rock_shard',
    name: 'Redspire Rock Shard',
    kind: 'junk',
    quality: 'poor',
    sellValue: 85,
  },
  spire_stalker_claw: {
    id: 'spire_stalker_claw',
    name: 'Spire Stalker Claw',
    kind: 'junk',
    quality: 'poor',
    sellValue: 90,
  },
  // --- vendor food / drink, graded south to north ---
  cinderrest_ashcake: {
    id: 'cinderrest_ashcake',
    name: 'Cinderrest Ashcake',
    kind: 'food',
    quality: 'common',
    foodHp: 1608,
    sellValue: 180,
    buyValue: 3000,
  },
  boiled_cistern_water: {
    id: 'boiled_cistern_water',
    name: 'Boiled Cistern Water',
    kind: 'drink',
    quality: 'common',
    drinkMana: 2472,
    sellValue: 180,
    buyValue: 3000,
  },
  brinehollow_salt_jerky: {
    id: 'brinehollow_salt_jerky',
    name: 'Brinehollow Salt Jerky',
    kind: 'food',
    quality: 'common',
    foodHp: 1800,
    sellValue: 190,
    buyValue: 3100,
  },
  desalted_waterskin: {
    id: 'desalted_waterskin',
    name: 'Desalted Waterskin',
    kind: 'drink',
    quality: 'common',
    drinkMana: 2736,
    sellValue: 190,
    buyValue: 3100,
  },
  gutter_stew: {
    id: 'gutter_stew',
    name: 'Exile Market Gutter Stew',
    kind: 'food',
    quality: 'common',
    foodHp: 1932,
    sellValue: 200,
    buyValue: 3300,
  },
  black_market_tea: {
    id: 'black_market_tea',
    name: 'Black-Market Tea',
    kind: 'drink',
    quality: 'common',
    drinkMana: 2934,
    sellValue: 200,
    buyValue: 3300,
  },
  forgefall_hardtack: {
    id: 'forgefall_hardtack',
    name: 'Forgefall Hardtack',
    kind: 'food',
    quality: 'common',
    foodHp: 2148,
    sellValue: 210,
    buyValue: 3500,
  },
  coalfire_stout: {
    id: 'coalfire_stout',
    name: 'Coalfire Stout',
    kind: 'drink',
    quality: 'common',
    drinkMana: 3258,
    sellValue: 210,
    buyValue: 3500,
  },
  waymeet_marching_bread: {
    id: 'waymeet_marching_bread',
    name: 'Waymeet Marching Bread',
    kind: 'food',
    quality: 'common',
    foodHp: 2352,
    sellValue: 220,
    buyValue: 3700,
  },
  bitterroot_brew: {
    id: 'bitterroot_brew',
    name: 'Bitterroot Brew',
    kind: 'drink',
    quality: 'common',
    drinkMana: 3564,
    sellValue: 220,
    buyValue: 3700,
  },
  // --- rare-elite drops, one per lair ---
  revenant_cinderguard: {
    id: 'revenant_cinderguard',
    name: 'Revenant Cinderguard',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 380, str: 15, sta: 13 },
    sellValue: 4400,
  },
  marrowhide_leggings: {
    id: 'marrowhide_leggings',
    name: 'Marrowhide Leggings',
    kind: 'armor',
    armorType: 'leather',
    slot: 'legs',
    quality: 'rare',
    stats: { armor: 172, agi: 16, sta: 11 },
    sellValue: 4700,
  },
  scavenger_kings_shiv: {
    id: 'scavenger_kings_shiv',
    name: "Scavenger King's Shiv",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 34, max: 52, speed: 1.8, dagger: true },
    stats: { agi: 14, sta: 8 },
    sellValue: 4900,
    requiredClass: ['rogue', 'hunter'],
  },
  forgewyrm_scale_helm: {
    id: 'forgewyrm_scale_helm',
    name: 'Forge-Wyrm Scale Helm',
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'rare',
    stats: { armor: 356, str: 14, sta: 14 },
    sellValue: 5100,
  },
  mantle_of_the_last_muster: {
    id: 'mantle_of_the_last_muster',
    name: 'Mantle of the Last Muster',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'rare',
    stats: { armor: 98, int: 18, sta: 12 },
    sellValue: 5500,
  },
};

// ---------------------------------------------------------------------------
// Static props for all five zones (rendering + collision share this data).
// Each hub is a small waystation: an inn, a well, one vendor stall, tents,
// crates, and a fire. Duskwall carries the ruin weight (the dead city);
// Cindral and Saltbone get the mine shafts.
// ---------------------------------------------------------------------------

export const CONTESTED_NORTH_PROPS: ZonePropsDef = {
  buildings: [
    { kind: 'inn', x: 37, z: 3372, w: 6, d: 7, rot: 0.6 }, // Cinderrest
    { kind: 'inn', x: -37, z: 3552, w: 6, d: 7, rot: -0.6 }, // Brinehollow
    { kind: 'inn', x: 31, z: 3729, w: 6, d: 7, rot: 0.4 }, // the Exile Market
    { kind: 'inn', x: -31, z: 3909, w: 6, d: 7, rot: -0.4 }, // Forgefall Camp
    { kind: 'inn', x: 26, z: 4089, w: 6, d: 7, rot: 0.5 }, // the Last Waymeet
  ],
  wells: [
    { x: 31, z: 3372, r: 1.5 },
    { x: -31, z: 3552, r: 1.5 },
    { x: 26, z: 3732, r: 1.5 },
    { x: -26, z: 3912, r: 1.5 },
    { x: 21, z: 4092, r: 1.5 },
  ],
  stalls: [
    { x: 24.5, z: 3379.5, rot: -0.4, r: 1.7 }, // Provisioner Hask
    { x: -25.5, z: 3559.5, rot: 0.5, r: 1.7 }, // Provisioner Sela
    { x: 20.5, z: 3739.5, rot: -0.3, r: 1.7 }, // Provisioner Varrow
    { x: -20.5, z: 3919.5, rot: 0.4, r: 1.7 }, // Provisioner Bruna
    { x: 15.5, z: 4099.5, rot: -0.5, r: 1.7 }, // Provisioner Odric
  ],
  mines: [
    { x: -64, z: 3596, rot: 0.8 }, // Saltbone: the bone-shaft under the Ribcage
    { x: -70, z: 3958, rot: 1.1 }, // Cindral: the Abandoned Diggings
    { x: 60, z: 3988, rot: -1.8 }, // Cindral: Magmavein Gulch working
    { x: -45, z: 4015, rot: 2.4 }, // Cindral: the Smeltheart approach shaft
  ],
  docks: [],
  tents: [
    { x: 35, z: 3381, rot: 0.8, scale: 1.1 },
    { x: 39, z: 3377, rot: 2.1, scale: 1.1 },
    { x: -35, z: 3561, rot: -0.8, scale: 1.1 },
    { x: -39, z: 3557, rot: 1.6, scale: 1.1 },
    { x: 30, z: 3741, rot: 0.5, scale: 1.1 },
    { x: 34, z: 3737, rot: -1.2, scale: 1.1 },
    { x: -30, z: 3921, rot: 0.9, scale: 1.1 },
    { x: -34, z: 3917, rot: -0.7, scale: 1.1 },
    { x: 25, z: 4101, rot: 0.6, scale: 1.1 },
    { x: 29, z: 4097, rot: 1.9, scale: 1.1 },
  ],
  crates: [
    [34, 3370],
    [-34, 3550],
    [29, 3730],
    [-29, 3910],
    [24, 4090],
  ],
  campfires: [
    [28, 3373],
    [-28, 3553],
    [23, 3733],
    [-23, 3913],
    [18, 4093],
  ],
  mudHuts: [],
  ruinRings: [
    { x: -52, z: 3366, ringR: 6, columns: 5 }, // Ashveil: a burned farmstead
    { x: 62, z: 3422, ringR: 6, columns: 5 }, // Ashveil: Bonewhite Tor
    { x: -70, z: 3600, ringR: 9, columns: 7 }, // Saltbone: the Great Ribcage
    { x: -58, z: 3742, ringR: 7, columns: 6 }, // Duskwall: the Broken Gate
    { x: 20, z: 3762, ringR: 5, columns: 4 }, // Duskwall: the Old Boulevard arch
    { x: 55, z: 3782, ringR: 7, columns: 6 }, // Duskwall: the Collapsed Quarter
    { x: -48, z: 3812, ringR: 6, columns: 5 }, // Duskwall: the sewer mouth
    { x: 47, z: 3843, ringR: 6, columns: 5 }, // Duskwall: the King's Midden
    { x: 52, z: 3926, ringR: 6, columns: 5 }, // Cindral: the Slag Steps
    { x: -57, z: 4102, ringR: 6, columns: 5 }, // Redspire: the Broken Teeth
    { x: 52, z: 4142, ringR: 6, columns: 5 }, // Redspire: Deserter Hollows
  ],
  fences: [],
  graveyards: [
    { x: 40, z: 3368 },
    { x: -40, z: 3548 },
    { x: 35, z: 3728 },
    { x: -35, z: 3908 },
    { x: 30, z: 4088 },
  ],
};
