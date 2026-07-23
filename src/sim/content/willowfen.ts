// The Willowfen (levels 19-20). North past the Amberfall's crown: a bright,
// gentle wetland under a clear morning sky. Bog pools and lake-mazes with
// little islands, weeping willows trailing into the water, flowering
// hedges, and the town of Bridgemere on its own island inside a ring moat,
// entered over the Fenway bridge causeway. Walked into over the Amberfen
// Steps (southPassX). Terrain: the FEN_* tables in world.ts; the willows,
// lilypads, and bridge dressing live in render/fen_features.ts.

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

// The moat: a ring of overlapping carves around the Bridgemere island, with
// one gap at the south where the Fenway causeway crosses (the bridge).
const MOAT: { x: number; z: number; radius: number }[] = [
  { x: -338, z: 358, radius: 11 },
  { x: -344, z: 380, radius: 11 },
  { x: -364, z: 390, radius: 11 },
  { x: -382, z: 380, radius: 11 },
  { x: -386, z: 358, radius: 11 },
  { x: -382, z: 336, radius: 9 }, // the ring closes SW, clear of the causeway
];

export const WILLOWFEN_ZONE: ZoneDef = {
  id: 'willowfen',
  name: 'The Willowfen',
  riftPortalEligible: true,
  riftTierWeights: { B: 0.1, A: 0.55, S: 0.35 },
  zMin: 180,
  zMax: 700,
  xMin: -540,
  xMax: -180,
  levelRange: [19, 20],
  biome: 'fen',
  eastPassZ: 440, // the Mirewalk: where the marsh road wades into the fen
  hub: { x: -360, z: 362, radius: 17, name: 'Bridgemere' },
  graveyard: { x: -346, z: 338 },
  lakes: [
    ...MOAT,
    // the Lilymoors: three pools ringing a real dry islet at (-87,3247)
    { x: -436, z: 286, radius: 13 },
    { x: -468, z: 304, radius: 11 },
    { x: -442, z: 330, radius: 11 },
    { x: -416, z: 310, radius: 9 },
    // Bogshine Pools: scattered bright bog eyes
    { x: -290, z: 280, radius: 12 },
    { x: -268, z: 298, radius: 9 },
    { x: -302, z: 304, radius: 8 },
    // the Drowsy Flats: three sheets ringing the Croaker's islet at (38,3436)
    { x: -336, z: 474, radius: 13 },
    { x: -302, z: 500, radius: 12 },
    { x: -332, z: 516, radius: 11 },
    { x: -426, z: 460, radius: 14 }, // Willowweep's pool
    { x: -444, z: 478, radius: 10 },
  ],
  pois: [
    { x: -360, z: 362, label: 'Bridgemere', id: 'bridgemere' },
    { x: -380, z: 208, label: 'The Amberfen Steps', id: 'the_amberfen_steps' },
    { x: -444, z: 308, label: 'The Lilymoors', id: 'the_lilymoors' },
    { x: -286, z: 292, label: 'Bogshine Pools', id: 'bogshine_pools' },
    { x: -430, z: 466, label: 'Willowweep', id: 'willowweep' },
    { x: -320, z: 496, label: 'The Drowsy Flats', id: 'the_drowsy_flats' },
  ],
  welcome:
    'The fen hums with dragonflies and bees. Cross the bridge into Bridgemere and rest your feet awhile.',
};

export const WILLOWFEN_ROADS: { x: number; z: number }[][] = [
  [
    { x: -372, z: 260 },
    { x: -360, z: 322 },
    { x: -360, z: 362 },
  ], // the Amberfen Steps -> the Fenway causeway -> Bridgemere
  // every spoke leaves over the causeway: the moat has ONE crossing
  [
    { x: -360, z: 324 },
    { x: -390, z: 300 },
    { x: -416, z: 296 },
  ], // the causeway -> the Lilymoors' southern edge
  [
    { x: -360, z: 324 },
    { x: -326, z: 308 },
    { x: -312, z: 286 },
  ], // the causeway -> Bogshine Pools' southern edge
  [
    { x: -360, z: 324 },
    { x: -396, z: 322 },
    { x: -406, z: 360 },
    { x: -410, z: 404 },
    { x: -412, z: 442 },
  ], // the causeway -> wide around the moat's west -> Willowweep's shore
  [
    { x: -360, z: 324 },
    { x: -322, z: 342 },
    { x: -322, z: 406 },
    { x: -330, z: 456 },
  ], // the causeway -> around the moat's east -> the Drowsy Flats' shore
  [
    { x: -412, z: 442 },
    { x: -404, z: 520 },
    { x: -396, z: 590 },
    { x: -394, z: 660 },
    { x: -398, z: 706 },
  ], // Willowweep's shore -> the north fen -> the Tanglemouth
  [
    { x: -330, z: 390 },
    { x: -278, z: 418 },
    { x: -230, z: 434 },
    { x: -184, z: 440 },
  ], // the Drowsy Flats track -> east over the moors -> the Windway
];

// No portals: walked into over the Amberfen Steps.
export const WILLOWFEN_PORTALS: PortalDef[] = [];

// Quests and folk follow in a later pass.
export const WILLOWFEN_MOBS: Record<string, MobTemplate> = {
  bogtoad: {
    id: 'bogtoad',
    name: 'Bogtoad',
    minLevel: 19,
    maxLevel: 20,
    family: 'murloc',
    hpBase: 56,
    hpPerLevel: 20,
    dmgBase: 11,
    dmgPerLevel: 2.3,
    attackSpeed: 2.0,
    armorPerLevel: 12,
    moveSpeed: 8,
    aggroRadius: 12,
    loot: [],
    scale: 1,
    color: 0x7aa848,
  },
  drowsy_croaker: {
    id: 'drowsy_croaker',
    name: 'The Drowsy Croaker',
    minLevel: 20,
    maxLevel: 20,
    family: 'murloc',
    hpBase: 140,
    hpPerLevel: 34,
    dmgBase: 16,
    dmgPerLevel: 3.0,
    attackSpeed: 2.4,
    armorPerLevel: 17,
    moveSpeed: 7.5,
    aggroRadius: 14,
    elite: true,
    loot: [],
    scale: 1.65,
    color: 0x5a9858,
  },
  lily_wisp: {
    id: 'lily_wisp',
    name: 'Lily Wisp',
    minLevel: 19,
    maxLevel: 19,
    family: 'elemental',
    hpBase: 44,
    hpPerLevel: 16,
    dmgBase: 8,
    dmgPerLevel: 2.0,
    attackSpeed: 2.0,
    armorPerLevel: 10,
    moveSpeed: 7.5,
    aggroRadius: 0, // pale lights adrift over the pools
    loot: [],
    scale: 0.7,
    color: 0xd0f2c8,
  },
  willow_sprite: {
    id: 'willow_sprite',
    name: 'Willow Sprite',
    minLevel: 19,
    maxLevel: 20,
    family: 'kobold',
    hpBase: 50,
    hpPerLevel: 18,
    dmgBase: 10,
    dmgPerLevel: 2.2,
    attackSpeed: 1.9,
    armorPerLevel: 11,
    moveSpeed: 8.5,
    aggroRadius: 10,
    loot: [],
    scale: 0.9,
    color: 0xc8e0b8,
  },
};
export const WILLOWFEN_NPCS: Record<string, NpcDef> = {
  mayor_alda: {
    id: 'mayor_alda',
    name: 'Mayor Alda',
    title: 'Speaker of Bridgemere',
    pos: { x: -360, z: 362 },
    facing: Math.PI,
    color: 0x78975a,
    questIds: ['q_willowfen_fenward', 'q_willowfen_croaker'],
    greeting:
      'The fen is friendly if you know where it sleeps. Lately, $C, it has been waking in all the wrong places.',
  },
  fenward_oli: {
    id: 'fenward_oli',
    name: 'Fenward Oli',
    title: 'Keeper of the Reed Marks',
    pos: { x: -444, z: 308 },
    facing: Math.PI / 2,
    color: 0x6e8d4e,
    questIds: ['q_willowfen_fenward', 'q_willowfen_marker_round', 'q_willowfen_croaker'],
    greeting:
      'Step where the reeds bend, not where they point. One path takes you home and the other feeds the bogtoads.',
  },
};
export const WILLOWFEN_QUESTS: Record<string, QuestDef> = {
  q_willowfen_fenward: {
    id: 'q_willowfen_fenward',
    name: 'The Missing Fenward',
    giverNpcId: 'mayor_alda',
    turnInNpcId: 'fenward_oli',
    text: 'Oli went to reset the reed marks and never returned. Cross the old bridge to the Lilymoors, find our fenward, and learn why every safe path now points toward deep water.',
    completionText:
      'Alda sent help at last. Something has turned every marker in the fen, and I have been too busy avoiding hungry mouths to turn them back.',
    objectives: [
      { type: 'interact', targetNpcId: 'fenward_oli', count: 1, label: 'Fenward Oli found' },
    ],
    xpReward: 5000,
    copperReward: 2400,
    itemRewards: {},
    minLevel: 19,
  },
  q_willowfen_marker_round: {
    id: 'q_willowfen_marker_round',
    name: 'Reeds Point Home',
    giverNpcId: 'fenward_oli',
    turnInNpcId: 'fenward_oli',
    text: 'Reset the carved markers at Bogshine Pools, Willowweep, and the Drowsy Flats. They stand beside the safest patches of ground, or they did before something big began moving them in the night.',
    completionText:
      'Mud on every post, and the same round scrape beneath each one. That old croaker is not sleeping anymore. It is herding travelers toward its hollow.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'willowfen_marker_bogshine',
        count: 1,
        label: 'Bogshine reed marker reset',
      },
      {
        type: 'interact',
        targetObjectItemId: 'willowfen_marker_willowweep',
        count: 1,
        label: 'Willowweep reed marker reset',
      },
      {
        type: 'interact',
        targetObjectItemId: 'willowfen_marker_drowsy',
        count: 1,
        label: 'Drowsy Flats reed marker reset',
      },
    ],
    xpReward: 6200,
    copperReward: 3400,
    itemRewards: {},
    requiresQuest: 'q_willowfen_fenward',
    minLevel: 19,
  },
  q_willowfen_croaker: {
    id: 'q_willowfen_croaker',
    name: 'The Fen Stops Snoring',
    giverNpcId: 'fenward_oli',
    turnInNpcId: 'mayor_alda',
    text: 'The Drowsy Croaker has learned that turned markers bring easy meals. Find the giant toad in the flats and put it back into the deep sleep its name promises.',
    completionText:
      'Bridgemere heard that final croak from here. The bridges are ours again, and Oli may finally stop shouting at the reeds.',
    objectives: [
      { type: 'kill', targetMobId: 'drowsy_croaker', count: 1, label: 'Drowsy Croaker defeated' },
    ],
    xpReward: 7600,
    copperReward: 5200,
    itemRewards: {},
    requiresQuest: 'q_willowfen_marker_round',
    minLevel: 20,
    suggestedPlayers: 2,
  },
};
export const WILLOWFEN_QUEST_ORDER: string[] = [
  'q_willowfen_fenward',
  'q_willowfen_marker_round',
  'q_willowfen_croaker',
];
export const WILLOWFEN_ITEMS: Record<string, ItemDef> = {
  willowfen_marker_bogshine: {
    id: 'willowfen_marker_bogshine',
    name: 'Bogshine Reed Marker',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_willowfen_marker_round',
    noVendorSell: true,
  },
  willowfen_marker_willowweep: {
    id: 'willowfen_marker_willowweep',
    name: 'Willowweep Reed Marker',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_willowfen_marker_round',
    noVendorSell: true,
  },
  willowfen_marker_drowsy: {
    id: 'willowfen_marker_drowsy',
    name: 'Drowsy Flats Reed Marker',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_willowfen_marker_round',
    noVendorSell: true,
  },
};
export const WILLOWFEN_CAMPS: CampDef[] = [
  { mobId: 'bogtoad', center: { x: -430, z: 270 }, radius: 10, count: 3 },
  { mobId: 'bogtoad', center: { x: -284, z: 316 }, radius: 10, count: 3 },
  { mobId: 'lily_wisp', center: { x: -426, z: 440 }, radius: 12, count: 4 },
  { mobId: 'willow_sprite', center: { x: -396, z: 376 }, radius: 10, count: 3 },
  { mobId: 'willow_sprite', center: { x: -316, z: 380 }, radius: 10, count: 2 },
  { mobId: 'drowsy_croaker', center: { x: -322, z: 496 }, radius: 5, count: 1 },
];
export const WILLOWFEN_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'willowfen_marker_bogshine',
    name: 'Bogshine Reed Marker',
    positions: [{ x: -286, z: 292 }],
  },
  {
    itemId: 'willowfen_marker_willowweep',
    name: 'Willowweep Reed Marker',
    positions: [{ x: -430, z: 466 }],
  },
  {
    itemId: 'willowfen_marker_drowsy',
    name: 'Drowsy Flats Reed Marker',
    positions: [{ x: -292, z: 496 }],
  },
];

export const WILLOWFEN_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // Bridgemere: a snug island town inside its moat
  buildings: [
    { kind: 'inn', x: -368, z: 366, w: 6, d: 7, rot: 0.7 },
    { kind: 'house', x: -351, z: 360, w: 6, d: 6, rot: -0.9 },
    { kind: 'house', x: -366, z: 352, w: 5, d: 5, rot: 2.4 },
    { kind: 'chapel', x: -354, z: 372, w: 5, d: 7, rot: -2.1 },
  ],
  wells: [{ x: -360, z: 364, r: 1.5 }],
  stalls: [
    { x: -363, z: 358, rot: 0.5, r: 1.6 },
    { x: -356, z: 366, rot: -1.3, r: 1.6 },
  ],
  crates: [
    [-365, 362],
    [-353, 356],
  ],
  campfires: [
    [-360, 360],
    [-379, 212], // the Steps' waycamp
  ],
  // the Fenway: dock planks spanning the moat neck as the town bridge
  // (hutLocal pushed far off-plank so no hut renders on the crossing)
  docks: [{ x: -360, z: 333, rot: 0, hutLocal: { x: 40, z: 40, hw: 0.1, hd: 0.1 } }],
  fences: [
    { x1: -364, z1: 328, x2: -364, z2: 338 }, // bridge rails
    { x1: -356, z1: 328, x2: -356, z2: 338 },
  ],
};
