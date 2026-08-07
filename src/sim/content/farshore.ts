// The Farshore (levels 3-7). A LARGE island far out in the eastern sea,
// hundreds of yards past the Eastbrook Vale coast across deep, fatiguing
// ocean. There is no land link and no swimming it: the ferry is the only
// crossing (the campaign's front door; terrain in world.ts,
// applyFarshoreSea). The island carries the campaign's authored topology:
// Gullhaven's harbor bay, the Landing beach, the Watch Meadow, the
// Sundered Cliffs range, the Riftfields with the breach, the Wreckfields.
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

import { GULLHAVEN_HARBOR } from '../harbor_layout';
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
import {
  GULLHAVEN_BUILDINGS,
  GULLHAVEN_CHURCHYARD_FENCE,
  GULLHAVEN_TOWN_PROPS,
  gullhavenWallProps,
} from './gullhaven';
import { GULLHAVEN_MEMORIAL, memorialRailProps } from './memorials';

export const FARSHORE_ZONE: ZoneDef = {
  id: 'farshore_isle',
  name: 'The Farshore',
  riftPortalEligible: true,
  riftTierWeights: { C: 0.7, B: 0.3 },
  zMin: -250,
  zMax: 290,
  xMin: 700,
  xMax: 1300,
  levelRange: [3, 7],
  biome: 'vale',
  hub: { x: 822, z: 118, radius: 16, name: 'Gullhaven' },
  graveyard: { x: 836, z: 132 },
  lakes: [
    { x: 1040, z: -60, radius: 9 }, // the Hilltop Spring, under the Watch Meadow
  ],
  pois: [
    { x: 822, z: 118, label: 'Gullhaven', id: 'gullhaven' },
    { x: 780, z: -30, label: 'The Landing', id: 'the_landing' },
    { x: 990, z: 10, label: 'The Watch Meadow', id: 'the_watch_meadow' },
    { x: 1170, z: -35, label: 'The Sundered Cliffs', id: 'the_sundered_cliffs' },
    { x: 1005, z: -125, label: 'The Riftfields', id: 'the_riftfields' },
    { x: 1012, z: -172, label: 'The Breach', id: 'the_breach' },
    { x: 885, z: 200, label: 'The Wreckfields', id: 'the_wreckfields' },
  ],
  welcome:
    "Step off the ferry and Gullhaven's bell will find you before the town does. The breaks tear open without warning, and the redoubt holds its shore against whatever pours through. They have been waiting a long while for someone like you.",
  welcomeQuestId: 'q_fs_bell_at_the_landing',
};

// Every road through Gullhaven meets at ONE junction node, (822, 118), the
// square's centre. They used to START a few yards apart from each other near it
// (the Watch Meadow road at (826, 114), the Wreckfields road at (820, 128)),
// which put three near-parallel painted bands through the middle of the town and
// left the market and the houses as two clusters with a smear of track between
// them. Sharing the node makes it read as a crossroads, which is what a market
// square is, and gives the blocks between the roads back to the town.
export const FARSHORE_ROADS: { x: number; z: number }[][] = [
  [
    { x: 784, z: 118 },
    { x: 791.5, z: 121 },
    { x: 800, z: 122 },
    { x: 812, z: 120 },
    { x: 822, z: 118 },
  ], // the harbour pier -> the west gate -> Gullhaven
  [
    { x: 822, z: 118 },
    { x: 831, z: 110 },
    { x: 880, z: 70 },
    { x: 935, z: 35 },
    { x: 985, z: 12 },
  ], // Gullhaven -> the Watch Meadow (the riftwatchers' vigil)
  [
    { x: 980, z: 4 },
    { x: 900, z: -15 },
    { x: 830, z: -25 },
    { x: 788, z: -30 },
  ], // the Watch Meadow -> the Landing
  [
    { x: 992, z: 2 },
    { x: 1000, z: -60 },
    { x: 1005, z: -120 },
    { x: 1010, z: -155 },
  ], // the Watch Meadow -> the Riftfields and the breach
  [
    { x: 1000, z: 14 },
    { x: 1070, z: -10 },
    { x: 1098, z: -24 },
  ], // the Watch Meadow -> the Sundered Cliffs' foot
  [
    { x: 822, z: 118 },
    { x: 826, z: 130 },
    { x: 855, z: 165 },
    { x: 880, z: 195 },
  ], // Gullhaven -> the Wreckfields
  // The shore road, up the west coast toward the Landing. Fisher Bram's escort
  // (q_fs_bram_come_home) already walked this line home and the lore names it
  // "the shore road", but it was not a road: he crossed open grass. It is a road
  // now, so the redoubt's north gate stands on a way in rather than on turf.
  [
    { x: 808, z: 66 },
    { x: 812.7, z: 91.6 },
    { x: 818, z: 108 },
    { x: 822, z: 118 },
  ], // the shore road -> the north gate -> Gullhaven
  // The town -> Warden Hale's memorial. It now BRANCHES at (807, 123) instead of
  // starting at (814, 121): that first leg ran 1.5 to 2.6 yards from the harbour
  // road and parallel to it, so the two painted bands merged into one wide smear
  // across the square's west side rather than reading as a junction.
  // It CONTOURS the mound's west flank
  // rather than climbing the face: the same curve MEMORIAL_TERRAIN_EDITS
  // grades, so the painted road always sits on graded ground and the climb
  // stays at about 0.2 per yard. You come round the hill and the bronze
  // arrives in view, instead of trudging straight at it.
  [
    { x: 807, z: 123 },
    { x: 801, z: 124.5 },
    { x: 797, z: 127.5 },
    { x: 795.5, z: 131 },
    { x: 797.5, z: 133.5 },
    { x: 801, z: 134 },
    { x: 805, z: 133.2 },
    { x: 805, z: 137.5 },
  ],
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
    loot: [{ itemId: 'farshore_salt_moss', chance: 0.6, questId: 'q_fs_moss_and_mending' }],
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
    loot: [{ itemId: 'breakscarred_steel', chance: 0.6, questId: 'q_fs_steel_for_the_redoubt' }],
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
    loot: [],
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
    loot: [],
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
    pos: { x: 822, z: 114 },
    facing: 0,
    color: 0x8a4b2b,
    questIds: [
      'q_lb_q0_ashore',
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
    pos: { x: 988, z: 6 },
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
    pos: { x: 815, z: 122 },
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
    pos: { x: 827, z: 124 },
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
    pos: { x: 784, z: -22 },
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
    pos: { x: 811, z: 128 },
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
    text: 'You came in on the ferry, $N? Then you are the first in a week, and the Warden will want to look you over. Gullhaven sits up from the harbor, past the drying racks nobody tends anymore. Tell Warden Coalfast the crossing still runs, and that Tam has not rung a three-toll today. Yet.',
    completionText:
      'The crossing holds, and Tam still has breath enough to joke about the three-toll. Good. We are an island under siege, $N, and every pair of hands the ferry carries over is a pair the breaks must get through before they reach my people. Welcome to Gullhaven.',
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
    text: 'My Bram took the boat out the morning the nets-break opened, and the sea threw him back somewhere past the Landing point. I heard him three nights ago, $N, calling over the water, and I was too afraid to go. I am still too afraid. Please. His boat lies wrecked on the north shore. Walk him home to me.',
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
  // the break-spawned pour from the breach and hold the island's north and
  // east; the redoubt keeps the town and the harbor. sharedRngCount preserves
  // the pre-campaign Farshore's 18 shared world-generation spawns (6
  // riftspawn, 7 wretches, 4 stalkers, 1 horror). The 16 campaign additions
  // scatter from deterministic camp-local streams, leaving the shared
  // construction stream stable for later camps and immediate interactions.
  {
    mobId: 'riftspawn',
    center: { x: 1030, z: -160 },
    radius: 12,
    count: 4,
    sharedRngCount: 2,
  }, // the breach's east lip
  {
    mobId: 'riftspawn',
    center: { x: 985, z: -178 },
    radius: 12,
    count: 4,
    sharedRngCount: 2,
  }, // the breach's west lip
  {
    mobId: 'riftspawn',
    center: { x: 1008, z: -112 },
    radius: 14,
    count: 5,
    sharedRngCount: 1,
  }, // the Riftfields
  {
    mobId: 'riftspawn',
    center: { x: 890, z: 218 },
    radius: 14,
    count: 4,
    sharedRngCount: 1,
  }, // the Wreckfields tide line
  {
    mobId: 'breach_wretch',
    center: { x: 940, z: 60 },
    radius: 14,
    count: 5,
    sharedRngCount: 4,
  }, // the wracked grain rows
  {
    mobId: 'breach_wretch',
    center: { x: 1055, z: 92 },
    radius: 14,
    count: 5,
    sharedRngCount: 3,
  }, // the east fields
  {
    mobId: 'void_stalker',
    center: { x: 1092, z: -72 },
    radius: 12,
    count: 3,
    sharedRngCount: 2,
  }, // the cliff approach
  {
    mobId: 'void_stalker',
    center: { x: 1108, z: 38 },
    radius: 12,
    count: 3,
    sharedRngCount: 2,
  }, // the cliffs' south foot
  { mobId: 'sundered_horror', center: { x: 1197, z: -157 }, radius: 6, count: 1 }, // the cliffs' great break
];
export const FARSHORE_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'gullhaven_watchbell',
    name: 'Coastal Watchbell',
    // Bellkeeper Tam's three coastal watchbells (q_fs_the_three_bells): the
    // Landing point, the south strand below Gullhaven, the Riftfields shore.
    positions: [
      { x: 772, z: -48 },
      { x: 852, z: 164 },
      { x: 1032, z: -112 },
    ],
  },
];

// Bram Come Home (q_fs_bram_come_home): Fisher Bram shelters in his wrecked
// boat on the north shore past the Landing point and walks the shore road
// home to Gullhaven, through the wretches that comb the wrack and the
// stalkers that hunt the road at dusk. Waypoints hug the authored shore
// roads above (the Landing -> Gullhaven leg).
export const FARSHORE_ESCORTS: Record<string, EscortDef> = {
  esc_fs_bram: {
    id: 'esc_fs_bram',
    npcMobId: 'fisher_bram',
    questId: 'q_fs_bram_come_home',
    // The wreck sits at the beach edge on the Landing point's north strand.
    start: { x: 770, z: -56 },
    waypoints: [
      { x: 778, z: -44 },
      { x: 792, z: -26 },
      { x: 804, z: 20 },
      { x: 810, z: 70 },
      { x: 814, z: 110 },
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
  // Gullhaven, the redoubt: a fishing town turned to holding a line. The homes
  // still stand, but a war camp crowds the market and the curtain wall on the
  // landward side is what the fences became.
  //
  // The buildings live in src/sim/content/gullhaven.ts, which also derives the
  // plot pads that level their ground and the curtain that encloses them. The
  // four original houses were RE-SITED rather than kept: three of them stood in
  // the painted road (one dead centre of the memorial path, one dead centre of
  // the Watch Meadow road) and two had an NPC standing inside their solid box.
  buildings: GULLHAVEN_BUILDINGS.map(({ kind, x, z, w, d, rot }) => ({ kind, x, z, w, d, rot })),
  // Warden Hale's memorial. It stands on the berm crest NORTH of the redoubt
  // (graded to a level 10.4 terrace, about 5 yd above the town's flat 5.5
  // pad, by MEMORIAL_TERRAIN_EDITS) rather than in the
  // market it used to crowd: a memorial reads as a memorial with space around
  // it, and from up here the bronze looks back down over the town and the
  // harbor steps the way the histories describe. Facing south, inland over the
  // town, per the Q0 line. One authored asset now, not two scaled nature-kit
  // blocks; the collider radius is the measured circumscribed footprint so
  // collision matches the silhouette.
  //
  // The bronze warden now stands on a European-style memorial column rather
  // than a plinth, which took the asset from 4.8 to 7.48 yd: a shaft only has
  // to out-measure the figure to read as a column at all. Both numbers below
  // are measured off the shipping GLB, not chosen.
  decorProps: [
    {
      key: 'wardenHaleStatue',
      x: 805,
      z: 139,
      rot: Math.PI,
      scale: 1,
      r: 1.4,
      h: 7.48,
    },
    // ---- Gullhaven's redoubt ---------------------------------------------
    // The wall ring and the town fittings, DERIVED from src/sim/content/gullhaven.ts
    // so the props here and the oriented boxes in colliders.ts stay one geometry.
    ...gullhavenWallProps(),
    ...GULLHAVEN_TOWN_PROPS,

    // ---- the memorial precinct -------------------------------------------
    // Rebuilt after the first pass read as scattered rubble in a forest. Three
    // corrections, all from measuring the assets instead of picking them by
    // name: hexFenceStone is 1.15 long and 0.27 high, so spacing it every 3
    // yards left 1.85 yard gaps and it read as debris (dropped); kcasBench is
    // a salmon-pink castle picnic table, absurd at a memorial (dropped); and
    // gardenIronFence is 4.0 long with rot 0 running along X, so a run needs
    // ~3.5 spacing to overlap rather than gap.
    //
    // Trees and rocks are cleared inside the memorial's clearingRadius
    // (decorationAt in world.ts), so the planting below is the only greenery
    // on the mound and the bronze keeps sky behind it.
    //
    // The path arrives from the WEST after contouring the mound, so the
    // perimeter opens on that side and closes the south and east where the
    // ground falls away.
    // The rail, DERIVED from GULLHAVEN_MEMORIAL.rail so the props and the
    // colliders in colliders.ts cannot drift apart. Do not hand-list these.
    ...memorialRailProps(GULLHAVEN_MEMORIAL),
    // Planting in matched pairs on the terrace diagonals: it frames the plinth
    // and never stands on the axis you walk in on.
    { key: 'shrubFlowering', x: 803.1, z: 137.7, scale: 1, r: 0.5, h: 1.4 },
    { key: 'shrubFlowering', x: 806.9, z: 137.7, scale: 1, r: 0.5, h: 1.4 },
    { key: 'shrubFlowering', x: 803.1, z: 141.5, scale: 1, r: 0.5, h: 1.4 },
    { key: 'shrubFlowering', x: 806.9, z: 141.5, scale: 1, r: 0.5, h: 1.4 },
    { key: 'oakTree', x: 786.5, z: 150, rot: 0.6, scale: 1.2, r: 0.8, h: 9 },
    // Moved clear of the south bench: at (823.5, 149) it stood in the middle of
    // the levelled building ground GULLHAVEN_TERRAIN_EDITS cuts there.
    { key: 'oakTree', x: 836, z: 156, rot: -1.1, scale: 1.25, r: 0.8, h: 9 },
  ],
  wells: [{ x: 820, z: 119, r: 1.5 }],
  stalls: [
    { x: 825, z: 116, rot: 0.6, r: 1.6 }, // the quartermaster's arming table
    { x: 815, z: 122, rot: -1.3, r: 1.6 },
  ],
  crates: [
    [809, 116],
    [827, 120],
    [823, 108], // ration and quarrel stores against the siege
    [805, 120],
  ],
  // No watchfire in the square. Gullhaven builds in STONE: a stone curtain, a
  // stone bell tower, mortared houses. A campfire on the market cobbles read as
  // a war camp pitched on top of a town rather than a town holding a line. The
  // two that remain are outposts with no roof over them, which is the point.
  campfires: [
    [782, -26], // the Landing's brazier on the west shore
    [992, 6], // the Watch Meadow's signal fire, kept burning for the vigil
  ],
  // The barricade ring is retired. It read as clutter around the muster, and
  // the north run (x 807-827, z 134-136) cut straight across the memorial's
  // south approach: a solid line between the town and the monument, which is
  // where the stray collision up there came from. The siege reads through the
  // war camp, the watchfires and the redoubt itself, not a rail fence.
  // The churchyard wall behind the menders' hall (src/sim/content/gullhaven.ts).
  // The old barricade ring is still retired: it read as clutter round the muster
  // and cut across the memorial's south approach.
  fences: [...GULLHAVEN_CHURCHYARD_FENCE],
  // No tents either, for the same reason: canvas beside a stone bell tower and
  // mortared houses is two different towns in one frame. The siege now reads
  // through the curtain wall, the gates and the salvage on the quay.
  tents: [],
  // The Landing's small fishing jetty on the west shore. Gullhaven's own
  // waterfront is the authored harbor below, which replaced the interim
  // single-dock town pier (a dock deck seats on its anchor's terrain, so it
  // could never reach the bay's deep water; the harbor's decks carry
  // authored heights instead).
  docks: [{ x: 778, z: -36, rot: 2.4, hutLocal: { x: 40, z: 40, hw: 0, hd: 0 } }],
  // Gullhaven's harbor: the boardwalk waterfront, the stepped pier over the
  // bay drop, and the ship berth (src/sim/harbor_layout.ts).
  harbors: [GULLHAVEN_HARBOR],
  graveyards: [{ x: 836, z: 132 }],
};
