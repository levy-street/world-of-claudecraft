// The Drakelands (levels 16-20). North across the Pale Causeway: a green
// gatewood at the entrance that dries northward into cinder desert, dune
// seas, and the volcanic Drakemaw belt of lava pools and bloodglass crystal,
// where dragons roost and the troll clans raid. The only zone entered on
// foot from a hidden realm: the causeway road climbs through the Wyrmgate
// pass (southPassX). Terrain shape: the EMBER_* tables in world.ts (coast
// lobes, the desert gradient, volcano cones).

import type {
  CampDef,
  GroundObjectDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  QuestDef,
  ZoneDef,
  ZonePropsDef,
} from '../types';
import { emptyZoneProps } from '../types';

export const DRAKELANDS_ZONE: ZoneDef = {
  id: 'drakelands',
  name: 'The Drakelands',
  riftPortalEligible: true,
  riftTierWeights: { B: 0.45, A: 0.4, S: 0.15 },
  zMin: 1820,
  zMax: 2420,
  xMin: 180,
  xMax: 540,
  levelRange: [16, 20],
  biome: 'ember',
  southPassX: 404, // the Wyrmgate road, now climbing out of the haunted wood
  westPassZ: 1890, // the Snowline: ash meets ice across the column border
  hub: { x: 404, z: 1900, radius: 24, name: 'Wyrmwatch' },
  graveyard: { x: 422, z: 1885 },
  lakes: [
    { x: 340, z: 1925, radius: 14 }, // Greenshade Pool, under the gatewood
    { x: 326, z: 1936, radius: 8 }, // ...its shaded western finger
    { x: 456, z: 1988, radius: 11 }, // the Last Spring, at the forest's edge
    { x: 300, z: 2110, radius: 10 }, // Mirage Hollow, a dune oasis
  ],
  pois: [
    { x: 404, z: 1900, label: 'Wyrmwatch', id: 'wyrmwatch' },
    { x: 360, z: 1940, label: 'The Gatewood', id: 'the_gatewood' },
    { x: 330, z: 2100, label: 'Cinder Dunes', id: 'cinder_dunes' },
    { x: 460, z: 2140, label: 'Trollmoot', id: 'trollmoot' },
    { x: 270, z: 2270, label: 'Bloodglass Fields', id: 'bloodglass_fields' },
    { x: 390, z: 2320, label: 'Drakemaw Caldera', id: 'drakemaw_caldera' },
  ],
  welcome:
    'Hot wind rolls off the wastes ahead. Dragons wheel over the Drakemaw, and troll fires burn in the dunes.',
};

// The causeway road runs on through the Wyrmgate, then forks into the wastes.
export const DRAKELANDS_ROADS: { x: number; z: number }[][] = [
  [
    { x: 404, z: 1804 },
    { x: 404, z: 1850 },
    { x: 404, z: 1900 },
  ], // the Pale Causeway -> the Wyrmgate pass -> Wyrmwatch
  [
    { x: 404, z: 1900 },
    { x: 370, z: 1970 },
    { x: 350, z: 2040 },
    { x: 330, z: 2100 },
  ], // Wyrmwatch -> Cinder Dunes
  [
    { x: 330, z: 2100 },
    { x: 380, z: 2180 },
    { x: 390, z: 2280 },
    { x: 390, z: 2298 },
  ], // Cinder Dunes -> the Drakemaw crater rim
  [
    { x: 380, z: 2180 },
    { x: 460, z: 2140 },
  ], // dune fork -> Trollmoot
  [
    { x: 330, z: 2100 },
    { x: 270, z: 2210 },
    { x: 270, z: 2270 },
  ], // Cinder Dunes -> Bloodglass Fields
  [
    { x: 380, z: 2180 },
    { x: 352, z: 2280 },
    { x: 350, z: 2355 },
  ], // the dune fork -> the crater's north rim
  [
    { x: 330, z: 2100 },
    { x: 276, z: 2044 },
    { x: 230, z: 1964 },
    { x: 186, z: 1892 },
  ], // the Cinder Dunes -> west to the Snowline crossing (fire meets ice)
];

// The caldera's creatures and quest cast support a connected three-part arc.
export const DRAKELANDS_MOBS: Record<string, MobTemplate> = {
  emberwing_drake: {
    id: 'emberwing_drake',
    name: 'Emberwing Drake',
    minLevel: 19,
    maxLevel: 20,
    family: 'dragonkin',
    hpBase: 130,
    hpPerLevel: 32,
    dmgBase: 16,
    dmgPerLevel: 3.0,
    attackSpeed: 2.2,
    armorPerLevel: 16,
    moveSpeed: 9,
    aggroRadius: 18,
    elite: true,
    loot: [],
    scale: 1.4,
    color: 0xd84028,
  },
  ashbone_raider: {
    id: 'ashbone_raider',
    name: 'Ashbone Raider',
    minLevel: 17,
    maxLevel: 18,
    family: 'undead',
    hpBase: 50,
    hpPerLevel: 18,
    dmgBase: 10,
    dmgPerLevel: 2.2,
    attackSpeed: 1.9,
    armorPerLevel: 12,
    moveSpeed: 8,
    aggroRadius: 13,
    loot: [],
    scale: 1,
    color: 0xe8dcc8,
  },
  ashbone_warcaller: {
    id: 'ashbone_warcaller',
    name: 'Ashbone Warcaller',
    minLevel: 18,
    maxLevel: 19,
    family: 'undead',
    hpBase: 62,
    hpPerLevel: 20,
    dmgBase: 12,
    dmgPerLevel: 2.4,
    attackSpeed: 2.1,
    armorPerLevel: 13,
    moveSpeed: 8,
    aggroRadius: 13,
    loot: [],
    scale: 1.1,
    color: 0xd8c8a8,
  },
  dune_troll: {
    id: 'dune_troll',
    name: 'Dune Troll',
    minLevel: 17,
    maxLevel: 19,
    family: 'troll',
    hpBase: 66,
    hpPerLevel: 22,
    dmgBase: 12,
    dmgPerLevel: 2.5,
    attackSpeed: 2.3,
    armorPerLevel: 14,
    moveSpeed: 8.5,
    aggroRadius: 14,
    loot: [],
    scale: 1.15,
    color: 0xb07040,
  },
};
export const DRAKELANDS_NPCS: Record<string, NpcDef> = {
  captain_kaelra: {
    id: 'captain_kaelra',
    name: 'Captain Kaelra',
    title: 'Wyrmwatch Commander',
    pos: { x: 404, z: 1900 },
    facing: Math.PI,
    color: 0xc45a36,
    questIds: ['q_drakewatch_dispatch', 'q_drakewatch_long_climb', 'q_drakewatch_wings'],
    greeting:
      'Wyrmwatch has one road and too many enemies, $C. If you are climbing north, make every step count.',
  },
  scout_vaela: {
    id: 'scout_vaela',
    name: 'Scout Vaela',
    title: 'Caldera Pathfinder',
    pos: { x: 330, z: 2100 },
    facing: 0,
    color: 0xd28b48,
    questIds: ['q_drakewatch_dispatch', 'q_drakewatch_long_climb'],
    greeting:
      'The dunes move, the trolls do not, and the drakes watch both. Stay close if you want the safe road.',
  },
};
export const DRAKELANDS_QUESTS: Record<string, QuestDef> = {
  q_drakewatch_dispatch: {
    id: 'q_drakewatch_dispatch',
    name: 'Smoke on the North Road',
    giverNpcId: 'captain_kaelra',
    turnInNpcId: 'scout_vaela',
    text: 'Vaela has not reported from the Cinder Dunes, and the watchfires beyond her post have gone dark. Follow the north road, find her among the ruined columns, and learn what is moving toward Wyrmwatch.',
    completionText:
      'Kaelra sent you? Good. I found the raiders, the trolls, and something with wings circling the caldera. I could use another blade on the climb.',
    objectives: [
      { type: 'interact', targetNpcId: 'scout_vaela', count: 1, label: 'Scout Vaela found' },
    ],
    xpReward: 14000,
    copperReward: 1600,
    itemRewards: {},
    minLevel: 16,
  },
  q_drakewatch_long_climb: {
    id: 'q_drakewatch_long_climb',
    name: 'The Long Climb',
    giverNpcId: 'scout_vaela',
    turnInNpcId: 'captain_kaelra',
    text: 'I need to mark a safe line from the dunes to the caldera rim, but the Ashbone clan has scouts on the road and Trollmoot has sent hunters after me. Walk with me, $N, and keep them off my back.',
    completionText:
      'You brought Vaela home with a marked road and a count of every threat upon it. That is worth more than another squad behind these walls.',
    objectives: [
      {
        type: 'escort',
        targetNpcId: 'scout_vaela',
        count: 1,
        label: 'Scout Vaela escorted to the caldera rim',
        path: [
          { x: 330, z: 2100 },
          { x: 355, z: 2140 },
          { x: 380, z: 2180 },
          { x: 370, z: 2230 },
          { x: 390, z: 2280 },
        ],
        ambushes: [
          { atWaypoint: 1, mobId: 'ashbone_raider', count: 2 },
          { atWaypoint: 3, mobId: 'dune_troll', count: 2 },
        ],
      },
    ],
    xpReward: 19000,
    copperReward: 2600,
    itemRewards: {},
    requiresQuest: 'q_drakewatch_dispatch',
    minLevel: 17,
  },
  q_drakewatch_wings: {
    id: 'q_drakewatch_wings',
    name: 'Wings Over Drakemaw',
    giverNpcId: 'captain_kaelra',
    turnInNpcId: 'captain_kaelra',
    text: 'Vaela marked the beast that drove the lesser drakes from the rim. The Emberwing hunts the whole caldera now, and soon it will test our walls. Climb to its roost and end the threat before it takes flight for Wyrmwatch.',
    completionText:
      'The shadow has left our roofs. Tonight Wyrmwatch sleeps without looking up, and that is your victory, $N.',
    objectives: [
      { type: 'kill', targetMobId: 'emberwing_drake', count: 1, label: 'Emberwing Drake slain' },
    ],
    xpReward: 26000,
    copperReward: 4200,
    itemRewards: {},
    requiresQuest: 'q_drakewatch_long_climb',
    minLevel: 19,
    suggestedPlayers: 2,
  },
};
export const DRAKELANDS_QUEST_ORDER: string[] = [
  'q_drakewatch_dispatch',
  'q_drakewatch_long_climb',
  'q_drakewatch_wings',
];
export const DRAKELANDS_ITEMS: Record<string, ItemDef> = {};
export const DRAKELANDS_CAMPS: CampDef[] = [
  { mobId: 'dune_troll', center: { x: 460, z: 2140 }, radius: 10, count: 3 },
  { mobId: 'dune_troll', center: { x: 476, z: 2124 }, radius: 8, count: 2 },
  { mobId: 'ashbone_raider', center: { x: 356, z: 2086 }, radius: 10, count: 3 },
  { mobId: 'ashbone_raider', center: { x: 296, z: 2184 }, radius: 10, count: 3 },
  { mobId: 'ashbone_warcaller', center: { x: 448, z: 2106 }, radius: 8, count: 2 },
  { mobId: 'emberwing_drake', center: { x: 408, z: 2292 }, radius: 8, count: 1 },
  { mobId: 'emberwing_drake', center: { x: 284, z: 2268 }, radius: 8, count: 1 },
];
export const DRAKELANDS_OBJECTS: GroundObjectDef[] = [];

export const DRAKELANDS_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // fallen keeps of the old drake-cult: castle ruins across the wastes
  ruinRings: [
    { x: 330, z: 2114, ringR: 10, columns: 8 }, // the Cinder Bastion
    { x: 338, z: 2124, ringR: 6, columns: 5 },
    { x: 422, z: 2032, ringR: 8, columns: 6 }, // the Last Keep, forest's edge
    { x: 468, z: 2158, ringR: 7, columns: 6 }, // the Trollmoot henge
    { x: 268, z: 2256, ringR: 6, columns: 5 }, // Bloodglass watch
  ],
  graveyards: [
    { x: 354, z: 2092 },
    { x: 300, z: 2176 },
    { x: 452, z: 2112 },
  ],
  // Wyrmwatch: the dragon-watch garrison town on the Wyrmgate road. The
  // north palisade parts at x 44 for the causeway gate; the southwest road
  // to the dunes leaves between the inn and the well.
  buildings: [
    { kind: 'inn', x: 390, z: 1904, w: 6, d: 7, rot: 0.6 },
    { kind: 'house', x: 414, z: 1892, w: 5, d: 5, rot: -1.1 },
    { kind: 'house', x: 393, z: 1888, w: 5, d: 5, rot: 2.0 },
    { kind: 'house', x: 416, z: 1912, w: 5, d: 6, rot: 2.6 },
  ],
  wells: [{ x: 410, z: 1902, r: 1.5 }],
  stalls: [
    { x: 398, z: 1896, rot: 0.5, r: 1.6 },
    { x: 410, z: 1910, rot: -1.2, r: 1.6 },
  ],
  crates: [
    [406, 1892],
    [396, 1912],
  ],
  fences: [
    // the north palisade, parted at the causeway gate
    { x1: 390, z1: 1882, x2: 400, z2: 1882 },
    { x1: 408, z1: 1882, x2: 416, z2: 1882 },
  ],
  // the old waypost stays: a garrison keeps its road camp
  tents: [
    { x: 396, z: 1894, rot: 0.8, scale: 1 },
    { x: 412, z: 1906, rot: -1.9, scale: 1 },
  ],
  campfires: [[404, 1900]],
};
