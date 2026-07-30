// The Farshore (levels 3-7). A small island in the starter sea east of
// Eastbrook Vale, all but surrounded by open ocean and joined to the
// mainland only by the Ferrywalk: a thin natural sandbar causeway from the
// vale's east point to the island's Landing, walked on foot (no teleport;
// the causeway terrain is in world.ts). The deeper strait to either side
// keeps its swim fatigue.
//
// The island is under siege. Rifts, the townsfolk call them "the breaks",
// tear open across the Farshore without warning and spill monsters onto the
// land; the fishing town of Gullhaven has become a redoubt, and its people
// hold their shore against whatever pours through. The break MECHANIC (the
// auto-generated dungeon portals themselves) is a separate system; this
// module builds the ISLAND around it: the besieged town, the defender cast
// who know exactly what is happening, and the break-spawned creatures that
// already made it through. Terrain: the ISLE_* tables in world.ts (biome
// 'vale': the island shares the vale's sky, palette, and song).

import type {
  CampDef,
  EscortDef,
  GroundObjectDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  PortalDef,
  QuestDef,
  ZoneDef,
  ZonePropsDef,
} from '../types';
import { emptyZoneProps } from '../types';

export const FARSHORE_ZONE: ZoneDef = {
  id: 'farshore_isle',
  name: 'The Farshore',
  riftPortalEligible: true,
  riftTierWeights: { C: 0.7, B: 0.3 },
  zMin: -180,
  zMax: 180,
  xMin: 180,
  xMax: 540,
  levelRange: [3, 7],
  biome: 'vale',
  hub: { x: 305, z: 70, radius: 15, name: 'Gullhaven' },
  graveyard: { x: 290, z: 86 },
  lakes: [
    { x: 388, z: 26, radius: 8 }, // the Hilltop Spring, under the Watch Meadow
  ],
  pois: [
    { x: 305, z: 70, label: 'Gullhaven', id: 'gullhaven' },
    { x: 250, z: 14, label: 'The Landing', id: 'the_landing' },
    { x: 375, z: -5, label: 'The Watch Meadow', id: 'the_watch_meadow' },
    { x: 402, z: -72, label: 'The Sundered Cliffs', id: 'the_sundered_cliffs' },
    { x: 434, z: 58, label: 'The Riftfields', id: 'the_riftfields' },
  ],
  welcome:
    "Cross the sandbar and Gullhaven's bell will find you before the town does. The breaks tear open without warning, and the redoubt holds its shore against whatever pours through. They have been waiting a long while for someone like you.",
  welcomeQuestId: 'q_fs_bell_at_the_landing',
};

export const FARSHORE_ROADS: { x: number; z: number }[][] = [
  [
    { x: 150, z: -46 },
    { x: 173, z: -30 },
    { x: 195, z: -14 },
    { x: 217, z: 1 },
    { x: 238, z: 12 },
    { x: 252, z: 15 },
  ], // the Ferrywalk causeway: the vale's east point -> the Landing
  [
    { x: 250, z: 14 },
    { x: 276, z: 42 },
    { x: 305, z: 68 },
  ], // the Landing -> up the shore road -> Gullhaven
  [
    { x: 308, z: 66 },
    { x: 340, z: 32 },
    { x: 372, z: 0 },
  ], // Gullhaven -> the Watch Meadow (the riftwatchers' vigil)
  [
    { x: 374, z: -4 },
    { x: 392, z: -40 },
    { x: 402, z: -68 },
  ], // the Watch Meadow -> the Sundered Cliffs
  [
    { x: 376, z: 0 },
    { x: 408, z: 30 },
    { x: 432, z: 54 },
  ], // the Watch Meadow -> the Riftfields
] as { x: number; z: number }[][];

// No portals: the Farshore is reached on foot, across the Ferrywalk causeway
// (the sandbar terrain in world.ts) from the vale's east point.
export const FARSHORE_PORTALS: PortalDef[] = [];

// The break-spawned. Whatever a rift is, it does not spill fishermen: these
// are the creatures that already made it through and now roam the island's
// fringe, away from the redoubt. All reuse an existing rigged family (the
// demons wear a void tint; the wretches borrow the kobold rig; the horror is
// an ogre grown wrong).
export const FARSHORE_MOBS: Record<string, MobTemplate> = {
  riftspawn: {
    id: 'riftspawn',
    name: 'Riftspawn',
    minLevel: 3,
    maxLevel: 4,
    family: 'demon',
    hpBase: 34,
    hpPerLevel: 12,
    dmgBase: 7,
    dmgPerLevel: 1.6,
    attackSpeed: 1.9,
    armorPerLevel: 8,
    moveSpeed: 8.5,
    aggroRadius: 12, // it knows only the way it came and the thing in front of it
    loot: [
      { copper: 15, chance: 1 },
      { itemId: 'farshore_salt_moss', chance: 0.6, questId: 'q_fs_moss_and_mending' },
    ],
    scale: 0.85,
    color: 0x7a3fb0,
  },
  breach_wretch: {
    id: 'breach_wretch',
    name: 'Breach Wretch',
    minLevel: 3,
    maxLevel: 5,
    family: 'kobold',
    hpBase: 30,
    hpPerLevel: 11,
    dmgBase: 6,
    dmgPerLevel: 1.5,
    attackSpeed: 1.8,
    armorPerLevel: 7,
    moveSpeed: 9,
    aggroRadius: 11, // the small ones come in numbers, and they come fast
    loot: [
      { copper: 18, chance: 1 },
      { itemId: 'breakscarred_steel', chance: 0.6, questId: 'q_fs_steel_for_the_redoubt' },
    ],
    scale: 0.9,
    color: 0x5a4a78,
  },
  void_stalker: {
    id: 'void_stalker',
    name: 'Void Stalker',
    minLevel: 5,
    maxLevel: 6,
    family: 'beast',
    hpBase: 52,
    hpPerLevel: 16,
    dmgBase: 10,
    dmgPerLevel: 2.1,
    attackSpeed: 1.7,
    armorPerLevel: 11,
    moveSpeed: 9.5,
    aggroRadius: 14, // it hunts the edges of the light the watchfires throw
    loot: [{ copper: 26, chance: 1 }],
    scale: 1.15,
    color: 0x2f2a44,
  },
  sundered_horror: {
    id: 'sundered_horror',
    name: 'The Sundered Horror',
    minLevel: 7,
    maxLevel: 7,
    family: 'ogre',
    hpBase: 128,
    hpPerLevel: 24,
    dmgBase: 14,
    dmgPerLevel: 2.6,
    attackSpeed: 2.4,
    armorPerLevel: 15,
    moveSpeed: 7,
    aggroRadius: 15, // the biggest thing the cliffs' break ever let through
    elite: true,
    loot: [{ copper: 150, chance: 1 }],
    scale: 1.45,
    color: 0x8a2f6a,
  },
  // Nell's husband (q_fs_bram_come_home), thrown back by the sea at the
  // nets-break and holed up in his wrecked boat past the Landing's point.
  // Escort-run escortee: non-hostile, never wanders (moveSpeed 0;
  // src/sim/escort.ts drives all movement), never fights back. Sturdy enough
  // to survive an ambush wave long enough for the escorting player to peel it.
  fisher_bram: {
    id: 'fisher_bram',
    name: 'Fisher Bram',
    minLevel: 5,
    maxLevel: 5,
    family: 'humanoid',
    hpBase: 120,
    hpPerLevel: 15,
    dmgBase: 1,
    dmgPerLevel: 0,
    attackSpeed: 2.0,
    armorPerLevel: 8,
    moveSpeed: 0,
    aggroRadius: 0,
    loot: [],
    scale: 1.0,
    color: 0x4a6a8a,
  },
};

// The defenders. Everyone left in Gullhaven knows what is happening and has
// found their place in the holding of it: a commander, a scholar who reads
// the breaks, a quartermaster, a surgeon, the bellkeeper who rings for aid,
// and a fisher who has seen one too many. Quests arrive with the break
// mechanic; for now the cast sets the siege and points the newcomer at it.
export const FARSHORE_NPCS: Record<string, NpcDef> = {
  warden_coalfast: {
    id: 'warden_coalfast',
    name: 'Warden Coalfast',
    title: 'Redoubt Commander',
    pos: { x: 305, z: 66 },
    facing: 0,
    color: 0x8a4b2b,
    questIds: [
      'q_fs_bell_at_the_landing',
      'q_fs_hold_the_riftfields',
      'q_fs_song_before_the_break',
      'q_fs_the_great_break',
    ],
    greeting:
      'The breaks do not care that Gullhaven is small, $C. We hold this shore, or there is no shore left to hold. Stand with us and I will not forget it.',
  },
  riftwatch_ollun: {
    id: 'riftwatch_ollun',
    name: 'Riftwatch Ollun',
    title: 'Breach Scholar',
    pos: { x: 372, z: 2 },
    facing: Math.PI,
    color: 0x3f5f8a,
    questIds: ['q_fs_song_before_the_break', 'q_fs_stalkers_off_the_light', 'q_fs_the_great_break'],
    greeting:
      'Every break sings before it opens, if you have the ear for it. I can hear three of them stirring on the island right now, and one of them is close.',
  },
  quartermaster_edda: {
    id: 'quartermaster_edda',
    name: 'Quartermaster Edda',
    title: 'Redoubt Armorer',
    pos: { x: 298, z: 74 },
    facing: Math.PI / 2,
    color: 0x6b6b3a,
    questIds: ['q_fs_steel_for_the_redoubt'],
    greeting:
      'Steel and salt, $C, it is all I have left to hand out. Take it and make the breaks regret opening where I could reach them.',
  },
  mender_saul: {
    id: 'mender_saul',
    name: 'Mender Saul',
    title: 'Field Surgeon',
    pos: { x: 312, z: 78 },
    facing: -Math.PI / 2,
    color: 0x9a3b3b,
    questIds: ['q_fs_moss_and_mending'],
    greeting:
      'I have set more bones this one month than in ten years of mending fishing falls. The breaks do not leave much of what they take. Come back to me whole, if you can manage it.',
  },
  bellkeeper_tam: {
    id: 'bellkeeper_tam',
    name: 'Bellkeeper Tam',
    title: 'Watchbell Keeper',
    pos: { x: 252, z: 18 },
    facing: Math.PI / 2,
    color: 0x4a7b6b,
    questIds: ['q_fs_bell_at_the_landing', 'q_fs_the_three_bells'],
    greeting:
      'The bell is the only warning the breaks give us, $C. One toll for the fields, two for the cliffs, three when it is close enough that running will not help. Keep an ear on it, and it may keep you whole.',
  },
  fisher_nell: {
    id: 'fisher_nell',
    name: 'Frightened Nell',
    title: 'Gullhaven Fisher',
    pos: { x: 296, z: 80 },
    facing: 0,
    color: 0x5a7a9a,
    questIds: ['q_fs_bram_come_home'],
    greeting:
      'It opened right where the nets dry. Right there, where I stood every morning of my life. I do not go down to the shore anymore. I do not go much of anywhere anymore.',
  },
};

export const FARSHORE_QUESTS: Record<string, QuestDef> = {
  q_fs_bell_at_the_landing: {
    id: 'q_fs_bell_at_the_landing',
    name: 'The Bell at the Landing',
    giverNpcId: 'bellkeeper_tam',
    turnInNpcId: 'warden_coalfast',
    text: 'You came over the Ferrywalk, $N? Then you are the first in a week, and the Warden will want to look you over. Gullhaven sits up the shore road, past the drying racks nobody tends anymore. Tell Warden Coalfast the causeway still stands, and that Tam has not rung a three-toll today. Yet.',
    completionText:
      'The causeway holds, and Tam still has breath enough to joke about the three-toll. Good. We are an island under siege, $N, and every pair of hands that crosses that sandbar is a pair the breaks must get through before they reach my people. Welcome to Gullhaven.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'warden_coalfast',
        count: 1,
        label: 'Report to Warden Coalfast',
      },
    ],
    xpReward: 150,
    copperReward: 60,
    itemRewards: {},
    minLevel: 2,
  },
  q_fs_hold_the_riftfields: {
    id: 'q_fs_hold_the_riftfields',
    name: 'Hold the Riftfields',
    giverNpcId: 'warden_coalfast',
    turnInNpcId: 'warden_coalfast',
    text: 'East of town the grain rows have gone to wrack, and the wretches that came through the Riftfields break now pick them clean. My people cannot tend a field they cannot stand in, $N. Cull ten of the wretches and give the farmers back their ground.',
    completionText:
      'Ten fewer, and the field hands are already arguing over who walks out first. It will not last, the breaks never rest long, but a town that eats is a town that holds.',
    objectives: [
      { type: 'kill', targetMobId: 'breach_wretch', count: 10, label: 'Breach Wretch slain' },
    ],
    xpReward: 400,
    copperReward: 180,
    itemRewards: {},
    requiresQuest: 'q_fs_bell_at_the_landing',
  },
  q_fs_steel_for_the_redoubt: {
    id: 'q_fs_steel_for_the_redoubt',
    name: 'Steel for the Redoubt',
    giverNpcId: 'quartermaster_edda',
    turnInNpcId: 'quartermaster_edda',
    text: 'Every blade I hand out is one the sea gave back or one I pried off the dead, $N. The wretches carry scrap through the breaks, hinges, hooks, broken sword-steel, magpie stuff, but it hammers out true. Bring me six pieces of their scavenged steel and the barricade line gets its teeth back.',
    completionText:
      'Salt-pitted and break-scarred, and it will hold an edge all the same. Here, I lined these grips myself. Steel for steel, $N: it is the only trade the Farshore runs these days.',
    objectives: [
      { type: 'collect', itemId: 'breakscarred_steel', count: 6, label: 'Break-Scarred Steel' },
    ],
    xpReward: 450,
    copperReward: 200,
    itemRewards: {
      warrior: 'saltforged_grips',
      mage: 'saltforged_grips',
      rogue: 'saltforged_grips',
    },
    requiresQuest: 'q_fs_bell_at_the_landing',
  },
  q_fs_the_three_bells: {
    id: 'q_fs_the_three_bells',
    name: 'The Three Bells',
    giverNpcId: 'bellkeeper_tam',
    turnInNpcId: 'bellkeeper_tam',
    text: 'Three watchbells stand the coast beyond my own: one on the Landing point, one on the south strand, one out by the Riftfields shore. If a rope has rotted or a clapper has been carried off, the town learns of a break when it is already in the streets. Walk the coast, $N, and ring each bell once, so I know it still has a voice.',
    completionText:
      'Three voices, three answers, carried clean over the water. Sleep in Gullhaven tonight, $N, and know that if a bell wakes you, it will be by my hand and in good time.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'gullhaven_watchbell',
        count: 3,
        label: 'Watchbell rung',
      },
    ],
    xpReward: 400,
    copperReward: 180,
    itemRewards: {},
    requiresQuest: 'q_fs_bell_at_the_landing',
  },
  q_fs_song_before_the_break: {
    id: 'q_fs_song_before_the_break',
    name: 'The Song Before the Break',
    giverNpcId: 'warden_coalfast',
    turnInNpcId: 'riftwatch_ollun',
    text: 'There is a man who hears the breaks before they open. Riftwatch Ollun: a scholar, or a madman, and lately I cannot afford the difference. He keeps his vigil at the Watch Meadow, up the road southeast of town. Find him, $N, and ask him what the island is about to do to us next.',
    completionText:
      'The Warden sent you? Good. That means the town has finally started listening. Now be still a moment, $N. There, under the wind, do you hear it? The cliffs are singing, and I do not like the tune.',
    objectives: [
      { type: 'interact', targetNpcId: 'riftwatch_ollun', count: 1, label: 'Find Riftwatch Ollun' },
    ],
    xpReward: 250,
    copperReward: 100,
    itemRewards: {},
    requiresQuest: 'q_fs_hold_the_riftfields',
    minLevel: 4,
  },
  q_fs_moss_and_mending: {
    id: 'q_fs_moss_and_mending',
    name: 'Moss and Mending',
    giverNpcId: 'mender_saul',
    turnInNpcId: 'mender_saul',
    text: 'The salt moss that grows along the tideline is the best wound-packing I know, and the riftspawn have claimed every stretch of shore it grows on. They carry tufts of it snagged on their hides, of all things. Clear six of them off the east reaches, $N, and pull me four good handfuls of moss from what they have trampled through.',
    completionText:
      'Moss in one hand and a quieter shoreline in the other. You have restocked my whole surgery, $N. Do me the kindness of not becoming my next patient.',
    objectives: [
      { type: 'kill', targetMobId: 'riftspawn', count: 6, label: 'Riftspawn slain' },
      { type: 'collect', itemId: 'farshore_salt_moss', count: 4, label: 'Farshore Salt Moss' },
    ],
    xpReward: 700,
    copperReward: 350,
    itemRewards: {},
    requiresQuest: 'q_fs_bell_at_the_landing',
    minLevel: 4,
  },
  q_fs_bram_come_home: {
    id: 'q_fs_bram_come_home',
    name: 'Bram Come Home',
    giverNpcId: 'fisher_nell',
    turnInNpcId: 'fisher_nell',
    text: 'My Bram took the boat out the morning the nets-break opened, and the sea threw him back somewhere past the Landing point. I heard him three nights ago, $N, calling over the water, and I was too afraid to go. I am still too afraid. Please. His boat lies wrecked on the south shore. Walk him home to me.',
    completionText:
      'Bram! You brought him back to me whole, $N. We both wept and neither of us is ashamed. Whatever the breaks take from this island next, they do not get my family. Not anymore.',
    objectives: [
      {
        type: 'escort',
        escortId: 'esc_fs_bram',
        count: 1,
        label: 'Fisher Bram seen safely home to Gullhaven',
      },
    ],
    xpReward: 800,
    copperReward: 400,
    itemRewards: {},
    requiresQuest: 'q_fs_bell_at_the_landing',
    minLevel: 5,
  },
  q_fs_stalkers_off_the_light: {
    id: 'q_fs_stalkers_off_the_light',
    name: 'Stalkers off the Light',
    giverNpcId: 'riftwatch_ollun',
    turnInNpcId: 'riftwatch_ollun',
    text: 'The stalkers hunt the dark between the watchfires, and every night they circle my meadow a little closer. They are not mindless, $N, they are patient, and patience is the one thing I cannot outlast. Kill eight and push the dark back to the cliffs it came through.',
    completionText:
      'Eight nights of circling, ended in one. The fires burn steadier already, or perhaps that is only my hands. Either way the meadow is mine again, and I can hear the island think.',
    objectives: [
      { type: 'kill', targetMobId: 'void_stalker', count: 8, label: 'Void Stalker slain' },
    ],
    xpReward: 600,
    copperReward: 300,
    itemRewards: {},
    requiresQuest: 'q_fs_song_before_the_break',
    minLevel: 5,
  },
  q_fs_the_great_break: {
    id: 'q_fs_the_great_break',
    name: 'The Great Break',
    giverNpcId: 'riftwatch_ollun',
    turnInNpcId: 'warden_coalfast',
    text: 'Every song this island sings ends on the same low note, and it comes from the Sundered Cliffs. Something came through the great break there, $N, something the cliffs themselves cracked open to admit, and it is still growing. If it walks north, no bell will matter. Take a friend, take two, and end it. Then tell Coalfast the tune has changed.',
    completionText:
      'Ollun sent word ahead: the singing stopped. My whole town heard the quiet, $N, and half of them wept at the sound of nothing at all. Wear this mantle. The Farshore does not forget who held its shore.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'sundered_horror',
        count: 1,
        label: 'The Sundered Horror slain',
      },
    ],
    xpReward: 1100,
    copperReward: 600,
    itemRewards: {
      warrior: 'mantle_of_the_unbroken_shore',
      mage: 'mantle_of_the_unbroken_shore',
      rogue: 'mantle_of_the_unbroken_shore',
    },
    requiresQuest: 'q_fs_stalkers_off_the_light',
    minLevel: 6,
    suggestedPlayers: 2,
  },
};

// Level-braided presentation order (not strictly chain order), matching the
// Veiled Hollow convention.
export const FARSHORE_QUEST_ORDER: string[] = [
  'q_fs_bell_at_the_landing',
  'q_fs_hold_the_riftfields',
  'q_fs_steel_for_the_redoubt',
  'q_fs_the_three_bells',
  'q_fs_song_before_the_break',
  'q_fs_moss_and_mending',
  'q_fs_bram_come_home',
  'q_fs_stalkers_off_the_light',
  'q_fs_the_great_break',
];

export const FARSHORE_ITEMS: Record<string, ItemDef> = {
  // --- quest items ---
  breakscarred_steel: {
    id: 'breakscarred_steel',
    name: 'Break-Scarred Steel',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_fs_steel_for_the_redoubt',
  },
  farshore_salt_moss: {
    id: 'farshore_salt_moss',
    name: 'Farshore Salt Moss',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_fs_moss_and_mending',
  },
  gullhaven_watchbell: {
    id: 'gullhaven_watchbell',
    name: 'Coastal Watchbell',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_fs_the_three_bells',
    noVendorSell: true,
  },
  // --- quest rewards ---
  saltforged_grips: {
    id: 'saltforged_grips',
    name: 'Saltforged Grips',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'uncommon',
    stats: { armor: 18, sta: 2, str: 2 },
    sellValue: 250,
  },
  mantle_of_the_unbroken_shore: {
    id: 'mantle_of_the_unbroken_shore',
    name: 'Mantle of the Unbroken Shore',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'rare',
    stats: { armor: 30, sta: 3, str: 2 },
    sellValue: 600,
  },
};
export const FARSHORE_CAMPS: CampDef[] = [
  // the break-spawned hold the island's fringe; the redoubt keeps the town
  { mobId: 'breach_wretch', center: { x: 430, z: 44 }, radius: 12, count: 4 }, // the Riftfields
  { mobId: 'breach_wretch', center: { x: 400, z: 96 }, radius: 11, count: 3 }, // the north downs
  { mobId: 'riftspawn', center: { x: 452, z: 66 }, radius: 11, count: 3 }, // deep in the Riftfields
  { mobId: 'riftspawn', center: { x: 388, z: -44 }, radius: 11, count: 3 }, // above the Sundered Cliffs
  { mobId: 'void_stalker', center: { x: 418, z: -30 }, radius: 12, count: 2 }, // the cliff approach
  { mobId: 'void_stalker', center: { x: 462, z: 20 }, radius: 11, count: 2 }, // the east reach
  { mobId: 'sundered_horror', center: { x: 402, z: -78 }, radius: 6, count: 1 }, // the cliffs' great break
];
export const FARSHORE_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'gullhaven_watchbell',
    name: 'Coastal Watchbell',
    // Bellkeeper Tam's three coastal watchbells (q_fs_the_three_bells): the
    // Landing point, the south strand below Gullhaven, the Riftfields shore.
    positions: [
      { x: 256, z: 0 },
      { x: 318, z: 94 },
      { x: 442, z: 64 },
    ],
  },
];

// Bram Come Home (q_fs_bram_come_home): Fisher Bram shelters in his wrecked
// boat on the south shore past the Landing point and walks the shore road
// home to Gullhaven, through the wretches that comb the wrack and the
// stalkers that hunt the road at dusk. Waypoints hug the authored shore
// roads above (the Landing -> Gullhaven leg).
//
// Bearings follow the ENGINE convention the map and compass render (+z north,
// +x WEST, so east is -x). Bram's post at z -8 has open sea 8 yards to the
// SOUTH and none within 90 yards north of it, so this is the isle's south
// shore, and it lies 22 yards south of the Landing.
export const FARSHORE_ESCORTS: Record<string, EscortDef> = {
  esc_fs_bram: {
    id: 'esc_fs_bram',
    npcMobId: 'fisher_bram',
    questId: 'q_fs_bram_come_home',
    // The wreck sits at the beach edge on the Landing point's north strand
    // (landness ~0.37: on sand, above the waterline).
    start: { x: 252, z: -8 },
    waypoints: [
      { x: 254, z: -4 },
      { x: 252, z: 15 },
      { x: 276, z: 42 },
      { x: 298, z: 74 },
    ],
    moveSpeed: 4.5,
    ambushes: [
      { atWaypoint: 0, mobId: 'breach_wretch', count: 3 },
      { atWaypoint: 2, mobId: 'void_stalker', count: 3 },
    ],
    creditRadius: 40,
    respawnSeconds: 30,
    startText:
      'Nell sent you? Then she is alive, oh, thank the tide. Stay close, friend: the little ones comb this stretch of shore, and they are never alone.',
    successText:
      'Gullhaven! I can see our roof from here. Go on ahead, friend, I have a wife to hold.',
    failText: 'Nell... I am sorry, love... I nearly made it home...',
  },
};

export const FARSHORE_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // Gullhaven, the redoubt: a fishing town turned to holding a line. The
  // homes still stand, but a war camp crowds the market and the fences have
  // become a barricade ring.
  buildings: [
    { kind: 'inn', x: 298, z: 64, w: 6, d: 7, rot: 0.5 }, // the muster hall
    { kind: 'house', x: 312, z: 78, w: 5, d: 5, rot: -1.1 },
    { kind: 'house', x: 296, z: 78, w: 5, d: 5, rot: 2.1 },
    { kind: 'chapel', x: 316, z: 62, w: 5, d: 7, rot: -2.4 }, // the menders' hall
  ],
  wells: [{ x: 305, z: 71, r: 1.5 }],
  stalls: [
    { x: 310, z: 68, rot: 0.6, r: 1.6 }, // the quartermaster's arming table
    { x: 300, z: 74, rot: -1.3, r: 1.6 },
  ],
  crates: [
    [294, 68],
    [312, 72],
    [308, 60], // ration and quarrel stores against the siege
    [290, 72],
  ],
  campfires: [
    [304, 66], // the muster fire
    [252, 18], // the Landing's brazier, at the causeway's island end
    [372, 4], // the Watch Meadow's signal fire, kept burning for the vigil
  ],
  // the barricade ring: the town's old windward fences, doubled and closed
  // into a defensive line around the muster
  fences: [
    { x1: 288, z1: 56, x2: 308, z2: 54 },
    { x1: 314, z1: 56, x2: 322, z2: 64 },
    { x1: 292, z1: 86, x2: 312, z2: 88 },
    { x1: 284, z1: 66, x2: 286, z2: 78 },
  ],
  // the war camp: tents crowd the market where the fish stalls used to stand
  tents: [
    { x: 300, z: 60, rot: 0.4, scale: 1 },
    { x: 314, z: 70, rot: -1.8, scale: 1 },
    { x: 292, z: 62, rot: 2.3, scale: 1 },
  ],
  // the Landing's fishing pier, at the island end of the causeway. No stone
  // hut on this dock: hw/hd 0 collapse the optional hut to nothing (with the
  // old 0.1/0.1 it drew as a thin post floating out over the water).
  docks: [{ x: 246, z: 12, rot: -1.7, hutLocal: { x: 40, z: 40, hw: 0, hd: 0 } }],
  graveyards: [{ x: 290, z: 86 }],
};
