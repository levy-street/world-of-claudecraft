import type {
  CampDef,
  DungeonDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  QuestDef,
  ZoneDef,
  ZonePropsDef,
} from '../types';
import { emptyZoneProps } from '../types';

export const ROTMIRE_ZONE: ZoneDef = {
  id: 'rotmire_expanse',
  name: 'The Rotmire Expanse',
  zMin: 2420,
  zMax: 2760,
  levelRange: [20, 27],
  biome: 'marsh',
  hub: { x: 0, z: 2470, radius: 22, name: 'Wakefort' },
  graveyard: { x: -18, z: 2490 },
  lakes: [{ x: 92, z: 2620, radius: 18 }],
  pois: [
    { x: 0, z: 2470, label: 'Wakefort', id: 'wakefort' },
    { x: -92, z: 2580, label: 'The Carrion Gardens', id: 'carrion_gardens' },
    { x: 98, z: 2680, label: 'Sporefall Basin', id: 'sporefall_basin' },
  ],
  welcome:
    'The dead feed a bloom that should never have taken root. Wakefort holds the last dry road north.',
  welcomeQuestId: 'q_ab_01_wakefort',
};

export const PETRIFIED_MARCH_ZONE: ZoneDef = {
  id: 'petrified_march',
  name: 'The Petrified March',
  zMin: 2760,
  zMax: 3100,
  levelRange: [27, 34],
  biome: 'amber',
  hub: { x: 8, z: 2810, radius: 22, name: 'Cairnwall' },
  graveyard: { x: -12, z: 2830 },
  lakes: [],
  pois: [
    { x: 8, z: 2810, label: 'Cairnwall', id: 'cairnwall' },
    { x: -105, z: 2920, label: 'The Stone Host', id: 'stone_host' },
    { x: 102, z: 3020, label: 'Rootscar Front', id: 'rootscar_front' },
  ],
  welcome:
    'A royal army stands petrified mid-charge, and something beneath the road has begun calling their names.',
  welcomeQuestId: 'q_ab_05_cairnwall',
};

export const CROWNROOT_ZONE: ZoneDef = {
  id: 'crownroot_wilds',
  name: 'The Crownroot Wilds',
  zMin: 3100,
  zMax: 3440,
  levelRange: [34, 40],
  biome: 'frost',
  hub: { x: 0, z: 3150, radius: 22, name: 'Lastbough' },
  graveyard: { x: -20, z: 3170 },
  lakes: [{ x: -100, z: 3300, radius: 14 }],
  pois: [
    { x: 0, z: 3150, label: 'Lastbough', id: 'lastbough' },
    { x: 110, z: 3260, label: 'The Ashen Canopy', id: 'ashen_canopy' },
    { x: 0, z: 3400, label: 'Sepulcher Approach', id: 'sepulcher_approach' },
  ],
  welcome:
    'Frost grips a forest growing from a buried crown. Beyond Lastbough, every root points toward the Sepulcher.',
  welcomeQuestId: 'q_ab_09_lastbough',
};

function mob(
  id: string,
  name: string,
  minLevel: number,
  maxLevel: number,
  family: MobTemplate['family'],
  color: number,
  elite = false,
): MobTemplate {
  return {
    id,
    name,
    minLevel,
    maxLevel,
    family,
    hpBase: 70 + minLevel * 10,
    hpPerLevel: elite ? 42 : 24,
    dmgBase: 12 + minLevel * 1.2,
    dmgPerLevel: elite ? 4.2 : 2.8,
    attackSpeed: 2,
    armorPerLevel: elite ? 18 : 12,
    moveSpeed: 8,
    aggroRadius: 14,
    loot: [{ copper: minLevel * 8, chance: 1 }],
    scale: elite ? 1.4 : 1,
    color,
    elite,
  };
}

export const ASHEN_BLOOM_MOBS: Record<string, MobTemplate> = {
  rotmire_husk: mob('rotmire_husk', 'Rotmire Husk', 20, 23, 'undead', 0x6c7650),
  carrion_bloom: mob('carrion_bloom', 'Carrion Bloom', 22, 25, 'burrower', 0x8f4567),
  sporebound_brute: mob('sporebound_brute', 'Sporebound Brute', 24, 27, 'ogre', 0x76516f),
  mother_morva: mob('mother_morva', 'Mother Morva', 27, 27, 'undead', 0xa04673, true),
  stone_legionary: mob('stone_legionary', 'Stone Legionary', 27, 30, 'humanoid', 0x8a8173),
  crownless_knight: mob('crownless_knight', 'Crownless Knight', 29, 32, 'undead', 0x5e6370),
  rootscar_widow: mob('rootscar_widow', 'Rootscar Widow', 31, 34, 'spider', 0x573b42),
  marshal_veyr: mob('marshal_veyr', 'Marshal Veyr', 34, 34, 'humanoid', 0xb49a72, true),
  frostroot_stalker: mob('frostroot_stalker', 'Frostroot Stalker', 34, 37, 'beast', 0x78919b),
  ashen_dryad: mob('ashen_dryad', 'Ashen Dryad', 36, 39, 'humanoid', 0x726b8d),
  sepulcher_guardian: mob(
    'sepulcher_guardian',
    'Sepulcher Guardian',
    38,
    40,
    'elemental',
    0x49515d,
  ),
  the_hollow_crown: mob('the_hollow_crown', 'The Hollow Crown', 40, 40, 'undead', 0xc4a15b, true),
};

export const ASHEN_BLOOM_NPCS: Record<string, NpcDef> = {
  mortician_ella: {
    id: 'mortician_ella',
    name: 'Mortician Ella',
    title: 'Keeper of Wakefort',
    pos: { x: 0, z: 2470 },
    facing: 0,
    color: 0x725c68,
    greeting: 'The graves are empty, $C. Help me learn what the bloom has taken from them.',
    questIds: ['q_ab_01_wakefort', 'q_ab_02_carrion', 'q_ab_03_sporefall', 'q_ab_04_morva'],
  },
  captain_orren: {
    id: 'captain_orren',
    name: 'Captain Orren',
    title: 'Cairnwall Commander',
    pos: { x: 8, z: 2810 },
    facing: 0,
    color: 0x776b5e,
    greeting:
      'The stone host remembers its last command. We must reach the Crownroot before it marches.',
    questIds: ['q_ab_05_cairnwall', 'q_ab_06_stone_host', 'q_ab_07_rootscar', 'q_ab_08_veyr'],
  },
  sister_briar: {
    id: 'sister_briar',
    name: 'Sister Briar',
    title: 'Warden of Lastbough',
    pos: { x: 0, z: 3150 },
    facing: 0,
    color: 0x5f7959,
    greeting: 'Every living root is pointing toward the Sepulcher. Walk carefully, $C.',
    questIds: ['q_ab_09_lastbough', 'q_ab_10_canopy', 'q_ab_11_guardians', 'q_ab_12_crown'],
  },
};

function killQuest(
  id: string,
  name: string,
  giverNpcId: string,
  targetMobId: string,
  count: number,
  minLevel: number,
  xpReward: number,
  requiresQuest?: string,
): QuestDef {
  return {
    id,
    name,
    giverNpcId,
    turnInNpcId: giverNpcId,
    text: `Defeat ${count} ${ASHEN_BLOOM_MOBS[targetMobId].name}.`,
    completionText: 'The road is safer, but the bloom still grows.',
    objectives: [
      { type: 'kill', targetMobId, count, label: `${ASHEN_BLOOM_MOBS[targetMobId].name} slain` },
    ],
    xpReward,
    copperReward: minLevel * 100,
    itemRewards: {},
    minLevel,
    requiresQuest,
  };
}

export const ASHEN_BLOOM_QUESTS: Record<string, QuestDef> = {
  q_ab_01_wakefort: killQuest(
    'q_ab_01_wakefort',
    'Wake the Fort',
    'mortician_ella',
    'rotmire_husk',
    8,
    20,
    16000,
  ),
  q_ab_02_carrion: killQuest(
    'q_ab_02_carrion',
    'The Carrion Gardens',
    'mortician_ella',
    'carrion_bloom',
    8,
    22,
    19000,
    'q_ab_01_wakefort',
  ),
  q_ab_03_sporefall: killQuest(
    'q_ab_03_sporefall',
    'Sporefall',
    'mortician_ella',
    'sporebound_brute',
    6,
    24,
    23000,
    'q_ab_02_carrion',
  ),
  q_ab_04_morva: killQuest(
    'q_ab_04_morva',
    'Mother of the Bloom',
    'mortician_ella',
    'mother_morva',
    1,
    26,
    30000,
    'q_ab_03_sporefall',
  ),
  q_ab_05_cairnwall: killQuest(
    'q_ab_05_cairnwall',
    'The Silent March',
    'captain_orren',
    'stone_legionary',
    8,
    27,
    34000,
    'q_ab_04_morva',
  ),
  q_ab_06_stone_host: killQuest(
    'q_ab_06_stone_host',
    'Crownless',
    'captain_orren',
    'crownless_knight',
    8,
    29,
    39000,
    'q_ab_05_cairnwall',
  ),
  q_ab_07_rootscar: killQuest(
    'q_ab_07_rootscar',
    'Webs in the Scar',
    'captain_orren',
    'rootscar_widow',
    8,
    31,
    45000,
    'q_ab_06_stone_host',
  ),
  q_ab_08_veyr: killQuest(
    'q_ab_08_veyr',
    'The Last Marshal',
    'captain_orren',
    'marshal_veyr',
    1,
    33,
    54000,
    'q_ab_07_rootscar',
  ),
  q_ab_09_lastbough: killQuest(
    'q_ab_09_lastbough',
    'Under the Last Bough',
    'sister_briar',
    'frostroot_stalker',
    8,
    34,
    61000,
    'q_ab_08_veyr',
  ),
  q_ab_10_canopy: killQuest(
    'q_ab_10_canopy',
    'Ash in the Canopy',
    'sister_briar',
    'ashen_dryad',
    8,
    36,
    70000,
    'q_ab_09_lastbough',
  ),
  q_ab_11_guardians: killQuest(
    'q_ab_11_guardians',
    'The Sepulcher Guard',
    'sister_briar',
    'sepulcher_guardian',
    8,
    38,
    82000,
    'q_ab_10_canopy',
  ),
  q_ab_12_crown: killQuest(
    'q_ab_12_crown',
    'Break the Hollow Crown',
    'sister_briar',
    'the_hollow_crown',
    1,
    40,
    100000,
    'q_ab_11_guardians',
  ),
};

export const ASHEN_BLOOM_QUEST_ORDER = Object.keys(ASHEN_BLOOM_QUESTS);

export const ASHEN_BLOOM_CAMPS: CampDef[] = [
  { mobId: 'rotmire_husk', center: { x: -70, z: 2520 }, radius: 28, count: 8, offStream: true },
  { mobId: 'carrion_bloom', center: { x: -95, z: 2600 }, radius: 26, count: 8, offStream: true },
  { mobId: 'sporebound_brute', center: { x: 85, z: 2680 }, radius: 30, count: 6, offStream: true },
  { mobId: 'mother_morva', center: { x: 120, z: 2720 }, radius: 4, count: 1, offStream: true },
  { mobId: 'stone_legionary', center: { x: -80, z: 2860 }, radius: 28, count: 8, offStream: true },
  { mobId: 'crownless_knight', center: { x: -105, z: 2940 }, radius: 28, count: 8, offStream: true },
  { mobId: 'rootscar_widow', center: { x: 100, z: 3020 }, radius: 28, count: 8, offStream: true },
  { mobId: 'marshal_veyr', center: { x: 0, z: 3070 }, radius: 4, count: 1, offStream: true },
  { mobId: 'frostroot_stalker', center: { x: -80, z: 3200 }, radius: 28, count: 8, offStream: true },
  { mobId: 'ashen_dryad', center: { x: 105, z: 3280 }, radius: 28, count: 8, offStream: true },
  { mobId: 'sepulcher_guardian', center: { x: 0, z: 3370 }, radius: 30, count: 8, offStream: true },
  { mobId: 'the_hollow_crown', center: { x: 0, z: 3410 }, radius: 4, count: 1, offStream: true },
];

export const ASHEN_BLOOM_ROADS = [
  [
    { x: 0, z: 2420 },
    { x: 0, z: 2470 },
    { x: 0, z: 2760 },
    { x: 8, z: 2810 },
  ],
  [
    { x: 8, z: 2810 },
    { x: 0, z: 3100 },
    { x: 0, z: 3150 },
    { x: 0, z: 3440 },
  ],
];

export const ASHEN_BLOOM_PROPS: ZonePropsDef = emptyZoneProps();

export const ASHEN_BLOOM_INSTANCE_MOBS: Record<string, MobTemplate> = {
  rotchapel_cultist: mob(
    'rotchapel_cultist',
    'Rotchapel Cultist',
    25,
    27,
    'humanoid',
    0x67505f,
    true,
  ),
  abbot_of_flies: mob('abbot_of_flies', 'Abbot of Flies', 27, 27, 'undead', 0x8d536d, true),
  cairnwall_revenant: mob(
    'cairnwall_revenant',
    'Cairnwall Revenant',
    31,
    33,
    'undead',
    0x777069,
    true,
  ),
  general_silex: mob('general_silex', 'General Silex', 34, 34, 'elemental', 0x9a8c75, true),
  crownroot_heartwood: mob(
    'crownroot_heartwood',
    'Heartwood Horror',
    38,
    40,
    'elemental',
    0x596a52,
    true,
  ),
  queen_under_roots: mob(
    'queen_under_roots',
    'The Queen Under Roots',
    40,
    40,
    'undead',
    0xba866b,
    true,
  ),
  sepulcher_crownshard: mob(
    'sepulcher_crownshard',
    'Living Crownshard',
    40,
    40,
    'elemental',
    0xc5a469,
    true,
  ),
  king_in_ashes: mob('king_in_ashes', 'The King in Ashes', 40, 40, 'undead', 0xd0aa68, true),
};

for (const id of ['abbot_of_flies', 'general_silex', 'queen_under_roots', 'king_in_ashes']) {
  const boss = ASHEN_BLOOM_INSTANCE_MOBS[id];
  boss.boss = true;
  boss.ccImmune = true;
  boss.slowImmune = true;
  boss.hpBase *= id === 'king_in_ashes' ? 18 : 7;
  boss.dmgBase *= id === 'king_in_ashes' ? 2.6 : 1.7;
}

// Each finale combines an avoidable room mechanic with a distinct pressure
// pattern. These use the shared deterministic boss drivers, so the encounters
// work identically offline and on the authoritative server.
Object.assign(ASHEN_BLOOM_INSTANCE_MOBS.abbot_of_flies, {
  aoePulse: { min: 34, max: 48, radius: 11, every: 9, name: 'Carrion Cloud', school: 'nature' },
  summonAdds: { mobId: 'rotchapel_cultist', count: 2, atHpPct: [0.65, 0.3] },
  yells: { engage: 'The bloom has waited for warmer blood.', summon: 'Rise and tend the garden!' },
});
Object.assign(ASHEN_BLOOM_INSTANCE_MOBS.general_silex, {
  stomp: { radius: 9, every: 12, duration: 1.5, min: 44, max: 62, name: 'Marching Order' },
  stoneskin: { amount: 260, every: 18, duration: 8, name: 'Ossuary Plate' },
  enrage: { belowHpPct: 0.25, dmgMult: 1.35, hasteMult: 1.2 },
});
Object.assign(ASHEN_BLOOM_INSTANCE_MOBS.queen_under_roots, {
  bigCast: {
    castId: 'rootheart_burst',
    name: 'Rootheart Burst',
    castTime: 2.5,
    every: 11,
    radius: 12,
    min: 58,
    max: 78,
    school: 'nature',
  },
  summonAdds: { mobId: 'crownroot_heartwood', count: 2, atHpPct: [0.5] },
  desperateHeal: { belowHpPct: 0.2, healPct: 0.12 },
});
Object.assign(ASHEN_BLOOM_INSTANCE_MOBS.king_in_ashes, {
  infernoChannel: {
    every: 24,
    duration: 6,
    pulses: 3,
    min: 24,
    max: 32,
    radius: 14,
    name: 'Ashen Coronation',
    school: 'fire',
    atHpPct: [0.7, 0.35],
  },
  summonAdds: { mobId: 'sepulcher_crownshard', count: 3, atHpPct: [0.75, 0.45] },
  terrify: { radius: 10, every: 17, duration: 2, name: 'Edict of Dust', school: 'shadow' },
  enrage: { belowHpPct: 0.2, dmgMult: 1.45, hasteMult: 1.25 },
  yells: {
    engage: 'Kneel, and be remembered as ash.',
    summon: 'My crown is legion.',
    enrage: 'The last kingdom burns with me!',
  },
});

export const ASHEN_BLOOM_ITEMS: Record<string, ItemDef> = {
  ashen_petal: {
    id: 'ashen_petal',
    name: 'Ashen Petal',
    kind: 'junk',
    quality: 'uncommon',
    sellValue: 180,
  },
  crownroot_heartwood_item: {
    id: 'crownroot_heartwood_item',
    name: 'Crownroot Heartwood',
    kind: 'junk',
    quality: 'rare',
    sellValue: 420,
  },
  flyblown_censer: {
    id: 'flyblown_censer',
    name: 'Flyblown Censer',
    kind: 'held_offhand',
    slot: 'offhand',
    quality: 'rare',
    stats: { int: 15, sta: 12 },
    spellPower: 18,
    sellValue: 3600,
  },
  gravecallers_crozier: {
    id: 'gravecallers_crozier',
    name: "Gravecaller's Crozier",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    weapon: { min: 73, max: 111, speed: 2.8 },
    stats: { int: 24, sta: 18 },
    spellPower: 35,
    requiredClass: ['gravecaller'],
    sellValue: 6800,
  },
  mantle_of_walking_thorns: {
    id: 'mantle_of_walking_thorns',
    name: 'Mantle of Walking Thorns',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'epic',
    stats: { armor: 176, sta: 26, int: 18, str: 14 },
    requiredClass: ['briar_warden'],
    sellValue: 6400,
  },
  crownshard_ring: {
    id: 'crownshard_ring',
    name: 'Crownshard Signet',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    stats: { sta: 20, int: 18 },
    critRating: 16,
    hitRating: 12,
    sellValue: 7200,
  },
  sepulcher_bulwark: {
    id: 'sepulcher_bulwark',
    name: 'Sepulcher Bulwark',
    kind: 'armor',
    armorType: 'mail',
    slot: 'offhand',
    quality: 'epic',
    shield: true,
    blockValue: 58,
    stats: { armor: 260, sta: 30, str: 20 },
    sellValue: 7600,
  },
  king_in_ashes_blade: {
    id: 'king_in_ashes_blade',
    name: 'Regicide in Bloom',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'legendary',
    weapon: { min: 105, max: 158, speed: 2.7 },
    stats: { str: 28, agi: 22, sta: 24 },
    sellValue: 12000,
  },
  royal_ash_phial: {
    id: 'royal_ash_phial',
    name: 'Phial of Royal Ash',
    kind: 'held_offhand',
    slot: 'offhand',
    quality: 'rare',
    stats: { int: 18, spi: 16, sta: 12 },
    spellPower: 22,
    sellValue: 900,
  },
};

ASHEN_BLOOM_INSTANCE_MOBS.abbot_of_flies.loot.push(
  { itemId: 'ashen_petal', chance: 1 },
  { itemId: 'flyblown_censer', chance: 0.3 },
);
ASHEN_BLOOM_INSTANCE_MOBS.general_silex.loot.push({ itemId: 'crownshard_ring', chance: 0.35 });
ASHEN_BLOOM_INSTANCE_MOBS.queen_under_roots.loot.push(
  { itemId: 'gravecallers_crozier', chance: 0.22 },
  { itemId: 'mantle_of_walking_thorns', chance: 0.22 },
);
ASHEN_BLOOM_INSTANCE_MOBS.king_in_ashes.loot.push(
  { itemId: 'sepulcher_bulwark', chance: 0.18 },
  { itemId: 'king_in_ashes_blade', chance: 0.06 },
  { itemId: 'royal_ash_phial', chance: 1 },
);

// Expansion profession materials remain obtainable outside instances, while
// bosses provide guaranteed quantities for groups progressing the campaign.
ASHEN_BLOOM_MOBS.carrion_bloom.loot.push({ itemId: 'ashen_petal', chance: 0.22 });
ASHEN_BLOOM_MOBS.ashen_dryad.loot.push({ itemId: 'ashen_petal', chance: 0.3 });
ASHEN_BLOOM_MOBS.sepulcher_guardian.loot.push({ itemId: 'crownroot_heartwood_item', chance: 0.12 });

export const ASHEN_BLOOM_DUNGEONS: Record<string, DungeonDef> = {
  rotchapel: {
    id: 'rotchapel',
    name: 'Rotchapel',
    index: 9,
    doorPos: { x: -118, z: 2700 },
    entry: { x: 0, z: -2 },
    exitOffset: { x: 0, z: -6 },
    interior: 'crypt',
    tombDressing: 'coffins',
    suggestedPlayers: 5,
    bossChainPull: true,
    spawns: [
      { mobId: 'rotchapel_cultist', x: -5, z: 30 },
      { mobId: 'rotchapel_cultist', x: 5, z: 30 },
      { mobId: 'rotchapel_cultist', x: 0, z: 62 },
      { mobId: 'abbot_of_flies', x: 0, z: 96 },
    ],
    enterText: 'Rotten incense hangs beneath the chapel vault.',
    leaveText: 'You return to the Rotmire air.',
  },
  ossuary_of_the_march: {
    id: 'ossuary_of_the_march',
    name: 'Ossuary of the March',
    index: 10,
    doorPos: { x: -118, z: 3040 },
    entry: { x: 0, z: -2 },
    exitOffset: { x: 0, z: -6 },
    interior: 'sanctum',
    suggestedPlayers: 5,
    spawns: [
      { mobId: 'cairnwall_revenant', x: -6, z: 28 },
      { mobId: 'cairnwall_revenant', x: 6, z: 28 },
      { mobId: 'cairnwall_revenant', x: 0, z: 60 },
      { mobId: 'general_silex', x: 0, z: 96 },
    ],
    enterText: 'Stone soldiers turn their heads toward the living.',
    leaveText: 'You escape the silent formation.',
  },
  heart_of_crownroot: {
    id: 'heart_of_crownroot',
    name: 'Heart of Crownroot',
    index: 11,
    doorPos: { x: 0, z: 3390 },
    entry: { x: 0, z: -2 },
    exitOffset: { x: 0, z: -6 },
    interior: 'wildheart',
    suggestedPlayers: 5,
    spawns: [
      { mobId: 'crownroot_heartwood', x: -7, z: 32 },
      { mobId: 'crownroot_heartwood', x: 7, z: 32 },
      { mobId: 'crownroot_heartwood', x: 0, z: 68 },
      { mobId: 'queen_under_roots', x: 0, z: 102 },
    ],
    enterText: 'The root-heart beats once beneath your feet.',
    leaveText: 'You climb back into the frozen wilds.',
  },
  sepulcher_of_ashes: {
    id: 'sepulcher_of_ashes',
    name: 'Sepulcher of Ashes',
    index: 12,
    doorPos: { x: 0, z: 3420 },
    entry: { x: 0, z: -2 },
    exitOffset: { x: 0, z: -6 },
    interior: 'nythraxis',
    suggestedPlayers: 10,
    spawns: [
      { mobId: 'sepulcher_crownshard', x: -22, z: 48 },
      { mobId: 'sepulcher_crownshard', x: 22, z: 48 },
      { mobId: 'sepulcher_crownshard', x: 0, z: 72 },
      { mobId: 'king_in_ashes', x: 0, z: 108 },
    ],
    enterText: 'The Hollow Crown closes around the raid.',
    leaveText: 'The Sepulcher releases you.',
  },
};
