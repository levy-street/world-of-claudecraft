// The Breach (levels 45-60): the eternal war zone at the geographic and
// political center of Valdris. Every banner has bled for this cracked plain
// and none has held it; the earth itself glows with ember light where the old
// offensives burned through. There is no law here, only what you can hold.
// The one neutral ground is the Last Bastion, a mercenary redoubt where the
// agents of all three factions drink under a truce-flag nobody quite trusts.
//
// PvE content only: the open faction PvP rule itself lives in the engine
// (src/sim/war_zone.ts), not in this data module. No quests are authored here
// yet; the quest tables are exported empty on purpose.

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

export const BREACH_ZONE: ZoneDef = {
  id: 'the_breach',
  name: 'The Breach',
  zMin: 2970,
  zMax: 3330,
  levelRange: [45, 60],
  biome: 'scorched',
  hub: { x: 0, z: 3150, radius: 16, name: 'Last Bastion' },
  graveyard: { x: 20, z: 3134 },
  lakes: [],
  pois: [
    { x: 0, z: 3150, label: 'Last Bastion' },
    { x: -70, z: 3010, label: 'The Sundered Field' },
    { x: 80, z: 3030, label: 'The Ember Scar' },
    { x: 135, z: 3075, label: 'The Ashen Saps' },
    { x: -105, z: 3090, label: 'The Broken Siege Line' },
    { x: 90, z: 3190, label: 'Wreck of the Third Offensive' },
    { x: -90, z: 3205, label: 'The Shattered Vanguard' },
    { x: 110, z: 3240, label: 'The First Crater' },
    { x: -70, z: 3280, label: 'The Molten Gate' },
    { x: 55, z: 3300, label: "Khorvax's Redoubt" },
  ],
  welcome:
    'No banner holds The Breach. The truce ends at the Last Bastion palisade; beyond it there is only the war.',
};

// The war road: one scorched spine straight up the zone, past the Last
// Bastion, with spokes west to the Broken Siege Line and northeast toward the
// First Crater.
export const BREACH_ROADS: { x: number; z: number }[][] = [
  [
    { x: 0, z: 2970 },
    { x: 0, z: 3150 },
    { x: 0, z: 3330 },
  ], // the war road: Pale Crossing pass -> Last Bastion -> the Ashveil pass
  [
    { x: -6, z: 3140 },
    { x: -60, z: 3105 },
    { x: -100, z: 3092 },
  ], // -> the Broken Siege Line
  [
    { x: 6, z: 3160 },
    { x: 60, z: 3200 },
    { x: 104, z: 3232 },
  ], // -> the First Crater
];

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

export const BREACH_MOBS: Record<string, MobTemplate> = {
  warped_warhound: {
    id: 'warped_warhound',
    name: 'Warped Warhound',
    minLevel: 45,
    maxLevel: 47,
    family: 'beast',
    hpBase: 108,
    hpPerLevel: 33,
    dmgBase: 21,
    dmgPerLevel: 4.2,
    attackSpeed: 1.8,
    armorPerLevel: 22,
    moveSpeed: 8.4,
    aggroRadius: 11,
    // Kennel beasts of dead offensives, gone feral and wrong in the ember light.
    bleed: {
      chance: 0.25,
      perTick: 16,
      interval: 3,
      duration: 9,
      name: 'Warped Fangs',
      school: 'physical',
    },
    packFrenzy: { radius: 12, hasteMult: 1.3, duration: 8 },
    loot: [
      { copper: 280, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.35 },
    ],
    scale: 1.0,
    color: 0x6e5a4a,
  },
  breach_horror: {
    id: 'breach_horror',
    name: 'Breach Horror',
    minLevel: 46,
    maxLevel: 48,
    family: 'demon',
    hpBase: 110,
    hpPerLevel: 34,
    dmgBase: 21,
    dmgPerLevel: 4.3,
    attackSpeed: 2.1,
    armorPerLevel: 24,
    moveSpeed: 7.2,
    aggroRadius: 12,
    // Things that crawled out of the Ember Scar; their claws leave a taint
    // that festers long after the wound closes.
    soulrot: {
      chance: 0.3,
      perTick: 18,
      interval: 3,
      duration: 12,
      name: 'Breach-Taint',
      school: 'shadow',
    },
    loot: [
      { copper: 300, chance: 1 },
      { itemId: 'cracked_horror_horn', chance: 0.35 },
    ],
    scale: 1.15,
    color: 0x8a3a3a,
  },
  ember_revenant: {
    id: 'ember_revenant',
    name: 'Ember Revenant',
    minLevel: 48,
    maxLevel: 50,
    family: 'undead',
    hpBase: 112,
    hpPerLevel: 34,
    dmgBase: 22,
    dmgPerLevel: 4.4,
    attackSpeed: 2.2,
    armorPerLevel: 24,
    moveSpeed: 6.6,
    aggroRadius: 11,
    // Soldiers of every banner, still burning where they fell.
    smolder: {
      chance: 0.3,
      perTick: 18,
      interval: 3,
      duration: 12,
      name: 'Ember Grasp',
      school: 'fire',
    },
    loot: [
      { copper: 330, chance: 1 },
      { itemId: 'melted_signet_ring', chance: 0.3 },
      { itemId: 'bone_fragments', chance: 0.3 },
    ],
    scale: 1.05,
    color: 0xd06a3c,
  },
  magma_elemental: {
    id: 'magma_elemental',
    name: 'Magma Elemental',
    minLevel: 50,
    maxLevel: 52,
    family: 'elemental',
    hpBase: 115,
    hpPerLevel: 35,
    dmgBase: 22,
    dmgPerLevel: 4.5,
    attackSpeed: 2.3,
    armorPerLevel: 30,
    moveSpeed: 6.5,
    aggroRadius: 11,
    // The cracked earth given fists; it hardens its hide when pressed.
    stoneskin: { amount: 220, every: 14, duration: 8, name: 'Molten Carapace' },
    cinder: {
      chance: 0.3,
      perTick: 20,
      interval: 3,
      duration: 9,
      name: 'Magma Fist',
      school: 'fire',
    },
    loot: [{ copper: 360, chance: 1 }],
    scale: 1.15,
    color: 0xe0662e,
  },
  ash_wraith: {
    id: 'ash_wraith',
    name: 'Ash Wraith',
    minLevel: 52,
    maxLevel: 54,
    family: 'undead',
    hpBase: 118,
    hpPerLevel: 36,
    dmgBase: 23,
    dmgPerLevel: 4.6,
    attackSpeed: 2.3,
    armorPerLevel: 22,
    moveSpeed: 6.8,
    aggroRadius: 12,
    // What is left when a war burns the body away and keeps the grievance.
    enervate: { chance: 0.3, sta: 34, duration: 12, name: 'Ash-Choke', school: 'shadow' },
    loot: [
      { copper: 400, chance: 1 },
      { itemId: 'scorched_banner_scrap', chance: 0.3 },
      { itemId: 'bone_fragments', chance: 0.35 },
    ],
    scale: 1.05,
    color: 0x9a9aa8,
  },
  breachsworn_deserter: {
    id: 'breachsworn_deserter',
    name: 'Breachsworn Deserter',
    minLevel: 54,
    maxLevel: 56,
    family: 'humanoid',
    hpBase: 121,
    hpPerLevel: 37,
    dmgBase: 24,
    dmgPerLevel: 4.8,
    attackSpeed: 2.0,
    armorPerLevel: 28,
    moveSpeed: 7.0,
    aggroRadius: 12,
    // Deserters of every banner, sworn now to the war itself. Their blades are
    // notched from a hundred fields and cut armor to ribbons.
    corrode: {
      chance: 0.3,
      armor: 120,
      maxStacks: 3,
      duration: 12,
      name: 'Notched Blades',
      school: 'physical',
    },
    loot: [
      { copper: 440, chance: 1 },
      { itemId: 'scorched_banner_scrap', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.0,
    color: 0x715c4e,
  },
  breach_scavenger_ogre: {
    id: 'breach_scavenger_ogre',
    name: 'Breach Scavenger Ogre',
    minLevel: 55,
    maxLevel: 57,
    family: 'ogre',
    hpBase: 126,
    hpPerLevel: 38,
    dmgBase: 25,
    dmgPerLevel: 4.9,
    attackSpeed: 2.5,
    armorPerLevel: 26,
    moveSpeed: 6.8,
    aggroRadius: 12,
    // Ogre clans follow the war the way gulls follow a plough, picking the
    // northern fields clean of rings, teeth, and anything shiny.
    knockback: { chance: 0.2, distance: 6, name: 'Sweeping Backhand' },
    loot: [
      { copper: 480, chance: 1 },
      { itemId: 'melted_signet_ring', chance: 0.35 },
    ],
    scale: 1.35,
    color: 0x8a7a5c,
  },
  ashwing_drake: {
    id: 'ashwing_drake',
    name: 'Ashwing Drake',
    minLevel: 58,
    maxLevel: 60,
    family: 'dragonkin',
    hpBase: 130,
    hpPerLevel: 40,
    dmgBase: 27,
    dmgPerLevel: 5.2,
    attackSpeed: 2.2,
    armorPerLevel: 34,
    moveSpeed: 7.4,
    aggroRadius: 13,
    // Drakes wheel over the Molten Gate and the crater rim, grown fat on the
    // war's leavings and grey with its ash.
    cleave: { radius: 5, mult: 0.35, name: 'Ash Wing Buffet' },
    smolder: {
      chance: 0.25,
      perTick: 22,
      interval: 3,
      duration: 9,
      name: 'Cinder Breath',
      school: 'fire',
    },
    loot: [
      { copper: 530, chance: 1 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.3,
    color: 0x5c5250,
  },
  // The Ember Scar's tithe-collector: a demon that walks the horror packs at
  // dusk, weighing the fallen of every banner and taking its cut in flesh.
  mazhrekk_the_flesh_tithe: {
    id: 'mazhrekk_the_flesh_tithe',
    name: 'Mazhrekk the Flesh-Tithe',
    minLevel: 50,
    maxLevel: 50,
    family: 'demon',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 750,
    hpPerLevel: 110,
    dmgBase: 34,
    dmgPerLevel: 5.4,
    attackSpeed: 2.0,
    armorPerLevel: 50,
    moveSpeed: 7.4,
    aggroRadius: 13,
    aoePulse: { min: 58, max: 78, radius: 9, every: 9, name: 'Tithe of Flesh', school: 'shadow' },
    enrage: { belowHpPct: 0.35, dmgMult: 1.4, hasteMult: 1.25 },
    lifeleech: { healFrac: 0.3, name: 'Flesh Tithe' },
    loot: [
      { copper: 1750, chance: 1 },
      { itemId: 'tithe_collectors_grasps', chance: 0.35 },
    ],
    scale: 1.35,
    color: 0x7a2f2f,
  },
  // The Breachsworn do not bury their dead; Vhorlan renders them. The wreck of
  // the Third Offensive is his larder and every camp pays him in carcasses.
  butcher_vhorlan: {
    id: 'butcher_vhorlan',
    name: 'Butcher Vhorlan',
    minLevel: 56,
    maxLevel: 56,
    family: 'humanoid',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 800,
    hpPerLevel: 118,
    dmgBase: 36,
    dmgPerLevel: 5.6,
    attackSpeed: 2.2,
    armorPerLevel: 55,
    moveSpeed: 7.0,
    aggroRadius: 13,
    aoePulse: {
      min: 62,
      max: 84,
      radius: 8,
      every: 8,
      name: 'Whirling Cleavers',
      school: 'physical',
    },
    enrage: { belowHpPct: 0.3, dmgMult: 1.45, hasteMult: 1.25 },
    mortalStrike: {
      chance: 0.25,
      healReduction: 0.4,
      duration: 8,
      name: "Butcher's Cut",
      school: 'physical',
    },
    loot: [
      { copper: 1750, chance: 1 },
      { itemId: 'butchers_chainguard', chance: 0.3 },
      { itemId: 'vhorlans_flensing_blade', chance: 0.25 },
    ],
    scale: 1.2,
    color: 0x6b4a3a,
  },
  // The first thing born of the First Crater and still the angriest: a slab of
  // burning earth that remembers being a battlefield.
  firstborn_of_the_crater: {
    id: 'firstborn_of_the_crater',
    name: 'Firstborn of the Crater',
    minLevel: 57,
    maxLevel: 57,
    family: 'elemental',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 850,
    hpPerLevel: 125,
    dmgBase: 38,
    dmgPerLevel: 5.8,
    attackSpeed: 2.4,
    armorPerLevel: 60,
    moveSpeed: 6.5,
    aggroRadius: 13,
    aoePulse: { min: 66, max: 90, radius: 10, every: 10, name: 'Crater Surge', school: 'fire' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 1750, chance: 1 },
      { itemId: 'craterheart_mantle', chance: 0.35 },
    ],
    scale: 1.4,
    color: 0xff7a2e,
  },
  // The war's favorite general. Khorvax has commanded both sides of a dozen
  // offensives, and his redoubt on the north rim is the closest thing The
  // Breach has to a throne.
  warbringer_khorvax: {
    id: 'warbringer_khorvax',
    name: 'Warbringer Khorvax',
    minLevel: 60,
    maxLevel: 60,
    family: 'demon',
    elite: true,
    boss: true,
    respawnMult: 12,
    hpBase: 420,
    hpPerLevel: 52,
    dmgBase: 24,
    dmgPerLevel: 4.6,
    attackSpeed: 2.4,
    armorPerLevel: 34,
    moveSpeed: 7.0,
    aggroRadius: 13,
    aoePulse: { min: 56, max: 76, radius: 10, every: 11, name: 'Warbringer Nova', school: 'fire' },
    knockback: { chance: 0.25, distance: 6, name: 'Concussive Blast' },
    summonAdds: { mobId: 'breach_horror', count: 2, atHpPct: [0.66, 0.33] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.4, hasteMult: 1.2 },
    loot: [
      { copper: 6500, chance: 1 },
      { itemId: 'warbringers_hellforged_cuirass', chance: 0.3 },
      { itemId: 'khorvax_warcleaver', chance: 0.25 },
    ],
    scale: 1.55,
    color: 0x9c2f23,
  },
};

// ---------------------------------------------------------------------------
// NPCs (Last Bastion hub): neutral mercenaries under the truce-flag. No
// quests are given here; the Bastion sells, it does not ask.
// ---------------------------------------------------------------------------

export const BREACH_NPCS: Record<string, NpcDef> = {
  trucekeeper_maro: {
    id: 'trucekeeper_maro',
    name: 'Trucekeeper Maro',
    title: 'Warden of the Last Bastion',
    pos: { x: 4, z: 3155 },
    facing: -1.6,
    color: 0x7d7468,
    questIds: [],
    greeting:
      'Three banners drink under this roof and not one of them owns it. Keep your blade sheathed inside the wall, $C, and we will get along fine.',
  },
  provisioner_saskia: {
    id: 'provisioner_saskia',
    name: 'Provisioner Saskia',
    title: 'Sutler of the Bastion',
    pos: { x: -5, z: 3148 },
    facing: 1.3,
    color: 0xa8763e,
    questIds: [],
    vendorItems: [
      'bastion_hardtack',
      'trucewater_flask',
      'healing_potion',
      'mana_potion',
      'ashguard_robe',
      'breachwalker_jerkin',
      'bastion_plated_hauberk',
    ],
    greeting:
      'Kael coin, Veth coin, Ossara coin: it all spends the same out here, $C. Eat before the war does.',
  },
  armorer_dreng: {
    id: 'armorer_dreng',
    name: 'Armorer Dreng',
    title: 'Salvage Smith',
    pos: { x: 7, z: 3147 },
    facing: -2.6,
    color: 0x6e5f4c,
    questIds: [],
    vendorItems: ['bastion_arming_sword', 'mercenary_greatblade'],
    greeting:
      'Every blade I sell was pulled off this field, reforged, and sold back to it. Try to break the cycle, $C.',
  },
};

// ---------------------------------------------------------------------------
// Quests: none yet. The Breach is a battlefield, not an errand board; quest
// content is follow-up work, so the tables merge empty on purpose.
// ---------------------------------------------------------------------------

export const BREACH_QUESTS: Record<string, QuestDef> = {};

export const BREACH_QUEST_ORDER: string[] = [];

// ---------------------------------------------------------------------------
// Camps (spawn tables), ordered south to north so the level grade follows the
// war road. The x=0 road corridor stays clear; the packs cluster around the
// war-ruin POIs the way survivors cluster around cover.
// ---------------------------------------------------------------------------

export const BREACH_CAMPS: CampDef[] = [
  // Warped warhounds: the Sundered Field, southwest
  { mobId: 'warped_warhound', center: { x: -70, z: 3005 }, radius: 20, count: 7 },
  { mobId: 'warped_warhound', center: { x: -42, z: 3032 }, radius: 16, count: 6 },
  // Breach horrors: the Ember Scar, southeast
  { mobId: 'breach_horror', center: { x: 80, z: 3025 }, radius: 20, count: 7 },
  { mobId: 'breach_horror', center: { x: 52, z: 3052 }, radius: 16, count: 6 },
  // Mazhrekk stalks the Scar's north edge, collecting
  { mobId: 'mazhrekk_the_flesh_tithe', center: { x: 96, z: 3058 }, radius: 4, count: 1 },
  // Ember revenants: the Broken Siege Line, west
  { mobId: 'ember_revenant', center: { x: -105, z: 3078 }, radius: 20, count: 8 },
  { mobId: 'ember_revenant', center: { x: -78, z: 3102 }, radius: 16, count: 6 },
  // Magma elementals: the Ashen Saps and the cracked ground east of the road
  { mobId: 'magma_elemental', center: { x: 120, z: 3095 }, radius: 20, count: 7 },
  { mobId: 'magma_elemental', center: { x: 95, z: 3125 }, radius: 16, count: 6 },
  // Breachsworn: the wreck of the Third Offensive, northeast of the Bastion
  { mobId: 'breachsworn_deserter', center: { x: 90, z: 3185 }, radius: 18, count: 7 },
  { mobId: 'breachsworn_deserter', center: { x: 62, z: 3205 }, radius: 14, count: 5 },
  { mobId: 'butcher_vhorlan', center: { x: 104, z: 3208 }, radius: 4, count: 1 },
  // Ash wraiths: the Shattered Vanguard, northwest
  { mobId: 'ash_wraith', center: { x: -90, z: 3200 }, radius: 20, count: 7 },
  { mobId: 'ash_wraith', center: { x: -62, z: 3225 }, radius: 16, count: 6 },
  // Scavenger ogres: picking the far northwest fields
  { mobId: 'breach_scavenger_ogre', center: { x: -120, z: 3250 }, radius: 20, count: 6 },
  { mobId: 'breach_scavenger_ogre', center: { x: -95, z: 3270 }, radius: 16, count: 5 },
  // The Firstborn broods in the First Crater
  { mobId: 'firstborn_of_the_crater', center: { x: 110, z: 3242 }, radius: 3, count: 1 },
  // Ashwing drakes: the Molten Gate and the crater rim, far north
  { mobId: 'ashwing_drake', center: { x: -70, z: 3285 }, radius: 18, count: 6 },
  { mobId: 'ashwing_drake', center: { x: 120, z: 3280 }, radius: 18, count: 6 },
  // Warbringer Khorvax holds his redoubt on the north rim
  { mobId: 'warbringer_khorvax', center: { x: 55, z: 3300 }, radius: 3, count: 1 },
];

export const BREACH_OBJECTS: GroundObjectDef[] = [];

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const BREACH_ITEMS: Record<string, ItemDef> = {
  // --- junk / flavor drops ---
  scorched_banner_scrap: {
    id: 'scorched_banner_scrap',
    name: 'Scorched Banner Scrap',
    kind: 'junk',
    quality: 'poor',
    sellValue: 100,
  },
  melted_signet_ring: {
    id: 'melted_signet_ring',
    name: 'Melted Signet Ring',
    kind: 'junk',
    quality: 'poor',
    sellValue: 115,
  },
  cracked_horror_horn: {
    id: 'cracked_horror_horn',
    name: 'Cracked Horror Horn',
    kind: 'junk',
    quality: 'poor',
    sellValue: 110,
  },
  // --- vendor food / drink ---
  bastion_hardtack: {
    id: 'bastion_hardtack',
    name: 'Bastion Hardtack',
    kind: 'food',
    quality: 'common',
    foodHp: 2600,
    sellValue: 280,
    buyValue: 4500,
  },
  trucewater_flask: {
    id: 'trucewater_flask',
    name: 'Trucewater Flask',
    kind: 'drink',
    quality: 'common',
    drinkMana: 3800,
    sellValue: 280,
    buyValue: 4500,
  },
  // --- vendor armor ---
  ashguard_robe: {
    id: 'ashguard_robe',
    name: 'Ashguard Robe',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 136 },
    sellValue: 2250,
    buyValue: 22500,
  },
  breachwalker_jerkin: {
    id: 'breachwalker_jerkin',
    name: 'Breachwalker Jerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 260 },
    sellValue: 2350,
    buyValue: 23500,
  },
  bastion_plated_hauberk: {
    id: 'bastion_plated_hauberk',
    name: 'Bastion Plated Hauberk',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 462 },
    sellValue: 2500,
    buyValue: 25000,
  },
  // --- vendor weapons ---
  bastion_arming_sword: {
    id: 'bastion_arming_sword',
    name: 'Bastion Arming Sword',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 44, max: 70, speed: 2.4 },
    sellValue: 2300,
    buyValue: 23000,
  },
  mercenary_greatblade: {
    id: 'mercenary_greatblade',
    name: 'Mercenary Greatblade',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 46, max: 72, speed: 2.6 },
    sellValue: 2400,
    buyValue: 24000,
  },
  // --- rare-elite drops ---
  tithe_collectors_grasps: {
    id: 'tithe_collectors_grasps',
    name: "Tithe-Collector's Grasps",
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 163, agi: 20, sta: 13 },
    sellValue: 6000,
  },
  craterheart_mantle: {
    id: 'craterheart_mantle',
    name: 'Craterheart Mantle',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'rare',
    stats: { armor: 97, int: 22, sta: 15 },
    sellValue: 6500,
  },
  butchers_chainguard: {
    id: 'butchers_chainguard',
    name: "Butcher's Chainguard",
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 572, str: 22, sta: 20 },
    sellValue: 8000,
  },
  vhorlans_flensing_blade: {
    id: 'vhorlans_flensing_blade',
    name: "Vhorlan's Flensing Blade",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 50, max: 78, speed: 2.2 },
    stats: { agi: 16, sta: 10 },
    sellValue: 8500,
  },
  // --- boss drops (the only epics in the zone) ---
  warbringers_hellforged_cuirass: {
    id: 'warbringers_hellforged_cuirass',
    name: "Warbringer's Hellforged Cuirass",
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'epic',
    stats: { armor: 640, str: 24, sta: 22 },
    sellValue: 9000,
  },
  khorvax_warcleaver: {
    id: 'khorvax_warcleaver',
    name: 'Khorvax Warcleaver',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    weapon: { min: 58, max: 92, speed: 2.5 },
    stats: { str: 20, sta: 14 },
    sellValue: 9500,
  },
};

// ---------------------------------------------------------------------------
// Static props: a war-torn field, not a settlement. The Last Bastion gets one
// common hall inside a partial stockade; everything else out there is wreckage:
// shattered walls, dead camps, collapsed sap tunnels, and the crater rim.
// ---------------------------------------------------------------------------

export const BREACH_PROPS: ZonePropsDef = {
  buildings: [
    { kind: 'inn', x: -8, z: 3155, w: 7, d: 8, rot: 0.4 }, // the Bastion common hall
  ],
  wells: [{ x: 2, z: 3152, r: 1.5 }],
  stalls: [
    { x: -6, z: 3146, rot: 1.2, r: 1.7 }, // Provisioner Saskia
    { x: 8, z: 3145, rot: -1.4, r: 1.7 }, // Armorer Dreng
  ],
  mines: [
    { x: 135, z: 3078, rot: -1.6 }, // the Ashen Saps: a collapsed sap tunnel
    { x: -112, z: 3095, rot: 1.1 }, // sap dug under the Broken Siege Line
  ],
  docks: [],
  tents: [
    // dead war-camp on the Sundered Field
    { x: -64, z: 3012, rot: 0.3, scale: 1.0 },
    { x: -70, z: 3018, rot: -1.2, scale: 1.1 },
    // the wreck of the Third Offensive, now a Breachsworn camp
    { x: 86, z: 3180, rot: 0.7, scale: 1.1 },
    { x: 94, z: 3176, rot: 2.2, scale: 1.0 },
    { x: 96, z: 3192, rot: -0.9, scale: 1.1 },
    // the Shattered Vanguard's last bivouac
    { x: -84, z: 3198, rot: 1.4, scale: 1.2 },
    { x: -95, z: 3210, rot: -0.4, scale: 1.0 },
  ],
  crates: [
    [-4, 3158],
    [-66, 3014],
    [88, 3182],
    [-90, 3204],
  ],
  campfires: [
    [3, 3148], // the Bastion yard
    [-66, 3016], // the Sundered Field camp
    [88, 3186], // Breachsworn, the wreck
    [64, 3203], // Breachsworn, forward picket
    [-90, 3202], // the Shattered Vanguard
  ],
  mudHuts: [],
  ruinRings: [
    { x: -70, z: 3008, ringR: 8, columns: 6 }, // the Sundered Field shieldwall
    { x: -105, z: 3088, ringR: 9, columns: 7 }, // the Broken Siege Line
    { x: 90, z: 3188, ringR: 7, columns: 6 }, // the wreck of the Third Offensive
    { x: -90, z: 3206, ringR: 7, columns: 6 }, // the Shattered Vanguard
    { x: 110, z: 3242, ringR: 9, columns: 8 }, // the First Crater rim
    { x: -70, z: 3282, ringR: 8, columns: 7 }, // the Molten Gate
  ],
  fences: [
    // the Bastion stockade: a partial ring with gates where the road passes
    { x1: -14, z1: 3140, x2: -6, z2: 3136 }, // south gate, west run
    { x1: 6, z1: 3136, x2: 14, z2: 3140 }, // south gate, east run
    { x1: -16, z1: 3148, x2: -14, z2: 3140 }, // west palisade
    { x1: 14, z1: 3140, x2: 16, z2: 3148 }, // east palisade
    { x1: -14, z1: 3160, x2: -6, z2: 3164 }, // north gate, west run
    { x1: 6, z1: 3164, x2: 14, z2: 3160 }, // north gate, east run
  ],
  graveyards: [{ x: 20, z: 3134 }],
};
