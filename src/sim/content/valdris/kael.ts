// Kael Empire (levels 33-40): the imperial northern heartland of Valdris and
// the most organized power in the known world. Fertile granary plains climb
// into the Wolfsward pines and end at the snow-capped Frosthelm peaks; the
// roads are patrolled, the taxes are collected twice, and every noble house
// keeps one eye on the throne and the other on its neighbors. Kaelspire, the
// fortified capital seat of the northern march, holds the Tithe Road open.
// The Empire's own soldiers are not the threat here: the danger is what the
// Empire cannot requisition away. Highland wolf packs, the kobolds squatting
// under Ironhold Mine, the stone that woke beneath its deep terraces, and the
// Broken Legion: a mutinied legion of deserters, the ogre sellswords they
// hired with stolen pay, and the oathbroken commander who leads them.
//
// Structured exactly like content/valdris/ossara.ts, the Valdris exemplar:
// ZoneDef + roads + mobs + npcs + quests + camps + objects + items + props.

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

export const KAEL_ZONE: ZoneDef = {
  id: 'kael_empire',
  name: 'Kael Empire',
  zMin: 1680,
  zMax: 2070,
  levelRange: [33, 40],
  biome: 'highlands',
  hub: { x: 0, z: 1800, radius: 20, name: 'Kaelspire' },
  graveyard: { x: -24, z: 1786 },
  lakes: [{ x: -75, z: 1855, radius: 14 }], // the Silverbrook Millpond
  pois: [
    { x: 0, z: 1800, label: 'Kaelspire' },
    { x: 0, z: 1710, label: 'The Tithe Road' },
    { x: 60, z: 1730, label: 'The Imperial Granaries' },
    { x: -85, z: 1740, label: 'Wolfsward Pines' },
    { x: 16, z: 1780, label: 'The Tithe House' },
    { x: -75, z: 1855, label: 'Silverbrook Millpond' },
    { x: 95, z: 1885, label: 'Ironhold Mine' },
    { x: -105, z: 1955, label: 'The Broken Legion Camp' },
    { x: -55, z: 2030, label: 'Frosthelm Ascent' },
  ],
  welcome: 'Marshal Corvin keeps the Tithe Road open from Kaelspire; the Empire expects it kept.',
  welcomeQuestId: 'q_wolfsward_culling',
};

// The Tithe Road: up from the Veth border pass, through Kaelspire, north to
// the Frosthelm passes, with spokes to the millpond, the mine, and the
// granary fields. Imperial roads are maintained; the things beside them less so.
export const KAEL_ROADS: { x: number; z: number }[][] = [
  [
    { x: 0, z: 1680 },
    { x: 0, z: 1740 },
    { x: 0, z: 1800 },
  ], // Veth border pass -> Kaelspire
  [
    { x: 0, z: 1810 },
    { x: 0, z: 1940 },
    { x: 0, z: 2070 },
  ], // Kaelspire -> Frosthelm passes
  [
    { x: -6, z: 1806 },
    { x: -40, z: 1826 },
    { x: -58, z: 1838 },
  ], // -> Silverbrook Millpond (ends at the shore; the pond basin starts ~16yd out)
  [
    { x: 6, z: 1806 },
    { x: 55, z: 1850 },
    { x: 88, z: 1878 },
  ], // -> Ironhold Mine
  [
    { x: 6, z: 1746 },
    { x: 35, z: 1737 },
    { x: 55, z: 1730 },
  ], // -> the Imperial Granaries
];

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

export const KAEL_MOBS: Record<string, MobTemplate> = {
  wolfsward_packwolf: {
    id: 'wolfsward_packwolf',
    name: 'Wolfsward Packwolf',
    minLevel: 33,
    maxLevel: 35,
    family: 'beast',
    hpBase: 90,
    hpPerLevel: 28,
    dmgBase: 17,
    dmgPerLevel: 3.5,
    attackSpeed: 1.9,
    armorPerLevel: 20,
    moveSpeed: 8.2,
    aggroRadius: 11,
    // Worrying Bite: the packs learned imperial convoys mean meat.
    bleed: {
      chance: 0.25,
      perTick: 11,
      interval: 3,
      duration: 9,
      name: 'Worrying Bite',
      school: 'physical',
    },
    loot: [
      { copper: 220, chance: 1 },
      { itemId: 'frostbrush_wolf_fang', chance: 0.4 },
      { itemId: 'chewed_tithe_scrip', chance: 0.4, questId: 'q_tithe_scrip_recovery' },
      { itemId: 'prime_wolf_pelt', chance: 0.4, questId: 'q_pelt_requisition' },
      { itemId: 'lean_wolf_haunch', chance: 0.4, questId: 'q_larder_restock' },
    ],
    scale: 1.0,
    color: 0x9aa3ad,
  },
  // The scar-muzzled sire of the Wolfsward packs: garrison bounty notices list
  // him by name, and three of them list hunters who never came back.
  hoarfang_alpha: {
    id: 'hoarfang_alpha',
    name: 'Hoarfang Alpha',
    minLevel: 35,
    maxLevel: 35,
    family: 'beast',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 7.2,
    hpBase: 660,
    hpPerLevel: 98,
    dmgBase: 28,
    dmgPerLevel: 5.4,
    attackSpeed: 1.7,
    armorPerLevel: 32,
    moveSpeed: 8.6,
    aggroRadius: 13,
    aoePulse: { min: 42, max: 56, radius: 8, every: 9, name: 'Ravening Lunge', school: 'physical' },
    enrage: { belowHpPct: 0.35, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 1050, chance: 1 },
      { itemId: 'hoarfang_pelt', chance: 1 },
      { itemId: 'hoarfang_clawgrips', chance: 0.3 },
    ],
    scale: 1.35,
    color: 0xbfc9d4,
  },
  ironhold_digger: {
    id: 'ironhold_digger',
    name: 'Ironhold Digger',
    minLevel: 34,
    maxLevel: 36,
    family: 'kobold',
    hpBase: 92,
    hpPerLevel: 28,
    dmgBase: 17,
    dmgPerLevel: 3.5,
    attackSpeed: 2.0,
    armorPerLevel: 24,
    moveSpeed: 7,
    aggroRadius: 10,
    // Gouging Pick: a mining pick swung at people chews through armor too.
    corrode: {
      chance: 0.3,
      armor: 60,
      maxStacks: 4,
      duration: 15,
      name: 'Gouging Pick',
      school: 'physical',
    },
    loot: [
      { copper: 240, chance: 1 },
      { itemId: 'stolen_tithe_ledger', chance: 0.55, questId: 'q_ironhold_ledgers' },
      { itemId: 'candle_tax_tally', chance: 0.4, questId: 'q_candle_tax_arrears' },
      { itemId: 'pilfered_ration_pack', chance: 0.4, questId: 'q_ration_theft' },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 0.9,
    color: 0x8a6b4a,
  },
  // Warren-taught wax sorcery plus whatever the thing under the deep terraces
  // whispers back: the geomancers pry the assay seals off the ore carts and
  // wear imperial lead as charms.
  ironhold_geomancer: {
    id: 'ironhold_geomancer',
    name: 'Ironhold Geomancer',
    minLevel: 35,
    maxLevel: 37,
    family: 'kobold',
    hpBase: 94,
    hpPerLevel: 29,
    dmgBase: 18,
    dmgPerLevel: 3.6,
    attackSpeed: 2.2,
    armorPerLevel: 22,
    moveSpeed: 6.6,
    aggroRadius: 11,
    // Pebble Ward: a rattling shell of quarry scree, shed and re-raised.
    stoneskin: { amount: 180, every: 16, duration: 6, name: 'Pebble Ward' },
    loot: [
      { copper: 270, chance: 1 },
      { itemId: 'assay_office_seal', chance: 0.4, questId: 'q_assay_seal_audit' },
      { itemId: 'mana_potion', chance: 0.06 },
    ],
    scale: 0.9,
    color: 0x9a7d52,
  },
  broken_legion_deserter: {
    id: 'broken_legion_deserter',
    name: 'Broken Legion Deserter',
    minLevel: 35,
    maxLevel: 37,
    family: 'humanoid',
    hpBase: 94,
    hpPerLevel: 29,
    dmgBase: 18,
    dmgPerLevel: 3.6,
    attackSpeed: 2.0,
    armorPerLevel: 28,
    moveSpeed: 7,
    aggroRadius: 11,
    // Drilled to imperial standard; the Empire regrets the drilling now.
    expose: { chance: 0.3, dmgIncrease: 0.15, duration: 10, name: 'Legion Breach' },
    cleave: { radius: 5, mult: 0.5, name: 'Line Breaker' },
    loot: [
      { copper: 260, chance: 1 },
      { itemId: 'legion_deserter_insignia', chance: 0.55, questId: 'q_broken_legion' },
      { itemId: 'legion_pay_manifest', chance: 0.4, questId: 'q_pay_chest_manifest' },
      { itemId: 'bent_legion_buckle', chance: 0.35 },
    ],
    scale: 1.0,
    color: 0x6d6f7a,
  },
  broken_legion_arbalist: {
    id: 'broken_legion_arbalist',
    name: 'Broken Legion Arbalist',
    minLevel: 36,
    maxLevel: 38,
    family: 'humanoid',
    hpBase: 94,
    hpPerLevel: 29,
    dmgBase: 18,
    dmgPerLevel: 3.6,
    attackSpeed: 2.2,
    armorPerLevel: 24,
    moveSpeed: 7,
    aggroRadius: 12,
    // Pinning Bolt: a quarrel through the boot keeps you where the line wants you.
    ensnare: { chance: 0.25, duration: 3, name: 'Pinning Bolt', school: 'physical' },
    loot: [
      { copper: 270, chance: 1 },
      { itemId: 'legion_deserter_insignia', chance: 0.5, questId: 'q_broken_legion' },
      { itemId: 'legion_quarrel_bundle', chance: 0.4, questId: 'q_arbalist_lines' },
      { itemId: 'bent_legion_buckle', chance: 0.3 },
    ],
    scale: 1.0,
    color: 0x5c6470,
  },
  granite_churn_elemental: {
    id: 'granite_churn_elemental',
    name: 'Granite Churn Elemental',
    minLevel: 36,
    maxLevel: 38,
    family: 'elemental',
    hpBase: 96,
    hpPerLevel: 29,
    dmgBase: 18,
    dmgPerLevel: 3.7,
    attackSpeed: 2.3,
    armorPerLevel: 30,
    moveSpeed: 6.2,
    aggroRadius: 10,
    // Something under the deep terraces did not care to be mined.
    stoneskin: { amount: 220, every: 14, duration: 8, name: 'Granite Carapace' },
    knockback: { chance: 0.2, distance: 5, name: 'Churning Slam' },
    loot: [
      { copper: 290, chance: 1 },
      { itemId: 'granite_core_shard', chance: 0.5, questId: 'q_granite_tempering' },
    ],
    scale: 1.15,
    color: 0x8d8d8d,
  },
  sellsword_ogre: {
    id: 'sellsword_ogre',
    name: 'Sellsword Ogre',
    minLevel: 37,
    maxLevel: 39,
    family: 'ogre',
    hpBase: 100,
    hpPerLevel: 30,
    dmgBase: 19,
    dmgPerLevel: 3.7,
    attackSpeed: 2.6,
    armorPerLevel: 22,
    moveSpeed: 6.8,
    aggroRadius: 11,
    // Paid in stolen imperial coin; enforcement of the contract is included.
    concuss: { chance: 0.2, duration: 2, name: 'Skullringer' },
    loot: [
      { copper: 310, chance: 1 },
      { itemId: 'ogre_knuckle_dice', chance: 0.35 },
      { itemId: 'clipped_imperial_coin', chance: 0.4, questId: 'q_ogre_paymasters' },
      { itemId: 'sellsword_pig_iron', chance: 0.4, questId: 'q_ogre_iron_reforging' },
      { itemId: 'sellsword_requisition_chit', chance: 0.4, questId: 'q_stores_for_the_ascent' },
    ],
    scale: 1.35,
    color: 0xb9975b,
  },
  frosthelm_wendigo: {
    id: 'frosthelm_wendigo',
    name: 'Frosthelm Wendigo',
    minLevel: 38,
    maxLevel: 40,
    family: 'beast',
    hpBase: 100,
    hpPerLevel: 30,
    dmgBase: 19,
    dmgPerLevel: 3.8,
    attackSpeed: 2.1,
    armorPerLevel: 26,
    moveSpeed: 7.4,
    aggroRadius: 12,
    // They come down with the snow line, and the snow line is coming down.
    chillOnHit: { chance: 0.3, mult: 0.6, duration: 5, name: 'Frostbitten Claw' },
    frostbite: {
      chance: 0.25,
      perTick: 12,
      interval: 3,
      duration: 9,
      name: 'Rimefever',
      school: 'frost',
    },
    loot: [
      { copper: 340, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.35 },
      { itemId: 'wendigo_gallstone', chance: 0.4, questId: 'q_wendigo_gall' },
      { itemId: 'rimewoven_hide', chance: 0.4, questId: 'q_wendigo_hide_lining' },
    ],
    scale: 1.2,
    color: 0xcfe0e8,
  },
  // New packs above the snow line, running ahead of the winter the wendigo
  // come down with. If they den before the caravans move, the Ascent closes.
  frosthelm_icehowler: {
    id: 'frosthelm_icehowler',
    name: 'Frosthelm Icehowler',
    minLevel: 37,
    maxLevel: 39,
    family: 'beast',
    hpBase: 98,
    hpPerLevel: 30,
    dmgBase: 19,
    dmgPerLevel: 3.7,
    attackSpeed: 2.0,
    armorPerLevel: 24,
    moveSpeed: 8.0,
    aggroRadius: 12,
    chillOnHit: { chance: 0.25, mult: 0.65, duration: 4, name: 'Numbing Howl' },
    bleed: {
      chance: 0.2,
      perTick: 13,
      interval: 3,
      duration: 9,
      name: 'Rending Fangs',
      school: 'physical',
    },
    loot: [
      { copper: 320, chance: 1 },
      { itemId: 'icehowler_ruff', chance: 0.4, questId: 'q_icehowler_cull' },
      { itemId: 'frostbrush_wolf_fang', chance: 0.3 },
    ],
    scale: 1.05,
    color: 0xd7e4ec,
  },
  // The self-appointed foreman of the Ironhold warrens. Kazrik wears a stolen
  // assessor's stole over his rags and taxes the other kobolds in candles.
  overseer_kazrik: {
    id: 'overseer_kazrik',
    name: 'Overseer Kazrik',
    minLevel: 38,
    maxLevel: 38,
    family: 'kobold',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 700,
    hpPerLevel: 105,
    dmgBase: 30,
    dmgPerLevel: 5.6,
    attackSpeed: 2.2,
    armorPerLevel: 46,
    moveSpeed: 6.8,
    aggroRadius: 13,
    aoePulse: { min: 54, max: 74, radius: 10, every: 9, name: 'Candle Flare', school: 'fire' },
    summonAdds: { mobId: 'ironhold_digger', count: 2, atHpPct: [0.5] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.45, hasteMult: 1.25 },
    loot: [
      { copper: 1150, chance: 1 },
      { itemId: 'kazriks_brass_whistle', chance: 1 },
      { itemId: 'overseers_candlewraps', chance: 0.3 },
    ],
    scale: 1.1,
    color: 0xa3743c,
  },
  // Commander of the Ninth until he burned its muster rolls and marched it
  // into the pines. His sentence was signed the day he ran; it wants only an
  // executioner willing to climb to his redoubt and deliver it.
  commander_vaelis: {
    id: 'commander_vaelis',
    name: 'Commander Vaelis the Oathbroken',
    minLevel: 40,
    maxLevel: 40,
    family: 'humanoid',
    elite: true,
    boss: true,
    hpBase: 390,
    hpPerLevel: 54,
    dmgBase: 23,
    dmgPerLevel: 4.8,
    attackSpeed: 2.5,
    armorPerLevel: 45,
    moveSpeed: 7,
    aggroRadius: 14,
    rally: { radius: 14, every: 12, ap: 60, duration: 10, name: 'Oathbroken Standard' },
    mortalStrike: { chance: 0.25, healReduction: 0.5, duration: 6, name: 'Mortal Strike' },
    summonAdds: { mobId: 'broken_legion_deserter', count: 2, atHpPct: [0.5] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.4, hasteMult: 1.2 },
    loot: [
      { copper: 4200, chance: 1 },
      { itemId: 'oathbreakers_battleplate', chance: 0.3 },
      { itemId: 'oathbreakers_greatblade', chance: 0.25 },
    ],
    scale: 1.35,
    color: 0x7d2f2f,
  },
};

// ---------------------------------------------------------------------------
// NPCs (Kaelspire hub)
// ---------------------------------------------------------------------------

export const KAEL_NPCS: Record<string, NpcDef> = {
  marshal_corvin: {
    id: 'marshal_corvin',
    name: 'Marshal Corvin',
    title: 'Marshal of the Northern March',
    pos: { x: 4, z: 1804 },
    facing: -2.0,
    color: 0x8c1f28,
    questIds: [
      'q_wolfsward_culling',
      'q_ironhold_ledgers',
      'q_broken_legion',
      'q_frosthelm_pass',
      'q_renegade_commander',
      'q_arbalist_lines',
      'q_ogre_paymasters',
      'q_watchfort_reclamation',
      'q_frosthelm_signals',
    ],
    greeting:
      'The Empire holds because someone files the reports and someone holds the road, $C. Today you are both.',
  },
  quartermaster_hilde: {
    id: 'quartermaster_hilde',
    name: 'Quartermaster Hilde',
    title: 'Kaelspire Garrison Stores',
    pos: { x: -6, z: 1808 },
    facing: 1.4,
    color: 0x7a6a3f,
    questIds: ['q_larder_restock', 'q_ration_theft', 'q_stores_for_the_ascent'],
    vendorItems: [
      'kaelspire_barley_loaf',
      'silverbrook_spring_water',
      'imperial_field_ration',
      'healing_potion',
      'mana_potion',
      'imperial_clerks_robe',
      'kael_infantry_hauberk',
      'wolfsward_hunting_jerkin',
      'tithe_road_marchboots',
      'imperial_marcher_legguards',
    ],
    greeting:
      'Requisitions in triplicate or coin up front, $C. Coin is faster, and the bread is fresher than the forms.',
  },
  armorer_ottokar: {
    id: 'armorer_ottokar',
    name: 'Armorer Ottokar',
    title: 'Imperial Pattern Smith',
    pos: { x: -2, z: 1812 },
    facing: 2.8,
    color: 0x5a6672,
    questIds: ['q_granite_tempering', 'q_wendigo_hide_lining', 'q_ogre_iron_reforging'],
    vendorItems: ['kael_arming_sword', 'frosthelm_warstaff', 'wolfsward_skinner'],
    greeting:
      'Imperial pattern, imperial steel. If it fails in the field, bring back the pieces and the paperwork.',
  },
  prefect_alina: {
    id: 'prefect_alina',
    name: 'Prefect Alina',
    title: 'Imperial Tithe Prefect',
    pos: { x: 9, z: 1790 },
    facing: -2.6,
    color: 0x3f5a7a,
    questIds: [
      'q_tithe_scrip_recovery',
      'q_candle_tax_arrears',
      'q_assay_seal_audit',
      'q_pay_chest_manifest',
      'q_overseer_audit',
    ],
    greeting: 'The quarter closes whether the province cooperates or not, $C. Sign here. And here.',
  },
  huntmaster_roderic: {
    id: 'huntmaster_roderic',
    name: 'Huntmaster Roderic',
    title: 'Wolfsward Huntmaster',
    pos: { x: -12, z: 1797 },
    facing: 0.9,
    color: 0x4f6b3c,
    questIds: ['q_pelt_requisition', 'q_hoarfang_writ', 'q_wendigo_gall', 'q_icehowler_cull'],
    greeting:
      'The Empire hunts by charter and quota, $C, and the quota is behind. Fetch your bow or fetch excuses; I only file one of them.',
  },
};

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export const KAEL_QUESTS: Record<string, QuestDef> = {
  q_wolfsward_culling: {
    id: 'q_wolfsward_culling',
    name: 'A Predation Report',
    giverNpcId: 'marshal_corvin',
    turnInNpcId: 'marshal_corvin',
    text: 'Filed this morning: three grain carts overturned on the Tithe Road, two oxen lost, one driver. The Wolfsward packs have learned that imperial convoys mean meat, $N, and the Empire does not negotiate with wolves. Cull twelve and I will close the report.',
    completionText:
      'Twelve, witnessed and logged. The convoys roll at dawn and the report is closed. Efficient work, $N; the Empire notices efficiency.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'wolfsward_packwolf',
        count: 12,
        label: 'Wolfsward Packwolf slain',
      },
    ],
    xpReward: 10000,
    copperReward: 5000,
    itemRewards: {},
    minLevel: 32,
  },
  q_ironhold_ledgers: {
    id: 'q_ironhold_ledgers',
    name: 'The Missing Ledgers',
    giverNpcId: 'marshal_corvin',
    turnInNpcId: 'marshal_corvin',
    text: 'The kobolds under Ironhold Mine broke into the assay office and carried off the tithe ledgers for the entire quarter. They eat the candle wax and nest in the paper, $N. Without those ledgers, no tithe in the north can be certified. Kill ten of the diggers and recover five ledgers. Intact, if you please.',
    completionText:
      'Chewed at the corners, but the seals held; the assessors can certify the quarter after all. Requisition these marchboots, $N: signed, stamped, and yours.',
    objectives: [
      { type: 'kill', targetMobId: 'ironhold_digger', count: 10, label: 'Ironhold Digger slain' },
      { type: 'collect', itemId: 'stolen_tithe_ledger', count: 5, label: 'Stolen Tithe Ledger' },
    ],
    xpReward: 11000,
    copperReward: 5600,
    itemRewards: {
      warrior: 'tithe_road_marchboots',
      mage: 'tithe_road_marchboots',
      rogue: 'tithe_road_marchboots',
    },
    requiresQuest: 'q_wolfsward_culling',
    minLevel: 34,
  },
  q_granite_tempering: {
    id: 'q_granite_tempering',
    name: 'Steel and Stone',
    giverNpcId: 'armorer_ottokar',
    turnInNpcId: 'armorer_ottokar',
    text: 'The mine woke something under the deep terraces, $N: granite churns, the miners call them, and imperial picks blunt against their hides. Break twelve and bring me six of their core shards. Stone that shrugs off a pick will temper a blade the Empire can rely on.',
    completionText:
      'Look how the quench takes to it. Imperial pattern, granite temper: the next blade off my bench will hold its edge through a winter campaign.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'granite_churn_elemental',
        count: 12,
        label: 'Granite Churn Elemental slain',
      },
      { type: 'collect', itemId: 'granite_core_shard', count: 6, label: 'Granite Core Shard' },
    ],
    xpReward: 12000,
    copperReward: 6400,
    itemRewards: {},
    requiresQuest: 'q_ironhold_ledgers',
    minLevel: 35,
  },
  q_broken_legion: {
    id: 'q_broken_legion',
    name: 'Strike the Rolls',
    giverNpcId: 'marshal_corvin',
    turnInNpcId: 'marshal_corvin',
    text: 'The Broken Legion was the Ninth, $N, before they burned their muster rolls, took their pay chests, and made for the pines. Deserters do not resign; they are struck from the rolls. Kill twelve and bring me five insignia. Each one is a name I can strike with a clear conscience.',
    completionText:
      'Five insignia, five names, five lines of ink. The Ninth is smaller tonight and the rolls are honest again. The Empire thanks you in writing, $N; I thank you in coin.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'broken_legion_deserter',
        count: 12,
        label: 'Broken Legion Deserter slain',
      },
      {
        type: 'collect',
        itemId: 'legion_deserter_insignia',
        count: 5,
        label: 'Legion Deserter Insignia',
      },
    ],
    xpReward: 13000,
    copperReward: 7200,
    itemRewards: {},
    requiresQuest: 'q_granite_tempering',
    minLevel: 36,
  },
  q_frosthelm_pass: {
    id: 'q_frosthelm_pass',
    name: 'Clearing the Ascent',
    giverNpcId: 'marshal_corvin',
    turnInNpcId: 'marshal_corvin',
    text: 'Two obstructions on the Frosthelm Ascent, $N. First: the ogre sellswords the deserters bought with stolen imperial pay. Second: the wendigo that come down with the snow line. The pass must be open before the winter caravans. Eight of each; the paperwork is already drafted.',
    completionText:
      'The Ascent is passable and the caravans are rescheduled. Two obstructions, one invoice, zero delays. I wish half my garrison filed results like yours, $N.',
    objectives: [
      { type: 'kill', targetMobId: 'sellsword_ogre', count: 8, label: 'Sellsword Ogre slain' },
      {
        type: 'kill',
        targetMobId: 'frosthelm_wendigo',
        count: 8,
        label: 'Frosthelm Wendigo slain',
      },
    ],
    xpReward: 14000,
    copperReward: 8000,
    itemRewards: {},
    requiresQuest: 'q_broken_legion',
    minLevel: 37,
  },
  q_renegade_commander: {
    id: 'q_renegade_commander',
    name: 'The Oathbroken',
    giverNpcId: 'marshal_corvin',
    turnInNpcId: 'marshal_corvin',
    text: 'Commander Vaelis of the Ninth swore his oath in Kaelspire and broke it in the pines, and every deserter and hired ogre in this province answers to him. His sentence was signed the day he ran; it wants only an executioner. Take companions, $N: he did not keep his rank by being easy to kill. Deliver it at his redoubt.',
    completionText:
      'So ends the Broken Legion: not with a battle honor, but with a signature and a good blade. The province stands quiet, $N, and quiet is what the Empire pays for. Take your pick of the recovered arms; you have earned first requisition.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'commander_vaelis',
        count: 1,
        label: 'Commander Vaelis the Oathbroken slain',
      },
    ],
    xpReward: 15000,
    copperReward: 9000,
    itemRewards: {
      warrior: 'oathbreakers_greatblade',
      mage: 'frosthelm_warstaff',
      rogue: 'wolfsward_skinner',
    },
    requiresQuest: 'q_frosthelm_pass',
    suggestedPlayers: 3,
    minLevel: 39,
  },
  // --- Prefect Alina: the tithe audit chain ---
  q_tithe_scrip_recovery: {
    id: 'q_tithe_scrip_recovery',
    name: 'Scrip in the Snow',
    giverNpcId: 'prefect_alina',
    turnInNpcId: 'prefect_alina',
    text: 'A tithe courier went into the Wolfsward pines nine days ago and his satchel did not come out, $N. The scrip he carried is legal tender against the quarter, and at present it is bedding in wolf dens. Cull fourteen of the packs and recover six notes of scrip. The Empire honors its paper in any condition.',
    completionText:
      "Six notes, chewed but countable. I will enter them at face value, and the courier's widow draws his back pay by the next post. The wolves are a closed line item now, $N.",
    objectives: [
      {
        type: 'kill',
        targetMobId: 'wolfsward_packwolf',
        count: 14,
        label: 'Wolfsward Packwolf slain',
      },
      { type: 'collect', itemId: 'chewed_tithe_scrip', count: 6, label: 'Chewed Tithe Scrip' },
    ],
    xpReward: 11500,
    copperReward: 5200,
    itemRewards: {},
    minLevel: 33,
  },
  q_candle_tax_arrears: {
    id: 'q_candle_tax_arrears',
    name: 'Arrears in Wax',
    giverNpcId: 'prefect_alina',
    turnInNpcId: 'prefect_alina',
    text: 'Every candle burned under an imperial mine is a taxed candle, $N, and the Ironhold warrens have eaten four quarters of tallies along with the wax. Fourteen diggers, six tax tallies recovered. Arrears do not forgive themselves.',
    completionText:
      'Six tallies, teeth marks notwithstanding. The arrears ledger balances for the first time since the mine broke through. You would be surprised how rarely I get to write the word settled, $N.',
    objectives: [
      { type: 'kill', targetMobId: 'ironhold_digger', count: 14, label: 'Ironhold Digger slain' },
      { type: 'collect', itemId: 'candle_tax_tally', count: 6, label: 'Candle Tax Tally' },
    ],
    xpReward: 13000,
    copperReward: 5800,
    itemRewards: {},
    requiresQuest: 'q_tithe_scrip_recovery',
    minLevel: 34,
  },
  q_assay_seal_audit: {
    id: 'q_assay_seal_audit',
    name: 'The Assay Seals',
    giverNpcId: 'prefect_alina',
    turnInNpcId: 'prefect_alina',
    text: 'The assay office stamps every ore cart with a lead seal, and an unsealed cart is contraband by definition. The kobold geomancers pry the seals off and wear imperial lead as charms, $N. Fourteen geomancers, six seals. The audit does not wait on the weather and neither do I.',
    completionText:
      'Six seals, all imperial lead. The carts can move, the assay stands, and the contraband file goes back in its drawer. Precise work, $N; precision is the only compliment I keep in stock.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'ironhold_geomancer',
        count: 14,
        label: 'Ironhold Geomancer slain',
      },
      { type: 'collect', itemId: 'assay_office_seal', count: 6, label: 'Assay Office Seal' },
    ],
    xpReward: 14500,
    copperReward: 6400,
    itemRewards: {},
    requiresQuest: 'q_candle_tax_arrears',
    minLevel: 35,
  },
  q_pay_chest_manifest: {
    id: 'q_pay_chest_manifest',
    name: 'Chests Without Manifests',
    giverNpcId: 'prefect_alina',
    turnInNpcId: 'prefect_alina',
    text: "The Ninth took its pay chests when it deserted, and every chest moved with a manifest. The deserters still carry them, $N: proof of theft, itemized, in their own quartermaster's hand. Sixteen deserters, six manifests. I intend to charge them by the line.",
    completionText:
      'Itemized, dated, signed. A court will read these one day, $N, and the Ninth wrote every word of the case against itself. Bureaucracy has a long arm and a longer memory.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'broken_legion_deserter',
        count: 16,
        label: 'Broken Legion Deserter slain',
      },
      { type: 'collect', itemId: 'legion_pay_manifest', count: 6, label: 'Legion Pay Manifest' },
    ],
    xpReward: 16000,
    copperReward: 7000,
    itemRewards: {},
    requiresQuest: 'q_assay_seal_audit',
    minLevel: 36,
  },
  q_overseer_audit: {
    id: 'q_overseer_audit',
    name: 'Abolish the Overseer',
    giverNpcId: 'prefect_alina',
    turnInNpcId: 'prefect_alina',
    text: 'Overseer Kazrik taxes his own warren in candles and styles himself an assessor of the Empire, $N. The Empire licenses no competitors. His office is hereby abolished; the abolition wants delivering, he will contest the finding, and he does not argue alone. Take witnesses.',
    completionText:
      'The office of Overseer stands abolished and its brass whistle is on my desk. The warrens will miss him less than they think. The Empire remembers its instruments, $N; wear this one.',
    objectives: [
      { type: 'kill', targetMobId: 'overseer_kazrik', count: 1, label: 'Overseer Kazrik slain' },
    ],
    xpReward: 23000,
    copperReward: 8600,
    itemRewards: {
      warrior: 'prefects_sealed_mantle',
      mage: 'prefects_sealed_mantle',
      rogue: 'prefects_sealed_mantle',
    },
    requiresQuest: 'q_pay_chest_manifest',
    suggestedPlayers: 3,
    minLevel: 37,
  },
  // --- Huntmaster Roderic: the charter hunt chain ---
  q_pelt_requisition: {
    id: 'q_pelt_requisition',
    name: 'The Pelt Requisition',
    giverNpcId: 'huntmaster_roderic',
    turnInNpcId: 'huntmaster_roderic',
    text: 'Requisition ninety-one, winter cloaks, garrison of Kaelspire: approved in spring, and the wool never came, $N. Wolf pelt serves better on the Ascent anyway. Fourteen packwolves culled, eight prime pelts delivered, and the garrison stops freezing on my quota.',
    completionText:
      'Eight primes, thick as any I have brought in myself. The tanner owes me a favor and the garrison owes you their ears and fingers, $N. Requisition ninety-one: filled.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'wolfsward_packwolf',
        count: 14,
        label: 'Wolfsward Packwolf slain',
      },
      { type: 'collect', itemId: 'prime_wolf_pelt', count: 8, label: 'Prime Wolf Pelt' },
    ],
    xpReward: 11500,
    copperReward: 5200,
    itemRewards: {},
    minLevel: 33,
  },
  q_hoarfang_writ: {
    id: 'q_hoarfang_writ',
    name: 'The Hoarfang Writ',
    giverNpcId: 'huntmaster_roderic',
    turnInNpcId: 'huntmaster_roderic',
    text: 'Three bounty notices name the Hoarfang Alpha, $N, and three list the hunters who went to collect. The writ is countersigned by the Marshal himself now, which makes it mandatory. Do not flatter yourself into going alone; the pack fights where he fights.',
    completionText:
      'So the old sire is down. I will not pretend the pines are safe, but they are safer, and three families can stop reading bounty notices. The writ is discharged, $N.',
    objectives: [
      { type: 'kill', targetMobId: 'hoarfang_alpha', count: 1, label: 'Hoarfang Alpha slain' },
    ],
    xpReward: 16000,
    copperReward: 6600,
    itemRewards: {},
    requiresQuest: 'q_pelt_requisition',
    suggestedPlayers: 3,
    minLevel: 35,
  },
  q_wendigo_gall: {
    id: 'q_wendigo_gall',
    name: 'Galls for the Surgeon',
    giverNpcId: 'huntmaster_roderic',
    turnInNpcId: 'huntmaster_roderic',
    text: 'The garrison surgeon prescribes wendigo gall against frostrot, and the Ascent provides, $N. Sixteen wendigo culled and six gallstones packed in snow. Do not ask what the tincture tastes like; the men on the signal line stopped asking years ago.',
    completionText:
      'Packed, potent, and paid for. The surgeon will grumble that they are small and then use every one. Frostrot takes toes, $N; you have saved the garrison a crate of them.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'frosthelm_wendigo',
        count: 16,
        label: 'Frosthelm Wendigo slain',
      },
      { type: 'collect', itemId: 'wendigo_gallstone', count: 6, label: 'Wendigo Gallstone' },
    ],
    xpReward: 18000,
    copperReward: 7800,
    itemRewards: {},
    requiresQuest: 'q_hoarfang_writ',
    minLevel: 38,
  },
  q_icehowler_cull: {
    id: 'q_icehowler_cull',
    name: 'The Icehowler Cull',
    giverNpcId: 'huntmaster_roderic',
    turnInNpcId: 'huntmaster_roderic',
    text: 'New packs above the snow line, $N: icehowlers, running ahead of the winter the wendigo come down with. If they den before the caravans move, the Ascent closes itself and no form reopens it. Fifteen culled, six ruffs for proof. This is the hunt that decides the season.',
    completionText:
      "Six ruffs, winter weight. The passes stay open and the quota is met with the season to spare. Take the hood, $N: huntmaster's issue, and you have out-hunted the huntmaster.",
    objectives: [
      {
        type: 'kill',
        targetMobId: 'frosthelm_icehowler',
        count: 15,
        label: 'Frosthelm Icehowler slain',
      },
      { type: 'collect', itemId: 'icehowler_ruff', count: 6, label: 'Icehowler Ruff' },
    ],
    xpReward: 20000,
    copperReward: 8400,
    itemRewards: {
      warrior: 'huntmasters_winter_hood',
      mage: 'huntmasters_winter_hood',
      rogue: 'huntmasters_winter_hood',
    },
    requiresQuest: 'q_wendigo_gall',
    minLevel: 38,
  },
  // --- Marshal Corvin: the watch-fort campaign, after the rolls are struck ---
  q_arbalist_lines: {
    id: 'q_arbalist_lines',
    name: 'Break the Firing Lines',
    giverNpcId: 'marshal_corvin',
    turnInNpcId: 'marshal_corvin',
    text: "The watch-fort walls are manned by the Ninth's arbalists, $N, and a wall of quarrels is still a wall. Fourteen arbalists struck from the rolls and six quarrel bundles confiscated. Every bundle you carry off is a volley they never fire.",
    completionText:
      'Fourteen names, six volleys, zero apologies. The walls answer slower already, $N. File this under progress.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'broken_legion_arbalist',
        count: 14,
        label: 'Broken Legion Arbalist slain',
      },
      {
        type: 'collect',
        itemId: 'legion_quarrel_bundle',
        count: 6,
        label: 'Legion Quarrel Bundle',
      },
    ],
    xpReward: 13500,
    copperReward: 6600,
    itemRewards: {},
    requiresQuest: 'q_broken_legion',
    minLevel: 36,
  },
  q_ogre_paymasters: {
    id: 'q_ogre_paymasters',
    name: 'Follow the Coin',
    giverNpcId: 'marshal_corvin',
    turnInNpcId: 'marshal_corvin',
    text: 'The ogres were paid from the stolen chests in imperial coin, clipped to stretch further, $N. Clipped coin is a second crime stacked on the first. Fourteen sellswords, six coins in evidence. The Empire audits its enemies too.',
    completionText:
      "Clipped, stamped, and damning. The coins go in the evidence box and the box goes to the capital under my seal. Vaelis bought muscle with the Empire's own silver, $N; now the silver testifies.",
    objectives: [
      { type: 'kill', targetMobId: 'sellsword_ogre', count: 14, label: 'Sellsword Ogre slain' },
      {
        type: 'collect',
        itemId: 'clipped_imperial_coin',
        count: 6,
        label: 'Clipped Imperial Coin',
      },
    ],
    xpReward: 16500,
    copperReward: 7400,
    itemRewards: {},
    requiresQuest: 'q_arbalist_lines',
    minLevel: 37,
  },
  q_watchfort_reclamation: {
    id: 'q_watchfort_reclamation',
    name: 'Retake the Watch-Fort',
    giverNpcId: 'marshal_corvin',
    turnInNpcId: 'marshal_corvin',
    text: 'The ruined watch-fort was imperial before the Ninth squatted in it, and it will be imperial after, $N. Fourteen deserters, fourteen arbalists: thin the garrison until what remains cannot hold a wall. I have masons on retainer waiting for the keys.',
    completionText:
      'The fort is a ruin held by stragglers and ghosts now. The masons go up within the month and the Empire gets its wall back. Methodical, $N. I approve of methodical.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'broken_legion_deserter',
        count: 14,
        label: 'Broken Legion Deserter slain',
      },
      {
        type: 'kill',
        targetMobId: 'broken_legion_arbalist',
        count: 14,
        label: 'Broken Legion Arbalist slain',
      },
    ],
    xpReward: 17500,
    copperReward: 8000,
    itemRewards: {},
    requiresQuest: 'q_ogre_paymasters',
    minLevel: 38,
  },
  q_frosthelm_signals: {
    id: 'q_frosthelm_signals',
    name: 'Relight the Signal Line',
    giverNpcId: 'marshal_corvin',
    turnInNpcId: 'marshal_corvin',
    text: 'Three signal stations on the Frosthelm Ascent, all dark, $N. The crews will not climb while the wendigo hold the line, and I do not blame them; I requisition someone the wendigo should worry about instead. Eighteen culled, and the beacons burn again.',
    completionText:
      'The first beacon lit within the hour, $N. Kaelspire talks to the passes again and the winter reports flow on schedule. The Empire runs on schedules; today it ran on you.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'frosthelm_wendigo',
        count: 18,
        label: 'Frosthelm Wendigo slain',
      },
    ],
    xpReward: 19000,
    copperReward: 8600,
    itemRewards: {},
    requiresQuest: 'q_watchfort_reclamation',
    minLevel: 38,
  },
  // --- Armorer Ottokar: winter materiel, after the granite tempering ---
  q_wendigo_hide_lining: {
    id: 'q_wendigo_hide_lining',
    name: 'Linings Against the Cold',
    giverNpcId: 'armorer_ottokar',
    turnInNpcId: 'armorer_ottokar',
    text: 'Imperial steel does not fail on the Ascent, $N; imperial fingers do. Wendigo hide is rimewoven, it never stiffens in the cold, and I need six hides to line the garrison gauntlets. The wendigo will not donate them. Fourteen culled, six hides.',
    completionText:
      'Feel that: supple at the deepest frost. Every gauntlet off my bench this winter carries your hunting in its lining, $N. The garrison will not know to thank you; I do.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'frosthelm_wendigo',
        count: 14,
        label: 'Frosthelm Wendigo slain',
      },
      { type: 'collect', itemId: 'rimewoven_hide', count: 6, label: 'Rimewoven Hide' },
    ],
    xpReward: 17000,
    copperReward: 7600,
    itemRewards: {},
    requiresQuest: 'q_granite_tempering',
    minLevel: 37,
  },
  q_ogre_iron_reforging: {
    id: 'q_ogre_iron_reforging',
    name: 'Sellsword Iron',
    giverNpcId: 'armorer_ottokar',
    turnInNpcId: 'armorer_ottokar',
    text: 'The ogres carry crude pig iron for patching their kit, $N, and crude or not, iron is iron. Reforged to imperial pattern it becomes bolt heads, hinges, and one fewer requisition I wait on. Twelve sellswords, eight ingots.',
    completionText:
      'Ogre iron, imperial pattern. The forge does not care who smelted it first, and after the third folding neither do I. Good weight, $N; the bolt heads will fly true.',
    objectives: [
      { type: 'kill', targetMobId: 'sellsword_ogre', count: 12, label: 'Sellsword Ogre slain' },
      { type: 'collect', itemId: 'sellsword_pig_iron', count: 8, label: 'Sellsword Pig Iron' },
    ],
    xpReward: 18500,
    copperReward: 8200,
    itemRewards: {},
    requiresQuest: 'q_wendigo_hide_lining',
    minLevel: 38,
  },
  // --- Quartermaster Hilde: stores and supply lines ---
  q_larder_restock: {
    id: 'q_larder_restock',
    name: 'Restock the Larder',
    giverNpcId: 'quartermaster_hilde',
    turnInNpcId: 'quartermaster_hilde',
    text: 'The garrison pot does not fill itself, $N, and salted wolf haunch keeps through the winter better than promises from the granary office. Twelve packwolves, eight lean haunches, delivered to my cold store. The forms are already stamped.',
    completionText:
      'Eight haunches, good weight, no spoilage. The pot is full for a month and the men fight better fed. Simple arithmetic, $N, and you carry it well.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'wolfsward_packwolf',
        count: 12,
        label: 'Wolfsward Packwolf slain',
      },
      { type: 'collect', itemId: 'lean_wolf_haunch', count: 8, label: 'Lean Wolf Haunch' },
    ],
    xpReward: 11000,
    copperReward: 5000,
    itemRewards: {},
    minLevel: 33,
  },
  q_ration_theft: {
    id: 'q_ration_theft',
    name: 'The Ration Count',
    giverNpcId: 'quartermaster_hilde',
    turnInNpcId: 'quartermaster_hilde',
    text: 'Fourteen crates of field rations left the granaries, $N; eleven arrived. The Ironhold diggers pilfer from the supply carts at the mine turnoff, and my count will balance if I have to weigh every kobold in the warren. Fourteen diggers, six ration packs recovered.',
    completionText:
      'Six packs recovered and the count balances. I will not ask what state the biscuit is in; the form has no field for teeth marks. The Empire thanks you in inventory, $N.',
    objectives: [
      { type: 'kill', targetMobId: 'ironhold_digger', count: 14, label: 'Ironhold Digger slain' },
      {
        type: 'collect',
        itemId: 'pilfered_ration_pack',
        count: 6,
        label: 'Pilfered Ration Pack',
      },
    ],
    xpReward: 13500,
    copperReward: 6200,
    itemRewards: {},
    requiresQuest: 'q_larder_restock',
    minLevel: 34,
  },
  q_stores_for_the_ascent: {
    id: 'q_stores_for_the_ascent',
    name: 'Stores for the Ascent',
    giverNpcId: 'quartermaster_hilde',
    turnInNpcId: 'quartermaster_hilde',
    text: 'The winter stores for the Frosthelm garrison move under requisition chits, and the ogres took the whole consignment, chits and all, $N. Without the chits I cannot even certify the loss. Fourteen sellswords, six chits, and the Ascent eats this winter.',
    completionText:
      'Six chits, countersigned and legible. The stores they cover are gone into ogre bellies, but a certified loss is a loss the Empire replaces. The Ascent eats, $N, because the paperwork survived.',
    objectives: [
      { type: 'kill', targetMobId: 'sellsword_ogre', count: 14, label: 'Sellsword Ogre slain' },
      {
        type: 'collect',
        itemId: 'sellsword_requisition_chit',
        count: 6,
        label: 'Sellsword Requisition Chit',
      },
    ],
    xpReward: 18000,
    copperReward: 8200,
    itemRewards: {},
    requiresQuest: 'q_ration_theft',
    minLevel: 37,
  },
};

export const KAEL_QUEST_ORDER = [
  'q_wolfsward_culling',
  'q_ironhold_ledgers',
  'q_granite_tempering',
  'q_broken_legion',
  'q_frosthelm_pass',
  'q_renegade_commander',
  // Prefect Alina: the tithe audit chain
  'q_tithe_scrip_recovery',
  'q_candle_tax_arrears',
  'q_assay_seal_audit',
  'q_pay_chest_manifest',
  'q_overseer_audit',
  // Huntmaster Roderic: the charter hunt chain
  'q_pelt_requisition',
  'q_hoarfang_writ',
  'q_wendigo_gall',
  'q_icehowler_cull',
  // Marshal Corvin: the watch-fort campaign
  'q_arbalist_lines',
  'q_ogre_paymasters',
  'q_watchfort_reclamation',
  'q_frosthelm_signals',
  // Armorer Ottokar: winter materiel
  'q_wendigo_hide_lining',
  'q_ogre_iron_reforging',
  // Quartermaster Hilde: stores and supply lines
  'q_larder_restock',
  'q_ration_theft',
  'q_stores_for_the_ascent',
];

// ---------------------------------------------------------------------------
// Camps (spawn tables), merged AFTER every existing camp in data.ts, and in
// this order relative to the other Valdris zones, so world-gen RNG draw order
// for pre-existing content never shifts. Graded south (33) to north (40).
// ---------------------------------------------------------------------------

export const KAEL_CAMPS: CampDef[] = [
  // Wolves: the Wolfsward pines flanking the south road and the granary fields
  { mobId: 'wolfsward_packwolf', center: { x: -85, z: 1740 }, radius: 20, count: 7 },
  { mobId: 'wolfsward_packwolf', center: { x: -55, z: 1722 }, radius: 16, count: 6 },
  { mobId: 'hoarfang_alpha', center: { x: -112, z: 1726 }, radius: 4, count: 1 },
  { mobId: 'wolfsward_packwolf', center: { x: 95, z: 1748 }, radius: 14, count: 5 },
  // Kobolds: Ironhold Mine, east of the millpond road
  { mobId: 'ironhold_digger', center: { x: 92, z: 1878 }, radius: 20, count: 8 },
  { mobId: 'ironhold_digger', center: { x: 120, z: 1902 }, radius: 16, count: 6 },
  { mobId: 'overseer_kazrik', center: { x: 135, z: 1888 }, radius: 5, count: 1 },
  // Granite churns: the deep mine terraces, northeast
  { mobId: 'granite_churn_elemental', center: { x: 128, z: 1938 }, radius: 18, count: 7 },
  { mobId: 'granite_churn_elemental', center: { x: 100, z: 1962 }, radius: 16, count: 6 },
  // The Broken Legion: a ruined watch-fort in the northwest pines
  { mobId: 'broken_legion_deserter', center: { x: -95, z: 1938 }, radius: 20, count: 8 },
  { mobId: 'broken_legion_arbalist', center: { x: -72, z: 1952 }, radius: 16, count: 6 },
  { mobId: 'broken_legion_deserter', center: { x: -122, z: 1962 }, radius: 18, count: 7 },
  { mobId: 'broken_legion_arbalist', center: { x: -104, z: 1984 }, radius: 14, count: 5 },
  // Ogre sellswords: the legion's hired muscle, camped on its flanks
  { mobId: 'sellsword_ogre', center: { x: -45, z: 1985 }, radius: 16, count: 6 },
  { mobId: 'sellsword_ogre', center: { x: -148, z: 1994 }, radius: 14, count: 5 },
  // Commander Vaelis: the Oathbroken redoubt above the legion camp
  { mobId: 'commander_vaelis', center: { x: -118, z: 2004 }, radius: 3, count: 1 },
  // Wendigo: the Frosthelm Ascent, at the snow line
  { mobId: 'frosthelm_wendigo', center: { x: -55, z: 2030 }, radius: 18, count: 7 },
  { mobId: 'frosthelm_wendigo', center: { x: 60, z: 2028 }, radius: 18, count: 7 },
  { mobId: 'frosthelm_wendigo', center: { x: 30, z: 2048 }, radius: 14, count: 5 },
  // Appended after every pre-existing Kael camp (world-gen RNG draw order):
  // geomancers on the deep mine terraces, icehowlers above the snow line.
  { mobId: 'ironhold_geomancer', center: { x: 112, z: 1920 }, radius: 16, count: 6 },
  { mobId: 'ironhold_geomancer', center: { x: 142, z: 1908 }, radius: 14, count: 5 },
  { mobId: 'frosthelm_icehowler', center: { x: -18, z: 2036 }, radius: 16, count: 6 },
  { mobId: 'frosthelm_icehowler', center: { x: 8, z: 2016 }, radius: 14, count: 5 },
];

export const KAEL_OBJECTS: GroundObjectDef[] = [];

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const KAEL_ITEMS: Record<string, ItemDef> = {
  // --- quest items ---
  stolen_tithe_ledger: {
    id: 'stolen_tithe_ledger',
    name: 'Stolen Tithe Ledger',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_ironhold_ledgers',
  },
  granite_core_shard: {
    id: 'granite_core_shard',
    name: 'Granite Core Shard',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_granite_tempering',
  },
  legion_deserter_insignia: {
    id: 'legion_deserter_insignia',
    name: 'Legion Deserter Insignia',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_broken_legion',
  },
  chewed_tithe_scrip: {
    id: 'chewed_tithe_scrip',
    name: 'Chewed Tithe Scrip',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_tithe_scrip_recovery',
  },
  candle_tax_tally: {
    id: 'candle_tax_tally',
    name: 'Candle Tax Tally',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_candle_tax_arrears',
  },
  assay_office_seal: {
    id: 'assay_office_seal',
    name: 'Assay Office Seal',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_assay_seal_audit',
  },
  legion_pay_manifest: {
    id: 'legion_pay_manifest',
    name: 'Legion Pay Manifest',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_pay_chest_manifest',
  },
  prime_wolf_pelt: {
    id: 'prime_wolf_pelt',
    name: 'Prime Wolf Pelt',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_pelt_requisition',
  },
  wendigo_gallstone: {
    id: 'wendigo_gallstone',
    name: 'Wendigo Gallstone',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_wendigo_gall',
  },
  icehowler_ruff: {
    id: 'icehowler_ruff',
    name: 'Icehowler Ruff',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_icehowler_cull',
  },
  legion_quarrel_bundle: {
    id: 'legion_quarrel_bundle',
    name: 'Legion Quarrel Bundle',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_arbalist_lines',
  },
  clipped_imperial_coin: {
    id: 'clipped_imperial_coin',
    name: 'Clipped Imperial Coin',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_ogre_paymasters',
  },
  rimewoven_hide: {
    id: 'rimewoven_hide',
    name: 'Rimewoven Hide',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_wendigo_hide_lining',
  },
  sellsword_pig_iron: {
    id: 'sellsword_pig_iron',
    name: 'Sellsword Pig Iron',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_ogre_iron_reforging',
  },
  lean_wolf_haunch: {
    id: 'lean_wolf_haunch',
    name: 'Lean Wolf Haunch',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_larder_restock',
  },
  pilfered_ration_pack: {
    id: 'pilfered_ration_pack',
    name: 'Pilfered Ration Pack',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_ration_theft',
  },
  sellsword_requisition_chit: {
    id: 'sellsword_requisition_chit',
    name: 'Sellsword Requisition Chit',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_stores_for_the_ascent',
  },
  // --- junk / flavor drops ---
  frostbrush_wolf_fang: {
    id: 'frostbrush_wolf_fang',
    name: 'Frostbrush Wolf Fang',
    kind: 'junk',
    quality: 'poor',
    sellValue: 64,
  },
  bent_legion_buckle: {
    id: 'bent_legion_buckle',
    name: 'Bent Legion Buckle',
    kind: 'junk',
    quality: 'poor',
    sellValue: 70,
  },
  ogre_knuckle_dice: {
    id: 'ogre_knuckle_dice',
    name: 'Ogre Knuckle Dice',
    kind: 'junk',
    quality: 'poor',
    sellValue: 72,
  },
  hoarfang_pelt: {
    id: 'hoarfang_pelt',
    name: 'Pelt of the Hoarfang Alpha',
    kind: 'junk',
    quality: 'uncommon',
    sellValue: 1280,
  },
  kazriks_brass_whistle: {
    id: 'kazriks_brass_whistle',
    name: "Kazrik's Brass Whistle",
    kind: 'junk',
    quality: 'uncommon',
    sellValue: 1440,
  },
  // --- vendor food / drink ---
  kaelspire_barley_loaf: {
    id: 'kaelspire_barley_loaf',
    name: 'Kaelspire Barley Loaf',
    kind: 'food',
    quality: 'common',
    foodHp: 1500,
    sellValue: 180,
    buyValue: 2900,
  },
  silverbrook_spring_water: {
    id: 'silverbrook_spring_water',
    name: 'Silverbrook Spring Water',
    kind: 'drink',
    quality: 'common',
    drinkMana: 2200,
    sellValue: 180,
    buyValue: 2900,
  },
  imperial_field_ration: {
    id: 'imperial_field_ration',
    name: 'Imperial Field Ration',
    kind: 'food',
    quality: 'common',
    foodHp: 1800,
    sellValue: 240,
    buyValue: 3800,
  },
  // --- vendor armor ---
  imperial_clerks_robe: {
    id: 'imperial_clerks_robe',
    name: "Imperial Clerk's Robe",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 100 },
    sellValue: 1450,
    buyValue: 14500,
  },
  kael_infantry_hauberk: {
    id: 'kael_infantry_hauberk',
    name: 'Kael Infantry Hauberk',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 330 },
    sellValue: 1600,
    buyValue: 16000,
  },
  wolfsward_hunting_jerkin: {
    id: 'wolfsward_hunting_jerkin',
    name: 'Wolfsward Hunting Jerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 190 },
    sellValue: 1500,
    buyValue: 15000,
  },
  // Cloth like zone3's ridgestalker_treads: the shared quest reward for all
  // three archetypes, so every class must be able to wear it.
  tithe_road_marchboots: {
    id: 'tithe_road_marchboots',
    name: 'Tithe Road Marchboots',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 86, agi: 11, sta: 8 },
    sellValue: 1750,
    buyValue: 17500,
  },
  imperial_marcher_legguards: {
    id: 'imperial_marcher_legguards',
    name: 'Imperial Marcher Legguards',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'common',
    stats: { armor: 285 },
    sellValue: 1600,
    buyValue: 16000,
  },
  // --- vendor / reward weapons ---
  kael_arming_sword: {
    id: 'kael_arming_sword',
    name: 'Kael Arming Sword',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 30, max: 48, speed: 2.4 },
    sellValue: 1450,
    buyValue: 14500,
  },
  frosthelm_warstaff: {
    id: 'frosthelm_warstaff',
    name: 'Frosthelm Warstaff',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 38, max: 61, speed: 2.9 },
    stats: { int: 14, sta: 8 },
    sellValue: 1900,
    buyValue: 19000,
    requiredClass: ['mage', 'priest', 'warlock', 'druid', 'shaman'],
  },
  wolfsward_skinner: {
    id: 'wolfsward_skinner',
    name: 'Wolfsward Skinner',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 26, max: 42, speed: 1.8 },
    stats: { agi: 13 },
    sellValue: 1900,
    buyValue: 19000,
    requiredClass: ['rogue', 'hunter'],
  },
  // Cloth like tithe_road_marchboots: shared quest rewards for all three
  // archetypes, so every class must be able to wear them.
  prefects_sealed_mantle: {
    id: 'prefects_sealed_mantle',
    name: "Prefect's Sealed Mantle",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 92, int: 12, sta: 10 },
    sellValue: 2100,
  },
  huntmasters_winter_hood: {
    id: 'huntmasters_winter_hood',
    name: "Huntmaster's Winter Hood",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'uncommon',
    stats: { armor: 96, agi: 13, sta: 10 },
    sellValue: 2300,
  },
  // --- rare-elite drops ---
  hoarfang_clawgrips: {
    id: 'hoarfang_clawgrips',
    name: 'Hoarfang Clawgrips',
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 118, agi: 14, sta: 10 },
    sellValue: 3800,
  },
  overseers_candlewraps: {
    id: 'overseers_candlewraps',
    name: "Overseer's Candlewraps",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 70, int: 16, sta: 11 },
    sellValue: 4200,
  },
  oathbreakers_battleplate: {
    id: 'oathbreakers_battleplate',
    name: "Oathbreaker's Battleplate",
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 416, str: 16, sta: 14 },
    sellValue: 5100,
  },
  oathbreakers_greatblade: {
    id: 'oathbreakers_greatblade',
    name: "Oathbreaker's Greatblade",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 42, max: 67, speed: 2.5 },
    stats: { str: 13, sta: 10 },
    sellValue: 5400,
  },
};

// ---------------------------------------------------------------------------
// Static props (rendering + collision share this placement data). Kaelspire
// sits on the hub plateau behind imperial gate fences; the Silverbrook
// Millpond at (-75, 1855) stays clear of every placement.
// ---------------------------------------------------------------------------

export const KAEL_PROPS: ZonePropsDef = {
  buildings: [
    { kind: 'house', x: 14, z: 1794, w: 7, d: 6, rot: -0.5 },
    { kind: 'house', x: 8, z: 1812, w: 6, d: 5, rot: 0.4 },
    { kind: 'house', x: 18, z: 1804, w: 6, d: 5, rot: 1.2 },
    { kind: 'house', x: 16, z: 1780, w: 6, d: 6, rot: 0.2 }, // the Tithe House
    { kind: 'inn', x: -15, z: 1806, w: 6, d: 7, rot: 0.6 }, // the Grain and Standard
    { kind: 'chapel', x: -16, z: 1790, w: 5, d: 7, rot: 0.9 }, // chapel of the imperial oath
    { kind: 'house', x: -56, z: 1850, w: 6, d: 6, rot: 1.6 }, // the Silverbrook mill
    { kind: 'house', x: 60, z: 1727, w: 7, d: 6, rot: 0.3 }, // granary
    { kind: 'house', x: 66, z: 1734, w: 7, d: 6, rot: -0.4 }, // granary
  ],
  wells: [{ x: 0, z: 1802, r: 1.5 }],
  stalls: [
    { x: -7.5, z: 1807, rot: Math.PI / 2, r: 1.7 }, // Quartermaster Hilde
    { x: -4.5, z: 1813.5, rot: -0.6, r: 1.7 }, // Armorer Ottokar
  ],
  mines: [
    { x: 90, z: 1880, rot: -2.0 }, // Ironhold Mine, main adit
    { x: 118, z: 1900, rot: Math.PI / 2 }, // the northern outpost shaft
  ],
  docks: [],
  tents: [
    // the Broken Legion camp in the ruined watch-fort
    { x: -90, z: 1932, rot: 0.5, scale: 1.2 },
    { x: -98, z: 1940, rot: 2.0, scale: 1.2 },
    { x: -118, z: 1958, rot: 0.8, scale: 1 },
    { x: -126, z: 1966, rot: -0.5, scale: 1 },
    // the ogre sellsword camp on the legion's east flank
    { x: -42, z: 1982, rot: 1.5, scale: 1.4 },
    { x: -50, z: 1990, rot: -1.0, scale: 1.4 },
  ],
  crates: [
    [60, 1728],
    [-94, 1936],
    [88, 1876],
  ],
  campfires: [
    [2, 1798],
    [-95, 1937],
    [-122, 1963],
    [-46, 1986],
    [92, 1882],
  ],
  mudHuts: [],
  ruinRings: [
    { x: -30, z: 1706, ringR: 6, columns: 5 }, // the old toll arch on the Tithe Road
    { x: -105, z: 1958, ringR: 7, columns: 6 }, // the ruined watch-fort the legion squats in
    { x: 48, z: 2036, ringR: 6, columns: 5 }, // the Frosthelm waystation ruin
  ],
  fences: [
    { x1: -14, z1: 1789, x2: -4, z2: 1787 }, // south gate, west run
    { x1: 4, z1: 1787, x2: 14, z2: 1789 }, // south gate, east run
    { x1: -14, z1: 1813, x2: -4, z2: 1815 }, // north gate, west run
    { x1: 4, z1: 1815, x2: 14, z2: 1813 }, // north gate, east run
    { x1: 50, z1: 1722, x2: 70, z2: 1722 }, // granary field, south run
    { x1: 50, z1: 1738, x2: 70, z2: 1738 }, // granary field, north run
    { x1: 50, z1: 1722, x2: 50, z2: 1738 }, // granary field, west run
  ],
  graveyards: [{ x: -24, z: 1786 }],
};
