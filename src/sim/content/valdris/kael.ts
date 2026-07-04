// Kael Empire (levels 20-40): the imperial northern heartland of Valdris and
// the most organized power in the known world. Fertile granary plains climb
// into the Wolfsward pines and end at the snow-capped Frosthelm peaks; the
// roads are patrolled, the taxes are collected twice, and every noble house
// keeps one eye on the throne and the other on its neighbors. Kaelspire, the
// fortified capital seat of the northern march, holds the Tithe Road open.
// The Empire's own soldiers are not the threat here: the danger is what the
// Empire cannot requisition away. Difficulty ramps south to north across the
// band: wolf packs and truant militia in the granary south (20s), the kobolds
// squatting under Ironhold Mine, House Maren's unlicensed duelists, the stone
// that woke beneath the deep terraces, and the Broken Legion's deserter camps
// in the pine belt (high 20s to low 30s, watched from Fort Ledgerwatch on the
// road), then the Empire's frayed northern edge (mid 30s to 40): the ogre
// sellswords hired with stolen pay, the loyalist oathguard around the
// oathbroken commander who leads them, and the wendigo snow line above the
// Rimeshaft mining camp.
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
  levelRange: [20, 40],
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
    // Appended after every pre-existing POI (labels localize by array index).
    { x: 24, z: 1930, label: 'Fort Ledgerwatch' },
    { x: 22, z: 2016, label: 'Rimeshaft Camp' },
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
    // Worrying Bite: the packs learned imperial convoys mean meat.
    bleed: {
      chance: 0.25,
      perTick: 6,
      interval: 3,
      duration: 9,
      name: 'Worrying Bite',
      school: 'physical',
    },
    loot: [
      { copper: 110, chance: 1 },
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
    minLevel: 24,
    maxLevel: 24,
    family: 'beast',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 7.2,
    hpBase: 400,
    hpPerLevel: 66,
    dmgBase: 20,
    dmgPerLevel: 4.4,
    attackSpeed: 1.7,
    armorPerLevel: 28,
    moveSpeed: 8.6,
    aggroRadius: 13,
    aoePulse: { min: 26, max: 36, radius: 8, every: 9, name: 'Ravening Lunge', school: 'physical' },
    enrage: { belowHpPct: 0.35, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 480, chance: 1 },
      { itemId: 'hoarfang_pelt', chance: 1 },
      { itemId: 'hoarfang_clawgrips', chance: 0.3 },
    ],
    scale: 1.35,
    color: 0xbfc9d4,
  },
  ironhold_digger: {
    id: 'ironhold_digger',
    name: 'Ironhold Digger',
    minLevel: 24,
    maxLevel: 26,
    family: 'burrower',
    hpBase: 78,
    hpPerLevel: 25,
    dmgBase: 14,
    dmgPerLevel: 3.1,
    attackSpeed: 2.0,
    armorPerLevel: 20,
    moveSpeed: 7,
    aggroRadius: 10,
    // Gouging Pick: a mining pick swung at people chews through armor too.
    corrode: {
      chance: 0.3,
      armor: 40,
      maxStacks: 4,
      duration: 15,
      name: 'Gouging Pick',
      school: 'physical',
    },
    loot: [
      { copper: 170, chance: 1 },
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
    minLevel: 26,
    maxLevel: 28,
    family: 'burrower',
    hpBase: 82,
    hpPerLevel: 26,
    dmgBase: 15,
    dmgPerLevel: 3.2,
    attackSpeed: 2.2,
    armorPerLevel: 20,
    moveSpeed: 6.6,
    aggroRadius: 11,
    // Pebble Ward: a rattling shell of quarry scree, shed and re-raised.
    stoneskin: { amount: 120, every: 16, duration: 6, name: 'Pebble Ward' },
    loot: [
      { copper: 200, chance: 1 },
      { itemId: 'assay_office_seal', chance: 0.4, questId: 'q_assay_seal_audit' },
      { itemId: 'mana_potion', chance: 0.06 },
    ],
    scale: 0.9,
    color: 0x9a7d52,
  },
  broken_legion_deserter: {
    id: 'broken_legion_deserter',
    name: 'Broken Legion Deserter',
    minLevel: 27,
    maxLevel: 29,
    family: 'humanoid',
    hpBase: 84,
    hpPerLevel: 26,
    dmgBase: 15,
    dmgPerLevel: 3.2,
    attackSpeed: 2.0,
    armorPerLevel: 24,
    moveSpeed: 7,
    aggroRadius: 11,
    // Drilled to imperial standard; the Empire regrets the drilling now.
    expose: { chance: 0.3, dmgIncrease: 0.15, duration: 10, name: 'Legion Breach' },
    cleave: { radius: 5, mult: 0.5, name: 'Line Breaker' },
    loot: [
      { copper: 190, chance: 1 },
      { itemId: 'legion_deserter_insignia', chance: 0.55, questId: 'q_broken_legion' },
      { itemId: 'legion_pay_manifest', chance: 0.4, questId: 'q_pay_chest_manifest' },
      { itemId: 'amnesty_petition', chance: 0.45, questId: 'q_deserter_amnesty_rolls' },
      { itemId: 'fort_pattern_kettle', chance: 0.45, questId: 'q_sutlers_kettles' },
      { itemId: 'bent_legion_buckle', chance: 0.35 },
    ],
    scale: 1.0,
    color: 0x6d6f7a,
  },
  broken_legion_arbalist: {
    id: 'broken_legion_arbalist',
    name: 'Broken Legion Arbalist',
    minLevel: 29,
    maxLevel: 31,
    family: 'humanoid',
    hpBase: 86,
    hpPerLevel: 27,
    dmgBase: 16,
    dmgPerLevel: 3.3,
    attackSpeed: 2.2,
    armorPerLevel: 22,
    moveSpeed: 7,
    aggroRadius: 12,
    // Pinning Bolt: a quarrel through the boot keeps you where the line wants you.
    ensnare: { chance: 0.25, duration: 3, name: 'Pinning Bolt', school: 'physical' },
    loot: [
      { copper: 210, chance: 1 },
      { itemId: 'legion_deserter_insignia', chance: 0.5, questId: 'q_broken_legion' },
      { itemId: 'legion_quarrel_bundle', chance: 0.4, questId: 'q_arbalist_lines' },
      { itemId: 'garnished_pay_pouch', chance: 0.45, questId: 'q_interest_on_arrears' },
      { itemId: 'bent_legion_buckle', chance: 0.3 },
    ],
    scale: 1.0,
    color: 0x5c6470,
  },
  granite_churn_elemental: {
    id: 'granite_churn_elemental',
    name: 'Granite Churn Elemental',
    minLevel: 31,
    maxLevel: 33,
    family: 'elemental',
    hpBase: 90,
    hpPerLevel: 27,
    dmgBase: 16,
    dmgPerLevel: 3.4,
    attackSpeed: 2.3,
    armorPerLevel: 28,
    moveSpeed: 6.2,
    aggroRadius: 10,
    // Something under the deep terraces did not care to be mined.
    stoneskin: { amount: 170, every: 14, duration: 8, name: 'Granite Carapace' },
    knockback: { chance: 0.2, distance: 5, name: 'Churning Slam' },
    loot: [
      { copper: 245, chance: 1 },
      { itemId: 'granite_core_shard', chance: 0.5, questId: 'q_granite_tempering' },
      { itemId: 'fault_line_core', chance: 0.45, questId: 'q_terrace_undermining' },
    ],
    scale: 1.15,
    color: 0x8d8d8d,
  },
  sellsword_ogre: {
    id: 'sellsword_ogre',
    name: 'Sellsword Ogre',
    minLevel: 36,
    maxLevel: 38,
    family: 'ogre',
    hpBase: 98,
    hpPerLevel: 29,
    dmgBase: 18,
    dmgPerLevel: 3.7,
    attackSpeed: 2.6,
    armorPerLevel: 22,
    moveSpeed: 6.8,
    aggroRadius: 11,
    // Paid in stolen imperial coin; enforcement of the contract is included.
    concuss: { chance: 0.2, duration: 2, name: 'Skullringer' },
    loot: [
      { copper: 300, chance: 1 },
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
      { itemId: 'icehowler_haunch', chance: 0.5, questId: 'q_cold_store_restock' },
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
    minLevel: 28,
    maxLevel: 28,
    family: 'burrower',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 520,
    hpPerLevel: 82,
    dmgBase: 24,
    dmgPerLevel: 5.0,
    attackSpeed: 2.2,
    armorPerLevel: 40,
    moveSpeed: 6.8,
    aggroRadius: 13,
    aoePulse: { min: 34, max: 46, radius: 10, every: 9, name: 'Candle Flare', school: 'fire' },
    summonAdds: { mobId: 'ironhold_digger', count: 2, atHpPct: [0.5] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.45, hasteMult: 1.25 },
    loot: [
      { copper: 750, chance: 1 },
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
    mortalStrike: { chance: 0.25, healReduction: 0.5, duration: 6, name: 'Maiming Strike' },
    summonAdds: { mobId: 'legion_oathguard_veteran', count: 2, atHpPct: [0.5] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.4, hasteMult: 1.2 },
    loot: [
      { copper: 4200, chance: 1 },
      { itemId: 'oathbreakers_battleplate', chance: 0.3 },
      { itemId: 'oathbreakers_greatblade', chance: 0.25 },
    ],
    scale: 1.35,
    color: 0x7d2f2f,
  },
  // The granary district's militia levy failed to report this spring; it
  // robs the grain carts it was raised to guard, carrying forged exemption
  // papers, which the Prefect counts as a second offense.
  granary_militia_deserter: {
    id: 'granary_militia_deserter',
    name: 'Granary Militia Deserter',
    minLevel: 22,
    maxLevel: 24,
    family: 'humanoid',
    hpBase: 74,
    hpPerLevel: 24,
    dmgBase: 13,
    dmgPerLevel: 2.9,
    attackSpeed: 2.0,
    armorPerLevel: 22,
    moveSpeed: 7,
    aggroRadius: 10,
    // A grain hook is not a regulation weapon, which is rather the point.
    bleed: {
      chance: 0.2,
      perTick: 6,
      interval: 3,
      duration: 9,
      name: 'Grain Hook',
      school: 'physical',
    },
    loot: [
      { copper: 140, chance: 1 },
      { itemId: 'forged_levy_papers', chance: 0.5, questId: 'q_forged_exemptions' },
      { itemId: 'healing_potion', chance: 0.06 },
    ],
    scale: 1.0,
    color: 0x76705a,
  },
  // House Maren duels on imperial ground without stamped permits and calls it
  // honor; the fee schedule calls it forty silver a bout, compounding.
  maren_house_duelist: {
    id: 'maren_house_duelist',
    name: 'House Maren Duelist',
    minLevel: 32,
    maxLevel: 34,
    family: 'humanoid',
    hpBase: 92,
    hpPerLevel: 28,
    dmgBase: 17,
    dmgPerLevel: 3.5,
    attackSpeed: 1.9,
    armorPerLevel: 22,
    moveSpeed: 7.4,
    aggroRadius: 11,
    bleed: {
      chance: 0.25,
      perTick: 10,
      interval: 3,
      duration: 9,
      name: 'Dueling Scar',
      school: 'physical',
    },
    expose: { chance: 0.25, dmgIncrease: 0.15, duration: 8, name: 'Measured Riposte' },
    loot: [
      { copper: 280, chance: 1 },
      { itemId: 'unstamped_duel_permit', chance: 0.5, questId: 'q_duelling_permits' },
      { itemId: 'maren_calling_card', chance: 0.3 },
    ],
    scale: 1.0,
    color: 0x7a4a5c,
  },
  // Wendigo kin from below the snow line: leaner, faster, and denning in the
  // Rimeshaft spoil heaps, where the claims office classifies them as weather.
  frosthelm_rimeclaw: {
    id: 'frosthelm_rimeclaw',
    name: 'Frosthelm Rimeclaw',
    minLevel: 34,
    maxLevel: 36,
    family: 'beast',
    hpBase: 93,
    hpPerLevel: 28,
    dmgBase: 17,
    dmgPerLevel: 3.5,
    attackSpeed: 2.0,
    armorPerLevel: 22,
    moveSpeed: 7.8,
    aggroRadius: 11,
    chillOnHit: { chance: 0.25, mult: 0.65, duration: 4, name: 'Rime Rake' },
    loot: [
      { copper: 290, chance: 1 },
      { itemId: 'rimeclaw_tallow', chance: 0.5, questId: 'q_tallow_ledger' },
      { itemId: 'rimeclaw_marrowbone', chance: 0.5, questId: 'q_marrow_for_the_kettles' },
      { itemId: 'frostbrush_wolf_fang', chance: 0.25 },
    ],
    scale: 1.1,
    color: 0xb9cdd8,
  },
  // The veterans who chose Vaelis over the Empire twice: what is left of the
  // Ninth's discipline, in imperial plate, ringing the redoubt.
  legion_oathguard_veteran: {
    id: 'legion_oathguard_veteran',
    name: 'Legion Oathguard Veteran',
    minLevel: 36,
    maxLevel: 38,
    family: 'humanoid',
    hpBase: 96,
    hpPerLevel: 29,
    dmgBase: 18,
    dmgPerLevel: 3.6,
    attackSpeed: 2.1,
    armorPerLevel: 30,
    moveSpeed: 6.8,
    aggroRadius: 11,
    cleave: { radius: 5, mult: 0.5, name: 'Wall of the Ninth' },
    expose: { chance: 0.3, dmgIncrease: 0.15, duration: 10, name: 'Oathguard Drill' },
    loot: [
      { copper: 300, chance: 1 },
      { itemId: 'oathguard_plate_scrap', chance: 0.45, questId: 'q_oathguard_plate' },
      { itemId: 'ninth_muster_roll', chance: 0.4, questId: 'q_the_norths_books' },
      { itemId: 'bent_legion_buckle', chance: 0.3 },
    ],
    scale: 1.05,
    color: 0x4f4a56,
  },
  // Shaft three broke into blue ice that walks. The claims office calls them
  // a geological event to avoid paying hazard rates; the assay office calls
  // them ambulatory assets and wants them weighed.
  rimebound_elemental: {
    id: 'rimebound_elemental',
    name: 'Rimebound Elemental',
    minLevel: 38,
    maxLevel: 40,
    family: 'elemental',
    hpBase: 98,
    hpPerLevel: 29,
    dmgBase: 18,
    dmgPerLevel: 3.7,
    attackSpeed: 2.3,
    armorPerLevel: 30,
    moveSpeed: 6.2,
    aggroRadius: 10,
    stoneskin: { amount: 200, every: 15, duration: 7, name: 'Blue Ice Carapace' },
    chillOnHit: { chance: 0.3, mult: 0.6, duration: 5, name: 'Glacial Grip' },
    loot: [
      { copper: 330, chance: 1 },
      { itemId: 'rimebound_core_ice', chance: 0.45, questId: 'q_core_ice_assay' },
      { itemId: 'glacial_quench_ice', chance: 0.45, questId: 'q_rimebound_quench' },
      { itemId: 'mana_potion', chance: 0.06 },
    ],
    scale: 1.15,
    color: 0xa8d4e8,
  },
  // Assessor Maldrek died on his collection route forty years ago and has not
  // let that interrupt his rounds. He assesses travelers at swordpoint and
  // issues receipts no office honors; his commission is revoked, in person.
  assessor_maldrek: {
    id: 'assessor_maldrek',
    name: 'Assessor Maldrek the Unremitted',
    minLevel: 35,
    maxLevel: 35,
    family: 'undead',
    rare: true,
    elite: true,
    ccImmune: true,
    respawnMult: 7.2,
    hpBase: 640,
    hpPerLevel: 94,
    dmgBase: 27,
    dmgPerLevel: 5.4,
    attackSpeed: 2.2,
    armorPerLevel: 42,
    moveSpeed: 7,
    aggroRadius: 13,
    aoePulse: {
      min: 50,
      max: 66,
      radius: 9,
      every: 10,
      name: 'Compound Interest',
      school: 'shadow',
    },
    expose: { chance: 0.3, dmgIncrease: 0.2, duration: 10, name: 'Final Notice' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.4, hasteMult: 1.25 },
    loot: [
      { copper: 980, chance: 1 },
      { itemId: 'maldreks_route_ledger', chance: 1 },
      { itemId: 'assessors_lead_greaves', chance: 0.3 },
    ],
    scale: 1.15,
    color: 0x6f7d6a,
  },
  // The ogre who keeps the Ninth's stolen pay chest. He has never mastered
  // counting but has fully mastered sitting on a box.
  purse_warden_grulk: {
    id: 'purse_warden_grulk',
    name: 'Purse-Warden Grulk',
    minLevel: 38,
    maxLevel: 38,
    family: 'ogre',
    rare: true,
    elite: true,
    ccImmune: true,
    respawnMult: 7.2,
    hpBase: 680,
    hpPerLevel: 100,
    dmgBase: 29,
    dmgPerLevel: 5.6,
    attackSpeed: 2.5,
    armorPerLevel: 38,
    moveSpeed: 6.8,
    aggroRadius: 13,
    concuss: { chance: 0.25, duration: 2, name: 'Chestlid Slam' },
    aoePulse: {
      min: 56,
      max: 74,
      radius: 9,
      every: 10,
      name: 'Scatter the Till',
      school: 'physical',
    },
    summonAdds: { mobId: 'sellsword_ogre', count: 2, atHpPct: [0.5] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.4, hasteMult: 1.2 },
    loot: [
      { copper: 1150, chance: 1 },
      { itemId: 'grulks_iron_strongbox', chance: 1 },
      { itemId: 'purse_wardens_coinbelt', chance: 0.3 },
    ],
    scale: 1.5,
    color: 0xc4a25e,
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
      'q_sign_the_garrison_book',
      'q_wolfsward_culling',
      'q_the_levy_answers',
      'q_ironhold_ledgers',
      'q_report_to_ledgerwatch',
      'q_broken_legion',
      'q_arbalist_lines',
      'q_watchfort_reclamation',
      'q_ogre_paymasters',
      'q_frosthelm_pass',
      'q_the_oathguard',
      'q_frosthelm_signals',
      'q_renegade_commander',
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
    questIds: [
      'q_granite_tempering',
      'q_ogre_iron_reforging',
      'q_oathguard_plate',
      'q_wendigo_hide_lining',
      'q_rimebound_quench',
    ],
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
      'q_forged_exemptions',
      'q_candle_tax_arrears',
      'q_assay_seal_audit',
      'q_pay_chest_manifest',
      'q_overseer_audit',
      'q_quarter_end_closing',
      'q_the_norths_books',
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
    questIds: [
      'q_pelt_requisition',
      'q_hoarfang_writ',
      'q_wendigo_gall',
      'q_icehowler_cull',
      'q_apex_predation',
    ],
    greeting:
      'The Empire hunts by charter and quota, $C, and the quota is behind. Fetch your bow or fetch excuses; I only file one of them.',
  },
  // --- Fort Ledgerwatch: the legion border fort on the road (levels 27-34) ---
  castellan_odric: {
    id: 'castellan_odric',
    name: 'Castellan Odric',
    title: 'Commandant, Fort Ledgerwatch',
    pos: { x: 24, z: 1930 },
    facing: -1.6,
    color: 0x8c2a33,
    questIds: [
      'q_report_to_ledgerwatch',
      'q_terrace_undermining',
      'q_duelling_permits',
      'q_boundary_survey',
      'q_report_to_rimeshaft',
    ],
    greeting:
      'Fort Ledgerwatch holds the border, and the border holds the paperwork, $C. State your business in one line or less.',
  },
  paymistress_serna: {
    id: 'paymistress_serna',
    name: 'Paymistress Serna',
    title: 'Ninth Legion Recovery Office',
    pos: { x: 29, z: 1926 },
    facing: 2.4,
    color: 0x46628a,
    questIds: [
      'q_deserter_amnesty_rolls',
      'q_interest_on_arrears',
      'q_the_unremitted_assessor',
      'q_arrears_in_kind',
    ],
    greeting:
      'Back pay of the Ninth Legion, frozen pending prosecution. If you are here to add to the evidence, $N, take a number: it is one.',
  },
  sutler_brama: {
    id: 'sutler_brama',
    name: 'Sutler Brama',
    title: 'Licensed Fort Sutler',
    pos: { x: 19, z: 1935 },
    facing: -0.8,
    color: 0x77683c,
    questIds: ['q_sutlers_kettles'],
    vendorItems: [
      'kaelspire_barley_loaf',
      'silverbrook_spring_water',
      'imperial_field_ration',
      'healing_potion',
      'mana_potion',
    ],
    greeting:
      'Licensed sutler, prices as posted, receipts on request. The Empire audits me monthly, $N, so the scale is honest.',
  },
  // --- Rimeshaft Camp: the snowline mining camp below the Ascent (34-40) ---
  foreman_ulla: {
    id: 'foreman_ulla',
    name: 'Foreman Ulla',
    title: 'Rimeshaft Claims Office',
    pos: { x: 22, z: 2016 },
    facing: -2.2,
    color: 0x5f7086,
    questIds: [
      'q_report_to_rimeshaft',
      'q_rimeclaw_denning',
      'q_tallow_ledger',
      'q_clear_the_galleries',
      'q_shaft_three_reopens',
    ],
    greeting:
      'Rimeshaft runs three shifts and loses two to weather, $C. If you can hold a pick, or kill what interrupts one, you are payroll.',
  },
  assayer_veck: {
    id: 'assayer_veck',
    name: 'Assayer Veck',
    title: 'Imperial Assay, Frosthelm Division',
    pos: { x: 27, z: 2012 },
    facing: 2.9,
    color: 0x8a7a4e,
    questIds: ['q_rimebound_breach', 'q_core_ice_assay', 'q_purse_warden_grulk'],
    greeting:
      'Every stone in this camp gets weighed twice, $N. The mountain shorts no one; people are another matter.',
  },
  provisioner_edda: {
    id: 'provisioner_edda',
    name: 'Provisioner Edda',
    title: 'Rimeshaft Stores',
    pos: { x: 17, z: 2020 },
    facing: 0.6,
    color: 0x6f5a44,
    questIds: ['q_cold_store_restock', 'q_marrow_for_the_kettles'],
    vendorItems: [
      'imperial_field_ration',
      'kaelspire_barley_loaf',
      'silverbrook_spring_water',
      'healing_potion',
      'mana_potion',
    ],
    greeting:
      'Stores are rationed by roster, and you are not on the roster, $C. Coin amends the roster. Coin amends most things.',
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
    xpReward: 7200,
    copperReward: 3200,
    itemRewards: {},
    minLevel: 20,
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
    xpReward: 8800,
    copperReward: 4000,
    itemRewards: {
      warrior: 'tithe_road_marchboots',
      mage: 'tithe_road_marchboots',
      rogue: 'tithe_road_marchboots',
    },
    requiresQuest: 'q_wolfsward_culling',
    minLevel: 24,
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
    xpReward: 13500,
    copperReward: 6100,
    itemRewards: {},
    requiresQuest: 'q_broken_legion',
    minLevel: 31,
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
    xpReward: 11000,
    copperReward: 5000,
    itemRewards: {},
    requiresQuest: 'q_ironhold_ledgers',
    minLevel: 27,
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
    xpReward: 16000,
    copperReward: 7200,
    itemRewards: {},
    requiresQuest: 'q_granite_tempering',
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
    xpReward: 24000,
    copperReward: 10800,
    itemRewards: {
      warrior: 'oathbreakers_greatblade',
      mage: 'frosthelm_warstaff',
      rogue: 'wolfsward_skinner',
    },
    requiresQuest: 'q_the_oathguard',
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
    xpReward: 8200,
    copperReward: 3700,
    itemRewards: {},
    minLevel: 21,
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
    xpReward: 9600,
    copperReward: 4300,
    itemRewards: {},
    requiresQuest: 'q_tithe_scrip_recovery',
    minLevel: 24,
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
    xpReward: 11200,
    copperReward: 5000,
    itemRewards: {},
    requiresQuest: 'q_candle_tax_arrears',
    minLevel: 26,
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
    xpReward: 13500,
    copperReward: 6100,
    itemRewards: {},
    requiresQuest: 'q_assay_seal_audit',
    minLevel: 28,
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
    xpReward: 16000,
    copperReward: 7200,
    itemRewards: {
      warrior: 'prefects_sealed_mantle',
      mage: 'prefects_sealed_mantle',
      rogue: 'prefects_sealed_mantle',
    },
    requiresQuest: 'q_pay_chest_manifest',
    suggestedPlayers: 3,
    minLevel: 28,
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
    xpReward: 8600,
    copperReward: 3900,
    itemRewards: {},
    minLevel: 21,
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
    xpReward: 13000,
    copperReward: 5900,
    itemRewards: {},
    requiresQuest: 'q_pelt_requisition',
    suggestedPlayers: 3,
    minLevel: 24,
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
    xpReward: 20000,
    copperReward: 9000,
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
    xpReward: 21500,
    copperReward: 9700,
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
    xpReward: 12500,
    copperReward: 5600,
    itemRewards: {},
    requiresQuest: 'q_broken_legion',
    minLevel: 29,
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
    xpReward: 19000,
    copperReward: 8600,
    itemRewards: {},
    requiresQuest: 'q_watchfort_reclamation',
    minLevel: 36,
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
    xpReward: 15000,
    copperReward: 6800,
    itemRewards: {},
    requiresQuest: 'q_arbalist_lines',
    minLevel: 30,
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
    xpReward: 21000,
    copperReward: 9500,
    itemRewards: {},
    requiresQuest: 'q_ogre_paymasters',
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
    xpReward: 19000,
    copperReward: 8600,
    itemRewards: {},
    requiresQuest: 'q_ogre_iron_reforging',
    minLevel: 38,
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
    xpReward: 20500,
    copperReward: 9200,
    itemRewards: {},
    requiresQuest: 'q_granite_tempering',
    minLevel: 36,
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
    xpReward: 7800,
    copperReward: 3500,
    itemRewards: {},
    minLevel: 20,
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
    xpReward: 9600,
    copperReward: 4300,
    itemRewards: {},
    requiresQuest: 'q_larder_restock',
    minLevel: 24,
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
    xpReward: 20000,
    copperReward: 9000,
    itemRewards: {},
    requiresQuest: 'q_ration_theft',
    minLevel: 36,
  },
  // --- Kaelspire intake and the granary levy (new arrivals, levels 20-24) ---
  q_sign_the_garrison_book: {
    id: 'q_sign_the_garrison_book',
    name: 'The Garrison Book',
    giverNpcId: 'marshal_corvin',
    turnInNpcId: 'marshal_corvin',
    text: 'Kaelspire files you before it feeds you, $N. Present yourself at the four offices of the garrison: stores, the smithy, the tithe desk, and the hunt charter. Sign each book legibly; the Empire has opinions about handwriting.',
    completionText:
      'Four signatures, one of them nearly legible. You now exist in the eyes of the Empire, $N, which is the only place existence is binding. Welcome to the northern march.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'quartermaster_hilde',
        count: 1,
        label: 'Report to Quartermaster Hilde',
      },
      {
        type: 'interact',
        targetNpcId: 'armorer_ottokar',
        count: 1,
        label: 'Report to Armorer Ottokar',
      },
      {
        type: 'interact',
        targetNpcId: 'prefect_alina',
        count: 1,
        label: 'Report to Prefect Alina',
      },
      {
        type: 'interact',
        targetNpcId: 'huntmaster_roderic',
        count: 1,
        label: 'Report to Huntmaster Roderic',
      },
    ],
    xpReward: 2200,
    copperReward: 1000,
    itemRewards: {},
    minLevel: 20,
  },
  q_forged_exemptions: {
    id: 'q_forged_exemptions',
    name: 'Forged Exemptions',
    giverNpcId: 'prefect_alina',
    turnInNpcId: 'prefect_alina',
    text: 'The granary district owes the Empire a militia levy, and the levy has decided it would rather rob grain carts than guard them, $N. Worse: they carry forged exemption papers, which is tax fraud stacked on desertion. Retire ten of them and bring me six forgeries for the evidence drawer.',
    completionText:
      'Six forgeries, and the stamps are not even close; a child defrauds better. The levy rolls balance again, $N. The fraud I can prosecute; the handwriting I can only mourn.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'granary_militia_deserter',
        count: 10,
        label: 'Granary Militia Deserter slain',
      },
      { type: 'collect', itemId: 'forged_levy_papers', count: 6, label: 'Forged Levy Papers' },
    ],
    xpReward: 8600,
    copperReward: 3900,
    itemRewards: {},
    minLevel: 22,
  },
  q_the_levy_answers: {
    id: 'q_the_levy_answers',
    name: 'The Levy Answers',
    giverNpcId: 'marshal_corvin',
    turnInNpcId: 'marshal_corvin',
    text: 'The Prefect has her evidence; I have a district that watched its levy walk off and turn thief. That does not stand in an imperial province, $N. Muster the truants out of the south fields: twelve, by the sword, since they declined the easier summons.',
    completionText:
      'Twelve names struck and the fields quiet. The next levy will report on time, $N; nothing recruits like precedent.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'granary_militia_deserter',
        count: 12,
        label: 'Granary Militia Deserter slain',
      },
    ],
    xpReward: 7400,
    copperReward: 3400,
    itemRewards: {},
    requiresQuest: 'q_forged_exemptions',
    minLevel: 23,
  },
  // --- Fort Ledgerwatch: the border fort chains (levels 26-34) ---
  q_report_to_ledgerwatch: {
    id: 'q_report_to_ledgerwatch',
    name: 'Report to Ledgerwatch',
    giverNpcId: 'marshal_corvin',
    turnInNpcId: 'castellan_odric',
    text: 'Fort Ledgerwatch watches the pine belt and the Broken Legion in it, and its castellan reports three problems for every soldier he has. You are one soldier who solves three problems, $N. Report to Castellan Odric; take the north road and the fort is on your right where the pines begin.',
    completionText:
      'The Marshal sends one blade and calls it reinforcement. Very well; I have learned to requisition quality over quantity. Welcome to Ledgerwatch, $N.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'castellan_odric',
        count: 1,
        label: 'Report to Castellan Odric',
      },
    ],
    xpReward: 2600,
    copperReward: 1200,
    itemRewards: {},
    minLevel: 26,
  },
  q_deserter_amnesty_rolls: {
    id: 'q_deserter_amnesty_rolls',
    name: 'The Amnesty Rolls',
    giverNpcId: 'paymistress_serna',
    turnInNpcId: 'paymistress_serna',
    text: 'The Crown offered the Ninth amnesty for any deserter who reported by spring; it is autumn, $N, and they keep the petitions in their packs like souvenirs. An unfiled petition is a confession with better penmanship. Put down twelve deserters and recover six petitions. I file posthumously.',
    completionText:
      'Six petitions, filed, stamped, and annotated deceased. The amnesty ledger balances either way, $N; the Empire is flexible about which column you die in.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'broken_legion_deserter',
        count: 12,
        label: 'Broken Legion Deserter slain',
      },
      {
        type: 'collect',
        itemId: 'amnesty_petition',
        count: 6,
        label: 'Unfiled Amnesty Petition',
      },
    ],
    xpReward: 11500,
    copperReward: 5200,
    itemRewards: {},
    minLevel: 28,
  },
  q_sutlers_kettles: {
    id: 'q_sutlers_kettles',
    name: 'Fort-Pattern Kettles',
    giverNpcId: 'sutler_brama',
    turnInNpcId: 'sutler_brama',
    text: 'When the Ninth mutinied they looted my predecessor down to the kettles, $N: fort-pattern, triple-riveted, inventory items every one. I am contractually short ten kettles and the garrison is short its soup. Take them back from the deserter camps; dented is acceptable, absent is not.',
    completionText:
      'Six kettles, dents and all, back on the manifest. The soup resumes tonight and my ledger closes clean for the first time this quarter. You have fed a fort, $N, one line item at a time.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'broken_legion_deserter',
        count: 10,
        label: 'Broken Legion Deserter slain',
      },
      { type: 'collect', itemId: 'fort_pattern_kettle', count: 6, label: 'Fort-Pattern Kettle' },
    ],
    xpReward: 11000,
    copperReward: 5000,
    itemRewards: {},
    minLevel: 29,
  },
  q_interest_on_arrears: {
    id: 'q_interest_on_arrears',
    name: 'Interest on Arrears',
    giverNpcId: 'paymistress_serna',
    turnInNpcId: 'paymistress_serna',
    text: 'Every arbalist on that wall still draws stolen pay from the chests the Ninth carried off. I am garnishing it, $N, at the rate of one pouch per corpse, which is the only rate they have honored yet. Twelve arbalists; bring me six pouches for the recovery account.',
    completionText:
      'Six pouches, short-counted exactly as I expected: they were stealing from each other too. The recovery account grows, $N, and arrears plus interest is a sum the Empire never forgets.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'broken_legion_arbalist',
        count: 12,
        label: 'Broken Legion Arbalist slain',
      },
      { type: 'collect', itemId: 'garnished_pay_pouch', count: 6, label: 'Garnished Pay Pouch' },
    ],
    xpReward: 13500,
    copperReward: 6100,
    itemRewards: {},
    requiresQuest: 'q_deserter_amnesty_rolls',
    minLevel: 30,
  },
  q_terrace_undermining: {
    id: 'q_terrace_undermining',
    name: 'Undermined',
    giverNpcId: 'castellan_odric',
    turnInNpcId: 'castellan_odric',
    text: 'The granite churns out of Ironhold have begun grinding through the deep terraces below my east wall, and a fort with no footing is a very orderly pile of stones, $N. Break twelve of them and pull five cores from the fault line. My engineers want proof the ground has stopped arguing.',
    completionText:
      'Five cores, and the engineers pronounce the east wall boring again, which from engineers is high praise. The fort stands on paperwork and bedrock, $N; you have secured the second one.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'granite_churn_elemental',
        count: 12,
        label: 'Granite Churn Elemental slain',
      },
      { type: 'collect', itemId: 'fault_line_core', count: 5, label: 'Fault Line Core' },
    ],
    xpReward: 14000,
    copperReward: 6300,
    itemRewards: {},
    minLevel: 31,
  },
  q_duelling_permits: {
    id: 'q_duelling_permits',
    name: 'Unstamped Permits',
    giverNpcId: 'castellan_odric',
    turnInNpcId: 'castellan_odric',
    text: 'House Maren duels on imperial ground without stamped permits: they call it honor, and the fee schedule calls it forty silver a bout, $N. Their blades have declined every summons my clerks delivered. Deliver the next ten summonses yourself and collect five unstamped permits as exhibits.',
    completionText:
      'Five permits, unstamped, each one a fine the estate will pay with interest. House Maren is about to discover that honor is taxable, $N. Everything is, eventually.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'maren_house_duelist',
        count: 10,
        label: 'House Maren Duelist slain',
      },
      {
        type: 'collect',
        itemId: 'unstamped_duel_permit',
        count: 5,
        label: 'Unstamped Duelling Permit',
      },
    ],
    xpReward: 14000,
    copperReward: 6300,
    itemRewards: {},
    minLevel: 32,
  },
  q_boundary_survey: {
    id: 'q_boundary_survey',
    name: 'The Boundary Survey',
    giverNpcId: 'castellan_odric',
    turnInNpcId: 'castellan_odric',
    text: 'House Maren has moved its boundary stones three fields into imperial land, and their duelists stand on the new line daring my surveyors to object. I object, $N. Walk the survey line and remove twelve of the objections; the stones go back where the map says.',
    completionText:
      "The line surveyed, the stones returned, the objections withdrawn from the record. House Maren keeps what the map grants and not one furrow more, $N. The map is the Empire's oldest weapon.",
    objectives: [
      {
        type: 'kill',
        targetMobId: 'maren_house_duelist',
        count: 12,
        label: 'House Maren Duelist slain',
      },
    ],
    xpReward: 13000,
    copperReward: 5900,
    itemRewards: {
      warrior: 'maren_duelling_mantle',
      mage: 'maren_duelling_mantle',
      rogue: 'maren_duelling_mantle',
    },
    requiresQuest: 'q_duelling_permits',
    minLevel: 33,
  },
  q_the_unremitted_assessor: {
    id: 'q_the_unremitted_assessor',
    name: 'The Unremitted Assessor',
    giverNpcId: 'paymistress_serna',
    turnInNpcId: 'paymistress_serna',
    text: 'Assessor Maldrek died on his collection route forty years ago and has not let that interrupt his rounds, $N. He assesses travelers at swordpoint and issues receipts no office honors; the complaints file is two drawers now. His commission is revoked. Take witnesses when you deliver the revocation: he audits back.',
    completionText:
      'The revocation delivered and the route closed after forty years of unauthorized collection. His receipts go to the archive as curiosities, $N. Even death answers to the tax office; it merely files late.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'assessor_maldrek',
        count: 1,
        label: 'Assessor Maldrek the Unremitted slain',
      },
    ],
    xpReward: 22000,
    copperReward: 9900,
    itemRewards: {
      warrior: 'final_notice_wraps',
      mage: 'final_notice_wraps',
      rogue: 'final_notice_wraps',
    },
    requiresQuest: 'q_interest_on_arrears',
    suggestedPlayers: 3,
    minLevel: 34,
  },
  q_arrears_in_kind: {
    id: 'q_arrears_in_kind',
    name: 'Arrears in Kind',
    giverNpcId: 'paymistress_serna',
    turnInNpcId: 'paymistress_serna',
    text: 'The Ninth cannot repay what it stole; the coin is spent on ogres and the ogres are spent on us, $N. Fine. The Crown accepts payment in kind: twelve of their hired ogres and twelve of the oathguard who spent the money. Debt collection is a blunt instrument this far north.',
    completionText:
      'Twenty-four entries in the recovery ledger, paid in the only currency the Ninth has left, $N. The account is not settled: but it is, for the first time, current.',
    objectives: [
      { type: 'kill', targetMobId: 'sellsword_ogre', count: 12, label: 'Sellsword Ogre slain' },
      {
        type: 'kill',
        targetMobId: 'legion_oathguard_veteran',
        count: 12,
        label: 'Legion Oathguard Veteran slain',
      },
    ],
    xpReward: 20000,
    copperReward: 9000,
    itemRewards: {},
    requiresQuest: 'q_interest_on_arrears',
    minLevel: 36,
  },
  // --- Rimeshaft Camp: the snowline mining chains (levels 34-40) ---
  q_report_to_rimeshaft: {
    id: 'q_report_to_rimeshaft',
    name: 'Report to Rimeshaft',
    giverNpcId: 'castellan_odric',
    turnInNpcId: 'foreman_ulla',
    text: 'The Rimeshaft camp digs silver above the snow line and files casualty reports faster than ore returns, $N. The foreman holds standing authority to hire anything that survives the road. Report to Foreman Ulla at the camp below the Frosthelm Ascent, and mind the wendigo: they are not on the payroll.',
    completionText:
      'Ledgerwatch sends help that walked the snow road alone; good. The last three hires arrived as a search expense. You are on the books as of this shift, $N.',
    objectives: [
      { type: 'interact', targetNpcId: 'foreman_ulla', count: 1, label: 'Report to Foreman Ulla' },
    ],
    xpReward: 3400,
    copperReward: 1500,
    itemRewards: {},
    minLevel: 34,
  },
  q_rimeclaw_denning: {
    id: 'q_rimeclaw_denning',
    name: 'Denning Season',
    giverNpcId: 'foreman_ulla',
    turnInNpcId: 'foreman_ulla',
    text: 'Rimeclaw are denning in the spoil heaps, $N, and a den in the spoil is a mauling on every shift change. The claims office classifies them as weather, which means no bounty, which is why I am paying you out of the tool budget. Twelve of them, before the denning finishes.',
    completionText:
      'Twelve, and the shift bell rings without a scream for the first time in a month. The tool budget mourns, $N, but shovels are cheaper than shovelers.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'frosthelm_rimeclaw',
        count: 12,
        label: 'Frosthelm Rimeclaw slain',
      },
    ],
    xpReward: 16000,
    copperReward: 7200,
    itemRewards: {},
    minLevel: 34,
  },
  q_tallow_ledger: {
    id: 'q_tallow_ledger',
    name: 'The Tallow Ledger',
    giverNpcId: 'foreman_ulla',
    turnInNpcId: 'foreman_ulla',
    text: 'The candle tax makes wax dearer than silver up here, so the lamps burn rimeclaw tallow, which the tax schedule has not discovered yet, $N. Do not enlighten it. Ten rimeclaw, six good renderings of tallow, and the night shift keeps its light at a price the books can bear.',
    completionText:
      'Six renderings, clean-burning, entered in the ledger as miscellaneous fats, $N. If the tax office ever learns to read a mine ledger we are all ruined; happily, it never has.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'frosthelm_rimeclaw',
        count: 10,
        label: 'Frosthelm Rimeclaw slain',
      },
      { type: 'collect', itemId: 'rimeclaw_tallow', count: 6, label: 'Rimeclaw Tallow' },
    ],
    xpReward: 19000,
    copperReward: 8600,
    itemRewards: {},
    requiresQuest: 'q_rimeclaw_denning',
    minLevel: 35,
  },
  q_marrow_for_the_kettles: {
    id: 'q_marrow_for_the_kettles',
    name: 'Marrow for the Kettles',
    giverNpcId: 'provisioner_edda',
    turnInNpcId: 'provisioner_edda',
    text: 'The kettles want marrow, the miners want soup with a history of meat in it, and the rimeclaw want the miners, $N. I propose we reverse the arrangement. Twelve rimeclaw, seven marrowbones, and the mess line stops writing letters home about the broth.',
    completionText:
      'Seven marrowbones in the kettles and the broth achieves what the manual calls nutritive integrity, $N. Morale is up two points. I measure it in second helpings.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'frosthelm_rimeclaw',
        count: 12,
        label: 'Frosthelm Rimeclaw slain',
      },
      { type: 'collect', itemId: 'rimeclaw_marrowbone', count: 7, label: 'Rimeclaw Marrowbone' },
    ],
    xpReward: 17000,
    copperReward: 7700,
    itemRewards: {},
    minLevel: 35,
  },
  q_quarter_end_closing: {
    id: 'q_quarter_end_closing',
    name: 'Quarter-End Closing',
    giverNpcId: 'prefect_alina',
    turnInNpcId: 'prefect_alina',
    text: 'The quarter closes in six days and three signatures are missing: the castellan at Ledgerwatch, the foreman at Rimeshaft, and the assayer beside her, $N. The post road eats couriers lately, and attestations do not sign themselves. Collect all three, in person; the Empire stopped accepting seals by pigeon after the incident.',
    completionText:
      "Three attestations, on time, in order. The north closes its quarter and the capital has nothing to complain about, which will not stop it, $N. You have my thanks and the ledger's, and the ledger's is worth more.",
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'castellan_odric',
        count: 1,
        label: 'Collect the Ledgerwatch attestation',
      },
      {
        type: 'interact',
        targetNpcId: 'foreman_ulla',
        count: 1,
        label: 'Collect the Rimeshaft attestation',
      },
      {
        type: 'interact',
        targetNpcId: 'assayer_veck',
        count: 1,
        label: 'Collect the assay attestation',
      },
    ],
    xpReward: 10500,
    copperReward: 4700,
    itemRewards: {},
    minLevel: 36,
  },
  q_the_oathguard: {
    id: 'q_the_oathguard',
    name: 'The Oathguard',
    giverNpcId: 'marshal_corvin',
    turnInNpcId: 'marshal_corvin',
    text: "What is left of the Ninth's discipline stands in plate around the redoubt: the oathguard, the veterans who chose Vaelis over the Empire twice, $N. Sentence was passed on them with their commander. Break twelve out of that line; no one reaches Vaelis through a wall that holds.",
    completionText:
      'Twelve veterans down and the redoubt line thins. They were the best soldiers the Ninth had, $N, which is precisely the charge against them.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'legion_oathguard_veteran',
        count: 12,
        label: 'Legion Oathguard Veteran slain',
      },
    ],
    xpReward: 17500,
    copperReward: 7900,
    itemRewards: {},
    requiresQuest: 'q_frosthelm_pass',
    minLevel: 38,
  },
  q_oathguard_plate: {
    id: 'q_oathguard_plate',
    name: 'Oathbroken Plate',
    giverNpcId: 'armorer_ottokar',
    turnInNpcId: 'armorer_ottokar',
    text: 'The oathguard wear imperial plate, forged on this bench before they disgraced it, $N. Plate does not desert; it merely needs new owners. Twelve veterans, six salvageable sections, and I will hammer the shame of the Ninth back into the service of the Empire.',
    completionText:
      "Six sections, my own maker's marks still under the soot. Refit and reissued, they will guard better men, $N. Steel holds no grudges; that is what smiths are for.",
    objectives: [
      {
        type: 'kill',
        targetMobId: 'legion_oathguard_veteran',
        count: 12,
        label: 'Legion Oathguard Veteran slain',
      },
      {
        type: 'collect',
        itemId: 'oathguard_plate_scrap',
        count: 6,
        label: 'Oathguard Plate Scrap',
      },
    ],
    xpReward: 20000,
    copperReward: 9000,
    itemRewards: {},
    requiresQuest: 'q_ogre_iron_reforging',
    minLevel: 37,
  },
  q_cold_store_restock: {
    id: 'q_cold_store_restock',
    name: 'The Cold Store',
    giverNpcId: 'provisioner_edda',
    turnInNpcId: 'provisioner_edda',
    text: 'Rimeshaft eats by roster, and the roster says the cold store holds three weeks of meat; the cold store disagrees, $N. Icehowler haunch freezes well and runs down its own delivery. Twelve howlers, eight haunches, and my inventory returns to a fiction the auditors will accept.',
    completionText:
      'Eight haunches racked and the roster is honest again, or near enough for government work, $N. The camp eats, the books balance, and nobody asks what miscellaneous protein means.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'frosthelm_icehowler',
        count: 12,
        label: 'Frosthelm Icehowler slain',
      },
      { type: 'collect', itemId: 'icehowler_haunch', count: 8, label: 'Icehowler Haunch' },
    ],
    xpReward: 20000,
    copperReward: 9000,
    itemRewards: {},
    minLevel: 37,
  },
  q_clear_the_galleries: {
    id: 'q_clear_the_galleries',
    name: 'Clear the Galleries',
    giverNpcId: 'foreman_ulla',
    turnInNpcId: 'foreman_ulla',
    text: 'When shaft three breached, wendigo moved into the east galleries like relatives who heard about the space, $N. The shoring crews will not go down while anything in the dark eats faster than they timber. Clear twelve out of the workings; the mountain owes me a shift.',
    completionText:
      'The galleries echo with hammers again instead of teeth, $N. The crews are timbering as we speak, and the mountain resumes paying its taxes in silver.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'frosthelm_wendigo',
        count: 12,
        label: 'Frosthelm Wendigo slain',
      },
    ],
    xpReward: 17500,
    copperReward: 7900,
    itemRewards: {},
    minLevel: 38,
  },
  q_rimebound_breach: {
    id: 'q_rimebound_breach',
    name: 'The Rimebound Breach',
    giverNpcId: 'assayer_veck',
    turnInNpcId: 'assayer_veck',
    text: 'Shaft three broke into blue ice that walks, $N: rimebound, the miners call them, and the claims office calls them a geological event to avoid paying hazard rates. My instruments call them ambulatory assets. Reduce twelve to a measurable state.',
    completionText:
      'Twelve, reduced and measured. The hazard is reclassified from event to expense, $N, and expenses can be budgeted. Science advances one line item at a time.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'rimebound_elemental',
        count: 12,
        label: 'Rimebound Elemental slain',
      },
    ],
    xpReward: 17000,
    copperReward: 7700,
    itemRewards: {},
    minLevel: 38,
  },
  q_core_ice_assay: {
    id: 'q_core_ice_assay',
    name: 'The Core Ice Assay',
    giverNpcId: 'assayer_veck',
    turnInNpcId: 'assayer_veck',
    text: 'The rimebound carry cores of ice older than the Empire, which the Empire finds presumptuous, $N. The assay office wants six cores: intact, cold, and weighed before they melt into ordinary water and lose all fiscal interest. Twelve rimebound should yield that.',
    completionText:
      'Six cores, weighed at altitude, sealed in the cold box. Preliminary finding: the mountain has been hoarding assets for ten thousand years, $N. The audit of the Frosthelm is going to be considerable.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'rimebound_elemental',
        count: 12,
        label: 'Rimebound Elemental slain',
      },
      { type: 'collect', itemId: 'rimebound_core_ice', count: 6, label: 'Rimebound Core Ice' },
    ],
    xpReward: 21500,
    copperReward: 9700,
    itemRewards: {},
    requiresQuest: 'q_rimebound_breach',
    minLevel: 39,
  },
  q_rimebound_quench: {
    id: 'q_rimebound_quench',
    name: 'The Glacier Quench',
    giverNpcId: 'armorer_ottokar',
    turnInNpcId: 'armorer_ottokar',
    text: 'A blade quenched in glacier ice takes an edge that laughs at winter, or so swears every smith north of the pass, $N. The Rimeshaft breach put walking glaciers within reach for the first time in my career. Ten rimebound, six unmelted cores of quench ice, packed fast.',
    completionText:
      'The quench hisses like an argument and the edge comes out singing, $N. The old smiths were right, which I will admit exactly once, in writing, in this ledger nobody reads.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'rimebound_elemental',
        count: 10,
        label: 'Rimebound Elemental slain',
      },
      { type: 'collect', itemId: 'glacial_quench_ice', count: 6, label: 'Glacial Quench Ice' },
    ],
    xpReward: 20000,
    copperReward: 9000,
    itemRewards: {},
    requiresQuest: 'q_wendigo_hide_lining',
    minLevel: 39,
  },
  q_purse_warden_grulk: {
    id: 'q_purse_warden_grulk',
    name: 'The Purse-Warden',
    giverNpcId: 'assayer_veck',
    turnInNpcId: 'assayer_veck',
    text: "The ogres keep the Ninth's pay chest with a warden called Grulk, who never mastered counting but has fully mastered sitting on a box, $N. That box is imperial bullion, and bullion is assay business. Bring companions: Grulk weighs more than his arithmetic.",
    completionText:
      'The chest recovered, the warden retired, the bullion under seal for the capital. Final count: the Ninth stole exactly what Grulk failed to count, to the last coin, $N. There is a lesson in that for somebody.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'purse_warden_grulk',
        count: 1,
        label: 'Purse-Warden Grulk slain',
      },
    ],
    xpReward: 24500,
    copperReward: 11000,
    itemRewards: {
      warrior: 'pay_wardens_shoulderguards',
      mage: 'pay_wardens_shoulderguards',
      rogue: 'pay_wardens_shoulderguards',
    },
    suggestedPlayers: 3,
    minLevel: 38,
  },
  q_shaft_three_reopens: {
    id: 'q_shaft_three_reopens',
    name: 'Shaft Three Reopens',
    giverNpcId: 'foreman_ulla',
    turnInNpcId: 'foreman_ulla',
    text: 'Shaft three reopens on schedule, $N, and the schedule does not care that the shaft is full of walking ice and hungry snow. Twelve rimebound, twelve wendigo, and the richest silver seam in the north goes back on the quarterly report where it belongs.',
    completionText:
      'The seam is cut, the carts roll, and the quarterly report reads like a commendation, $N. Rimeshaft remembers who reopened shaft three; more usefully, so does the payroll.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'rimebound_elemental',
        count: 12,
        label: 'Rimebound Elemental slain',
      },
      {
        type: 'kill',
        targetMobId: 'frosthelm_wendigo',
        count: 12,
        label: 'Frosthelm Wendigo slain',
      },
    ],
    xpReward: 21000,
    copperReward: 9500,
    itemRewards: {
      warrior: 'rimeshaft_foremans_cap',
      mage: 'rimeshaft_foremans_cap',
      rogue: 'rimeshaft_foremans_cap',
    },
    requiresQuest: 'q_clear_the_galleries',
    minLevel: 39,
  },
  q_apex_predation: {
    id: 'q_apex_predation',
    name: 'Apex Predation',
    giverNpcId: 'huntmaster_roderic',
    turnInNpcId: 'huntmaster_roderic',
    text: 'The ridgeline has two apex predators this winter and the charter recognizes neither, $N. Icehowlers hunt the passes, wendigo hunt the hunters, and my quota is somewhere underneath both. Cull twelve of each, and the mountain remembers who holds the charter.',
    completionText:
      'Twelve and twelve, witnessed from the signal line. The passes hunt quiet, the quota stands filled, and the charter hangs where it always did, $N: above everything else on the mountain.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'frosthelm_icehowler',
        count: 12,
        label: 'Frosthelm Icehowler slain',
      },
      {
        type: 'kill',
        targetMobId: 'frosthelm_wendigo',
        count: 12,
        label: 'Frosthelm Wendigo slain',
      },
    ],
    xpReward: 20000,
    copperReward: 9000,
    itemRewards: {},
    requiresQuest: 'q_icehowler_cull',
    minLevel: 39,
  },
  q_the_norths_books: {
    id: 'q_the_norths_books',
    name: "The North's Books",
    giverNpcId: 'prefect_alina',
    turnInNpcId: 'prefect_alina',
    text: "Vaelis burned the Ninth's muster rolls, but soldiers are sentimental, $N: the oathguard carry salvaged pages like relics. Those pages are the last evidence of who the Ninth was before it broke. Twelve veterans, six rolls, and the north's books close on the whole sorry legion.",
    completionText:
      'Six rolls, scorched but legible, every name recoverable. The Ninth is fully accounted for at last, $N: mustered, mutinied, and closed. The Empire audits its dead, and today the dead balance.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'legion_oathguard_veteran',
        count: 12,
        label: 'Legion Oathguard Veteran slain',
      },
      { type: 'collect', itemId: 'ninth_muster_roll', count: 6, label: 'Salvaged Muster Roll' },
    ],
    xpReward: 22500,
    copperReward: 10100,
    itemRewards: {
      warrior: 'quarter_close_vestments',
      mage: 'quarter_close_vestments',
      rogue: 'quarter_close_vestments',
    },
    requiresQuest: 'q_quarter_end_closing',
    minLevel: 39,
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
  // Appended after every pre-existing Kael quest (progression order):
  // Kaelspire intake and the granary levy (20-24)
  'q_sign_the_garrison_book',
  'q_forged_exemptions',
  'q_the_levy_answers',
  // Fort Ledgerwatch: the border fort chains (26-34)
  'q_report_to_ledgerwatch',
  'q_deserter_amnesty_rolls',
  'q_sutlers_kettles',
  'q_interest_on_arrears',
  'q_terrace_undermining',
  'q_duelling_permits',
  'q_boundary_survey',
  'q_the_unremitted_assessor',
  'q_arrears_in_kind',
  // Rimeshaft Camp: the snowline mining chains (34-40)
  'q_report_to_rimeshaft',
  'q_rimeclaw_denning',
  'q_tallow_ledger',
  'q_marrow_for_the_kettles',
  'q_quarter_end_closing',
  'q_the_oathguard',
  'q_oathguard_plate',
  'q_cold_store_restock',
  'q_clear_the_galleries',
  'q_rimebound_breach',
  'q_core_ice_assay',
  'q_rimebound_quench',
  'q_purse_warden_grulk',
  'q_shaft_three_reopens',
  'q_apex_predation',
  'q_the_norths_books',
];

// ---------------------------------------------------------------------------
// Camps (spawn tables), merged AFTER every existing camp in data.ts, and in
// this order relative to the other Valdris zones, so world-gen RNG draw order
// for pre-existing content never shifts. Pre-existing camps are re-leveled
// and moved IN PLACE (same array order, same counts); every new camp is
// appended at the tail. Graded south (20) to north (40).
// ---------------------------------------------------------------------------

export const KAEL_CAMPS: CampDef[] = [
  // Wolves (20-22): the Wolfsward pines flanking the south road
  { mobId: 'wolfsward_packwolf', center: { x: -85, z: 1740 }, radius: 20, count: 7 },
  { mobId: 'wolfsward_packwolf', center: { x: -55, z: 1722 }, radius: 16, count: 6 },
  { mobId: 'hoarfang_alpha', center: { x: -112, z: 1726 }, radius: 4, count: 1 },
  { mobId: 'wolfsward_packwolf', center: { x: 95, z: 1748 }, radius: 14, count: 5 },
  // Kobolds (24-26): Ironhold Mine, east of the millpond road
  { mobId: 'ironhold_digger', center: { x: 92, z: 1878 }, radius: 20, count: 8 },
  { mobId: 'ironhold_digger', center: { x: 120, z: 1902 }, radius: 16, count: 6 },
  { mobId: 'overseer_kazrik', center: { x: 135, z: 1888 }, radius: 5, count: 1 },
  // Granite churns (31-33): the deep mine terraces, northeast
  { mobId: 'granite_churn_elemental', center: { x: 128, z: 1938 }, radius: 18, count: 7 },
  { mobId: 'granite_churn_elemental', center: { x: 100, z: 1962 }, radius: 16, count: 6 },
  // The Broken Legion (27-31): the ruined watch-fort in the west pine belt,
  // shifted south with its band so the rank and file sit below the redoubt.
  { mobId: 'broken_legion_deserter', center: { x: -92, z: 1922 }, radius: 20, count: 8 },
  { mobId: 'broken_legion_arbalist', center: { x: -68, z: 1938 }, radius: 16, count: 6 },
  { mobId: 'broken_legion_deserter', center: { x: -120, z: 1946 }, radius: 18, count: 7 },
  { mobId: 'broken_legion_arbalist', center: { x: -102, z: 1964 }, radius: 14, count: 5 },
  // Ogre sellswords (36-38): the legion's hired muscle, camped on its flanks
  { mobId: 'sellsword_ogre', center: { x: -45, z: 1985 }, radius: 16, count: 6 },
  { mobId: 'sellsword_ogre', center: { x: -148, z: 1994 }, radius: 14, count: 5 },
  // Commander Vaelis (40): the Oathbroken redoubt above the legion camp
  { mobId: 'commander_vaelis', center: { x: -118, z: 2004 }, radius: 3, count: 1 },
  // Wendigo (38-40): the Frosthelm Ascent, at the snow line
  { mobId: 'frosthelm_wendigo', center: { x: -55, z: 2030 }, radius: 18, count: 7 },
  { mobId: 'frosthelm_wendigo', center: { x: 60, z: 2028 }, radius: 18, count: 7 },
  { mobId: 'frosthelm_wendigo', center: { x: 30, z: 2048 }, radius: 14, count: 5 },
  // Geomancers (26-28) on the mine terraces; icehowlers (37-39) at the snow
  // line, the east camp shifted west to clear the Rimeshaft sub-hub.
  { mobId: 'ironhold_geomancer', center: { x: 112, z: 1920 }, radius: 16, count: 6 },
  { mobId: 'ironhold_geomancer', center: { x: 142, z: 1908 }, radius: 14, count: 5 },
  { mobId: 'frosthelm_icehowler', center: { x: -18, z: 2036 }, radius: 16, count: 6 },
  { mobId: 'frosthelm_icehowler', center: { x: -30, z: 2016 }, radius: 12, count: 5 },
  // Appended after every pre-existing Kael camp (world-gen RNG draw order):
  // Granary militia deserters (22-24): the south fields below the granaries
  { mobId: 'granary_militia_deserter', center: { x: 30, z: 1756 }, radius: 14, count: 5 },
  { mobId: 'granary_militia_deserter', center: { x: 58, z: 1764 }, radius: 16, count: 6 },
  // House Maren duelists (32-34): the contested fields east of Ledgerwatch
  { mobId: 'maren_house_duelist', center: { x: 62, z: 1942 }, radius: 14, count: 6 },
  { mobId: 'maren_house_duelist', center: { x: 74, z: 1926 }, radius: 12, count: 5 },
  // Assessor Maldrek (35): walks his old collection route on the Tithe Road
  { mobId: 'assessor_maldrek', center: { x: 8, z: 1956 }, radius: 5, count: 1 },
  // Rimeclaw (34-36): denning in the Rimeshaft spoil heaps
  { mobId: 'frosthelm_rimeclaw', center: { x: 52, z: 1996 }, radius: 16, count: 6 },
  { mobId: 'frosthelm_rimeclaw', center: { x: 92, z: 2004 }, radius: 12, count: 5 },
  // The Oathguard (36-38): the loyalist ring around the Vaelis redoubt
  { mobId: 'legion_oathguard_veteran', center: { x: -104, z: 1996 }, radius: 12, count: 6 },
  { mobId: 'legion_oathguard_veteran', center: { x: -136, z: 2002 }, radius: 12, count: 5 },
  // Rimebound elementals (38-40): the breached high shafts above the camp
  { mobId: 'rimebound_elemental', center: { x: 78, z: 2052 }, radius: 10, count: 5 },
  { mobId: 'rimebound_elemental', center: { x: 96, z: 2040 }, radius: 12, count: 4 },
  // Purse-Warden Grulk (38): sits on the pay chest at the west ogre camp
  { mobId: 'purse_warden_grulk', center: { x: -150, z: 2004 }, radius: 4, count: 1 },
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
    sellValue: 32,
  },
  bent_legion_buckle: {
    id: 'bent_legion_buckle',
    name: 'Bent Legion Buckle',
    kind: 'junk',
    quality: 'poor',
    sellValue: 48,
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
    sellValue: 640,
  },
  kazriks_brass_whistle: {
    id: 'kazriks_brass_whistle',
    name: "Kazrik's Brass Whistle",
    kind: 'junk',
    quality: 'uncommon',
    sellValue: 800,
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
  // three archetypes, so every class must be able to wear it. Priced for the
  // level-24 Ironhold band it now rewards.
  tithe_road_marchboots: {
    id: 'tithe_road_marchboots',
    name: 'Tithe Road Marchboots',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 64, agi: 8, sta: 6 },
    sellValue: 1200,
    buyValue: 12000,
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
    stats: { armor: 74, int: 10, sta: 8 },
    sellValue: 1500,
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
    stats: { armor: 86, agi: 10, sta: 7 },
    sellValue: 2400,
  },
  overseers_candlewraps: {
    id: 'overseers_candlewraps',
    name: "Overseer's Candlewraps",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 58, int: 12, sta: 8 },
    sellValue: 2700,
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
  // --- quest items: the 20-40 re-band chains ---
  forged_levy_papers: {
    id: 'forged_levy_papers',
    name: 'Forged Levy Papers',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_forged_exemptions',
  },
  amnesty_petition: {
    id: 'amnesty_petition',
    name: 'Unfiled Amnesty Petition',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_deserter_amnesty_rolls',
  },
  fort_pattern_kettle: {
    id: 'fort_pattern_kettle',
    name: 'Fort-Pattern Kettle',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_sutlers_kettles',
  },
  garnished_pay_pouch: {
    id: 'garnished_pay_pouch',
    name: 'Garnished Pay Pouch',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_interest_on_arrears',
  },
  fault_line_core: {
    id: 'fault_line_core',
    name: 'Fault Line Core',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_terrace_undermining',
  },
  unstamped_duel_permit: {
    id: 'unstamped_duel_permit',
    name: 'Unstamped Duelling Permit',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_duelling_permits',
  },
  rimeclaw_tallow: {
    id: 'rimeclaw_tallow',
    name: 'Rimeclaw Tallow',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_tallow_ledger',
  },
  rimeclaw_marrowbone: {
    id: 'rimeclaw_marrowbone',
    name: 'Rimeclaw Marrowbone',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_marrow_for_the_kettles',
  },
  oathguard_plate_scrap: {
    id: 'oathguard_plate_scrap',
    name: 'Oathguard Plate Scrap',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_oathguard_plate',
  },
  ninth_muster_roll: {
    id: 'ninth_muster_roll',
    name: 'Salvaged Muster Roll',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_the_norths_books',
  },
  icehowler_haunch: {
    id: 'icehowler_haunch',
    name: 'Icehowler Haunch',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_cold_store_restock',
  },
  rimebound_core_ice: {
    id: 'rimebound_core_ice',
    name: 'Rimebound Core Ice',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_core_ice_assay',
  },
  glacial_quench_ice: {
    id: 'glacial_quench_ice',
    name: 'Glacial Quench Ice',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_rimebound_quench',
  },
  // --- junk / flavor drops (new templates) ---
  maren_calling_card: {
    id: 'maren_calling_card',
    name: 'House Maren Calling Card',
    kind: 'junk',
    quality: 'poor',
    sellValue: 85,
  },
  maldreks_route_ledger: {
    id: 'maldreks_route_ledger',
    name: "Maldrek's Route Ledger",
    kind: 'junk',
    quality: 'uncommon',
    sellValue: 1050,
  },
  grulks_iron_strongbox: {
    id: 'grulks_iron_strongbox',
    name: "Grulk's Iron Strongbox",
    kind: 'junk',
    quality: 'uncommon',
    sellValue: 1300,
  },
  // --- quest rewards: cloth shared across all three archetypes, so every
  // class can wear them (the tithe_road_marchboots pattern). ---
  maren_duelling_mantle: {
    id: 'maren_duelling_mantle',
    name: 'Maren Duelling Mantle',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 84, agi: 12, sta: 9 },
    sellValue: 1900,
  },
  final_notice_wraps: {
    id: 'final_notice_wraps',
    name: 'Final Notice Wraps',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'uncommon',
    stats: { armor: 78, int: 12, sta: 9 },
    sellValue: 2000,
  },
  pay_wardens_shoulderguards: {
    id: 'pay_wardens_shoulderguards',
    name: "Pay Warden's Shoulderguards",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 96, sta: 12, agi: 10 },
    sellValue: 2400,
  },
  rimeshaft_foremans_cap: {
    id: 'rimeshaft_foremans_cap',
    name: "Rimeshaft Foreman's Cap",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'uncommon',
    stats: { armor: 100, int: 14, sta: 11 },
    sellValue: 2400,
  },
  quarter_close_vestments: {
    id: 'quarter_close_vestments',
    name: 'Quarter-Close Vestments',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 112, int: 15, sta: 12 },
    sellValue: 2600,
  },
  // --- rare-elite drops (new named) ---
  assessors_lead_greaves: {
    id: 'assessors_lead_greaves',
    name: "Assessor's Lead Greaves",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'legs',
    quality: 'rare',
    stats: { armor: 96, int: 15, sta: 12 },
    sellValue: 3900,
  },
  purse_wardens_coinbelt: {
    id: 'purse_wardens_coinbelt',
    name: "Purse-Warden's Coinbelt",
    kind: 'armor',
    armorType: 'mail',
    slot: 'waist',
    quality: 'rare',
    stats: { armor: 210, str: 14, sta: 12 },
    sellValue: 4600,
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
    { kind: 'house', x: 29, z: 1927, w: 6, d: 5, rot: -0.3 }, // Fort Ledgerwatch pay office
  ],
  wells: [{ x: 0, z: 1802, r: 1.5 }],
  stalls: [
    { x: -7.5, z: 1807, rot: Math.PI / 2, r: 1.7 }, // Quartermaster Hilde
    { x: -4.5, z: 1813.5, rot: -0.6, r: 1.7 }, // Armorer Ottokar
  ],
  mines: [
    { x: 90, z: 1880, rot: -2.0 }, // Ironhold Mine, main adit
    { x: 118, z: 1900, rot: Math.PI / 2 }, // the northern outpost shaft
    { x: 30, z: 2010, rot: -1.4 }, // the Rimeshaft adit
    { x: 88, z: 2048, rot: 2.4 }, // the breached high shafts
  ],
  docks: [],
  tents: [
    // the Broken Legion camp in the ruined watch-fort (shifted south with
    // its re-banded camps)
    { x: -88, z: 1916, rot: 0.5, scale: 1.2 },
    { x: -96, z: 1924, rot: 2.0, scale: 1.2 },
    { x: -116, z: 1942, rot: 0.8, scale: 1 },
    { x: -124, z: 1950, rot: -0.5, scale: 1 },
    // the ogre sellsword camp on the legion's east flank
    { x: -42, z: 1982, rot: 1.5, scale: 1.4 },
    { x: -50, z: 1990, rot: -1.0, scale: 1.4 },
    // Fort Ledgerwatch garrison rows
    { x: 17, z: 1926, rot: 0.8, scale: 1.1 },
    { x: 20, z: 1936, rot: -2.4, scale: 1.1 },
    // the Rimeshaft mining camp
    { x: 14, z: 2012, rot: 1.8, scale: 1.1 },
    { x: 18, z: 2023, rot: -0.7, scale: 1.1 },
    // the House Maren hunting lodge east of the fort
    { x: 66, z: 1936, rot: 0.9, scale: 1.1 },
  ],
  crates: [
    [60, 1728],
    [-92, 1920],
    [88, 1876],
    [26, 1934], // Fort Ledgerwatch stores
    [25, 2013], // Rimeshaft stores
    [31, 1754], // the militia deserters' stolen grain
  ],
  campfires: [
    [2, 1798],
    [-93, 1921],
    [-120, 1947],
    [-46, 1986],
    [92, 1882],
    [22, 1931], // Fort Ledgerwatch
    [20, 2017], // Rimeshaft Camp
    [63, 1939], // the Maren lodge
    [56, 1762], // the militia camp in the south fields
  ],
  mudHuts: [],
  ruinRings: [
    { x: -30, z: 1706, ringR: 6, columns: 5 }, // the old toll arch on the Tithe Road
    { x: -104, z: 1944, ringR: 7, columns: 6 }, // the ruined watch-fort the legion squats in
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
    { x1: 14, z1: 1922, x2: 34, z2: 1922 }, // Fort Ledgerwatch, south wall
    { x1: 14, z1: 1938, x2: 34, z2: 1938 }, // Fort Ledgerwatch, north wall
    { x1: 34, z1: 1922, x2: 34, z2: 1938 }, // Fort Ledgerwatch, east wall
  ],
  graveyards: [{ x: -24, z: 1786 }],
};
