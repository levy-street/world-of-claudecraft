// Veth Confederation (levels 27-34): the shadow-and-ice faction realm north of
// Ossara. Veth is not a nation, it is an agreement: city-states connected by
// rivers of black water through ancient forests where light never reaches the
// ground. It keeps no standing army; it keeps money, intelligence networks, and
// the most dangerous assassins' guild on the continent. Nighthollow, the hub on
// the towpath, keeps the ledger; everything in the dark around it keeps score.
//
// The hostile mobs here are NOT Veth soldiers (Veth is a player faction): the
// forest itself, feral wisps, drowned things in the black water, renegades the
// guild expelled, and the frost-covered north where the pines turn to ice.
//
// Structure mirrors content/valdris/ossara.ts, the exemplar for every Valdris
// zone module: ZoneDef + roads + mobs + npcs + quests + camps + objects +
// items + props, merged by content/valdris/index.ts.

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

export const VETH_ZONE: ZoneDef = {
  id: 'veth_confederation',
  name: 'Veth Confederation',
  zMin: 1290,
  zMax: 1680,
  levelRange: [27, 34],
  biome: 'shadowwood',
  hub: { x: 0, z: 1410, radius: 20, name: 'Nighthollow' },
  graveyard: { x: 18, z: 1395 },
  lakes: [{ x: -90, z: 1470, radius: 16 }], // the Blackmere
  pois: [
    { x: 0, z: 1410, label: 'Nighthollow' },
    { x: -60, z: 1330, label: 'Duskmane Run' },
    { x: 90, z: 1350, label: 'Palewidow Hollows' },
    { x: 40, z: 1380, label: 'Blackwater Quays' },
    { x: 30, z: 1400, label: 'The Whisper Market' },
    { x: -90, z: 1470, label: 'The Blackmere' },
    { x: 80, z: 1480, label: 'Wispwood' },
    { x: -70, z: 1550, label: 'The Silent Court' },
    { x: 100, z: 1590, label: 'Frostpine Terraces' },
    { x: -40, z: 1640, label: 'The Last Lodge' },
  ],
  welcome: 'Veth is not a nation, it is an agreement, and Nighthollow keeps its ledger.',
  welcomeQuestId: 'q_duskmane_hunt',
};

// The towpath: up from the Ossara border pass, through Nighthollow, north to
// the Kael border pass, with spokes to the Blackmere, the Quays, and the
// Frostpine Terraces.
export const VETH_ROADS: { x: number; z: number }[][] = [
  [
    { x: 0, z: 1290 },
    { x: 0, z: 1350 },
    { x: 0, z: 1410 },
  ], // Ossara border pass -> Nighthollow
  [
    { x: 0, z: 1420 },
    { x: 0, z: 1550 },
    { x: 0, z: 1680 },
  ], // Nighthollow -> Kael border pass
  [
    { x: -6, z: 1416 },
    { x: -45, z: 1440 },
    { x: -70, z: 1462 },
  ], // -> the Blackmere shore
  [
    { x: 6, z: 1406 },
    { x: 24, z: 1392 },
    { x: 38, z: 1382 },
  ], // -> Blackwater Quays
  [
    { x: 6, z: 1560 },
    { x: 55, z: 1575 },
    { x: 92, z: 1588 },
  ], // -> Frostpine Terraces
];

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

export const VETH_MOBS: Record<string, MobTemplate> = {
  duskmane_stalker: {
    id: 'duskmane_stalker',
    name: 'Duskmane Stalker',
    minLevel: 27,
    maxLevel: 29,
    family: 'beast',
    hpBase: 82,
    hpPerLevel: 26,
    dmgBase: 15,
    dmgPerLevel: 3.2,
    attackSpeed: 1.9,
    armorPerLevel: 18,
    moveSpeed: 8.2,
    aggroRadius: 11,
    // Duskmane Rake: the packs hunt by ear in the dark and worry what they open.
    bleed: {
      chance: 0.25,
      perTick: 8,
      interval: 3,
      duration: 9,
      name: 'Duskmane Rake',
      school: 'physical',
    },
    loot: [
      { copper: 145, chance: 1 },
      { itemId: 'duskmane_tuft', chance: 0.35 },
      { itemId: 'duskmane_pelt_strip', chance: 0.4, questId: 'q_veth_pelt_lots' },
    ],
    scale: 0.95,
    color: 0x4a4a5e,
  },
  // The oldest stalker on the Run: white as birch bark, and porters swear the
  // towpath goes quiet a full minute before she steps out of it.
  palefang_the_silent: {
    id: 'palefang_the_silent',
    name: 'Palefang the Silent',
    minLevel: 29,
    maxLevel: 29,
    family: 'beast',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 7.2,
    hpBase: 560,
    hpPerLevel: 86,
    dmgBase: 25,
    dmgPerLevel: 5.2,
    attackSpeed: 1.7,
    armorPerLevel: 30,
    moveSpeed: 8.6,
    aggroRadius: 13,
    aoePulse: { min: 30, max: 42, radius: 8, every: 9, name: 'Silent Pounce', school: 'physical' },
    enrage: { belowHpPct: 0.35, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 390, chance: 1 },
      { itemId: 'palefang_pelt', chance: 1 },
      { itemId: 'palefang_grips', chance: 0.3 },
    ],
    scale: 1.3,
    color: 0xe8e4ec,
  },
  palewidow_weaver: {
    id: 'palewidow_weaver',
    name: 'Palewidow Weaver',
    minLevel: 27,
    maxLevel: 29,
    family: 'spider',
    hpBase: 83,
    hpPerLevel: 26,
    dmgBase: 15,
    dmgPerLevel: 3.2,
    attackSpeed: 2.1,
    armorPerLevel: 22,
    moveSpeed: 7,
    aggroRadius: 10,
    // Palewidow Venom: the hollows' silk trade has a supplier no one thanks.
    venom: {
      chance: 0.3,
      perTick: 8,
      interval: 3,
      duration: 12,
      name: 'Palewidow Venom',
      school: 'nature',
    },
    ensnare: { chance: 0.15, duration: 2.5, name: 'Widow Silk' },
    loot: [
      { copper: 155, chance: 1 },
      { itemId: 'palewidow_silk', chance: 0.6, questId: 'q_palewidow_silk' },
      { itemId: 'palewidow_venom_sac', chance: 0.4, questId: 'q_veth_venom_ledger' },
    ],
    scale: 1.0,
    color: 0xd8d4e0,
  },
  blackriver_skulker: {
    id: 'blackriver_skulker',
    name: 'Blackriver Skulker',
    minLevel: 28,
    maxLevel: 30,
    family: 'murloc',
    canSwim: true,
    hpBase: 85,
    hpPerLevel: 26,
    dmgBase: 15,
    dmgPerLevel: 3.3,
    attackSpeed: 2.0,
    armorPerLevel: 20,
    moveSpeed: 7,
    aggroRadius: 11,
    // Blackwater Chill: whatever runs in the black rivers, it is not warm.
    chillOnHit: { chance: 0.3, mult: 0.65, duration: 5, name: 'Blackwater Chill' },
    loot: [
      { copper: 180, chance: 1 },
      { itemId: 'waterlogged_ledger', chance: 0.55, questId: 'q_blackmere_ledgers' },
      { itemId: 'quay_manifest', chance: 0.5, questId: 'q_veth_quay_manifests' },
    ],
    scale: 0.95,
    color: 0x3d5a66,
  },
  feral_wisp: {
    id: 'feral_wisp',
    name: 'Feral Wisp',
    minLevel: 29,
    maxLevel: 31,
    family: 'elemental',
    hpBase: 86,
    hpPerLevel: 27,
    dmgBase: 16,
    dmgPerLevel: 3.3,
    attackSpeed: 2.2,
    armorPerLevel: 20,
    moveSpeed: 6.5,
    aggroRadius: 11,
    // The only light under the Wispwood canopy, and it feeds on what you know.
    manaBurn: { chance: 0.25, amount: 100, name: 'Light Siphon', school: 'arcane' },
    enfeeble: { chance: 0.3, int: 15, duration: 12, name: 'Wisplight Daze', school: 'arcane' },
    loot: [
      { copper: 195, chance: 1 },
      { itemId: 'guttering_wisp_mote', chance: 0.4 },
      { itemId: 'wisplight_essence', chance: 0.4, questId: 'q_veth_wisp_essence' },
    ],
    scale: 0.9,
    color: 0x9fd4e8,
  },
  guildless_cutthroat: {
    id: 'guildless_cutthroat',
    name: 'Guildless Cutthroat',
    minLevel: 30,
    maxLevel: 32,
    family: 'humanoid',
    hpBase: 88,
    hpPerLevel: 27,
    dmgBase: 16,
    dmgPerLevel: 3.4,
    attackSpeed: 2.0,
    armorPerLevel: 22,
    moveSpeed: 7,
    aggroRadius: 11,
    // Expelled from the guild for freelancing; the training, they kept.
    mortalStrike: { chance: 0.25, healReduction: 0.4, duration: 8, name: 'Cutthroat Gash' },
    loot: [
      { copper: 220, chance: 1 },
      { itemId: 'guildless_sigil', chance: 0.55, questId: 'q_guildless_debts' },
      { itemId: 'cutthroat_contract', chance: 0.5, questId: 'q_veth_broken_contracts' },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 1.0,
    color: 0x5a5668,
  },
  hollow_revenant: {
    id: 'hollow_revenant',
    name: 'Hollow Revenant',
    minLevel: 31,
    maxLevel: 33,
    family: 'undead',
    hpBase: 90,
    hpPerLevel: 27,
    dmgBase: 16,
    dmgPerLevel: 3.4,
    attackSpeed: 2.3,
    armorPerLevel: 24,
    moveSpeed: 6.5,
    aggroRadius: 12,
    // The court that refused the Agreement still holds session, after a fashion.
    soulrot: {
      chance: 0.3,
      perTick: 9,
      interval: 3,
      duration: 12,
      name: 'Hollow Rot',
      school: 'shadow',
    },
    loot: [
      { copper: 245, chance: 1 },
      { itemId: 'silent_court_seal', chance: 0.55, questId: 'q_silent_court' },
      { itemId: 'court_ledger_page', chance: 0.4, questId: 'q_veth_court_records' },
      { itemId: 'bone_fragments', chance: 0.4 },
    ],
    scale: 1.05,
    color: 0xb8c4d0,
  },
  frostpine_headhunter: {
    id: 'frostpine_headhunter',
    name: 'Frostpine Headhunter',
    minLevel: 32,
    maxLevel: 34,
    family: 'troll',
    hpBase: 92,
    hpPerLevel: 28,
    dmgBase: 17,
    dmgPerLevel: 3.5,
    attackSpeed: 2.2,
    armorPerLevel: 26,
    moveSpeed: 6.8,
    aggroRadius: 12,
    // Frostpine Chill: the terraces' trolls oil their spearheads with rime.
    frostbite: {
      chance: 0.3,
      perTick: 9,
      interval: 3,
      duration: 12,
      name: 'Frostpine Chill',
    },
    loot: [
      { copper: 275, chance: 1 },
      { itemId: 'frostpine_charm', chance: 0.35 },
      { itemId: 'frostpine_war_totem', chance: 0.4, questId: 'q_veth_totem_tally' },
    ],
    scale: 1.1,
    color: 0x6e8a94,
  },
  // The trolls of the terraces sank Grelnok in the ice two winters for eating
  // his own war party. The ice let him back out. They did not argue with it.
  grelnok_the_hoarbound: {
    id: 'grelnok_the_hoarbound',
    name: 'Grelnok the Hoarbound',
    minLevel: 33,
    maxLevel: 33,
    family: 'troll',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 620,
    hpPerLevel: 92,
    dmgBase: 27,
    dmgPerLevel: 5.6,
    attackSpeed: 2.3,
    armorPerLevel: 48,
    moveSpeed: 6.8,
    aggroRadius: 13,
    aoePulse: { min: 42, max: 56, radius: 10, every: 9, name: 'Hoarfrost Ring', school: 'frost' },
    stoneskin: { amount: 260, every: 20, duration: 8, name: 'Rimehide' },
    summonAdds: { mobId: 'frostpine_headhunter', count: 2, atHpPct: [0.5] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.45, hasteMult: 1.25 },
    loot: [
      { copper: 910, chance: 1 },
      { itemId: 'grelnoks_frozen_idol', chance: 1 },
      { itemId: 'hoarbound_bindings', chance: 0.3 },
    ],
    scale: 1.35,
    color: 0x88b4c4,
  },
  // Veykar kept the guild's oldest lodge and broke its oldest rule: he chose
  // his own contracts. The guild will not touch him; he trained half of them.
  veykar_the_forsworn: {
    id: 'veykar_the_forsworn',
    name: 'Veykar the Forsworn',
    minLevel: 34,
    maxLevel: 34,
    family: 'humanoid',
    elite: true,
    boss: true,
    hpBase: 325,
    hpPerLevel: 45,
    dmgBase: 19,
    dmgPerLevel: 4.0,
    attackSpeed: 2.5,
    armorPerLevel: 38,
    moveSpeed: 7,
    aggroRadius: 14,
    aoePulse: {
      min: 35,
      max: 48,
      radius: 10,
      every: 11,
      name: 'Fan of Knives',
      school: 'physical',
    },
    mortalStrike: { chance: 0.25, healReduction: 0.5, duration: 8, name: 'Forsworn Cut' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.4, hasteMult: 1.2 },
    loot: [
      { copper: 3380, chance: 1 },
      { itemId: 'forsworn_lamellar', chance: 0.3 },
      { itemId: 'forsworn_edge', chance: 0.25 },
    ],
    scale: 1.2,
    color: 0x46425c,
  },
  // Porters and bargefolk the Blackmere kept. The mere pays no wages, and it
  // never lets its staff go.
  blackmere_drowned: {
    id: 'blackmere_drowned',
    name: 'Blackmere Drowned',
    minLevel: 29,
    maxLevel: 31,
    family: 'undead',
    canSwim: true,
    hpBase: 87,
    hpPerLevel: 27,
    dmgBase: 16,
    dmgPerLevel: 3.3,
    attackSpeed: 2.1,
    armorPerLevel: 22,
    moveSpeed: 6.4,
    aggroRadius: 11,
    // Drowning Grip: the mere collects slowly, and it starts with your stride.
    chillOnHit: { chance: 0.3, mult: 0.65, duration: 5, name: 'Drowning Grip' },
    loot: [
      { copper: 205, chance: 1 },
      { itemId: 'drowned_toll_coin', chance: 0.4, questId: 'q_veth_drowned_tolls' },
      { itemId: 'bone_fragments', chance: 0.35 },
    ],
    scale: 1.0,
    color: 0x46605a,
  },
  // Down from the high ice when the drifts close; the terraces feed better,
  // and the trolls have learned to leave the white cats the first cut.
  rimeclaw_prowler: {
    id: 'rimeclaw_prowler',
    name: 'Rimeclaw Prowler',
    minLevel: 32,
    maxLevel: 34,
    family: 'beast',
    hpBase: 93,
    hpPerLevel: 28,
    dmgBase: 17,
    dmgPerLevel: 3.5,
    attackSpeed: 1.9,
    armorPerLevel: 24,
    moveSpeed: 8.0,
    aggroRadius: 11,
    // Rimeclaw Rake: frostbitten claws open wounds that will not close warm.
    bleed: {
      chance: 0.25,
      perTick: 10,
      interval: 3,
      duration: 9,
      name: 'Rimeclaw Rake',
      school: 'physical',
    },
    loot: [
      { copper: 290, chance: 1 },
      { itemId: 'rimeclaw_pelt', chance: 0.5, questId: 'q_veth_rimeclaw_pelts' },
    ],
    scale: 1.05,
    color: 0xb9c8d2,
  },
};

// ---------------------------------------------------------------------------
// NPCs (Nighthollow hub)
// ---------------------------------------------------------------------------

export const VETH_NPCS: Record<string, NpcDef> = {
  spymaster_vael: {
    id: 'spymaster_vael',
    name: 'Spymaster Vael',
    title: 'Keeper of the Ledger',
    pos: { x: 4, z: 1414 },
    facing: -2.0,
    color: 0x5c4a78,
    questIds: [
      'q_duskmane_hunt',
      'q_blackmere_ledgers',
      'q_silent_court',
      'q_forsworn_master',
      'q_veth_totem_tally',
      'q_veth_rimeclaw_pelts',
      'q_veth_terrace_sweep',
      'q_veth_hoarbound_debt',
    ],
    greeting:
      'Nothing in Veth is free, $C, and nothing is wasted. Tell me what you can do, and I will tell you what it is worth.',
  },
  provisioner_maren: {
    id: 'provisioner_maren',
    name: 'Provisioner Maren',
    title: 'Sutler of the Whisper Market',
    pos: { x: -6, z: 1418 },
    facing: 1.4,
    color: 0x7a6a4e,
    questIds: ['q_palewidow_silk'],
    vendorItems: [
      'nighthollow_black_bread',
      'pinefrost_tea',
      'smoked_blackmere_eel',
      'healing_potion',
      'mana_potion',
      'wispweave_robe',
      'quayguard_hauberk',
      'duskstalker_vest',
      'nightpath_treads',
      'blackriver_legguards',
    ],
    greeting:
      'Bread, tea, and a coat the damp cannot argue with: the Quays run on credit, $C, but you will pay me in coin.',
  },
  isyra_coldwater: {
    id: 'isyra_coldwater',
    name: 'Isyra Coldwater',
    title: 'Dealer in Quiet Steel',
    pos: { x: -2, z: 1422 },
    facing: 2.8,
    color: 0x4e6a7a,
    questIds: [
      'q_guildless_debts',
      'q_veth_broken_contracts',
      'q_veth_knife_tax',
      'q_veth_court_records',
      'q_veth_adjourn_court',
    ],
    vendorItems: ['quays_cutlass', 'wispcaller_staff', 'whispersteel_stiletto'],
    greeting: 'Quiet steel for quiet work. If a blade of mine sings, I will refund the difference.',
  },
  factor_ilvane: {
    id: 'factor_ilvane',
    name: 'Factor Ilvane',
    title: 'Broker of Small Debts',
    pos: { x: 10, z: 1414 },
    facing: -1.2,
    color: 0x6a5a44,
    questIds: [
      'q_veth_pelt_lots',
      'q_veth_venom_ledger',
      'q_veth_quay_manifests',
      'q_veth_palefang_price',
    ],
    greeting:
      'Every small debt in Nighthollow crosses this desk before it becomes a large one, $C. Yours can start here.',
  },
  auditor_cress: {
    id: 'auditor_cress',
    name: 'Auditor Cress',
    title: 'Examiner of Closed Accounts',
    pos: { x: -12, z: 1408 },
    facing: 0.8,
    color: 0x4a5a6e,
    questIds: [
      'q_veth_wisp_essence',
      'q_veth_wispwood_cull',
      'q_veth_drowned_tolls',
      'q_veth_mere_bottom',
    ],
    greeting: 'I audit what the dark takes, $C, and lately it takes more than it reports.',
  },
};

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export const VETH_QUESTS: Record<string, QuestDef> = {
  q_duskmane_hunt: {
    id: 'q_duskmane_hunt',
    name: 'The Price of Teeth',
    giverNpcId: 'spymaster_vael',
    turnInNpcId: 'spymaster_vael',
    text: 'The duskmane packs have started taking porters off the south towpath, $N. Every body they drag into the dark is a debt the Confederation must settle with someone. Kill twelve; the ledger prefers round numbers.',
    completionText:
      'Twelve, as written. The porters will not thank you; they will never know your name. That is how Veth prefers its debts paid.',
    objectives: [
      { type: 'kill', targetMobId: 'duskmane_stalker', count: 12, label: 'Duskmane Stalker slain' },
    ],
    xpReward: 7000,
    copperReward: 3200,
    itemRewards: {},
    minLevel: 26,
  },
  q_palewidow_silk: {
    id: 'q_palewidow_silk',
    name: 'Silk for the Ledger',
    giverNpcId: 'provisioner_maren',
    turnInNpcId: 'provisioner_maren',
    text: 'Palewidow silk holds a knot better than anything the south sells, and my buyers do not ask where it comes from, $N. Eight skeins, cut from the weavers in the hollows east of the towpath. I pay the fair rate, which is the rate I say is fair.',
    completionText:
      'Fine cuts, barely a strand frayed. Take the treads; call the rest of your fee goodwill, which in Veth is worth more than coin.',
    objectives: [{ type: 'collect', itemId: 'palewidow_silk', count: 8, label: 'Palewidow Silk' }],
    xpReward: 7400,
    copperReward: 3600,
    itemRewards: {
      warrior: 'nightpath_treads',
      mage: 'nightpath_treads',
      rogue: 'nightpath_treads',
    },
    minLevel: 27,
  },
  q_blackmere_ledgers: {
    id: 'q_blackmere_ledgers',
    name: 'The Drowned Accounts',
    giverNpcId: 'spymaster_vael',
    turnInNpcId: 'spymaster_vael',
    text: 'A courier barge went down where the black river widens into the Blackmere, $N, and the skulkers have nested in the wreck ever since. The cargo was paper: four ledgers, and Veth remembers what is written even when the water does not. Kill ten of the skulkers and bring the books up dry.',
    completionText:
      'Waterstained but legible. Half the names in these pages owe the Confederation money; the other half will, by morning.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'blackriver_skulker',
        count: 10,
        label: 'Blackriver Skulker slain',
      },
      { type: 'collect', itemId: 'waterlogged_ledger', count: 4, label: 'Waterlogged Ledger' },
    ],
    xpReward: 8200,
    copperReward: 4000,
    itemRewards: {},
    requiresQuest: 'q_duskmane_hunt',
    minLevel: 28,
  },
  q_guildless_debts: {
    id: 'q_guildless_debts',
    name: 'Debts Called Due',
    giverNpcId: 'isyra_coldwater',
    turnInNpcId: 'isyra_coldwater',
    text: 'Every blade I sell is numbered, $N, and the guild keeps the numbers. The cutthroats working the north road were expelled for freelancing; they kept their sigils, and the guild wants them back. Ten dead, five sigils. The guild does not pay for apologies.',
    completionText:
      'Five sigils, struck from the rolls. You did not hear a guild mentioned, and I did not say the word. We understand each other.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'guildless_cutthroat',
        count: 10,
        label: 'Guildless Cutthroat slain',
      },
      { type: 'collect', itemId: 'guildless_sigil', count: 5, label: 'Guildless Sigil' },
    ],
    xpReward: 9400,
    copperReward: 4600,
    itemRewards: {},
    minLevel: 30,
  },
  q_silent_court: {
    id: 'q_silent_court',
    name: 'The Silent Court',
    giverNpcId: 'spymaster_vael',
    turnInNpcId: 'spymaster_vael',
    text: 'The city-state that raised the Silent Court refused the Agreement, $N, and it is no coincidence that nobody remembers its name. Its courtiers still hold session in the ruin, and they have begun collecting tolls on the west bank again. Put twelve of them down and bring me five of their court seals; unpaid history is still a debt.',
    completionText:
      'Seals of a court that no longer exists, for a debt that never expires. The Confederation settles everything eventually, $N. Remember that.',
    objectives: [
      { type: 'kill', targetMobId: 'hollow_revenant', count: 12, label: 'Hollow Revenant slain' },
      { type: 'collect', itemId: 'silent_court_seal', count: 5, label: 'Silent Court Seal' },
    ],
    xpReward: 10200,
    copperReward: 5200,
    itemRewards: {},
    requiresQuest: 'q_blackmere_ledgers',
    minLevel: 31,
  },
  q_forsworn_master: {
    id: 'q_forsworn_master',
    name: 'The Forsworn Master',
    giverNpcId: 'spymaster_vael',
    turnInNpcId: 'spymaster_vael',
    text: 'Veykar kept the oldest lodge in the guild and broke its oldest rule: he chose his own contracts. Now he sells Veth secrets out of the Last Lodge and calls it independence. The guild will not touch him; he trained half of them. Take companions, $N, mind the knives when he turns, and close the account.',
    completionText:
      'It is done, then. No song, no statue; his name comes off the rolls tonight, and yours goes into a ledger very few are permitted to read. Consider that the highest payment Veth offers.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'veykar_the_forsworn',
        count: 1,
        label: 'Veykar the Forsworn slain',
      },
    ],
    xpReward: 11500,
    copperReward: 6000,
    itemRewards: {
      warrior: 'forsworn_edge',
      mage: 'wispcaller_staff',
      rogue: 'whispersteel_stiletto',
    },
    requiresQuest: 'q_silent_court',
    suggestedPlayers: 3,
    minLevel: 33,
  },
  // --- chain: Factor Ilvane, "small debts" (27-29) ---
  q_veth_pelt_lots: {
    id: 'q_veth_pelt_lots',
    name: 'Pelts by the Lot',
    giverNpcId: 'factor_ilvane',
    turnInNpcId: 'factor_ilvane',
    text: 'The southern lots trade duskmane pelts at four times what the beasts cost to skin, $N. Thin the packs on the Run, twelve of them, and bring me eight clean pelt strips. The margin is mine; the fee is yours.',
    completionText:
      'Eight strips, uncut, and twelve fewer mouths on the towpath. I will enter it as a profit, which in Veth is the warmest word we have.',
    objectives: [
      { type: 'kill', targetMobId: 'duskmane_stalker', count: 12, label: 'Duskmane Stalker slain' },
      { type: 'collect', itemId: 'duskmane_pelt_strip', count: 8, label: 'Duskmane Pelt Strip' },
    ],
    xpReward: 7200,
    copperReward: 3400,
    itemRewards: {},
    minLevel: 26,
  },
  q_veth_venom_ledger: {
    id: 'q_veth_venom_ledger',
    name: 'The Venom Ledger',
    giverNpcId: 'factor_ilvane',
    turnInNpcId: 'factor_ilvane',
    text: 'Palewidow venom sells south as medicine and north as something else, $N; I do not write down which. Fourteen weavers culled and eight venom sacs, unruptured. Handle them the way you would handle your own accounts: carefully.',
    completionText:
      "Not one sac ruptured. You have a bookkeeper's hands, $N. That is a compliment; in Nighthollow there is no higher one.",
    objectives: [
      { type: 'kill', targetMobId: 'palewidow_weaver', count: 14, label: 'Palewidow Weaver slain' },
      { type: 'collect', itemId: 'palewidow_venom_sac', count: 8, label: 'Palewidow Venom Sac' },
    ],
    xpReward: 7600,
    copperReward: 3600,
    itemRewards: {},
    requiresQuest: 'q_veth_pelt_lots',
    minLevel: 27,
  },
  q_veth_quay_manifests: {
    id: 'q_veth_quay_manifests',
    name: 'Manifests in the Mud',
    giverNpcId: 'factor_ilvane',
    turnInNpcId: 'factor_ilvane',
    text: 'The skulkers have been dragging cargo off the Quays and the manifests with it, $N. Paper is the only proof a debt exists. Fourteen skulkers, eight manifests, and mind the chill in the water; I do not insure against it.',
    completionText:
      'Smeared, but the numbers survive. Numbers usually do. The Quays owe you; I have written it down, which makes it true.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'blackriver_skulker',
        count: 14,
        label: 'Blackriver Skulker slain',
      },
      { type: 'collect', itemId: 'quay_manifest', count: 8, label: 'Sodden Quay Manifest' },
    ],
    xpReward: 8000,
    copperReward: 3800,
    itemRewards: {},
    requiresQuest: 'q_veth_venom_ledger',
    minLevel: 28,
  },
  q_veth_palefang_price: {
    id: 'q_veth_palefang_price',
    name: 'A Debt of Silence',
    giverNpcId: 'factor_ilvane',
    turnInNpcId: 'factor_ilvane',
    text: 'Palefang has taken three porters and a factor this season, and the Run goes quiet a full minute before she steps out of it, $N. The Confederation has priced that silence and found it too expensive. Bring companions; she has never needed them.',
    completionText:
      'So the Run has sound again. The porters will invent a hero for this, and they will be wrong twice. Your fee is entered; the ledger does not care who is thanked.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'palefang_the_silent',
        count: 1,
        label: 'Palefang the Silent slain',
      },
    ],
    xpReward: 10000,
    copperReward: 5200,
    itemRewards: {},
    requiresQuest: 'q_veth_quay_manifests',
    suggestedPlayers: 3,
    minLevel: 28,
  },
  // --- chain: Auditor Cress, the Blackmere audit (29-31) ---
  q_veth_wisp_essence: {
    id: 'q_veth_wisp_essence',
    name: 'What the Light Eats',
    giverNpcId: 'auditor_cress',
    turnInNpcId: 'auditor_cress',
    text: 'The wisps in the Wispwood feed on what travelers know: names, routes, sums, $N. That is Veth property. Cull twelve and bring me eight of their essences; I intend to bill the forest itself if I can find where it banks.',
    completionText:
      'Warm as a lie and twice as bright. The essences balance against three lost couriers; the forest still owes us two.',
    objectives: [
      { type: 'kill', targetMobId: 'feral_wisp', count: 12, label: 'Feral Wisp slain' },
      { type: 'collect', itemId: 'wisplight_essence', count: 8, label: 'Wisplight Essence' },
    ],
    xpReward: 8400,
    copperReward: 4000,
    itemRewards: {},
    minLevel: 29,
  },
  q_veth_wispwood_cull: {
    id: 'q_veth_wispwood_cull',
    name: 'A Correction in the Wood',
    giverNpcId: 'auditor_cress',
    turnInNpcId: 'auditor_cress',
    text: 'The audit says the Wispwood holds a third more wisps than last season, and the skulkers have begun nesting under its bank, $N. The Confederation calls this drift, and drift gets corrected. Fourteen wisps, ten skulkers; round the account down.',
    completionText:
      'Corrected. The wood will drift again by spring, and someone will be paid to correct it again. This is what stability costs, $N; Veth pays it gladly.',
    objectives: [
      { type: 'kill', targetMobId: 'feral_wisp', count: 14, label: 'Feral Wisp slain' },
      {
        type: 'kill',
        targetMobId: 'blackriver_skulker',
        count: 10,
        label: 'Blackriver Skulker slain',
      },
    ],
    xpReward: 8800,
    copperReward: 4200,
    itemRewards: {},
    requiresQuest: 'q_veth_wisp_essence',
    minLevel: 29,
  },
  q_veth_drowned_tolls: {
    id: 'q_veth_drowned_tolls',
    name: 'Tolls for the Drowned',
    giverNpcId: 'auditor_cress',
    turnInNpcId: 'auditor_cress',
    text: 'The drowned have started collecting tolls at the Blackmere landing: coin, cargo, and twice a porter, $N. A toll requires a charter, and they have none on file. Put fourteen of them down and recover eight of the toll coins they hoard; those are Confederation currency.',
    completionText:
      'Cold coin, but coin. The drowned may keep what they took from older ledgers than ours; these eight are ours, and now they are home.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'blackmere_drowned',
        count: 14,
        label: 'Blackmere Drowned slain',
      },
      { type: 'collect', itemId: 'drowned_toll_coin', count: 8, label: 'Drowned Toll Coin' },
    ],
    xpReward: 9200,
    copperReward: 4400,
    itemRewards: {},
    requiresQuest: 'q_veth_wispwood_cull',
    minLevel: 30,
  },
  q_veth_mere_bottom: {
    id: 'q_veth_mere_bottom',
    name: 'The Bottom of the Mere',
    giverNpcId: 'auditor_cress',
    turnInNpcId: 'auditor_cress',
    text: 'Whatever charter the drowned think they hold, it was not issued by Veth, $N. Sixteen more of them, and ten of the skulkers ferrying for them. When the Blackmere is quiet, the audit closes.',
    completionText:
      'The Blackmere reports quiet water and no new claims. I am closing the account. Do not mistake that for gratitude; it is better, it is a balance.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'blackmere_drowned',
        count: 16,
        label: 'Blackmere Drowned slain',
      },
      {
        type: 'kill',
        targetMobId: 'blackriver_skulker',
        count: 10,
        label: 'Blackriver Skulker slain',
      },
    ],
    xpReward: 9600,
    copperReward: 4600,
    itemRewards: {},
    requiresQuest: 'q_veth_drowned_tolls',
    minLevel: 30,
  },
  // --- chain: Isyra Coldwater, guild accounts receivable (30-32) ---
  q_veth_broken_contracts: {
    id: 'q_veth_broken_contracts',
    name: 'Broken Contracts',
    giverNpcId: 'isyra_coldwater',
    turnInNpcId: 'isyra_coldwater',
    text: 'The sigils were the start, $N. The guildless still carry their old contracts, and every page names clients who believe those debts died with the expulsion. The guild disagrees. Fourteen cutthroats, eight contracts, and no copies.',
    completionText:
      'Eight contracts, and every client on them suddenly owes the guild an apology and a fee. You have made several important people poorer, $N. They will never know it was you; that is the service.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'guildless_cutthroat',
        count: 14,
        label: 'Guildless Cutthroat slain',
      },
      { type: 'collect', itemId: 'cutthroat_contract', count: 8, label: 'Cutthroat Contract' },
    ],
    xpReward: 9800,
    copperReward: 4700,
    itemRewards: {},
    requiresQuest: 'q_guildless_debts',
    minLevel: 30,
  },
  q_veth_knife_tax: {
    id: 'q_veth_knife_tax',
    name: 'The Knife Tax',
    giverNpcId: 'isyra_coldwater',
    turnInNpcId: 'isyra_coldwater',
    text: 'The freelancers on the north road have begun taxing porters at knifepoint and calling it a toll, $N. There is one tax collector in Veth, and it is not them. Sixteen, and make it plain.',
    completionText:
      'The road reports no collections this week. Plain enough. The guild thanks you in the only language it is fluent in: coin.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'guildless_cutthroat',
        count: 16,
        label: 'Guildless Cutthroat slain',
      },
    ],
    xpReward: 10200,
    copperReward: 4800,
    itemRewards: {},
    requiresQuest: 'q_veth_broken_contracts',
    minLevel: 31,
  },
  q_veth_court_records: {
    id: 'q_veth_court_records',
    name: 'Records of the Court',
    giverNpcId: 'isyra_coldwater',
    turnInNpcId: 'isyra_coldwater',
    text: 'Before the Agreement, the Silent Court licensed killings the guild now claims as its own history, $N. The revenants still file those pages in the ruin. Fourteen of them put down, eight pages recovered; the guild prefers its history unread.',
    completionText:
      "Pages older than the Agreement, and half the names still legible. They go in the vault, not the fire; the guild's history is a weapon, and weapons are not burned.",
    objectives: [
      { type: 'kill', targetMobId: 'hollow_revenant', count: 14, label: 'Hollow Revenant slain' },
      { type: 'collect', itemId: 'court_ledger_page', count: 8, label: 'Court Ledger Page' },
    ],
    xpReward: 10600,
    copperReward: 5000,
    itemRewards: {},
    requiresQuest: 'q_veth_knife_tax',
    minLevel: 31,
  },
  q_veth_adjourn_court: {
    id: 'q_veth_adjourn_court',
    name: 'Court Adjourned',
    giverNpcId: 'isyra_coldwater',
    turnInNpcId: 'isyra_coldwater',
    text: 'The Court has begun sending its tollmen east of the river, and the guildless sell them passage, $N. Both sides of that trade are unlicensed. Sixteen revenants, ten cutthroats, and the west bank keeps its quiet.',
    completionText:
      'Adjourned, then. A court with no session, a road with no toll, and a ledger with no outstanding lines. This is as close to a holiday as Veth observes.',
    objectives: [
      { type: 'kill', targetMobId: 'hollow_revenant', count: 16, label: 'Hollow Revenant slain' },
      {
        type: 'kill',
        targetMobId: 'guildless_cutthroat',
        count: 10,
        label: 'Guildless Cutthroat slain',
      },
    ],
    xpReward: 11000,
    copperReward: 5200,
    itemRewards: {},
    requiresQuest: 'q_veth_court_records',
    minLevel: 32,
  },
  // --- chain: Spymaster Vael, the north ledger (32-34) ---
  q_veth_totem_tally: {
    id: 'q_veth_totem_tally',
    name: 'A Tally of Totems',
    giverNpcId: 'spymaster_vael',
    turnInNpcId: 'spymaster_vael',
    text: 'The Frostpine trolls carve a war totem for every raid they intend to make, $N, which makes their intentions admirably easy to audit. The current count is too high. Fourteen headhunters, and bring me eight totems; each one is a raid that never happens.',
    completionText:
      'Eight raids, cancelled in advance. Cheaper than walls, quieter than war. This is why Veth keeps ledgers instead of armies.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'frostpine_headhunter',
        count: 14,
        label: 'Frostpine Headhunter slain',
      },
      { type: 'collect', itemId: 'frostpine_war_totem', count: 8, label: 'Frostpine War Totem' },
    ],
    xpReward: 11600,
    copperReward: 5400,
    itemRewards: {},
    minLevel: 32,
  },
  q_veth_rimeclaw_pelts: {
    id: 'q_veth_rimeclaw_pelts',
    name: 'Rimeclaw Futures',
    giverNpcId: 'spymaster_vael',
    turnInNpcId: 'spymaster_vael',
    text: 'The rimeclaws have come down from the high ice and the terrace trade in furs has noticed, $N. Twelve prowlers thinned and eight pelts, whole. The Confederation buys low, in the north, in winter, from you.',
    completionText:
      'Whole pelts, winter weight. They will sell south for six times your fee, and you will not resent it, because you knew the rate when you took the work. Veth values that in a contractor.',
    objectives: [
      { type: 'kill', targetMobId: 'rimeclaw_prowler', count: 12, label: 'Rimeclaw Prowler slain' },
      { type: 'collect', itemId: 'rimeclaw_pelt', count: 8, label: 'Rimeclaw Pelt' },
    ],
    xpReward: 12000,
    copperReward: 5600,
    itemRewards: {},
    requiresQuest: 'q_veth_totem_tally',
    minLevel: 32,
  },
  q_veth_terrace_sweep: {
    id: 'q_veth_terrace_sweep',
    name: 'Sweeping the Terraces',
    giverNpcId: 'spymaster_vael',
    turnInNpcId: 'spymaster_vael',
    text: 'The northern terraces are the only road to the Kael border, and this season it is held by spears and claws in roughly equal measure, $N. Sixteen headhunters, twelve rimeclaws. The pass stays open; the ledger stays balanced.',
    completionText:
      'The border porters crossed this morning without an escort, which is the only report that matters. The north is passable. What comes down that road next is another account entirely.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'frostpine_headhunter',
        count: 16,
        label: 'Frostpine Headhunter slain',
      },
      { type: 'kill', targetMobId: 'rimeclaw_prowler', count: 12, label: 'Rimeclaw Prowler slain' },
    ],
    xpReward: 12800,
    copperReward: 5800,
    itemRewards: {},
    requiresQuest: 'q_veth_rimeclaw_pelts',
    minLevel: 33,
  },
  q_veth_hoarbound_debt: {
    id: 'q_veth_hoarbound_debt',
    name: 'The Hoarbound Debt',
    giverNpcId: 'spymaster_vael',
    turnInNpcId: 'spymaster_vael',
    text: 'The trolls sank Grelnok in the ice for eating his own war party, and the ice let him back out, $N. He has been collecting the terraces piece by piece since, and Veth does not recognize his claim. Take companions onto the ice. The cold is his; make sure the ledger is ours.',
    completionText:
      'The ice keeps him this time; we paid it more than the trolls did. Take the leggings, $N, and the fee. Your account with the north is closed, and very few people can say that.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'grelnok_the_hoarbound',
        count: 1,
        label: 'Grelnok the Hoarbound slain',
      },
    ],
    xpReward: 16000,
    copperReward: 6400,
    itemRewards: {
      warrior: 'terracewatch_leggings',
      mage: 'terracewatch_leggings',
      rogue: 'terracewatch_leggings',
    },
    requiresQuest: 'q_veth_terrace_sweep',
    suggestedPlayers: 3,
    minLevel: 33,
  },
};

export const VETH_QUEST_ORDER = [
  'q_duskmane_hunt',
  'q_palewidow_silk',
  'q_blackmere_ledgers',
  'q_guildless_debts',
  'q_silent_court',
  'q_forsworn_master',
  'q_veth_pelt_lots',
  'q_veth_venom_ledger',
  'q_veth_quay_manifests',
  'q_veth_palefang_price',
  'q_veth_wisp_essence',
  'q_veth_wispwood_cull',
  'q_veth_drowned_tolls',
  'q_veth_mere_bottom',
  'q_veth_broken_contracts',
  'q_veth_knife_tax',
  'q_veth_court_records',
  'q_veth_adjourn_court',
  'q_veth_totem_tally',
  'q_veth_rimeclaw_pelts',
  'q_veth_terrace_sweep',
  'q_veth_hoarbound_debt',
];

// ---------------------------------------------------------------------------
// Camps (spawn tables), merged AFTER every existing camp in data.ts and after
// Ossara's, so world-gen RNG draw order for pre-existing content never shifts.
// Graded and ordered south (27) to north (34).
// ---------------------------------------------------------------------------

export const VETH_CAMPS: CampDef[] = [
  // Duskmane packs: the Run flanking the towpath south of Nighthollow
  { mobId: 'duskmane_stalker', center: { x: -60, z: 1330 }, radius: 22, count: 7 },
  { mobId: 'duskmane_stalker', center: { x: 45, z: 1340 }, radius: 20, count: 6 },
  { mobId: 'palefang_the_silent', center: { x: -85, z: 1318 }, radius: 5, count: 1 },
  // Palewidows: the hollows east of the towpath
  { mobId: 'palewidow_weaver', center: { x: 90, z: 1350 }, radius: 20, count: 8 },
  { mobId: 'palewidow_weaver', center: { x: 115, z: 1380 }, radius: 16, count: 6 },
  // Skulkers: the Quays wreckline and the Blackmere banks
  { mobId: 'blackriver_skulker', center: { x: 55, z: 1385 }, radius: 16, count: 6 },
  { mobId: 'blackriver_skulker', center: { x: -70, z: 1440 }, radius: 16, count: 6 },
  { mobId: 'blackriver_skulker', center: { x: -110, z: 1490 }, radius: 16, count: 6 },
  // Feral wisps: the Wispwood, east of the lake
  { mobId: 'feral_wisp', center: { x: 80, z: 1480 }, radius: 20, count: 8 },
  { mobId: 'feral_wisp', center: { x: 105, z: 1510 }, radius: 16, count: 6 },
  // Guildless cutthroats: roadside ambush camps on the north towpath
  { mobId: 'guildless_cutthroat', center: { x: -30, z: 1520 }, radius: 14, count: 5 },
  { mobId: 'guildless_cutthroat', center: { x: 30, z: 1540 }, radius: 14, count: 5 },
  // Revenants: the Silent Court, west bank
  { mobId: 'hollow_revenant', center: { x: -70, z: 1550 }, radius: 20, count: 8 },
  { mobId: 'hollow_revenant', center: { x: -95, z: 1575 }, radius: 16, count: 6 },
  // Frostpine trolls: the frozen terraces at the north edge
  { mobId: 'frostpine_headhunter', center: { x: 100, z: 1590 }, radius: 20, count: 8 },
  { mobId: 'frostpine_headhunter', center: { x: 130, z: 1620 }, radius: 16, count: 6 },
  { mobId: 'grelnok_the_hoarbound', center: { x: 145, z: 1645 }, radius: 5, count: 1 },
  // Veykar the Forsworn: the Last Lodge, northwest
  { mobId: 'veykar_the_forsworn', center: { x: -40, z: 1640 }, radius: 3, count: 1 },
  // Appended after every pre-existing Veth camp (world-gen RNG draw order):
  // the Blackmere drowned, the landing and the far shore
  { mobId: 'blackmere_drowned', center: { x: -95, z: 1452 }, radius: 16, count: 6 },
  { mobId: 'blackmere_drowned', center: { x: -68, z: 1492 }, radius: 16, count: 6 },
  // rimeclaw prowlers: the high ice above the terraces
  { mobId: 'rimeclaw_prowler', center: { x: 70, z: 1612 }, radius: 18, count: 6 },
  { mobId: 'rimeclaw_prowler', center: { x: 118, z: 1652 }, radius: 16, count: 6 },
];

// Every collect objective in this zone is satisfied by mob loot (questId drops),
// so the zone places no ground collectibles.
export const VETH_OBJECTS: GroundObjectDef[] = [];

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const VETH_ITEMS: Record<string, ItemDef> = {
  // --- quest items ---
  palewidow_silk: {
    id: 'palewidow_silk',
    name: 'Palewidow Silk',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_palewidow_silk',
  },
  waterlogged_ledger: {
    id: 'waterlogged_ledger',
    name: 'Waterlogged Ledger',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_blackmere_ledgers',
  },
  guildless_sigil: {
    id: 'guildless_sigil',
    name: 'Guildless Sigil',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_guildless_debts',
  },
  silent_court_seal: {
    id: 'silent_court_seal',
    name: 'Silent Court Seal',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_silent_court',
  },
  duskmane_pelt_strip: {
    id: 'duskmane_pelt_strip',
    name: 'Duskmane Pelt Strip',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_veth_pelt_lots',
  },
  palewidow_venom_sac: {
    id: 'palewidow_venom_sac',
    name: 'Palewidow Venom Sac',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_veth_venom_ledger',
  },
  quay_manifest: {
    id: 'quay_manifest',
    name: 'Sodden Quay Manifest',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_veth_quay_manifests',
  },
  wisplight_essence: {
    id: 'wisplight_essence',
    name: 'Wisplight Essence',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_veth_wisp_essence',
  },
  drowned_toll_coin: {
    id: 'drowned_toll_coin',
    name: 'Drowned Toll Coin',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_veth_drowned_tolls',
  },
  cutthroat_contract: {
    id: 'cutthroat_contract',
    name: 'Cutthroat Contract',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_veth_broken_contracts',
  },
  court_ledger_page: {
    id: 'court_ledger_page',
    name: 'Court Ledger Page',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_veth_court_records',
  },
  frostpine_war_totem: {
    id: 'frostpine_war_totem',
    name: 'Frostpine War Totem',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_veth_totem_tally',
  },
  rimeclaw_pelt: {
    id: 'rimeclaw_pelt',
    name: 'Rimeclaw Pelt',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_veth_rimeclaw_pelts',
  },
  // --- junk / flavor drops ---
  duskmane_tuft: {
    id: 'duskmane_tuft',
    name: 'Duskmane Tuft',
    kind: 'junk',
    quality: 'poor',
    sellValue: 52,
  },
  guttering_wisp_mote: {
    id: 'guttering_wisp_mote',
    name: 'Guttering Wisp Mote',
    kind: 'junk',
    quality: 'poor',
    sellValue: 56,
  },
  frostpine_charm: {
    id: 'frostpine_charm',
    name: 'Frostpine Charm',
    kind: 'junk',
    quality: 'poor',
    sellValue: 60,
  },
  palefang_pelt: {
    id: 'palefang_pelt',
    name: 'Pelt of Palefang the Silent',
    kind: 'junk',
    quality: 'uncommon',
    sellValue: 1040,
  },
  grelnoks_frozen_idol: {
    id: 'grelnoks_frozen_idol',
    name: "Grelnok's Frozen Idol",
    kind: 'junk',
    quality: 'uncommon',
    sellValue: 1170,
  },
  // --- vendor food / drink ---
  nighthollow_black_bread: {
    id: 'nighthollow_black_bread',
    name: 'Nighthollow Black Bread',
    kind: 'food',
    quality: 'common',
    foodHp: 1150,
    sellValue: 145,
    buyValue: 2350,
  },
  pinefrost_tea: {
    id: 'pinefrost_tea',
    name: 'Pinefrost Tea',
    kind: 'drink',
    quality: 'common',
    drinkMana: 1700,
    sellValue: 145,
    buyValue: 2350,
  },
  smoked_blackmere_eel: {
    id: 'smoked_blackmere_eel',
    name: 'Smoked Blackmere Eel',
    kind: 'food',
    quality: 'common',
    foodHp: 1350,
    sellValue: 195,
    buyValue: 3100,
  },
  // --- vendor armor ---
  wispweave_robe: {
    id: 'wispweave_robe',
    name: 'Wispweave Robe',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 78 },
    sellValue: 1150,
    buyValue: 11500,
  },
  quayguard_hauberk: {
    id: 'quayguard_hauberk',
    name: 'Quayguard Hauberk',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 260 },
    sellValue: 1250,
    buyValue: 12500,
  },
  duskstalker_vest: {
    id: 'duskstalker_vest',
    name: 'Duskstalker Vest',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 148 },
    sellValue: 1200,
    buyValue: 12000,
  },
  // Cloth like zone3's ridgestalker_treads: the shared quest reward for all
  // three archetypes, so every class must be able to wear it.
  nightpath_treads: {
    id: 'nightpath_treads',
    name: 'Nightpath Treads',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 68, agi: 8, sta: 6 },
    sellValue: 1400,
    buyValue: 14000,
  },
  blackriver_legguards: {
    id: 'blackriver_legguards',
    name: 'Blackriver Legguards',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'common',
    stats: { armor: 222 },
    sellValue: 1250,
    buyValue: 12500,
  },
  // Cloth like nightpath_treads: the shared reward for the Hoarbound finale,
  // so all three archetypes must be able to wear it.
  terracewatch_leggings: {
    id: 'terracewatch_leggings',
    name: 'Terracewatch Leggings',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 72, sta: 10, agi: 8 },
    sellValue: 1550,
  },
  // --- vendor / reward weapons ---
  quays_cutlass: {
    id: 'quays_cutlass',
    name: 'Quays Cutlass',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 24, max: 38, speed: 2.4 },
    sellValue: 1150,
    buyValue: 11500,
  },
  wispcaller_staff: {
    id: 'wispcaller_staff',
    name: 'Wispcaller Staff',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 30, max: 48, speed: 2.9 },
    stats: { int: 11, sta: 6 },
    sellValue: 1500,
    buyValue: 15000,
    requiredClass: ['mage', 'priest', 'warlock', 'druid', 'shaman'],
  },
  whispersteel_stiletto: {
    id: 'whispersteel_stiletto',
    name: 'Whispersteel Stiletto',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 20, max: 33, speed: 1.8 },
    stats: { agi: 10 },
    sellValue: 1500,
    buyValue: 15000,
    requiredClass: ['rogue', 'hunter'],
  },
  // --- rare-elite / boss drops ---
  palefang_grips: {
    id: 'palefang_grips',
    name: 'Palefang Grips',
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 92, agi: 11, sta: 8 },
    sellValue: 3000,
  },
  hoarbound_bindings: {
    id: 'hoarbound_bindings',
    name: 'Hoarbound Bindings',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 55, int: 12, sta: 9 },
    sellValue: 3250,
  },
  forsworn_lamellar: {
    id: 'forsworn_lamellar',
    name: 'Forsworn Lamellar Cuirass',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 325, str: 12, sta: 11 },
    sellValue: 4000,
  },
  forsworn_edge: {
    id: 'forsworn_edge',
    name: 'Forsworn Edge',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 33, max: 53, speed: 2.5 },
    stats: { str: 10, sta: 8 },
    sellValue: 4250,
  },
};

// ---------------------------------------------------------------------------
// Static props (rendering + collision share this placement data). Nighthollow
// sits on the hub plateau; the Blackmere at (-90, 1470) stays clear.
// ---------------------------------------------------------------------------

export const VETH_PROPS: ZonePropsDef = {
  buildings: [
    { kind: 'house', x: 14, z: 1421, w: 7, d: 6, rot: -0.5 },
    { kind: 'house', x: 8, z: 1400, w: 6, d: 5, rot: 0.4 },
    { kind: 'house', x: 18, z: 1410, w: 6, d: 5, rot: 1.2 },
    { kind: 'inn', x: -15, z: 1416, w: 6, d: 7, rot: 0.6 }, // the Quiet Ledger
    { kind: 'chapel', x: -16, z: 1400, w: 5, d: 7, rot: 0.9 }, // shrine of the Agreement
  ],
  wells: [{ x: 0, z: 1412, r: 1.5 }],
  stalls: [
    { x: -7.5, z: 1417, rot: Math.PI / 2, r: 1.7 }, // Provisioner Maren
    { x: -4.5, z: 1423.5, rot: -0.6, r: 1.7 }, // Isyra Coldwater
  ],
  mines: [],
  docks: [
    // the Blackmere landing, where the black river widens into the lake
    { x: -72, z: 1462, rot: -2.2, hutLocal: { x: 2.8, z: 2.4, hw: 1.7, hd: 1.5 } },
  ],
  tents: [
    // porter camp by the Blackwater Quays
    { x: 30, z: 1372, rot: 0.5, scale: 1 },
    { x: 36, z: 1367, rot: 2.0, scale: 1 },
    // cutthroat ambush bivouac off the north towpath
    { x: -12, z: 1508, rot: 1.5, scale: 1 },
    { x: -8, z: 1514, rot: -1.0, scale: 1 },
    // the Last Lodge outbuildings
    { x: -30, z: 1630, rot: 0.8, scale: 1.2 },
    { x: -24, z: 1636, rot: -0.5, scale: 1.2 },
  ],
  crates: [
    [32, 1370],
    [-10, 1510],
    [-26, 1632],
  ],
  campfires: [
    [2, 1408],
    [33, 1369],
    [-11, 1512],
    [-27, 1634],
  ],
  mudHuts: [],
  ruinRings: [
    { x: -52, z: 1528, ringR: 7, columns: 6 }, // the Silent Court colonnade
    { x: 72, z: 1568, ringR: 6, columns: 5 }, // Frostpine Terraces, the fallen stair
    { x: -52, z: 1650, ringR: 6, columns: 5 }, // the Last Lodge boundary stones
  ],
  fences: [
    { x1: -14, z1: 1399, x2: -4, z2: 1397 }, // south gate, west run
    { x1: 4, z1: 1397, x2: 14, z2: 1399 }, // south gate, east run
  ],
  graveyards: [{ x: 18, z: 1395 }],
};
