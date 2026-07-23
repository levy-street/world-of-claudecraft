// The Evergarden (level 20). North past the Palmreach's warm sand the road
// climbs through the Garden Gate onto clipped lawn: a vast formal garden
// gone a hundred years without its gardener, yet still trimmed. Marble
// statues line the Statuary Walk, roses run wild in the west, the Petal
// Pond mirrors the east lawn, and at the realm's heart stands the Great
// Maze: a true hedge labyrinth grown from the terrain itself, with the
// Fountain Court (and something horned that guards it) at the center. The
// hamlet of Hedgewick keeps its lamps lit by the gate lawns. Terrain: the
// GARDEN_* tables and the maze grid in world.ts (the hedge walls ARE the
// heightfield, so the sim, the renderer, and the map all agree); statues,
// topiary, and the fountain live in render/garden_features.ts (the
// greatTrees records below give the sim its solid trunk colliders).

import type {
  CampDef,
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

export const EVERGARDEN_ZONE: ZoneDef = {
  id: 'evergarden',
  name: 'The Evergarden',
  riftPortalEligible: true,
  riftTierWeights: { A: 0.35, S: 0.65 },
  zMin: 700,
  zMax: 1260,
  xMin: 180,
  xMax: 540,
  levelRange: [20, 20],
  biome: 'garden',
  southPassX: 400, // the Garden Gate: where the headland road meets the lawns
  westPassZ: 800, // the Gardenwalk: down from the heights onto the lawns
  hub: { x: 320, z: 810, radius: 16, name: 'Hedgewick' },
  graveyard: { x: 302, z: 792 },
  lakes: [
    { x: 440, z: 850, radius: 11 }, // the Petal Pond
    { x: 340, z: 1170, radius: 10 }, // the Lily Basin
  ],
  pois: [
    { x: 320, z: 810, label: 'Hedgewick', id: 'hedgewick' },
    { x: 410, z: 732, label: 'The Garden Gate', id: 'the_garden_gate' },
    { x: 360, z: 875, label: 'The Statuary Walk', id: 'the_statuary_walk' },
    { x: 270, z: 910, label: 'The Rose Wilds', id: 'the_rose_wilds' },
    { x: 440, z: 850, label: 'The Petal Pond', id: 'the_petal_pond' },
    { x: 360, z: 946, label: 'The Great Maze', id: 'the_great_maze' },
    { x: 360, z: 1016, label: 'The Fountain Court', id: 'the_fountain_court' },
  ],
  welcome:
    'Someone is still trimming the hedges, though no gardener has been seen for a hundred years. Mind the maze: it minds you back.',
};

export const EVERGARDEN_ROADS: { x: number; z: number }[][] = [
  [
    { x: 398, z: 706 },
    { x: 390, z: 752 },
    { x: 358, z: 784 },
    { x: 320, z: 810 },
  ], // the Garden Gate -> Hedgewick
  [
    { x: 320, z: 810 },
    { x: 344, z: 844 },
    { x: 360, z: 875 },
    { x: 360, z: 926 },
  ], // Hedgewick -> the Statuary Walk -> the maze mouth
  [
    { x: 320, z: 810 },
    { x: 298, z: 852 },
    { x: 276, z: 894 },
  ], // Hedgewick -> the Rose Wilds
  [
    { x: 320, z: 810 },
    { x: 366, z: 818 },
    { x: 408, z: 832 },
    { x: 422, z: 835 },
  ], // Hedgewick -> the Petal Pond's west shore
  [
    { x: 422, z: 835 },
    { x: 420, z: 878 },
    { x: 454, z: 920 },
    { x: 458, z: 1020 },
    { x: 440, z: 1110 },
    { x: 396, z: 1162 },
    { x: 352, z: 1170 },
  ], // the pond -> the long east walk around the maze -> the Lily Basin
  [
    { x: 352, z: 1170 },
    { x: 376, z: 1208 },
    { x: 390, z: 1256 },
  ], // the Lily Basin -> up to the Crowgate (into the wood)
  [
    { x: 320, z: 810 },
    { x: 268, z: 806 },
    { x: 224, z: 802 },
    { x: 186, z: 800 },
  ], // Hedgewick -> west down the Gardenwalk (onto the heights)
] as { x: number; z: number }[][];

// No portals: walked into through the Garden Gate.
export const EVERGARDEN_PORTALS: PortalDef[] = [];

// Quests and folk follow in a later pass.
export const EVERGARDEN_MOBS: Record<string, MobTemplate> = {
  topiary_stag: {
    id: 'topiary_stag',
    name: 'Topiary Stag',
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    hpBase: 56,
    hpPerLevel: 18,
    dmgBase: 10,
    dmgPerLevel: 2.2,
    attackSpeed: 2.0,
    armorPerLevel: 12,
    moveSpeed: 9,
    aggroRadius: 0, // clipped leaves grazing the lawn; it minds its own shape
    loot: [],
    scale: 1.15,
    color: 0x3f7e3c,
  },
  topiary_wolf: {
    id: 'topiary_wolf',
    name: 'Topiary Wolf',
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    hpBase: 58,
    hpPerLevel: 19,
    dmgBase: 12,
    dmgPerLevel: 2.3,
    attackSpeed: 1.9,
    armorPerLevel: 11,
    moveSpeed: 8.5,
    aggroRadius: 11, // some of the shapes were pruned into hunger
    loot: [],
    scale: 1.15,
    color: 0x4a8a4e,
  },
  hedge_gnome: {
    id: 'hedge_gnome',
    name: 'Hedge Gnome',
    minLevel: 20,
    maxLevel: 20,
    family: 'kobold',
    hpBase: 52,
    hpPerLevel: 18,
    dmgBase: 11,
    dmgPerLevel: 2.2,
    attackSpeed: 1.8,
    armorPerLevel: 10,
    moveSpeed: 8.5,
    aggroRadius: 10, // the unseen groundskeepers, and they hate trespass
    loot: [],
    scale: 0.95,
    color: 0x5a8a46,
  },
  the_topiary_bull: {
    id: 'the_topiary_bull',
    name: 'The Topiary Bull',
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    hpBase: 155,
    hpPerLevel: 34,
    dmgBase: 17,
    dmgPerLevel: 3.0,
    attackSpeed: 2.2,
    armorPerLevel: 17, // a century of hardened green wood
    moveSpeed: 8.5,
    aggroRadius: 12, // the court is his, and the maze feeds him trespassers
    elite: true,
    loot: [],
    scale: 1.45,
    color: 0x2e6a34,
  },
};
export const EVERGARDEN_NPCS: Record<string, NpcDef> = {
  steward_elian: {
    id: 'steward_elian',
    name: 'Steward Elian',
    title: 'Keeper of Hedgewick',
    pos: { x: 320, z: 810 },
    facing: Math.PI,
    color: 0x6f9b5c,
    questIds: ['q_evergarden_maze_mouth', 'q_evergarden_bull'],
    greeting:
      'Everything in Evergarden is carefully placed, $C. If a hedge moves, assume it meant to.',
  },
  maze_scholar_pip: {
    id: 'maze_scholar_pip',
    name: 'Maze Scholar Pip',
    title: 'Cartographer of Living Hedges',
    pos: { x: 360, z: 946 },
    facing: Math.PI,
    color: 0x84a85f,
    questIds: ['q_evergarden_maze_mouth', 'q_evergarden_living_map', 'q_evergarden_bull'],
    greeting:
      'I have drawn this maze every morning for twelve years. It has never once had the decency to stay drawn.',
  },
  statue_keeper_bram: {
    id: 'statue_keeper_bram',
    name: 'Statue Keeper Bram',
    title: 'Warden of the Marble Walk',
    pos: { x: 360, z: 875 },
    facing: Math.PI / 2,
    color: 0xa7ad91,
    questIds: [],
    greeting:
      'The statues face south today. Yesterday they faced the fountain. I prefer not to guess where they will look tomorrow.',
  },
  rose_keeper_una: {
    id: 'rose_keeper_una',
    name: 'Rose Keeper Una',
    title: 'Tender of the Rose Wilds',
    pos: { x: 270, z: 910 },
    facing: -Math.PI / 2,
    color: 0xb56f79,
    questIds: [],
    greeting:
      'The roses are harmless when they sing. If they go quiet, leave before the thorns decide you are interesting.',
  },
  pond_keeper_sol: {
    id: 'pond_keeper_sol',
    name: 'Pond Keeper Sol',
    title: 'Watcher of Petal Pond',
    pos: { x: 440, z: 850 },
    facing: Math.PI / 2,
    color: 0x6c9c83,
    questIds: [],
    greeting:
      'The pond reflects every path through the maze. Today it shows one path too many, ending at the Fountain Court.',
  },
};
export const EVERGARDEN_QUESTS: Record<string, QuestDef> = {
  q_evergarden_maze_mouth: {
    id: 'q_evergarden_maze_mouth',
    name: 'The Maze Has Moved',
    giverNpcId: 'steward_elian',
    turnInNpcId: 'maze_scholar_pip',
    text: 'Pip went to map the Great Maze before breakfast and has not returned for supper. Find the scholar at the maze mouth and ask why every hedge in Hedgewick is leaning toward the Fountain Court.',
    completionText:
      'Elian noticed the lean too? Then my map is not the problem for once. We need three witnesses from three corners of the garden.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'maze_scholar_pip',
        count: 1,
        label: 'Maze Scholar Pip found',
      },
    ],
    xpReward: 5000,
    copperReward: 2400,
    itemRewards: {},
    minLevel: 19,
  },
  q_evergarden_living_map: {
    id: 'q_evergarden_living_map',
    name: 'A Map with Three Voices',
    giverNpcId: 'maze_scholar_pip',
    turnInNpcId: 'maze_scholar_pip',
    text: 'Speak with Bram on the Statuary Walk, Una in the Rose Wilds, and Sol at Petal Pond. Each watches a different edge of the maze. Put their sightings together and we can map what is moving beneath it.',
    completionText:
      'Statues turning, roses falling silent, and a new path in the pond. All three lines meet at the Fountain Court, where the Topiary Bull has broken its roots.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'statue_keeper_bram',
        count: 1,
        label: 'Statue Keeper Bram consulted',
      },
      {
        type: 'interact',
        targetNpcId: 'rose_keeper_una',
        count: 1,
        label: 'Rose Keeper Una consulted',
      },
      {
        type: 'interact',
        targetNpcId: 'pond_keeper_sol',
        count: 1,
        label: 'Pond Keeper Sol consulted',
      },
    ],
    xpReward: 6200,
    copperReward: 3400,
    itemRewards: {},
    requiresQuest: 'q_evergarden_maze_mouth',
    minLevel: 19,
  },
  q_evergarden_bull: {
    id: 'q_evergarden_bull',
    name: 'The Bull in the Fountain Court',
    giverNpcId: 'maze_scholar_pip',
    turnInNpcId: 'steward_elian',
    text: 'The Topiary Bull is dragging the maze inward one living root at a time. Enter the Fountain Court, cut the beast free from the garden, and give every path room to breathe again.',
    completionText:
      'The hedges have settled back into their proper places. Proper for today, at least. Evergarden owes you one peaceful morning.',
    objectives: [
      { type: 'kill', targetMobId: 'the_topiary_bull', count: 1, label: 'Topiary Bull defeated' },
    ],
    xpReward: 7600,
    copperReward: 5200,
    itemRewards: {},
    requiresQuest: 'q_evergarden_living_map',
    minLevel: 20,
    suggestedPlayers: 2,
  },
};
export const EVERGARDEN_QUEST_ORDER: string[] = [
  'q_evergarden_maze_mouth',
  'q_evergarden_living_map',
  'q_evergarden_bull',
];
export const EVERGARDEN_ITEMS: Record<string, ItemDef> = {};
export const EVERGARDEN_CAMPS: CampDef[] = [
  { mobId: 'topiary_stag', center: { x: 364, z: 898 }, radius: 10, count: 3 },
  { mobId: 'topiary_stag', center: { x: 326, z: 1146 }, radius: 10, count: 3 },
  { mobId: 'topiary_wolf', center: { x: 272, z: 912 }, radius: 10, count: 3 },
  { mobId: 'topiary_wolf', center: { x: 418, z: 1124 }, radius: 10, count: 3 },
  { mobId: 'hedge_gnome', center: { x: 268, z: 1002 }, radius: 10, count: 3 },
  { mobId: 'hedge_gnome', center: { x: 456, z: 942 }, radius: 10, count: 2 },
  { mobId: 'the_topiary_bull', center: { x: 360, z: 1016 }, radius: 5, count: 1 },
];
export const EVERGARDEN_OBJECTS: GroundObjectDef[] = [];

export const EVERGARDEN_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // Hedgewick: the groundskeepers' hamlet by the gate lawns
  buildings: [
    { kind: 'inn', x: 312, z: 804, w: 6, d: 7, rot: 0.7 },
    { kind: 'house', x: 328, z: 818, w: 5, d: 5, rot: -1.0 },
    { kind: 'house', x: 314, z: 820, w: 5, d: 5, rot: 2.1 },
  ],
  wells: [{ x: 320, z: 812, r: 1.5 }],
  stalls: [{ x: 324, z: 804, rot: 0.5, r: 1.6 }],
  crates: [
    [309, 810],
    [327, 810],
  ],
  campfires: [
    [320, 806],
    [388, 716], // the Garden Gate's waycamp
  ],
  fences: [
    // trimmed border hedgerows read as fence lines around the hamlet
    { x1: 306, z1: 796, x2: 334, z2: 796 },
    { x1: 306, z1: 826, x2: 334, z2: 826 },
  ],
  // the Statuary Walk's marble colonnade, and a folly on the north lawn
  ruinRings: [
    { x: 360, z: 875, ringR: 7, columns: 6 },
    { x: 400, z: 1182, ringR: 6, columns: 5 },
  ],
  // the gardener's own plot, unweeded and unnamed
  graveyards: [{ x: 298, z: 796 }],
  // The specimen elders on the lawns: solid trunk colliders in the sim,
  // evergreen crowns drawn by render/garden_features.ts. Kept off every
  // road and clear of the maze.
  greatTrees: [
    { x: 264, z: 850, r: 2.8 },
    { x: 390, z: 902, r: 2.6 },
    { x: 316, z: 1122, r: 3.0 },
    { x: 462, z: 1068, r: 2.6 },
    { x: 244, z: 1034, r: 2.6 },
  ],
};
