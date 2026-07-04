// The Emberdeep Foundry, the old forge of the mountain clans, dug under the
// southwest crags of Thornpeak Heights and long cold. The Emberpact cult has
// relit it, and whatever they are forging is why the deep halls glow again.
// Drogmar's ogres did not camp at the doorstep by choice: they were driven out
// of the deep halls (which is why the war-camp squats where it does).
//
// Everything is merged into the flat engine tables by sim/data.ts, exactly the
// way temple.ts is. Levels 18-20: the pre-raid step alongside the Sanctum.

import type {
  CampDef,
  DungeonDef,
  DungeonSpawn,
  GroundObjectDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  PlayerClass,
  QuestDef,
} from '../types';

// Archetype class-locks (match content/items.ts so REWARD_ARCHETYPE hand-offs
// land on an item the whole group can equip).
const WAR: PlayerClass[] = ['warrior', 'paladin', 'shaman'];
const MAG: PlayerClass[] = ['mage', 'priest', 'warlock', 'druid'];
const ROG: PlayerClass[] = ['rogue', 'hunter'];

// The forge door opens in the crag face past Drogmar's War-Camp (-130, 740).
export const FOUNDRY_DOOR_POS = { x: -150, z: 770 };

// ---------------------------------------------------------------------------
// Mobs, overworld (the Emberpact siege line outside the door)
// ---------------------------------------------------------------------------

export const FOUNDRY_MOBS: Record<string, MobTemplate> = {
  emberpact_zealot: {
    id: 'emberpact_zealot',
    name: 'Emberpact Zealot',
    minLevel: 18,
    maxLevel: 19,
    family: 'humanoid',
    hpBase: 84,
    hpPerLevel: 24,
    dmgBase: 12,
    dmgPerLevel: 2.7,
    attackSpeed: 2.0,
    armorPerLevel: 18,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [
      { copper: 120, chance: 1 },
      { itemId: 'emberpact_sigil', chance: 0.6, questId: 'q_foundry_sigils' },
      { itemId: 'cult_brand', chance: 0.3 },
    ],
    scale: 1.0,
    color: 0xb4552e,
  },
  cinderhound: {
    id: 'cinderhound',
    name: 'Cinderhound',
    minLevel: 18,
    maxLevel: 19,
    family: 'beast',
    hpBase: 78,
    hpPerLevel: 23,
    dmgBase: 12,
    dmgPerLevel: 2.7,
    attackSpeed: 1.8,
    armorPerLevel: 14,
    moveSpeed: 8.5,
    aggroRadius: 13,
    loot: [
      { copper: 100, chance: 1 },
      { itemId: 'slag_heart', chance: 0.55, questId: 'q_foundry_hounds' },
      { itemId: 'ember_grit', chance: 0.35 },
    ],
    scale: 1.1,
    color: 0xc9662f,
    componentTags: ['hide', 'claw'],
  },
  ashmaw_kilnborn: {
    id: 'ashmaw_kilnborn',
    name: 'Ashmaw the Kilnborn',
    minLevel: 19,
    maxLevel: 19,
    family: 'elemental',
    rare: true,
    hpBase: 210,
    hpPerLevel: 30,
    dmgBase: 14,
    dmgPerLevel: 2.9,
    attackSpeed: 2.2,
    armorPerLevel: 24,
    moveSpeed: 7.5,
    aggroRadius: 12,
    loot: [
      { copper: 700, chance: 1 },
      { itemId: 'kilnborn_core', chance: 1, questId: 'q_foundry_ashmaw' },
      { itemId: 'slag_chunk', chance: 1 },
      { itemId: 'ember_grit', chance: 0.5 },
    ],
    scale: 1.25,
    color: 0xe07a30,
  },
};

// ---------------------------------------------------------------------------
// Mobs, instanced (the Emberdeep Foundry, 5-player elite, 18-20)
// ---------------------------------------------------------------------------

export const FOUNDRY_DUNGEON_MOBS: Record<string, MobTemplate> = {
  emberpact_cinderpriest: {
    id: 'emberpact_cinderpriest',
    name: 'Emberpact Cinderpriest',
    minLevel: 18,
    maxLevel: 19,
    family: 'humanoid',
    elite: true,
    hpBase: 60,
    hpPerLevel: 23,
    dmgBase: 12,
    dmgPerLevel: 2.8,
    attackSpeed: 2.0,
    armorPerLevel: 17,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [
      { copper: 280, chance: 1 },
      { itemId: 'cult_brand', chance: 0.4 },
      { itemId: 'ember_grit', chance: 0.4 },
    ],
    scale: 1.0,
    color: 0xd06a2a,
  },
  emberpact_kiln_acolyte: {
    id: 'emberpact_kiln_acolyte',
    name: 'Emberpact Kiln Acolyte',
    minLevel: 18,
    maxLevel: 19,
    family: 'humanoid',
    elite: true,
    hpBase: 58,
    hpPerLevel: 22,
    dmgBase: 12,
    dmgPerLevel: 2.7,
    attackSpeed: 2.1,
    armorPerLevel: 16,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [
      { copper: 260, chance: 1 },
      { itemId: 'cult_brand', chance: 0.35 },
      { itemId: 'slag_chunk', chance: 0.3 },
    ],
    scale: 1.0,
    color: 0xb85a30,
  },
  slag_hound: {
    id: 'slag_hound',
    name: 'Slag Hound',
    minLevel: 18,
    maxLevel: 19,
    family: 'beast',
    elite: true,
    hpBase: 60,
    hpPerLevel: 22,
    dmgBase: 12,
    dmgPerLevel: 2.8,
    attackSpeed: 1.8,
    armorPerLevel: 15,
    moveSpeed: 8.5,
    aggroRadius: 13,
    loot: [
      { copper: 240, chance: 1 },
      { itemId: 'slag_chunk', chance: 0.5 },
      { itemId: 'ember_grit', chance: 0.35 },
    ],
    scale: 1.15,
    color: 0x8a4a28,
    componentTags: ['hide', 'claw'],
  },
  ash_revenant: {
    id: 'ash_revenant',
    name: 'Ash Revenant',
    minLevel: 19,
    maxLevel: 20,
    family: 'undead',
    elite: true,
    hpBase: 62,
    hpPerLevel: 23,
    dmgBase: 12,
    dmgPerLevel: 2.8,
    attackSpeed: 2.2,
    armorPerLevel: 18,
    moveSpeed: 6.5,
    aggroRadius: 12,
    loot: [
      { copper: 300, chance: 1 },
      { itemId: 'ember_grit', chance: 0.5 },
      { itemId: 'cult_brand', chance: 0.3 },
    ],
    scale: 1.05,
    color: 0x9a9088,
  },
  emberbound_custodian: {
    id: 'emberbound_custodian',
    name: 'Emberbound Custodian',
    minLevel: 19,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 68,
    hpPerLevel: 24,
    dmgBase: 13,
    dmgPerLevel: 2.8,
    attackSpeed: 2.3,
    armorPerLevel: 23,
    moveSpeed: 6.5,
    aggroRadius: 12,
    loot: [
      { copper: 320, chance: 1 },
      { itemId: 'slag_chunk', chance: 0.6 },
      { itemId: 'ember_grit', chance: 0.4 },
    ],
    scale: 1.2,
    color: 0xd88a3a,
  },
  forgeguard_sentinel: {
    id: 'forgeguard_sentinel',
    name: 'Forgeguard Sentinel',
    minLevel: 19,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 70,
    hpPerLevel: 25,
    dmgBase: 13,
    dmgPerLevel: 2.9,
    attackSpeed: 2.4,
    armorPerLevel: 25,
    moveSpeed: 6,
    aggroRadius: 12,
    loot: [
      { copper: 340, chance: 1 },
      { itemId: 'slag_chunk', chance: 0.6 },
      { itemId: 'cult_brand', chance: 0.3 },
    ],
    scale: 1.25,
    color: 0xc27a2e,
  },
  molten_crucible_tender: {
    id: 'molten_crucible_tender',
    name: 'Molten Crucible-Tender',
    minLevel: 19,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 64,
    hpPerLevel: 23,
    dmgBase: 13,
    dmgPerLevel: 2.9,
    attackSpeed: 2.0,
    armorPerLevel: 19,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [
      { copper: 320, chance: 1 },
      { itemId: 'ember_grit', chance: 0.5 },
      { itemId: 'slag_chunk', chance: 0.4 },
    ],
    scale: 1.1,
    color: 0xe6923c,
  },
  cinder_wisp: {
    id: 'cinder_wisp',
    name: 'Cinder Wisp',
    minLevel: 19,
    maxLevel: 19,
    family: 'elemental',
    hpBase: 50,
    hpPerLevel: 16,
    dmgBase: 9,
    dmgPerLevel: 2.2,
    attackSpeed: 1.9,
    armorPerLevel: 10,
    moveSpeed: 8,
    aggroRadius: 12,
    loot: [], // summoned by Kilnmaster Vorr, nothing to loot
    scale: 0.85,
    color: 0xffb066,
  },
  kilnmaster_vorr: {
    id: 'kilnmaster_vorr',
    name: 'Kilnmaster Vorr',
    minLevel: 20,
    maxLevel: 20,
    family: 'humanoid',
    elite: true,
    hpBase: 170,
    hpPerLevel: 28,
    dmgBase: 13,
    dmgPerLevel: 2.8,
    attackSpeed: 2.2,
    armorPerLevel: 23,
    moveSpeed: 7,
    aggroRadius: 14,
    summonAdds: { mobId: 'cinder_wisp', count: 2, atHpPct: [0.65, 0.35] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.3, hasteMult: 1.25 },
    loot: [
      { copper: 900, chance: 1 },
      { itemId: 'vorrs_kilnplates', chance: 0.4 },
      { itemId: 'cult_brand', chance: 0.5 },
    ],
    scale: 1.2,
    color: 0xa44a20,
  },
  slagheart_colossus: {
    id: 'slagheart_colossus',
    name: 'The Slagheart Colossus',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    boss: true,
    hpBase: 330,
    hpPerLevel: 40,
    dmgBase: 15,
    dmgPerLevel: 3.0,
    attackSpeed: 2.6,
    armorPerLevel: 30,
    moveSpeed: 6.5,
    aggroRadius: 18,
    aoePulse: { min: 26, max: 38, radius: 13, every: 9, name: 'Slag Eruption' },
    enrage: { belowHpPct: 0.25, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 8000, chance: 1 },
      { itemId: 'slagforged_legguards', chance: 0.5 },
      // exclusive "one of three" epic helms (weights sum to 1.0)
      { itemId: 'forgelord_warhelm', chance: 0.34, rollGroup: 'slagheart_epic' },
      { itemId: 'emberweave_cowl', chance: 0.33, rollGroup: 'slagheart_epic' },
      { itemId: 'slagstalker_hood', chance: 0.33, rollGroup: 'slagheart_epic' },
    ],
    scale: 1.75,
    color: 0xe0802e,
  },
};

// ---------------------------------------------------------------------------
// NPC, Forgewright Brenna keeps the old forge records in Highwatch
// ---------------------------------------------------------------------------

export const FOUNDRY_NPCS: Record<string, NpcDef> = {
  forgewright_brenna: {
    id: 'forgewright_brenna',
    name: 'Brenna Coalwright',
    title: 'Forgewright',
    pos: { x: 20, z: 668 },
    facing: -1.5,
    color: 0xb4642e,
    questIds: [
      'q_foundry_smoke',
      'q_foundry_pickets',
      'q_foundry_hounds',
      'q_foundry_sigils',
      'q_foundry_ashmaw',
      'q_foundry_kilnmaster',
      'q_foundry_slagheart',
    ],
    greeting:
      'Smoke over the southwest crags, $C. My grandmother banked that forge herself and swore it cold. Cold forges do not smoke.',
  },
};

// ---------------------------------------------------------------------------
// Quests, a soloable siege-line lead-up, then a 5-player descent
// ---------------------------------------------------------------------------

export const FOUNDRY_QUESTS: Record<string, QuestDef> = {
  q_foundry_smoke: {
    id: 'q_foundry_smoke',
    name: 'Smoke Over the Crags',
    giverNpcId: 'forgewright_brenna',
    turnInNpcId: 'forgewright_brenna',
    text: "The Emberdeep was OUR forge, $N, before the clans buried it and swore it cold. Now it smokes again, and Drogmar's ogres sit outside it like whipped dogs. Something drove them OUT. Go to the siege line past the war-camp and bring me one of the dispatches the cultists nail to their posts. I would know who relit my grandmother's fire.",
    completionText:
      '"The Emberpact." A cult that prays to a banked coal. And this seal at the bottom, $N: the old forgemark of the Emberdeep itself. They are not squatting in the forge. They are RUNNING it.',
    objectives: [
      { type: 'collect', itemId: 'warcamp_dispatch', count: 1, label: 'Emberpact Dispatch taken' },
    ],
    xpReward: 5200,
    copperReward: 2600,
    itemRewards: {},
    minLevel: 18,
  },
  q_foundry_pickets: {
    id: 'q_foundry_pickets',
    name: 'Thin the Siege Line',
    giverNpcId: 'forgewright_brenna',
    turnInNpcId: 'forgewright_brenna',
    text: 'The Emberpact holds the crag approach with zealot pickets, and while they stand no one reaches the forge door. They drove out ogres, $N. OGRES. Cull ten zealots and the line breaks.',
    completionText:
      'Ten fewer voices praying at the coal. The pickets are thinning, and the door is almost in reach.',
    objectives: [
      { type: 'kill', targetMobId: 'emberpact_zealot', count: 10, label: 'Emberpact Zealot slain' },
    ],
    xpReward: 5400,
    copperReward: 2800,
    itemRewards: {},
    requiresQuest: 'q_foundry_smoke',
  },
  q_foundry_hounds: {
    id: 'q_foundry_hounds',
    name: 'Hounds of the Kiln',
    giverNpcId: 'forgewright_brenna',
    turnInNpcId: 'forgewright_brenna',
    text: 'The cult runs hounds along the crag paths, beasts with slag cooling in their hides. Kill eight, and cut out six of the slag hearts that beat in them. If the forge is hot enough to birth THOSE, it is hotter than my grandmother ever dared run it.',
    completionText:
      'Still warm. $N, a slag heart holds forge-heat for a day at most. The Emberdeep is not just lit. It is roaring.',
    objectives: [
      { type: 'kill', targetMobId: 'cinderhound', count: 8, label: 'Cinderhound put down' },
      { type: 'collect', itemId: 'slag_heart', count: 6, label: 'Slag Heart' },
    ],
    xpReward: 5600,
    copperReward: 3000,
    itemRewards: {},
    requiresQuest: 'q_foundry_pickets',
  },
  q_foundry_sigils: {
    id: 'q_foundry_sigils',
    name: 'The Emberpact Sigils',
    giverNpcId: 'forgewright_brenna',
    turnInNpcId: 'forgewright_brenna',
    text: 'Every zealot on that line carries a fired-clay sigil, their key past the door wards. Bring me six. I can read the firing marks, and the marks will tell me how many crucibles they have running.',
    completionText:
      'Six sigils, six different crucible marks. $N, the Emberdeep has SEVEN crucibles. They are running the full forge, and the seventh mark belongs to the great crucible: the Slagheart.',
    objectives: [
      { type: 'collect', itemId: 'emberpact_sigil', count: 6, label: 'Emberpact Sigil' },
    ],
    xpReward: 5600,
    copperReward: 3000,
    itemRewards: {},
    requiresQuest: 'q_foundry_pickets',
  },
  q_foundry_ashmaw: {
    id: 'q_foundry_ashmaw',
    name: 'Ashmaw the Kilnborn',
    giverNpcId: 'forgewright_brenna',
    turnInNpcId: 'forgewright_brenna',
    text: 'One thing on that line is no cultist and no hound. A shape of cooling slag walks the high path, the first thing the relit forge ever poured, and the pickets follow it like a banner. Kill Ashmaw the Kilnborn and bring me its core, $N. While it walks, the line will always reform.',
    completionText:
      'The core still glows. Poured slag should not LIVE, $N. Whoever tends that forge has learned something the clans buried on purpose.',
    objectives: [{ type: 'collect', itemId: 'kilnborn_core', count: 1, label: "Ashmaw's Core" }],
    xpReward: 5800,
    copperReward: 3200,
    itemRewards: {
      warrior: 'forgehand_gauntlets',
      mage: 'forgehand_handwraps',
      rogue: 'forgehand_grips',
    },
    requiresQuest: 'q_foundry_hounds',
    minLevel: 19,
  },
  q_foundry_kilnmaster: {
    id: 'q_foundry_kilnmaster',
    name: 'The Kilnmaster',
    giverNpcId: 'forgewright_brenna',
    turnInNpcId: 'forgewright_brenna',
    text: 'The sigils name their master: Kilnmaster Vorr, who found the Emberdeep cold and taught the coal to pray back. He holds the casting halls past the assembly floor. Take companions through the door and end him, $N. This is no errand for a lone blade.',
    completionText:
      'Vorr is ash in his own halls. But the firing marks on his robes... he was not the forgemaster, $N. He was the BELLOWS. Something deeper is still drawing breath.',
    objectives: [
      { type: 'kill', targetMobId: 'kilnmaster_vorr', count: 1, label: 'Kilnmaster Vorr slain' },
    ],
    xpReward: 6000,
    copperReward: 4000,
    itemRewards: {
      warrior: 'emberstep_warboots',
      mage: 'emberstep_slippers',
      rogue: 'emberstep_treads',
    },
    requiresQuest: 'q_foundry_sigils',
    minLevel: 19,
    suggestedPlayers: 5,
  },
  q_foundry_slagheart: {
    id: 'q_foundry_slagheart',
    name: 'The Slagheart Colossus',
    giverNpcId: 'forgewright_brenna',
    turnInNpcId: 'forgewright_brenna',
    text: 'I read the last of the firing marks, $N, and I finally understand what the Emberpact is forging: nothing. The forge is forging ITSELF a body. The great crucible has been pouring one casting for a season, and it stands now on the anvil dais at the forge heart, waiting for its final quench. When it steps off that dais, the mountain loses whatever war comes next. Gather the strongest you can find and shatter the Slagheart Colossus before it wakes fully.',
    completionText:
      'Cold at last, and this time it will STAY cold: I will bank that forge myself, the way my grandmother taught me. The mountain will never know what almost walked out from under it, $N. But I will. And so will you.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'slagheart_colossus',
        count: 1,
        label: 'The Slagheart Colossus shattered',
      },
    ],
    xpReward: 6400,
    copperReward: 15000,
    itemRewards: {
      warrior: 'slagrend_cleaver',
      mage: 'slagfire_scepter',
      rogue: 'slagglass_shiv',
    },
    requiresQuest: 'q_foundry_kilnmaster',
    minLevel: 19,
    suggestedPlayers: 5,
  },
};

export const FOUNDRY_QUEST_ORDER = [
  'q_foundry_smoke',
  'q_foundry_pickets',
  'q_foundry_hounds',
  'q_foundry_sigils',
  'q_foundry_ashmaw',
  'q_foundry_kilnmaster',
  'q_foundry_slagheart',
];

// ---------------------------------------------------------------------------
// World layout, the Emberpact siege line outside the door
// ---------------------------------------------------------------------------

export const FOUNDRY_CAMPS: CampDef[] = [
  { mobId: 'emberpact_zealot', center: { x: -138, z: 762 }, radius: 14, count: 6 },
  { mobId: 'emberpact_zealot', center: { x: -152, z: 784 }, radius: 14, count: 6 },
  { mobId: 'cinderhound', center: { x: -162, z: 758 }, radius: 12, count: 5 },
  { mobId: 'cinderhound', center: { x: -144, z: 776 }, radius: 10, count: 4 },
  { mobId: 'ashmaw_kilnborn', center: { x: -166, z: 788 }, radius: 3, count: 1 },
];

export const FOUNDRY_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'warcamp_dispatch',
    name: 'Emberpact Picket Post',
    positions: [
      { x: -140, z: 758 },
      { x: -148, z: 766 },
      { x: -156, z: 776 },
      { x: -144, z: 782 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const FOUNDRY_ITEMS: Record<string, ItemDef> = {
  // --- quest items ---
  warcamp_dispatch: {
    id: 'warcamp_dispatch',
    name: 'Emberpact Dispatch',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_foundry_smoke',
  },
  slag_heart: {
    id: 'slag_heart',
    name: 'Slag Heart',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_foundry_hounds',
  },
  emberpact_sigil: {
    id: 'emberpact_sigil',
    name: 'Emberpact Sigil',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_foundry_sigils',
  },
  kilnborn_core: {
    id: 'kilnborn_core',
    name: "Ashmaw's Core",
    kind: 'quest',
    sellValue: 0,
    questId: 'q_foundry_ashmaw',
  },

  // --- quest blues (rare), endgame band ---
  forgehand_gauntlets: {
    id: 'forgehand_gauntlets',
    name: 'Forgehand Gauntlets',
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 105, sta: 5, str: 3 },
    sellValue: 1600,
    requiredClass: WAR,
  },
  forgehand_handwraps: {
    id: 'forgehand_handwraps',
    name: 'Forgehand Handwraps',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 40, int: 6, spi: 3 },
    sellValue: 1600,
    requiredClass: MAG,
  },
  forgehand_grips: {
    id: 'forgehand_grips',
    name: 'Forgehand Grips',
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 72, agi: 7, sta: 2 },
    sellValue: 1600,
    requiredClass: ROG,
  },
  emberstep_warboots: {
    id: 'emberstep_warboots',
    name: 'Emberstep Warboots',
    kind: 'armor',
    armorType: 'mail',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 100, sta: 5, str: 3 },
    sellValue: 1800,
    requiredClass: WAR,
  },
  emberstep_slippers: {
    id: 'emberstep_slippers',
    name: 'Emberstep Slippers',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 38, int: 6, spi: 3 },
    sellValue: 1800,
    requiredClass: MAG,
  },
  emberstep_treads: {
    id: 'emberstep_treads',
    name: 'Emberstep Treads',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 68, agi: 7, sta: 2 },
    sellValue: 1800,
    requiredClass: ROG,
  },
  slagrend_cleaver: {
    id: 'slagrend_cleaver',
    name: 'Slagrend Cleaver',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 26, max: 42, speed: 2.6 },
    stats: { str: 9, sta: 5 },
    sellValue: 2600,
    requiredClass: WAR,
  },
  slagfire_scepter: {
    id: 'slagfire_scepter',
    name: 'Slagfire Scepter',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 28, max: 46, speed: 3.0 },
    stats: { int: 11, spi: 5 },
    sellValue: 2600,
    requiredClass: MAG,
  },
  slagglass_shiv: {
    id: 'slagglass_shiv',
    name: 'Slagglass Shiv',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 17, max: 27, speed: 1.7, dagger: true },
    stats: { agi: 10, sta: 3 },
    sellValue: 2600,
    requiredClass: ROG,
  },

  // --- dungeon drops ---
  vorrs_kilnplates: {
    id: 'vorrs_kilnplates',
    name: "Vorr's Kilnplates",
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 210, sta: 7, str: 4 },
    sellValue: 2500,
  },
  slagforged_legguards: {
    id: 'slagforged_legguards',
    name: 'Slagforged Legguards',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'rare',
    stats: { armor: 140, sta: 7, spi: 3 },
    sellValue: 2200,
  },
  // pre-raid best: exclusive one-of-three epic helms off the Colossus
  // (budget mirrors the T1 epics in zone3.ts scaled chest-to-head ~0.85x)
  forgelord_warhelm: {
    id: 'forgelord_warhelm',
    name: 'Forgelord Warhelm',
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'epic',
    stats: { armor: 230, str: 7, sta: 9 },
    sellValue: 9000,
    requiredClass: WAR,
  },
  emberweave_cowl: {
    id: 'emberweave_cowl',
    name: 'Emberweave Cowl',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'epic',
    stats: { armor: 78, int: 10, spi: 6 },
    sellValue: 9000,
    requiredClass: MAG,
  },
  slagstalker_hood: {
    id: 'slagstalker_hood',
    name: 'Slagstalker Hood',
    kind: 'armor',
    armorType: 'leather',
    slot: 'helmet',
    quality: 'epic',
    stats: { armor: 145, agi: 10, sta: 5 },
    sellValue: 9000,
    requiredClass: ROG,
  },

  // --- junk (gray) ---
  slag_chunk: {
    id: 'slag_chunk',
    name: 'Slag Chunk',
    kind: 'junk',
    quality: 'poor',
    sellValue: 30,
  },
  ember_grit: {
    id: 'ember_grit',
    name: 'Ember Grit',
    kind: 'junk',
    quality: 'poor',
    sellValue: 26,
  },
  cult_brand: {
    id: 'cult_brand',
    name: 'Emberpact Brand',
    kind: 'junk',
    quality: 'poor',
    sellValue: 34,
  },
};

// ---------------------------------------------------------------------------
// The Emberdeep Foundry instance: elite packs across the assembly hall,
// Kilnmaster Vorr holding the far casting halls, then the Slagheart Colossus
// waiting on the anvil dais with two forgeguards.
// ---------------------------------------------------------------------------

const FOUNDRY_SPAWN_LIST: DungeonSpawn[] = [
  // assembly hall (z 0-48)
  { mobId: 'slag_hound', x: -3, z: 14 },
  { mobId: 'slag_hound', x: 3, z: 15 },
  { mobId: 'emberpact_kiln_acolyte', x: -9, z: 28 },
  { mobId: 'emberpact_cinderpriest', x: -5, z: 29 },
  { mobId: 'forgeguard_sentinel', x: 9, z: 40 },
  { mobId: 'slag_hound', x: 5, z: 41 },
  // casting halls (past the waist at z 48)
  { mobId: 'emberbound_custodian', x: -5, z: 56 },
  { mobId: 'emberpact_kiln_acolyte', x: -1, z: 57 },
  { mobId: 'ash_revenant', x: 9, z: 66 },
  { mobId: 'slag_hound', x: -7, z: 67 },
  { mobId: 'emberpact_cinderpriest', x: 6, z: 76 },
  { mobId: 'molten_crucible_tender', x: 0, z: 77 },
  { mobId: 'kilnmaster_vorr', x: -2, z: 86 },
  { mobId: 'emberpact_kiln_acolyte', x: 4, z: 87 },
  // the forge heart (past the waist at z 96)
  { mobId: 'forgeguard_sentinel', x: -6, z: 102 },
  { mobId: 'emberbound_custodian', x: 4, z: 103 },
  { mobId: 'molten_crucible_tender', x: -4, z: 110 },
  { mobId: 'ash_revenant', x: 6, z: 111 },
  { mobId: 'slagheart_colossus', x: 0, z: 116 },
  { mobId: 'forgeguard_sentinel', x: -5, z: 113 },
  { mobId: 'forgeguard_sentinel', x: 5, z: 113 },
];

export const FOUNDRY_DUNGEON_DEFS: Record<string, DungeonDef> = {
  emberdeep_foundry: {
    id: 'emberdeep_foundry',
    name: 'The Emberdeep Foundry',
    index: 6, // instance origin x = 900 + 6*600 = 4500 (4 and 5 are the raid wings)
    doorPos: { ...FOUNDRY_DOOR_POS },
    entry: { x: 0, z: 4 },
    exitOffset: { x: 0, z: -6 },
    spawns: FOUNDRY_SPAWN_LIST,
    interior: 'foundry',
    suggestedPlayers: 5,
    enterText:
      'You step through the forge door. The mountain closes overhead, and the heat of the relit Emberdeep rolls up the passage to meet you.',
    leaveText: 'You step out of the forge door into the cold of the crags.',
  },
};
