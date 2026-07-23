// The Galecrest (level 20). The world's first EAST map: a wind-scoured
// headland realm in its own grid column beside the Willowfen, entered on
// foot through the Windway, a pass in the mountain border that runs along
// the shared edge (no teleport; the border ridge is real ground, opened at
// westPassZ). Salt-silvered downs roll to grey sea cliffs; the fishing town
// of Wickharbor keeps its boats in the lee of the harbor cove; the Old
// Beacon burns on the highest head, sea stacks stand off the Shear, and the
// Wreckfields beach its bones in the north. Terrain: the GALE_* tables in
// world.ts; the lighthouse, sea stacks, and wreck ribs live in
// render/gale_features.ts.

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

export const GALECREST_ZONE: ZoneDef = {
  id: 'galecrest',
  name: 'The Galecrest',
  riftPortalEligible: true,
  riftTierWeights: { A: 0.4, S: 0.6 },
  zMin: 180,
  zMax: 700,
  xMin: 180,
  xMax: 540,
  levelRange: [20, 20],
  biome: 'gale',
  westPassZ: 440, // the Windway: where the marsh road climbs into the wind
  hub: { x: 420, z: 360, radius: 16, name: 'Wickharbor' },
  graveyard: { x: 404, z: 344 },
  lakes: [
    { x: 300, z: 560, radius: 10 }, // the Mirror Tarn, up on the downs
  ],
  pois: [
    { x: 420, z: 360, label: 'Wickharbor', id: 'wickharbor' },
    { x: 200, z: 440, label: 'The Windway', id: 'the_windway' },
    { x: 280, z: 320, label: 'The Howling Downs', id: 'the_howling_downs' },
    { x: 498, z: 308, label: 'The Old Beacon', id: 'the_old_beacon' },
    { x: 455, z: 535, label: 'The Shear', id: 'the_shear' },
    { x: 340, z: 645, label: 'The Wreckfields', id: 'the_wreckfields' },
    { x: 300, z: 560, label: 'The Mirror Tarn', id: 'the_mirror_tarn' },
  ],
  welcome:
    'The wind has never once stopped here, and the Old Beacon has never once gone out. Wickharbor asks only that you close the inn door behind you.',
};

export const GALECREST_ROADS: { x: number; z: number }[][] = [
  [
    { x: 186, z: 440 },
    { x: 240, z: 412 },
    { x: 300, z: 378 },
    { x: 360, z: 362 },
    { x: 420, z: 360 },
  ], // the Windway -> across the downs -> Wickharbor
  [
    { x: 420, z: 360 },
    { x: 458, z: 332 },
    { x: 492, z: 312 },
  ], // Wickharbor -> the Old Beacon
  [
    { x: 420, z: 360 },
    { x: 432, z: 440 },
    { x: 446, z: 512 },
    { x: 410, z: 588 },
    { x: 352, z: 636 },
  ], // Wickharbor -> above the Shear -> the Wreckfields
  [
    { x: 420, z: 360 },
    { x: 352, z: 342 },
    { x: 296, z: 324 },
  ], // Wickharbor -> the Howling Downs
  [
    { x: 432, z: 440 },
    { x: 372, z: 488 },
    { x: 316, z: 538 },
  ], // the cliff road -> up to the Mirror Tarn
  [
    { x: 352, z: 636 },
    { x: 376, z: 666 },
    { x: 396, z: 698 },
  ], // the Wreckfields -> up to the Garden Gate (onto the lawns)
] as { x: number; z: number }[][];

// No portals: walked into through the Windway.
export const GALECREST_PORTALS: PortalDef[] = [];

// Quests and folk follow in a later pass.
export const GALECREST_MOBS: Record<string, MobTemplate> = {
  moor_ram: {
    id: 'moor_ram',
    name: 'Moor Ram',
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    hpBase: 58,
    hpPerLevel: 19,
    dmgBase: 11,
    dmgPerLevel: 2.2,
    attackSpeed: 2.0,
    armorPerLevel: 13, // a fleece the wind gave up on
    moveSpeed: 8.5,
    aggroRadius: 0, // grazing the downs, braced side-on to the gale
    loot: [],
    scale: 1.1,
    color: 0xd8d0c0,
  },
  gale_wisp: {
    id: 'gale_wisp',
    name: 'Gale Wisp',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    hpBase: 52,
    hpPerLevel: 18,
    dmgBase: 12,
    dmgPerLevel: 2.3,
    attackSpeed: 1.9,
    armorPerLevel: 9,
    moveSpeed: 9,
    aggroRadius: 11, // a knot of living wind, and it resents shelter
    loot: [],
    scale: 1.25,
    color: 0xbfe0e8,
  },
  shoal_scuttler: {
    id: 'shoal_scuttler',
    name: 'Shoal Scuttler',
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    hpBase: 56,
    hpPerLevel: 19,
    dmgBase: 11,
    dmgPerLevel: 2.3,
    attackSpeed: 2.0,
    armorPerLevel: 14, // storm-shell
    moveSpeed: 7,
    aggroRadius: 8,
    loot: [],
    scale: 1.2,
    color: 0x8898a8,
  },
  the_wreck_warden: {
    id: 'the_wreck_warden',
    name: 'The Wreck Warden',
    minLevel: 20,
    maxLevel: 20,
    family: 'undead',
    hpBase: 155,
    hpPerLevel: 34,
    dmgBase: 17,
    dmgPerLevel: 3.0,
    attackSpeed: 2.3,
    armorPerLevel: 17, // barnacled plate
    moveSpeed: 8,
    aggroRadius: 14, // every hull on that beach is a grave he keeps
    elite: true,
    loot: [],
    scale: 1.45,
    color: 0x7a8a86,
  },
};
export const GALECREST_NPCS: Record<string, NpcDef> = {
  harbormaster_pell: {
    id: 'harbormaster_pell',
    name: 'Harbormaster Pell',
    title: 'Master of Wickharbor',
    pos: { x: 420, z: 360 },
    facing: Math.PI,
    color: 0x6f8790,
    questIds: ['q_galecrest_beacon_orders', 'q_galecrest_wreck_warden'],
    greeting:
      'If the wind takes your hat, let it go. If it takes a ship, $C, then we have work to do.',
  },
  beacon_keeper_ada: {
    id: 'beacon_keeper_ada',
    name: 'Beacon Keeper Ada',
    title: 'Keeper of the Old Light',
    pos: { x: 498, z: 308 },
    facing: Math.PI,
    color: 0x8b9498,
    questIds: [
      'q_galecrest_beacon_orders',
      'q_galecrest_storm_signals',
      'q_galecrest_wreck_warden',
    ],
    greeting:
      'The old light does not guide ships anymore. It tells us which wrecks are trying to crawl back into the sea.',
  },
};
export const GALECREST_QUESTS: Record<string, QuestDef> = {
  q_galecrest_beacon_orders: {
    id: 'q_galecrest_beacon_orders',
    name: 'Orders for the Old Beacon',
    giverNpcId: 'harbormaster_pell',
    turnInNpcId: 'beacon_keeper_ada',
    text: 'The Old Beacon flashed at noon with no keeper on the lens. Climb east from Wickharbor, find Ada, and ask what can cast a shadow bright enough to wake that ancient light.',
    completionText:
      'Pell saw it from the harbor, then. The storm posts will tell us whether the warning came from sea, sky, or something below both.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'beacon_keeper_ada',
        count: 1,
        label: 'Beacon Keeper Ada found',
      },
    ],
    xpReward: 5000,
    copperReward: 2400,
    itemRewards: {},
    minLevel: 19,
  },
  q_galecrest_storm_signals: {
    id: 'q_galecrest_storm_signals',
    name: 'Signals in the Gale',
    giverNpcId: 'beacon_keeper_ada',
    turnInNpcId: 'beacon_keeper_ada',
    text: 'Sound the storm posts on the Howling Downs, beside Mirror Tarn, and among the Wreckfields. Their three notes will locate the thing calling drowned ships toward shore.',
    completionText:
      'Downs and tarn answered clear. The Wreckfields answered with a fourth note, deep as a hull breaking. Their warden is awake.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'galecrest_signal_downs',
        count: 1,
        label: 'Howling Downs storm post sounded',
      },
      {
        type: 'interact',
        targetObjectItemId: 'galecrest_signal_tarn',
        count: 1,
        label: 'Mirror Tarn storm post sounded',
      },
      {
        type: 'interact',
        targetObjectItemId: 'galecrest_signal_wrecks',
        count: 1,
        label: 'Wreckfields storm post sounded',
      },
    ],
    xpReward: 6200,
    copperReward: 3400,
    itemRewards: {},
    requiresQuest: 'q_galecrest_beacon_orders',
    minLevel: 19,
  },
  q_galecrest_wreck_warden: {
    id: 'q_galecrest_wreck_warden',
    name: 'The Fourth Note',
    giverNpcId: 'beacon_keeper_ada',
    turnInNpcId: 'harbormaster_pell',
    text: 'The Wreck Warden is ringing drowned bells beneath the sand, and every storm will bring it more ships. Find the thing among the broken hulls and silence its fourth note.',
    completionText:
      'The harbor bells sound like themselves again. Sailors will still fear Galecrest, but at least the dead have stopped giving directions.',
    objectives: [
      { type: 'kill', targetMobId: 'the_wreck_warden', count: 1, label: 'Wreck Warden defeated' },
    ],
    xpReward: 7600,
    copperReward: 5200,
    itemRewards: {},
    requiresQuest: 'q_galecrest_storm_signals',
    minLevel: 20,
    suggestedPlayers: 2,
  },
};
export const GALECREST_QUEST_ORDER: string[] = [
  'q_galecrest_beacon_orders',
  'q_galecrest_storm_signals',
  'q_galecrest_wreck_warden',
];
export const GALECREST_ITEMS: Record<string, ItemDef> = {
  galecrest_signal_downs: {
    id: 'galecrest_signal_downs',
    name: 'Downs Storm Post',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_galecrest_storm_signals',
    noVendorSell: true,
  },
  galecrest_signal_tarn: {
    id: 'galecrest_signal_tarn',
    name: 'Tarn Storm Post',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_galecrest_storm_signals',
    noVendorSell: true,
  },
  galecrest_signal_wrecks: {
    id: 'galecrest_signal_wrecks',
    name: 'Wreckfields Storm Post',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_galecrest_storm_signals',
    noVendorSell: true,
  },
};
export const GALECREST_CAMPS: CampDef[] = [
  { mobId: 'moor_ram', center: { x: 292, z: 312 }, radius: 11, count: 3 },
  { mobId: 'moor_ram', center: { x: 262, z: 360 }, radius: 10, count: 3 },
  { mobId: 'gale_wisp', center: { x: 302, z: 522 }, radius: 11, count: 3 },
  { mobId: 'gale_wisp', center: { x: 366, z: 570 }, radius: 10, count: 3 },
  { mobId: 'shoal_scuttler', center: { x: 444, z: 438 }, radius: 10, count: 3 },
  { mobId: 'shoal_scuttler', center: { x: 386, z: 622 }, radius: 9, count: 2 },
  { mobId: 'the_wreck_warden', center: { x: 330, z: 638 }, radius: 5, count: 1 },
];
export const GALECREST_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'galecrest_signal_downs',
    name: 'Downs Storm Post',
    positions: [{ x: 280, z: 320 }],
  },
  {
    itemId: 'galecrest_signal_tarn',
    name: 'Tarn Storm Post',
    positions: [{ x: 300, z: 560 }],
  },
  {
    itemId: 'galecrest_signal_wrecks',
    name: 'Wreckfields Storm Post',
    positions: [{ x: 360, z: 650 }],
  },
];

export const GALECREST_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // Wickharbor: a fishing town in the lee of the harbor cove
  buildings: [
    { kind: 'inn', x: 412, z: 352, w: 6, d: 7, rot: 0.4 },
    { kind: 'house', x: 428, z: 368, w: 5, d: 5, rot: -1.2 },
    { kind: 'house', x: 410, z: 370, w: 5, d: 5, rot: 2.2 },
  ],
  wells: [{ x: 420, z: 362, r: 1.5 }],
  stalls: [
    { x: 426, z: 354, rot: 0.6, r: 1.6 },
    { x: 414, z: 360, rot: -1.4, r: 1.6 },
  ],
  crates: [
    [432, 356],
    [408, 358],
  ],
  campfires: [
    [420, 356],
    [196, 434], // the Windway's waycamp
  ],
  // the harbor: a working dock running into the cove east of town (hw/hd 0: no hut)
  docks: [{ x: 436, z: 372, rot: 2.2, hutLocal: { x: 40, z: 40, hw: 0, hd: 0 } }],
  fences: [
    // windbreak lines, the only fences that matter here
    { x1: 406, z1: 346, x2: 434, z2: 346 },
    { x1: 406, z1: 376, x2: 434, z2: 376 },
  ],
  // an old watch ruin on the Howling Downs, and the beacon's fallen forecourt
  ruinRings: [
    { x: 288, z: 328, ringR: 7, columns: 5 },
    { x: 492, z: 316, ringR: 6, columns: 4 },
  ],
  graveyards: [{ x: 400, z: 342 }],
};
