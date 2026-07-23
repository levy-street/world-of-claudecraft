// The Frostveil Reach (levels 17-20). A snowbound mountain realm of terraced
// benches, frozen tarns, and auroras, north of the Drakemaw belt. Walked
// into like the Drakelands: the Snowline pass climbs out of the volcanic
// rim on a flat valley floor whose green fades under the snow mile by mile
// (southPassX). Terrain shape: the FROST_* tables in world.ts (coast lobes,
// the bench terracing).

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

export const FROSTVEIL_ZONE: ZoneDef = {
  id: 'frostveil',
  name: 'The Frostveil Reach',
  riftPortalEligible: true,
  riftTierWeights: { B: 0.45, A: 0.4, S: 0.15 },
  zMin: 1440,
  zMax: 1960,
  levelRange: [17, 20],
  biome: 'frost',
  southPassX: 44, // the Wyrmgate: the causeway road now climbs into the snow
  hub: { x: -30, z: 1560, radius: 22, name: 'Icemantle' },
  graveyard: { x: -34, z: 1576 },
  lakes: [
    { x: 60, z: 1640, radius: 16 }, // Glacier Tarn
    { x: 48, z: 1652, radius: 9 }, // ...its still northern finger
    { x: -90, z: 1760, radius: 12 }, // the Shiverfen pool
  ],
  pois: [
    { x: -30, z: 1560, label: 'Icemantle', id: 'icemantle' },
    { x: -10, z: 1495, label: 'The Snowline', id: 'the_snowline' },
    { x: 60, z: 1640, label: 'Glacier Tarn', id: 'glacier_tarn' },
    { x: 30, z: 1740, label: 'The Aurora Steps', id: 'the_aurora_steps' },
    { x: -90, z: 1760, label: 'The Shiverfen', id: 'the_shiverfen' },
    { x: 100, z: 1810, label: 'The Howling Terraces', id: 'the_howling_terraces' },
  ],
  welcome: 'Snow swallows every sound. Under the dancing lights, the cold itself feels awake.',
};

// Bench-to-bench mountain paths; terracing is suppressed near roads so every
// marked route stays climbable (see the frost shaping in world.ts).
export const FROSTVEIL_ROADS: { x: number; z: number }[][] = [
  [
    { x: -30, z: 1560 },
    { x: 10, z: 1600 },
    { x: 42, z: 1626 },
  ], // Icemantle -> the Glacier Tarn shore
  [
    { x: 42, z: 1626 },
    { x: 28, z: 1662 },
    { x: 40, z: 1700 },
    { x: 30, z: 1740 },
  ], // the tarn shore -> the Aurora Steps, skirting the tarn's finger
  [
    { x: -30, z: 1560 },
    { x: -70, z: 1660 },
    { x: -78, z: 1746 },
  ], // Icemantle -> the Shiverfen's edge
  [
    { x: 30, z: 1740 },
    { x: 70, z: 1790 },
    { x: 90, z: 1830 },
  ], // the Aurora Steps -> the Howling Terraces
  [
    { x: 30, z: 1740 },
    { x: -40, z: 1800 },
    { x: -120, z: 1860 },
    { x: -176, z: 1888 },
  ], // the Aurora Steps -> the Goldmelt crossing (into the autumn)
  [
    { x: -30, z: 1560 },
    { x: 20, z: 1612 },
    { x: 30, z: 1666 },
    { x: 80, z: 1694 },
    { x: 130, z: 1760 },
    { x: 120, z: 1840 },
    { x: 142, z: 1876 },
    { x: 176, z: 1888 },
  ], // Icemantle -> around the tarn -> the Snowline crossing (west of the moat coves)
  [
    { x: -30, z: 1560 },
    { x: -10, z: 1520 },
    { x: 20, z: 1480 },
    { x: 44, z: 1448 },
  ], // Icemantle -> south to the Wyrmgate (down to the causeway)
];

// No portals: the Reach is walked into over the Snowline pass.
export const FROSTVEIL_PORTALS: PortalDef[] = [];

// The Reach's first inhabitants (quests and folk follow in the next pass):
// wolves and rime elementals hunt the benches, wisps drift the aurora
// country, sprites keep to the fen, and a yeti stalks the far terraces.
export const FROSTVEIL_MOBS: Record<string, MobTemplate> = {
  snowdrift_wolf: {
    id: 'snowdrift_wolf',
    name: 'Snowdrift Wolf',
    minLevel: 17,
    maxLevel: 18,
    family: 'beast',
    hpBase: 52,
    hpPerLevel: 18,
    dmgBase: 10,
    dmgPerLevel: 2.2,
    attackSpeed: 1.8,
    armorPerLevel: 12,
    moveSpeed: 8.5,
    aggroRadius: 14,
    loot: [],
    scale: 1.1,
    color: 0xeef4f8,
  },
  ice_wisp: {
    id: 'ice_wisp',
    name: 'Ice Wisp',
    minLevel: 17,
    maxLevel: 18,
    family: 'elemental',
    hpBase: 44,
    hpPerLevel: 16,
    dmgBase: 8,
    dmgPerLevel: 2.0,
    attackSpeed: 2.0,
    armorPerLevel: 10,
    moveSpeed: 7.5,
    aggroRadius: 0, // drifting cold light, harmless unless harmed
    loot: [],
    scale: 0.7,
    color: 0xbfe4ff,
  },
  rime_elemental: {
    id: 'rime_elemental',
    name: 'Rime Elemental',
    minLevel: 18,
    maxLevel: 19,
    family: 'elemental',
    hpBase: 62,
    hpPerLevel: 20,
    dmgBase: 11,
    dmgPerLevel: 2.4,
    attackSpeed: 2.2,
    armorPerLevel: 14,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [],
    scale: 1.15,
    color: 0x9fd0f0,
  },
  fen_sprite: {
    id: 'fen_sprite',
    name: 'Fen Sprite',
    minLevel: 17,
    maxLevel: 18,
    family: 'kobold',
    hpBase: 48,
    hpPerLevel: 17,
    dmgBase: 9,
    dmgPerLevel: 2.1,
    attackSpeed: 1.9,
    armorPerLevel: 11,
    moveSpeed: 8,
    aggroRadius: 10,
    loot: [],
    scale: 0.9,
    color: 0xcfe0ea,
  },
  frostmane_yeti: {
    id: 'frostmane_yeti',
    name: 'Frostmane Yeti',
    minLevel: 19,
    maxLevel: 20,
    family: 'ogre',
    hpBase: 120,
    hpPerLevel: 30,
    dmgBase: 15,
    dmgPerLevel: 2.8,
    attackSpeed: 2.4,
    armorPerLevel: 16,
    moveSpeed: 8,
    aggroRadius: 16,
    elite: true,
    loot: [],
    scale: 1.5,
    color: 0xf2f6fa,
  },
};
export const FROSTVEIL_NPCS: Record<string, NpcDef> = {
  matriarch_eira: {
    id: 'matriarch_eira',
    name: 'Matriarch Eira',
    title: 'Voice of Icemantle',
    pos: { x: -30, z: 1560 },
    facing: Math.PI,
    color: 0xa9c7db,
    questIds: ['q_frostveil_aurora_call', 'q_frostveil_shield_tracks'],
    greeting:
      'The ice remembers every footstep, $C. Walk lightly, listen closely, and Frostveil may let you pass.',
  },
  watcher_senn: {
    id: 'watcher_senn',
    name: 'Watcher Senn',
    title: 'Aurora Warden',
    pos: { x: 30, z: 1740 },
    facing: Math.PI,
    color: 0x82b8c9,
    questIds: ['q_frostveil_aurora_call', 'q_frostveil_three_cairns', 'q_frostveil_shield_tracks'],
    greeting:
      'The aurora is beautiful because you cannot hear it screaming. I can, and tonight it is warning us.',
  },
};
export const FROSTVEIL_QUESTS: Record<string, QuestDef> = {
  q_frostveil_aurora_call: {
    id: 'q_frostveil_aurora_call',
    name: 'Where the Aurora Touches',
    giverNpcId: 'matriarch_eira',
    turnInNpcId: 'watcher_senn',
    text: 'Senn watches the lights from the Aurora Steps, beyond the tarn and the wolf packs. He sent a signal of three blue flames before the storm swallowed the ridge. Find him and bring Icemantle his warning.',
    completionText:
      'You crossed the storm for a warning. Then you should see what the warning concerns before we carry it home.',
    objectives: [
      { type: 'interact', targetNpcId: 'watcher_senn', count: 1, label: 'Watcher Senn found' },
    ],
    xpReward: 7500,
    copperReward: 1800,
    itemRewards: {},
    minLevel: 17,
  },
  q_frostveil_three_cairns: {
    id: 'q_frostveil_three_cairns',
    name: 'Three Cairns in the Snow',
    giverNpcId: 'watcher_senn',
    turnInNpcId: 'watcher_senn',
    text: 'Our warding stones at Glacier Tarn, Shiverfen, and the Howling Terraces should glow beneath the aurora. Touch each cairn and tell me which light has failed. That path will show us where the storm entered.',
    completionText:
      'The last cairn is dark, then. The storm did not come from the sky at all. Something large walked down from the terraces and dragged the cold behind it.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'frostveil_cairn_tarn',
        count: 1,
        label: 'Glacier Tarn cairn inspected',
      },
      {
        type: 'interact',
        targetObjectItemId: 'frostveil_cairn_fen',
        count: 1,
        label: 'Shiverfen cairn inspected',
      },
      {
        type: 'interact',
        targetObjectItemId: 'frostveil_cairn_terrace',
        count: 1,
        label: 'Howling Terraces cairn inspected',
      },
    ],
    xpReward: 9500,
    copperReward: 2800,
    itemRewards: {},
    requiresQuest: 'q_frostveil_aurora_call',
    minLevel: 18,
  },
  q_frostveil_shield_tracks: {
    id: 'q_frostveil_shield_tracks',
    name: 'Tracks Broad as Shields',
    giverNpcId: 'watcher_senn',
    turnInNpcId: 'matriarch_eira',
    text: 'The tracks beyond the final cairn are broad as shields. A Frostmane has claimed the terraces and shattered every ward it found. Hunt the yeti among the high ice before it follows our lights back to Icemantle.',
    completionText:
      'The old cairns will be raised again, but their light would have led that beast straight to us. You have bought Icemantle another winter.',
    objectives: [
      { type: 'kill', targetMobId: 'frostmane_yeti', count: 1, label: 'Frostmane Yeti defeated' },
    ],
    xpReward: 13000,
    copperReward: 4400,
    itemRewards: {},
    requiresQuest: 'q_frostveil_three_cairns',
    minLevel: 19,
    suggestedPlayers: 2,
  },
};
export const FROSTVEIL_QUEST_ORDER: string[] = [
  'q_frostveil_aurora_call',
  'q_frostveil_three_cairns',
  'q_frostveil_shield_tracks',
];
export const FROSTVEIL_ITEMS: Record<string, ItemDef> = {
  frostveil_cairn_tarn: {
    id: 'frostveil_cairn_tarn',
    name: 'Tarn Warding Cairn',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_frostveil_three_cairns',
    noVendorSell: true,
  },
  frostveil_cairn_fen: {
    id: 'frostveil_cairn_fen',
    name: 'Fen Warding Cairn',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_frostveil_three_cairns',
    noVendorSell: true,
  },
  frostveil_cairn_terrace: {
    id: 'frostveil_cairn_terrace',
    name: 'Terrace Warding Cairn',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_frostveil_three_cairns',
    noVendorSell: true,
  },
};
export const FROSTVEIL_CAMPS: CampDef[] = [
  { mobId: 'snowdrift_wolf', center: { x: 20, z: 1610 }, radius: 10, count: 3 },
  { mobId: 'snowdrift_wolf', center: { x: -60, z: 1690 }, radius: 10, count: 3 },
  { mobId: 'ice_wisp', center: { x: 30, z: 1745 }, radius: 12, count: 4 },
  { mobId: 'rime_elemental', center: { x: 66, z: 1622 }, radius: 9, count: 2 },
  { mobId: 'rime_elemental', center: { x: 10, z: 1800 }, radius: 10, count: 2 },
  { mobId: 'fen_sprite', center: { x: -84, z: 1738 }, radius: 11, count: 3 },
  { mobId: 'frostmane_yeti', center: { x: 96, z: 1816 }, radius: 6, count: 1 },
];
export const FROSTVEIL_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'frostveil_cairn_tarn',
    name: 'Tarn Warding Cairn',
    positions: [{ x: 60, z: 1640 }],
  },
  {
    itemId: 'frostveil_cairn_fen',
    name: 'Fen Warding Cairn',
    positions: [{ x: -90, z: 1760 }],
  },
  {
    itemId: 'frostveil_cairn_terrace',
    name: 'Terrace Warding Cairn',
    positions: [{ x: 70, z: 1810 }],
  },
];

export const FROSTVEIL_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // Icemantle: a snug village ringing its firelit market plaza (the well
  // and the great fire at the centre, stalls and crates crowding in, homes
  // and the lodge shouldering close against the cold)
  buildings: [
    { kind: 'inn', x: -42, z: 1554, w: 6, d: 7, rot: 0.9 }, // the Hearth-Lodge
    { kind: 'house', x: -20, z: 1550, w: 6, d: 6, rot: -0.5 },
    { kind: 'house', x: -40, z: 1572, w: 6, d: 6, rot: 2.2 },
    { kind: 'chapel', x: -18, z: 1570, w: 5, d: 7, rot: -2.0 },
    { kind: 'house', x: -30, z: 1544, w: 5, d: 5, rot: 0.1 }, // the fisher's hut
    { kind: 'house', x: -44, z: 1563, w: 5, d: 5, rot: 1.4 },
    { kind: 'inn', x: -22, z: 1578, w: 5, d: 6, rot: -2.6 }, // the trade hall
  ],
  wells: [{ x: -30, z: 1562, r: 1.5 }],
  stalls: [
    { x: -24, z: 1556, rot: 0.6, r: 1.6 },
    { x: -36, z: 1566, rot: -1.2, r: 1.6 },
    { x: -34, z: 1554, rot: 2.1, r: 1.6 },
    { x: -25, z: 1568, rot: -0.4, r: 1.6 },
  ],
  crates: [
    [-27, 1558],
    [-33, 1565],
    [-23, 1562],
    [-38, 1558],
  ],
  fences: [
    { x1: -46, z1: 1546, x2: -38, z2: 1542 },
    { x1: -16, z1: 1558, x2: -14, z2: 1566 },
    { x1: -44, z1: 1578, x2: -36, z2: 1580 },
  ],
  tents: [
    { x: -12, z: 1500, rot: 0.4, scale: 1 }, // the Snowline waycamp
  ],
  campfires: [
    [-30, 1560],
    [-28, 1564], // the plaza's great fire is really two, for a wider glow
    [-11, 1498],
  ],
};
