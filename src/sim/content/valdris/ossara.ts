// Ossara Domain (levels 20-28): the southern desert power of Valdris and the
// first mainland zone after The Landing. The oldest civilization in the world
// is buried under these dunes: half-sunken aqueducts, tombs of gods whose
// names no one remembers correctly, and the Judges who claim to inherit it
// all. Qesh Aram, the sunbaked settlement around the great carved rock, keeps
// the caravan road open; everything older than Ossara would rather it did not.
//
// This file is the exemplar for every Valdris zone module: ZoneDef + roads +
// mobs + npcs + quests + camps + objects + items + props, merged by
// content/valdris/index.ts exactly like zone1/2/3 are merged by sim/data.ts.

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

export const OSSARA_ZONE: ZoneDef = {
  id: 'ossara_domain',
  name: 'Ossara Domain',
  zMin: 900,
  zMax: 1290,
  levelRange: [20, 28],
  biome: 'desert',
  hub: { x: 0, z: 1020, radius: 20, name: 'Qesh Aram' },
  graveyard: { x: 18, z: 1005 },
  lakes: [{ x: -80, z: 1150, radius: 14 }], // the Mirage Oasis
  pois: [
    { x: 0, z: 1020, label: 'Qesh Aram' },
    { x: 0, z: 950, label: 'The Caravan Road' },
    { x: -60, z: 970, label: 'Prowler Dunes' },
    { x: -120, z: 1060, label: 'Glasswind Flats' },
    { x: 90, z: 1060, label: 'Sunken Aqueduct' },
    { x: 60, z: 1150, label: 'Tombs of the Nameless' },
    { x: -80, z: 1150, label: 'Mirage Oasis' },
    { x: -120, z: 1210, label: 'Duststorm Rise' },
    { x: 40, z: 1240, label: "Judges' Terrace" },
    { x: 120, z: 1230, label: 'Bonewind Barrens' },
  ],
  welcome: 'Judge Saphira keeps the caravan road open from Qesh Aram, barely.',
  welcomeQuestId: 'q_dune_prowlers',
};

// The caravan road: down from the Thornpeak pass, through Qesh Aram, north to
// the Veth border pass, with spokes to the oasis and the aqueduct.
export const OSSARA_ROADS: { x: number; z: number }[][] = [
  [
    { x: 0, z: 900 },
    { x: 0, z: 960 },
    { x: 0, z: 1020 },
  ], // Thornpeak pass -> Qesh Aram
  [
    { x: 0, z: 1030 },
    { x: 0, z: 1150 },
    { x: 0, z: 1290 },
  ], // Qesh Aram -> Veth border pass
  [
    { x: -6, z: 1026 },
    { x: -45, z: 1085 },
    { x: -64, z: 1128 },
  ], // -> Mirage Oasis (ends at the shore; the oasis basin starts ~16yd out)
  [
    { x: 6, z: 1026 },
    { x: 60, z: 1050 },
    { x: 88, z: 1058 },
  ], // -> Sunken Aqueduct
];

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

export const OSSARA_MOBS: Record<string, MobTemplate> = {
  dune_prowler: {
    id: 'dune_prowler',
    name: 'Dune Prowler',
    minLevel: 20,
    maxLevel: 22,
    family: 'beast',
    hpBase: 70,
    hpPerLevel: 23,
    dmgBase: 12,
    dmgPerLevel: 2.8,
    attackSpeed: 1.9,
    armorPerLevel: 16,
    moveSpeed: 8.2,
    aggroRadius: 11,
    // Harrying Bite: pack hunters worry the wound as they circle.
    bleed: {
      chance: 0.25,
      perTick: 7,
      interval: 3,
      duration: 9,
      name: 'Harrying Bite',
      school: 'physical',
    },
    loot: [
      { copper: 110, chance: 1 },
      { itemId: 'dune_prowler_pelt', chance: 0.6, questId: 'q_dune_prowler_pelts' },
      { itemId: 'sunbleached_fang', chance: 0.35 },
    ],
    scale: 0.95,
    color: 0xc9a86a,
  },
  // The matriarch of the prowler packs: a rangy, scar-eared old huntress that
  // has dragged more than one caravan guard off the road at dusk.
  emberjaw_matriarch: {
    id: 'emberjaw_matriarch',
    name: 'Emberjaw Matriarch',
    minLevel: 22,
    maxLevel: 22,
    family: 'beast',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 7.2,
    hpBase: 380,
    hpPerLevel: 60,
    dmgBase: 18,
    dmgPerLevel: 4.2,
    attackSpeed: 1.7,
    armorPerLevel: 26,
    moveSpeed: 8.6,
    aggroRadius: 13,
    aoePulse: { min: 26, max: 36, radius: 8, every: 9, name: 'Ember Pounce', school: 'physical' },
    enrage: { belowHpPct: 0.35, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 300, chance: 1 },
      { itemId: 'emberjaw_pelt', chance: 1 },
      { itemId: 'emberjaw_prowlgrips', chance: 0.3 },
    ],
    scale: 1.3,
    color: 0xa8763e,
  },
  glasswind_scorpion: {
    id: 'glasswind_scorpion',
    name: 'Glasswind Scorpion',
    minLevel: 21,
    maxLevel: 23,
    family: 'spider',
    hpBase: 72,
    hpPerLevel: 24,
    dmgBase: 12,
    dmgPerLevel: 2.8,
    attackSpeed: 2.1,
    armorPerLevel: 22,
    moveSpeed: 7,
    aggroRadius: 10,
    // Glassvenom: a stinger of crystallized sand injects a searing toxin.
    bleed: {
      chance: 0.3,
      perTick: 8,
      interval: 3,
      duration: 12,
      name: 'Glassvenom Sting',
      school: 'nature',
    },
    loot: [
      { copper: 120, chance: 1 },
      { itemId: 'glasswind_stinger', chance: 0.5, questId: 'q_glasswind_venom' },
      { itemId: 'glasswind_husk', chance: 0.5, questId: 'q_glasswind_husks' },
      { itemId: 'cracked_scarab_shell', chance: 0.3 },
    ],
    scale: 1.0,
    color: 0xd9c48b,
  },
  tombrobber_scavenger: {
    id: 'tombrobber_scavenger',
    name: 'Tombrobber Scavenger',
    minLevel: 22,
    maxLevel: 24,
    family: 'humanoid',
    hpBase: 74,
    hpPerLevel: 24,
    dmgBase: 13,
    dmgPerLevel: 2.9,
    attackSpeed: 2.0,
    armorPerLevel: 20,
    moveSpeed: 7,
    aggroRadius: 11,
    // A grave-dust lantern swung at the eyes: the scavenger fights dirty.
    staggerHit: { chance: 0.3, dodgeReduction: 0.05, duration: 8, name: 'Grave-Dust Flash' },
    loot: [
      { copper: 140, chance: 1 },
      { itemId: 'stolen_relic', chance: 0.55, questId: 'q_tombrobbers' },
      { itemId: 'dig_manifest', chance: 0.5, questId: 'q_dig_manifests' },
      { itemId: 'aqueduct_bronze', chance: 0.5, questId: 'q_aqueduct_bronze' },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.0,
    color: 0x8f7a52,
  },
  sandbound_shade: {
    id: 'sandbound_shade',
    name: 'Sandbound Shade',
    minLevel: 23,
    maxLevel: 25,
    family: 'undead',
    hpBase: 76,
    hpPerLevel: 25,
    dmgBase: 14,
    dmgPerLevel: 3.0,
    attackSpeed: 2.3,
    armorPerLevel: 18,
    moveSpeed: 6.5,
    aggroRadius: 11,
    enervate: { chance: 0.3, sta: 16, duration: 12, name: 'Dust-Dry Grasp', school: 'shadow' },
    loot: [
      { copper: 150, chance: 1 },
      { itemId: 'nameless_burial_shroud', chance: 0.55, questId: 'q_sandbound' },
      { itemId: 'tomb_censer', chance: 0.5, questId: 'q_shade_censers' },
      { itemId: 'bone_fragments', chance: 0.4 },
    ],
    scale: 1.05,
    color: 0xd8cdb0,
  },
  duststorm_elemental: {
    id: 'duststorm_elemental',
    name: 'Duststorm Elemental',
    minLevel: 24,
    maxLevel: 26,
    family: 'elemental',
    hpBase: 78,
    hpPerLevel: 25,
    dmgBase: 14,
    dmgPerLevel: 3.1,
    attackSpeed: 2.2,
    armorPerLevel: 22,
    moveSpeed: 6.5,
    aggroRadius: 11,
    // Scouring Sand: a face full of storm-driven grit dulls every strike.
    staggerHit: { chance: 0.35, dodgeReduction: 0.05, duration: 8, name: 'Scouring Sand' },
    spellVuln: { chance: 0.25, amp: 0.18, duration: 10, name: 'Static Grit', school: 'nature' },
    loot: [
      { copper: 170, chance: 1 },
      { itemId: 'storm_glass_core', chance: 0.5, questId: 'q_duststorms' },
      { itemId: 'duststorm_heart', chance: 0.5, questId: 'q_rise_walks' },
    ],
    scale: 1.1,
    color: 0xcbb27a,
  },
  forsaken_judge: {
    id: 'forsaken_judge',
    name: 'Forsaken Judge',
    minLevel: 26,
    maxLevel: 28,
    family: 'undead',
    hpBase: 82,
    hpPerLevel: 26,
    dmgBase: 15,
    dmgPerLevel: 3.2,
    attackSpeed: 2.2,
    armorPerLevel: 24,
    moveSpeed: 6.8,
    aggroRadius: 12,
    // The dead Judges still pass sentence: a verdict that saps the will.
    enfeeble: { chance: 0.3, int: 14, duration: 12, name: 'Withered Verdict', school: 'shadow' },
    manaBurn: { chance: 0.25, amount: 90, name: 'Tithe of Silence', school: 'shadow' },
    loot: [
      { copper: 210, chance: 1 },
      { itemId: 'verdict_seal', chance: 0.5, questId: 'q_forsaken_judges' },
      { itemId: 'sentence_tablet', chance: 0.5, questId: 'q_judge_tablets' },
      { itemId: 'judge_regalia', chance: 0.5, questId: 'q_judge_regalia' },
      { itemId: 'frayed_prayer_beads', chance: 0.3 },
    ],
    scale: 1.1,
    color: 0xbfae8e,
  },
  // Karn dug too deep beneath the Tombs of the Nameless and came back up
  // wrong. The tombrobbers leave offerings at the shaft mouth so he stays down.
  karn_the_unburied: {
    id: 'karn_the_unburied',
    name: 'Karn the Unburied',
    minLevel: 27,
    maxLevel: 27,
    family: 'undead',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 520,
    hpPerLevel: 84,
    dmgBase: 24,
    dmgPerLevel: 5.2,
    attackSpeed: 2.3,
    armorPerLevel: 46,
    moveSpeed: 6.8,
    aggroRadius: 13,
    aoePulse: { min: 34, max: 46, radius: 10, every: 9, name: 'Grave Sand', school: 'shadow' },
    summonAdds: { mobId: 'sandbound_shade', count: 2, atHpPct: [0.5] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.45, hasteMult: 1.25 },
    loot: [
      { copper: 700, chance: 1 },
      { itemId: 'karns_funeral_mask', chance: 1 },
      { itemId: 'unburied_gravewraps', chance: 0.3 },
    ],
    scale: 1.25,
    color: 0xcfc3a4,
  },
  // The Bonewind Barrens' apex predator: a dune-burrowing basilisk the clans
  // call a tyrant for how it taxes every caravan that strays off the road.
  sandmaw_tyrant: {
    id: 'sandmaw_tyrant',
    name: 'Sandmaw Tyrant',
    minLevel: 28,
    maxLevel: 28,
    family: 'dragonkin',
    elite: true,
    boss: true,
    hpBase: 260,
    hpPerLevel: 36,
    dmgBase: 15,
    dmgPerLevel: 3.2,
    attackSpeed: 2.5,
    armorPerLevel: 30,
    moveSpeed: 7,
    aggroRadius: 14,
    aoePulse: { min: 28, max: 38, radius: 10, every: 11, name: 'Sand Geyser', school: 'nature' },
    knockback: { chance: 0.25, distance: 6, name: 'Tail Sweep' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.4, hasteMult: 1.2 },
    loot: [
      { copper: 2600, chance: 1 },
      { itemId: 'sandmaw_scale_cuirass', chance: 0.3 },
      { itemId: 'tyrantfang_edge', chance: 0.25 },
    ],
    scale: 1.5,
    color: 0xc98d4a,
  },
  // The heat-shimmer over the Mirage Oasis hides a predator that learned to
  // hunt inside the lie. The water carriers say the oasis is "guarded" and
  // they mean this.
  mirage_stalker: {
    id: 'mirage_stalker',
    name: 'Mirage Stalker',
    minLevel: 23,
    maxLevel: 25,
    family: 'beast',
    canSwim: true,
    hpBase: 76,
    hpPerLevel: 25,
    dmgBase: 14,
    dmgPerLevel: 3.0,
    attackSpeed: 2.0,
    armorPerLevel: 18,
    moveSpeed: 8.0,
    aggroRadius: 11,
    // Heat Shimmer: the stalker blurs at the edge of a swing and blades slide wide.
    staggerHit: { chance: 0.3, dodgeReduction: 0.05, duration: 8, name: 'Heat Shimmer' },
    loot: [
      { copper: 160, chance: 1 },
      { itemId: 'mirage_stalker_eye', chance: 0.5, questId: 'q_mirage_eyes' },
      { itemId: 'sunbleached_fang', chance: 0.3 },
    ],
    scale: 1.0,
    color: 0xd8c9a3,
  },
  // Bone-picking pack hunters of the Bonewind Barrens: patient, tireless, and
  // never far from anything that bleeds.
  bonewind_ravager: {
    id: 'bonewind_ravager',
    name: 'Bonewind Ravager',
    minLevel: 26,
    maxLevel: 28,
    family: 'beast',
    hpBase: 82,
    hpPerLevel: 26,
    dmgBase: 15,
    dmgPerLevel: 3.2,
    attackSpeed: 1.9,
    armorPerLevel: 20,
    moveSpeed: 8.2,
    aggroRadius: 12,
    // Worrying Bite: a ravager does not let go so much as tear free.
    bleed: {
      chance: 0.3,
      perTick: 9,
      interval: 3,
      duration: 9,
      name: 'Worrying Bite',
      school: 'physical',
    },
    loot: [
      { copper: 200, chance: 1 },
      { itemId: 'ravager_hide', chance: 0.5, questId: 'q_ravager_hides' },
      { itemId: 'sunbleached_fang', chance: 0.35 },
    ],
    scale: 1.05,
    color: 0xb99a66,
  },
};

// ---------------------------------------------------------------------------
// NPCs (Qesh Aram hub)
// ---------------------------------------------------------------------------

export const OSSARA_NPCS: Record<string, NpcDef> = {
  judge_saphira: {
    id: 'judge_saphira',
    name: 'Judge Saphira',
    title: 'Judge of the Domain',
    pos: { x: 4, z: 1024 },
    facing: -2.0,
    color: 0xc9762a,
    questIds: [
      'q_dune_prowlers',
      'q_emberjaw_matriarch',
      'q_tombrobbers',
      'q_sandbound',
      'q_forsaken_judges',
      'q_bonewind_ravagers',
      'q_sandmaw',
    ],
    greeting:
      'Ossara does not ask for heroes, $C. It asks for hands that finish what they start. Show me yours.',
  },
  caravan_master_odai: {
    id: 'caravan_master_odai',
    name: 'Caravan Master Odai',
    title: 'Master of the Qesh Road',
    pos: { x: -6, z: 1028 },
    facing: 1.4,
    color: 0xb08948,
    questIds: ['q_dune_prowler_pelts', 'q_duststorms', 'q_rise_walks', 'q_ravager_hides'],
    vendorItems: [
      'qesh_flatbread',
      'oasis_waterskin',
      'spiced_scarab_skewer',
      'healing_potion',
      'mana_potion',
      'duneweave_robe',
      'caravan_guard_hauberk',
      'prowlerhide_vest',
      'sandwalker_treads',
      'dunewatch_legguards',
    ],
    greeting: 'Water, bread, and boots that keep the sand out: the road runs on all three, $C.',
  },
  armorer_khet: {
    id: 'armorer_khet',
    name: 'Armorer Khet',
    title: 'Stone-Quarter Smith',
    pos: { x: -2, z: 1032 },
    facing: 2.8,
    color: 0x8d6e46,
    questIds: ['q_glasswind_venom', 'q_aqueduct_bronze', 'q_judge_regalia'],
    vendorItems: ['qesh_khopesh', 'judgestaff_of_ossara', 'glasswind_talon'],
    greeting: 'Steel keeps its edge here if you oil it against the sand. If it cuts, I sell it.',
  },
  oasis_keeper_neriah: {
    id: 'oasis_keeper_neriah',
    name: 'Oasis Keeper Neriah',
    title: 'Keeper of the Mirage Oasis',
    pos: { x: -12, z: 1018 },
    facing: 1.1,
    color: 0x4f86a0,
    questIds: ['q_oasis_waterline', 'q_glasswind_husks', 'q_mirage_stalkers', 'q_mirage_eyes'],
    greeting:
      "Every drop Qesh Aram drinks walks in from the oasis on somebody's back, $C. Help me keep the road it walks.",
  },
  relic_warden_temos: {
    id: 'relic_warden_temos',
    name: 'Relic-Warden Temos',
    title: 'Warden of the Buried Faith',
    pos: { x: 12, z: 1014 },
    facing: -2.6,
    color: 0x9a7b3f,
    questIds: ['q_dig_manifests', 'q_shade_censers', 'q_judge_tablets', 'q_karn_unburied'],
    greeting:
      'The Domain guards what the sand keeps, $C. My office counts what it has already lost.',
  },
};

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export const OSSARA_QUESTS: Record<string, QuestDef> = {
  q_dune_prowlers: {
    id: 'q_dune_prowlers',
    name: 'The Road Bleeds',
    giverNpcId: 'judge_saphira',
    turnInNpcId: 'judge_saphira',
    text: 'The prowler packs have learned the caravan bell means food, $N. Every wagon we lose feeds them and starves Qesh Aram. Thin the packs on the dunes flanking the south road: twelve, to start.',
    completionText:
      'Twelve fewer shadows pacing the wagons. The road breathes tonight, and so do I.',
    objectives: [
      { type: 'kill', targetMobId: 'dune_prowler', count: 12, label: 'Dune Prowler slain' },
    ],
    xpReward: 5200,
    copperReward: 2600,
    itemRewards: {},
    minLevel: 19,
  },
  q_dune_prowler_pelts: {
    id: 'q_dune_prowler_pelts',
    name: 'Pelts for the North Road',
    giverNpcId: 'caravan_master_odai',
    turnInNpcId: 'caravan_master_odai',
    text: 'Desert nights strip the heat out of you faster than any snow, $N. Eight prowler pelts will line enough bedrolls to get my next caravan over the Veth passes alive.',
    completionText:
      'Thick and warm. The north caravan leaves at dawn; take these treads for your trouble.',
    objectives: [
      { type: 'collect', itemId: 'dune_prowler_pelt', count: 8, label: 'Dune Prowler Pelt' },
    ],
    xpReward: 5400,
    copperReward: 2600,
    itemRewards: {
      warrior: 'sandwalker_treads',
      mage: 'sandwalker_treads',
      rogue: 'sandwalker_treads',
    },
  },
  q_glasswind_venom: {
    id: 'q_glasswind_venom',
    name: 'Venom in the Glass',
    giverNpcId: 'armorer_khet',
    turnInNpcId: 'armorer_khet',
    text: 'The scorpions out on the Glasswind Flats sting through boiled leather like it was linen. I want six stingers, $N: whatever they temper their glass with, I mean to temper my steel with it.',
    completionText:
      'Look at that edge drink the venom in. The next blade I sell you will bite deeper than anything on these flats.',
    objectives: [
      { type: 'collect', itemId: 'glasswind_stinger', count: 6, label: 'Glasswind Stinger' },
    ],
    xpReward: 5600,
    copperReward: 2800,
    itemRewards: {},
    minLevel: 21,
  },
  q_tombrobbers: {
    id: 'q_tombrobbers',
    name: 'What the Sand Keeps',
    giverNpcId: 'judge_saphira',
    turnInNpcId: 'judge_saphira',
    text: 'The scavengers picking at the Sunken Aqueduct are not treasure hunters, $N; they are hired hands, and their masters want what Ossara keeps buried. Kill ten, and bring me four of the relics they have already pried loose.',
    completionText:
      'These relics belong to the faith, not to whoever holds the heavier purse. The Domain remembers this service.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'tombrobber_scavenger',
        count: 10,
        label: 'Tombrobber Scavenger slain',
      },
      { type: 'collect', itemId: 'stolen_relic', count: 4, label: 'Stolen Relic' },
    ],
    xpReward: 6200,
    copperReward: 3000,
    itemRewards: {},
    requiresQuest: 'q_dune_prowlers',
    minLevel: 22,
  },
  q_sandbound: {
    id: 'q_sandbound',
    name: 'The Unquiet Tombs',
    giverNpcId: 'judge_saphira',
    turnInNpcId: 'judge_saphira',
    text: 'The robbers broke more than seals, $N. The dead of the old civilization walk the Tombs of the Nameless, wrapped in shrouds older than any faction. Put twelve shades to rest and bring me five shrouds; the rites require them whole.',
    completionText:
      'The shrouds will be reburied with the rites they were owed. What the sand keeps, $N, it keeps for a reason.',
    objectives: [
      { type: 'kill', targetMobId: 'sandbound_shade', count: 12, label: 'Sandbound Shade slain' },
      {
        type: 'collect',
        itemId: 'nameless_burial_shroud',
        count: 5,
        label: 'Nameless Burial Shroud',
      },
    ],
    xpReward: 6800,
    copperReward: 3200,
    itemRewards: {},
    requiresQuest: 'q_tombrobbers',
    minLevel: 23,
  },
  q_duststorms: {
    id: 'q_duststorms',
    name: 'Glass in the Wind',
    giverNpcId: 'caravan_master_odai',
    turnInNpcId: 'caravan_master_odai',
    text: 'Duststorm Rise did not use to walk, $N. Now the storms come down the dunes with shapes inside them, and my drivers refuse the west fork outright. Break twelve of the elementals and bring me six of the storm-glass cores they leave behind.',
    completionText:
      'The cores still hum like wind through wire. The west fork reopens tomorrow; you have my thanks and my coin.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'duststorm_elemental',
        count: 12,
        label: 'Duststorm Elemental slain',
      },
      { type: 'collect', itemId: 'storm_glass_core', count: 6, label: 'Storm-Glass Core' },
    ],
    xpReward: 7400,
    copperReward: 3600,
    itemRewards: {},
    minLevel: 24,
  },
  q_forsaken_judges: {
    id: 'q_forsaken_judges',
    name: 'The First Verdicts',
    giverNpcId: 'judge_saphira',
    turnInNpcId: 'judge_saphira',
    text: "On the terrace above the tombs, the first Judges still hold court, dead two ages and still passing sentence on anything that climbs the stair. I will not pretend it is not heresy to say it, $N: put twelve of them down, and bring me three of their verdict seals. The Domain's claim rests on what those seals say.",
    completionText:
      'So the first verdicts name no heir at all... This stays between us, $N. The Domain rests on older claims than truth.',
    objectives: [
      { type: 'kill', targetMobId: 'forsaken_judge', count: 12, label: 'Forsaken Judge slain' },
      { type: 'collect', itemId: 'verdict_seal', count: 3, label: 'Verdict Seal' },
    ],
    xpReward: 8200,
    copperReward: 4000,
    itemRewards: {},
    requiresQuest: 'q_sandbound',
    minLevel: 26,
  },
  q_sandmaw: {
    id: 'q_sandmaw',
    name: 'The Tyrant of the Barrens',
    giverNpcId: 'judge_saphira',
    turnInNpcId: 'judge_saphira',
    text: 'Every caravan that crosses the Bonewind Barrens pays a toll in oxen or in drivers, and the collector is a basilisk the clans have named the Sandmaw Tyrant. Take companions, $N: when the sand geysers, do not be standing where you were. End it, for the Domain.',
    completionText:
      'The Barrens toll is repealed, $N. The clans will sing the beast bigger every year; let them. You and I know exactly how big it was.',
    objectives: [
      { type: 'kill', targetMobId: 'sandmaw_tyrant', count: 1, label: 'Sandmaw Tyrant slain' },
    ],
    xpReward: 9000,
    copperReward: 5000,
    itemRewards: {
      warrior: 'tyrantfang_edge',
      mage: 'judgestaff_of_ossara',
      rogue: 'glasswind_talon',
    },
    requiresQuest: 'q_forsaken_judges',
    suggestedPlayers: 3,
    minLevel: 27,
  },
  // --- Oasis Keeper Neriah: the water road and the Mirage Oasis ---
  q_oasis_waterline: {
    id: 'q_oasis_waterline',
    name: 'Teeth at the Waterline',
    giverNpcId: 'oasis_keeper_neriah',
    turnInNpcId: 'oasis_keeper_neriah',
    text: 'The prowlers have learned that everything alive in this desert comes to water sooner or later, $N. My carriers will not walk the oasis road while the packs hold it. Clear sixteen from the dunes between here and the shore.',
    completionText:
      'The carriers shouldered their yokes within the hour of your word reaching them. Water walks again, $N.',
    objectives: [
      { type: 'kill', targetMobId: 'dune_prowler', count: 16, label: 'Dune Prowler slain' },
    ],
    xpReward: 5200,
    copperReward: 2600,
    itemRewards: {},
    minLevel: 20,
  },
  q_glasswind_husks: {
    id: 'q_glasswind_husks',
    name: 'The Dew Carriers',
    giverNpcId: 'oasis_keeper_neriah',
    turnInNpcId: 'oasis_keeper_neriah',
    text: 'A scorpion husk holds the cold of the night long past noon, $N; the old carriers lined their water jars with them, and what I line does not spoil. Kill twelve of the glasswind scorpions and bring me eight husks worth the name.',
    completionText:
      'Feel how the shade lives inside the shell? Eight jars will cross the flats now without turning foul.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'glasswind_scorpion',
        count: 12,
        label: 'Glasswind Scorpion slain',
      },
      { type: 'collect', itemId: 'glasswind_husk', count: 8, label: 'Glasswind Husk' },
    ],
    xpReward: 5800,
    copperReward: 2900,
    itemRewards: {},
    requiresQuest: 'q_oasis_waterline',
    minLevel: 21,
  },
  q_mirage_stalkers: {
    id: 'q_mirage_stalkers',
    name: 'What Walks in the Shimmer',
    giverNpcId: 'oasis_keeper_neriah',
    turnInNpcId: 'oasis_keeper_neriah',
    text: 'The heat over the oasis has learned to stalk, $N. Beasts hunt inside the shimmer where the eye gives up, and two of my carriers did not come back from the shallows. Kill sixteen of the mirage stalkers, and do not trust your own shadow while you do it.',
    completionText:
      'Sixteen, and the shimmer is only heat again. The oasis owes you, $N, and the oasis pays its debts.',
    objectives: [
      { type: 'kill', targetMobId: 'mirage_stalker', count: 16, label: 'Mirage Stalker slain' },
    ],
    xpReward: 7000,
    copperReward: 3400,
    itemRewards: {},
    requiresQuest: 'q_glasswind_husks',
    minLevel: 23,
  },
  q_mirage_eyes: {
    id: 'q_mirage_eyes',
    name: 'Eyes That Hold the Lie',
    giverNpcId: 'oasis_keeper_neriah',
    turnInNpcId: 'oasis_keeper_neriah',
    text: "A stalker's eye does not see the desert we see, $N: it sees the lie laid over it. The faith has uses for glass like that. Bring me eight eyes whole, and put down another twelve of the beasts so the shimmer stays honest.",
    completionText:
      'Look into one long enough and the oasis doubles... enough of that. These go to the Judges under seal, $N, and we both drink easier.',
    objectives: [
      { type: 'kill', targetMobId: 'mirage_stalker', count: 12, label: 'Mirage Stalker slain' },
      { type: 'collect', itemId: 'mirage_stalker_eye', count: 8, label: 'Mirage Stalker Eye' },
    ],
    xpReward: 7800,
    copperReward: 3800,
    itemRewards: {},
    requiresQuest: 'q_mirage_stalkers',
    minLevel: 24,
  },
  // --- Relic-Warden Temos: the buried faith and what was taken from it ---
  q_dig_manifests: {
    id: 'q_dig_manifests',
    name: 'Paper for the Warden',
    giverNpcId: 'relic_warden_temos',
    turnInNpcId: 'relic_warden_temos',
    text: 'Every relic the tombrobbers pry loose is tallied on a dig manifest before it leaves the sand, $N. Names, weights, buyers. Kill twelve of the scavengers at the aqueduct and bring me eight manifests; I will burn their trade road out from under them.',
    completionText:
      'Buyers in three cities, and two names I have dined with... The Domain thanks you, $N. The knives that follow this paper will not be mine.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'tombrobber_scavenger',
        count: 12,
        label: 'Tombrobber Scavenger slain',
      },
      { type: 'collect', itemId: 'dig_manifest', count: 8, label: 'Dig Manifest' },
    ],
    xpReward: 6400,
    copperReward: 3200,
    itemRewards: {},
    minLevel: 22,
  },
  q_shade_censers: {
    id: 'q_shade_censers',
    name: 'Smoke for the Nameless',
    giverNpcId: 'relic_warden_temos',
    turnInNpcId: 'relic_warden_temos',
    text: 'The shades in the tombs were censer-bearers once, $N; they clutch the bronze they carried in life, and the rites cannot be sung over an empty bowl. Put sixteen of them to rest and recover six censers. Handle the bronze gently; the dead notice.',
    completionText:
      'Six bowls, and not one dropped. We will fill them with sweetgrass, and the Nameless will sleep another age, $N.',
    objectives: [
      { type: 'kill', targetMobId: 'sandbound_shade', count: 16, label: 'Sandbound Shade slain' },
      { type: 'collect', itemId: 'tomb_censer', count: 6, label: 'Tomb Censer' },
    ],
    xpReward: 7200,
    copperReward: 3600,
    itemRewards: {},
    requiresQuest: 'q_dig_manifests',
    minLevel: 23,
  },
  q_judge_tablets: {
    id: 'q_judge_tablets',
    name: 'The Sentences in Stone',
    giverNpcId: 'relic_warden_temos',
    turnInNpcId: 'relic_warden_temos',
    text: 'Before seals, the first court cut its sentences into stone, $N, and the dead Judges on the terrace still carry the tablets they died holding. Saphira keeps the seals; I want the sentences. Sixteen Judges, five tablets, and say nothing of this in the square.',
    completionText:
      'Read here: exile, exile, exile... and mercy. So the first court bent once. That is worth more than every seal in the Domain, $N.',
    objectives: [
      { type: 'kill', targetMobId: 'forsaken_judge', count: 16, label: 'Forsaken Judge slain' },
      { type: 'collect', itemId: 'sentence_tablet', count: 5, label: 'Sentence Tablet' },
    ],
    xpReward: 9400,
    copperReward: 4600,
    itemRewards: {},
    requiresQuest: 'q_shade_censers',
    minLevel: 26,
  },
  q_karn_unburied: {
    id: 'q_karn_unburied',
    name: 'What Karn Brought Up',
    giverNpcId: 'relic_warden_temos',
    turnInNpcId: 'relic_warden_temos',
    text: 'The tombrobbers leave offerings so Karn stays down the shaft, $N, and lately he does not stay. Whatever he found beneath the Tombs of the Nameless, he carried it back up in place of his own soul. Take companions to the shaft mouth and bury him properly this time.',
    completionText:
      'Down, and buried with the rites owed him. Whatever Karn found stays found by no one, $N. The Domain owes you a debt it will pretend it never carried.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'karn_the_unburied',
        count: 1,
        label: 'Karn the Unburied slain',
      },
    ],
    xpReward: 13000,
    copperReward: 6000,
    itemRewards: {},
    requiresQuest: 'q_judge_tablets',
    suggestedPlayers: 3,
    minLevel: 27,
  },
  // --- Judge Saphira: the road, continued ---
  q_emberjaw_matriarch: {
    id: 'q_emberjaw_matriarch',
    name: "The Matriarch's Toll",
    giverNpcId: 'judge_saphira',
    turnInNpcId: 'judge_saphira',
    text: 'Cull the packs all you like, $N; while the Emberjaw Matriarch dens above the south road they will always come back. She has dragged guards off moving wagons in daylight. Take help, corner her, and end her line.',
    completionText:
      'The old huntress is down. The packs will scatter leaderless for a season, and the road will feel it, $N.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'emberjaw_matriarch',
        count: 1,
        label: 'Emberjaw Matriarch slain',
      },
    ],
    xpReward: 6500,
    copperReward: 3200,
    itemRewards: {},
    requiresQuest: 'q_dune_prowlers',
    suggestedPlayers: 3,
    minLevel: 21,
  },
  q_bonewind_ravagers: {
    id: 'q_bonewind_ravagers',
    name: 'The Barrens Pack',
    giverNpcId: 'judge_saphira',
    turnInNpcId: 'judge_saphira',
    text: 'The Bonewind Barrens keep their own tax collectors, $N: ravager packs that strip a fallen ox to bright bone before the drivers can cut it loose. The Tyrant is not the only reason caravans refuse the northeast. Break the packs; sixteen ravagers.',
    completionText:
      'The clans report the packs thinned and shy of torchlight. That is as close to gratitude as the Barrens come, $N.',
    objectives: [
      { type: 'kill', targetMobId: 'bonewind_ravager', count: 16, label: 'Bonewind Ravager slain' },
    ],
    xpReward: 9000,
    copperReward: 4400,
    itemRewards: {},
    requiresQuest: 'q_forsaken_judges',
    minLevel: 26,
  },
  // --- Caravan Master Odai: the road, provisioned ---
  q_rise_walks: {
    id: 'q_rise_walks',
    name: 'The Rise Still Walks',
    giverNpcId: 'caravan_master_odai',
    turnInNpcId: 'caravan_master_odai',
    text: 'I reopened the west fork too soon, $N. The storms came back down the Rise with hearts beating grit inside them, and this time they took a wagon whole. Break sixteen more of the elementals and cut out eight of the storm-hearts; I want to know what drives them.',
    completionText:
      'Still warm, and humming like the inside of thunder. These go to wiser heads than mine, $N; the fork stays open either way.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'duststorm_elemental',
        count: 16,
        label: 'Duststorm Elemental slain',
      },
      { type: 'collect', itemId: 'duststorm_heart', count: 8, label: 'Duststorm Heart' },
    ],
    xpReward: 8600,
    copperReward: 4200,
    itemRewards: {},
    requiresQuest: 'q_duststorms',
    minLevel: 25,
  },
  q_ravager_hides: {
    id: 'q_ravager_hides',
    name: 'Hides for the High Passes',
    giverNpcId: 'caravan_master_odai',
    turnInNpcId: 'caravan_master_odai',
    text: 'Prowler pelt lines a bedroll, $N, but ravager hide turns wind like a shed wall, and the Veth passes will kill a driver the pelts would only chill. Bring me eight barrens ravager hides, and thin ten of the brutes while you are cutting.',
    completionText:
      'Stiff as boot leather and twice as warm. My drivers will curse the smell all the way up to Veth and thank me at the top, $N.',
    objectives: [
      { type: 'kill', targetMobId: 'bonewind_ravager', count: 10, label: 'Bonewind Ravager slain' },
      { type: 'collect', itemId: 'ravager_hide', count: 8, label: 'Ravager Hide' },
    ],
    xpReward: 9200,
    copperReward: 4400,
    itemRewards: {},
    requiresQuest: 'q_rise_walks',
    minLevel: 26,
  },
  // --- Armorer Khet: old metal, new work ---
  q_aqueduct_bronze: {
    id: 'q_aqueduct_bronze',
    name: 'Old Bronze, New Edges',
    giverNpcId: 'armorer_khet',
    turnInNpcId: 'armorer_khet',
    text: 'The scavengers strip bronze fittings off the Sunken Aqueduct and sell them for scrap, $N. Scrap! That alloy outlived the civilization that poured it. Kill ten of the scavengers and bring me eight fittings; I will fold old kingdom into new steel.',
    completionText:
      'Look at the color in that metal. Whatever the old kingdom knew, a sliver of it goes into every blade I strike from this, $N.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'tombrobber_scavenger',
        count: 10,
        label: 'Tombrobber Scavenger slain',
      },
      { type: 'collect', itemId: 'aqueduct_bronze', count: 8, label: 'Aqueduct Bronze Fitting' },
    ],
    xpReward: 6200,
    copperReward: 3000,
    itemRewards: {},
    requiresQuest: 'q_glasswind_venom',
    minLevel: 22,
  },
  q_judge_regalia: {
    id: 'q_judge_regalia',
    name: 'Rust of the First Court',
    giverNpcId: 'armorer_khet',
    turnInNpcId: 'armorer_khet',
    text: 'The dead Judges on the terrace wear regalia older than the Domain that claims them, $N, and in two ages the metal has not rusted. I need six pieces, and the twelve Judges wearing them will not be persuaded politely.',
    completionText:
      'No rust, no pitting, and it sings when struck. Armor from this will outlive us both, $N, and I intend to test that personally.',
    objectives: [
      { type: 'kill', targetMobId: 'forsaken_judge', count: 12, label: 'Forsaken Judge slain' },
      { type: 'collect', itemId: 'judge_regalia', count: 6, label: 'First Court Regalia' },
    ],
    xpReward: 10800,
    copperReward: 5200,
    itemRewards: {},
    requiresQuest: 'q_aqueduct_bronze',
    minLevel: 27,
  },
};

export const OSSARA_QUEST_ORDER = [
  'q_dune_prowlers',
  'q_dune_prowler_pelts',
  'q_glasswind_venom',
  'q_tombrobbers',
  'q_sandbound',
  'q_duststorms',
  'q_forsaken_judges',
  'q_sandmaw',
  'q_oasis_waterline',
  'q_emberjaw_matriarch',
  'q_glasswind_husks',
  'q_aqueduct_bronze',
  'q_dig_manifests',
  'q_mirage_stalkers',
  'q_shade_censers',
  'q_mirage_eyes',
  'q_rise_walks',
  'q_bonewind_ravagers',
  'q_ravager_hides',
  'q_judge_tablets',
  'q_judge_regalia',
  'q_karn_unburied',
];

// ---------------------------------------------------------------------------
// Camps (spawn tables), merged AFTER every existing camp in data.ts, and in
// this order relative to the other Valdris zones, so world-gen RNG draw order
// for pre-existing content never shifts.
// ---------------------------------------------------------------------------

export const OSSARA_CAMPS: CampDef[] = [
  // Prowlers: the dunes flanking the caravan road south of town
  { mobId: 'dune_prowler', center: { x: -60, z: 965 }, radius: 22, count: 7 },
  { mobId: 'dune_prowler', center: { x: 48, z: 975 }, radius: 20, count: 6 },
  { mobId: 'emberjaw_matriarch', center: { x: -88, z: 952 }, radius: 5, count: 1 },
  // Scorpions: Glasswind Flats, far west
  { mobId: 'glasswind_scorpion', center: { x: -120, z: 1055 }, radius: 20, count: 8 },
  { mobId: 'glasswind_scorpion', center: { x: -145, z: 1090 }, radius: 16, count: 6 },
  // Tombrobbers: the Sunken Aqueduct, east
  { mobId: 'tombrobber_scavenger', center: { x: 90, z: 1055 }, radius: 20, count: 8 },
  { mobId: 'tombrobber_scavenger', center: { x: 115, z: 1085 }, radius: 16, count: 6 },
  // Shades: Tombs of the Nameless, center-north
  { mobId: 'sandbound_shade', center: { x: 60, z: 1145 }, radius: 20, count: 8 },
  { mobId: 'sandbound_shade', center: { x: 40, z: 1170 }, radius: 16, count: 6 },
  { mobId: 'karn_the_unburied', center: { x: 74, z: 1178 }, radius: 5, count: 1 },
  // Duststorm elementals: Duststorm Rise, northwest
  { mobId: 'duststorm_elemental', center: { x: -120, z: 1205 }, radius: 20, count: 8 },
  { mobId: 'duststorm_elemental', center: { x: -95, z: 1235 }, radius: 16, count: 6 },
  // Forsaken Judges: the terrace stair, north
  { mobId: 'forsaken_judge', center: { x: 40, z: 1235 }, radius: 18, count: 7 },
  { mobId: 'forsaken_judge', center: { x: 66, z: 1255 }, radius: 14, count: 5 },
  // The Sandmaw Tyrant: Bonewind Barrens, northeast
  { mobId: 'sandmaw_tyrant', center: { x: 120, z: 1228 }, radius: 3, count: 1 },
  // Mirage stalkers: the shimmer around the Mirage Oasis (clear of the water)
  { mobId: 'mirage_stalker', center: { x: -104, z: 1128 }, radius: 16, count: 7 },
  { mobId: 'mirage_stalker', center: { x: -58, z: 1172 }, radius: 14, count: 6 },
  // Bonewind ravagers: the barrens flats below the Tyrant's ground
  { mobId: 'bonewind_ravager', center: { x: 132, z: 1204 }, radius: 16, count: 7 },
  { mobId: 'bonewind_ravager', center: { x: 98, z: 1254 }, radius: 14, count: 6 },
];

export const OSSARA_OBJECTS: GroundObjectDef[] = [];

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const OSSARA_ITEMS: Record<string, ItemDef> = {
  // --- quest items ---
  dune_prowler_pelt: {
    id: 'dune_prowler_pelt',
    name: 'Dune Prowler Pelt',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_dune_prowler_pelts',
  },
  glasswind_stinger: {
    id: 'glasswind_stinger',
    name: 'Glasswind Stinger',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_glasswind_venom',
  },
  stolen_relic: {
    id: 'stolen_relic',
    name: 'Stolen Relic',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_tombrobbers',
  },
  nameless_burial_shroud: {
    id: 'nameless_burial_shroud',
    name: 'Nameless Burial Shroud',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_sandbound',
  },
  storm_glass_core: {
    id: 'storm_glass_core',
    name: 'Storm-Glass Core',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_duststorms',
  },
  verdict_seal: {
    id: 'verdict_seal',
    name: 'Verdict Seal',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_forsaken_judges',
  },
  glasswind_husk: {
    id: 'glasswind_husk',
    name: 'Glasswind Husk',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_glasswind_husks',
  },
  mirage_stalker_eye: {
    id: 'mirage_stalker_eye',
    name: 'Mirage Stalker Eye',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_mirage_eyes',
  },
  dig_manifest: {
    id: 'dig_manifest',
    name: 'Dig Manifest',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_dig_manifests',
  },
  tomb_censer: {
    id: 'tomb_censer',
    name: 'Tomb Censer',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_shade_censers',
  },
  sentence_tablet: {
    id: 'sentence_tablet',
    name: 'Sentence Tablet',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_judge_tablets',
  },
  duststorm_heart: {
    id: 'duststorm_heart',
    name: 'Duststorm Heart',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_rise_walks',
  },
  ravager_hide: {
    id: 'ravager_hide',
    name: 'Ravager Hide',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_ravager_hides',
  },
  aqueduct_bronze: {
    id: 'aqueduct_bronze',
    name: 'Aqueduct Bronze Fitting',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_aqueduct_bronze',
  },
  judge_regalia: {
    id: 'judge_regalia',
    name: 'First Court Regalia',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_judge_regalia',
  },
  // --- junk / flavor drops ---
  sunbleached_fang: {
    id: 'sunbleached_fang',
    name: 'Sunbleached Fang',
    kind: 'junk',
    quality: 'poor',
    sellValue: 40,
  },
  cracked_scarab_shell: {
    id: 'cracked_scarab_shell',
    name: 'Cracked Scarab Shell',
    kind: 'junk',
    quality: 'poor',
    sellValue: 45,
  },
  emberjaw_pelt: {
    id: 'emberjaw_pelt',
    name: 'Pelt of the Emberjaw Matriarch',
    kind: 'junk',
    quality: 'uncommon',
    sellValue: 800,
  },
  karns_funeral_mask: {
    id: 'karns_funeral_mask',
    name: "Karn's Funeral Mask",
    kind: 'junk',
    quality: 'uncommon',
    sellValue: 900,
  },
  // --- vendor food / drink ---
  qesh_flatbread: {
    id: 'qesh_flatbread',
    name: 'Qesh Flatbread',
    kind: 'food',
    quality: 'common',
    foodHp: 874,
    sellValue: 110,
    buyValue: 1800,
  },
  oasis_waterskin: {
    id: 'oasis_waterskin',
    name: 'Oasis Waterskin',
    kind: 'drink',
    quality: 'common',
    drinkMana: 1344,
    sellValue: 110,
    buyValue: 1800,
  },
  spiced_scarab_skewer: {
    id: 'spiced_scarab_skewer',
    name: 'Spiced Scarab Skewer',
    kind: 'food',
    quality: 'common',
    foodHp: 1064,
    sellValue: 150,
    buyValue: 2400,
  },
  // --- vendor armor ---
  duneweave_robe: {
    id: 'duneweave_robe',
    name: 'Duneweave Robe',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 62 },
    sellValue: 900,
    buyValue: 9000,
  },
  caravan_guard_hauberk: {
    id: 'caravan_guard_hauberk',
    name: 'Caravan Guard Hauberk',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 210 },
    sellValue: 1000,
    buyValue: 10000,
  },
  prowlerhide_vest: {
    id: 'prowlerhide_vest',
    name: 'Prowlerhide Vest',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 118 },
    sellValue: 950,
    buyValue: 9500,
  },
  // Cloth like zone3's ridgestalker_treads: this is the shared quest reward for
  // all three archetypes, so every class must be able to wear it.
  sandwalker_treads: {
    id: 'sandwalker_treads',
    name: 'Sandwalker Treads',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 56, agi: 7, sta: 5 },
    sellValue: 1100,
    buyValue: 11000,
  },
  dunewatch_legguards: {
    id: 'dunewatch_legguards',
    name: 'Dunewatch Legguards',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'common',
    stats: { armor: 178 },
    sellValue: 1000,
    buyValue: 10000,
  },
  // --- vendor / reward weapons ---
  qesh_khopesh: {
    id: 'qesh_khopesh',
    name: 'Qesh Khopesh',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 21, max: 33, speed: 2.4 },
    sellValue: 900,
    buyValue: 9000,
  },
  judgestaff_of_ossara: {
    id: 'judgestaff_of_ossara',
    name: 'Judgestaff of Ossara',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 24, max: 38, speed: 2.9 },
    stats: { int: 9, sta: 5 },
    sellValue: 1200,
    buyValue: 12000,
    requiredClass: ['mage', 'priest', 'warlock', 'druid', 'shaman'],
  },
  glasswind_talon: {
    id: 'glasswind_talon',
    name: 'Glasswind Talon',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 16, max: 26, speed: 1.8 },
    stats: { agi: 8 },
    sellValue: 1200,
    buyValue: 12000,
    requiredClass: ['rogue', 'hunter'],
  },
  // --- rare-elite drops ---
  emberjaw_prowlgrips: {
    id: 'emberjaw_prowlgrips',
    name: 'Emberjaw Prowlgrips',
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 74, agi: 9, sta: 6 },
    sellValue: 2400,
  },
  unburied_gravewraps: {
    id: 'unburied_gravewraps',
    name: 'Unburied Gravewraps',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 44, int: 10, sta: 7 },
    sellValue: 2600,
  },
  sandmaw_scale_cuirass: {
    id: 'sandmaw_scale_cuirass',
    name: 'Sandmaw Scale Cuirass',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 260, str: 10, sta: 9 },
    sellValue: 3200,
  },
  tyrantfang_edge: {
    id: 'tyrantfang_edge',
    name: 'Tyrantfang Edge',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 26, max: 42, speed: 2.5 },
    stats: { str: 8, sta: 6 },
    sellValue: 3400,
  },
};

// ---------------------------------------------------------------------------
// Static props (rendering + collision share this placement data). Qesh Aram
// sits on the hub plateau; the Mirage Oasis at (-80, 1150) stays clear.
// ---------------------------------------------------------------------------

export const OSSARA_PROPS: ZonePropsDef = {
  buildings: [
    { kind: 'house', x: 14, z: 1031, w: 7, d: 6, rot: -0.5 },
    { kind: 'house', x: 8, z: 1010, w: 6, d: 5, rot: 0.4 },
    { kind: 'house', x: 18, z: 1020, w: 6, d: 5, rot: 1.2 },
    { kind: 'inn', x: -15, z: 1026, w: 6, d: 7, rot: 0.6 }, // the Caravan Rest
    { kind: 'chapel', x: -16, z: 1010, w: 5, d: 7, rot: 0.9 }, // shrine of the Judges
  ],
  wells: [{ x: 0, z: 1022, r: 1.5 }],
  stalls: [
    { x: -7.5, z: 1027, rot: Math.PI / 2, r: 1.7 }, // Caravan Master Odai
    { x: -4.5, z: 1033.5, rot: -0.6, r: 1.7 }, // Armorer Khet
  ],
  mines: [
    { x: 66, z: 1152, rot: -2.0 }, // Tombs of the Nameless shaft
    { x: 96, z: 1062, rot: Math.PI / 2 }, // Sunken Aqueduct dig
  ],
  docks: [],
  tents: [
    // caravan camp on the south road
    { x: 10, z: 962, rot: 0.5, scale: 1.2 },
    { x: 16, z: 955, rot: 2.0, scale: 1.2 },
    // tombrobber dig camp by the aqueduct
    { x: 84, z: 1048, rot: 0.8, scale: 1 },
    { x: 92, z: 1044, rot: -0.5, scale: 1 },
    // nomad camp near the oasis
    { x: -70, z: 1138, rot: 1.5, scale: 1.3 },
    { x: -62, z: 1146, rot: -1.0, scale: 1.3 },
  ],
  crates: [
    [12, 958],
    [86, 1046],
    [-66, 1141],
  ],
  campfires: [
    [2, 1018],
    [13, 959],
    [88, 1047],
    [-66, 1143],
  ],
  mudHuts: [],
  ruinRings: [
    { x: 90, z: 1060, ringR: 8, columns: 7 }, // the Sunken Aqueduct arches
    { x: 60, z: 1150, ringR: 7, columns: 6 }, // Tombs of the Nameless
    { x: 40, z: 1240, ringR: 7, columns: 6 }, // Judges' Terrace
    { x: 120, z: 1230, ringR: 6, columns: 5 }, // Bonewind Barrens bones
  ],
  fences: [
    { x1: -14, z1: 1009, x2: -4, z2: 1007 }, // south gate, west run
    { x1: 4, z1: 1007, x2: 14, z2: 1009 }, // south gate, east run
  ],
  graveyards: [{ x: 18, z: 1005 }],
};
