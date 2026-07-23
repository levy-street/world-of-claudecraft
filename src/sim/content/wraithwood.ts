// The Wraithwood (level 20). North past the Nightbloom's dream the road
// slips under the Crowgate and the canopy closes overhead: a drowned-grey
// haunted forest where giant overgrown trees shut out the sky, a drizzle
// that never quite stops, and things between the trunks that watch the
// road. The hamlet of Gallowmere holds the center; Widow's Thicket crawls
// in the west, the Hanging Glade swings in the east, the ruined Mournstone
// Chapel moulders by its black tarn, and the Pale Huntsman keeps his
// clearing in the far north. Terrain: the WOOD_* tables in world.ts; the
// giant canopies, ground mist, and ghost-lights live in
// render/haunt_features.ts (the greatTrees records below give the sim its
// solid trunk colliders).

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

export const WRAITHWOOD_ZONE: ZoneDef = {
  id: 'wraithwood',
  name: 'The Wraithwood',
  riftPortalEligible: true,
  riftTierWeights: { A: 0.35, S: 0.65 },
  zMin: 1260,
  zMax: 1820,
  xMin: 180,
  xMax: 540,
  levelRange: [20, 20],
  biome: 'haunt',
  southPassX: 390, // the Crowgate: the climb up from the garden's lawns
  hub: { x: 360, z: 1430, radius: 17, name: 'Gallowmere' },
  graveyard: { x: 378, z: 1412 },
  lakes: [
    { x: 290, z: 1500, radius: 10 }, // the Black Looking-Glass
    { x: 312, z: 1640, radius: 9 }, // the chapel tarn
    { x: 452, z: 1444, radius: 11 }, // the Drowned Coppice
  ],
  pois: [
    { x: 360, z: 1430, label: 'Gallowmere', id: 'gallowmere' },
    { x: 390, z: 1292, label: 'The Crowgate', id: 'the_crowgate' },
    { x: 280, z: 1484, label: "Widow's Thicket", id: 'widows_thicket' },
    { x: 440, z: 1530, label: 'The Hanging Glade', id: 'the_hanging_glade' },
    { x: 300, z: 1620, label: 'The Mournstone Chapel', id: 'the_mournstone_chapel' },
    { x: 380, z: 1680, label: "The Huntsman's Clearing", id: 'the_huntsmans_clearing' },
  ],
  welcome:
    'The canopy closes over the road like a lid. Keep to the lanterns of Gallowmere, and do not answer if the wood calls your name.',
};

export const WRAITHWOOD_ROADS: { x: number; z: number }[][] = [
  [
    { x: 390, z: 1268 },
    { x: 384, z: 1326 },
    { x: 370, z: 1382 },
    { x: 360, z: 1430 },
  ], // the Crowgate -> Gallowmere
  [
    { x: 360, z: 1430 },
    { x: 322, z: 1454 },
    { x: 296, z: 1472 },
  ], // Gallowmere -> Widow's Thicket
  [
    { x: 360, z: 1430 },
    { x: 396, z: 1468 },
    { x: 422, z: 1504 },
  ], // Gallowmere -> the Hanging Glade
  [
    { x: 360, z: 1430 },
    { x: 338, z: 1500 },
    { x: 318, z: 1570 },
    { x: 306, z: 1608 },
  ], // Gallowmere -> the Mournstone Chapel
  [
    { x: 360, z: 1430 },
    { x: 368, z: 1510 },
    { x: 374, z: 1590 },
    { x: 378, z: 1660 },
    { x: 390, z: 1706 },
    { x: 398, z: 1748 },
    { x: 404, z: 1794 },
  ], // Gallowmere -> the Huntsman's Clearing -> the Wyrmroad (into the waste)
  [
    { x: 360, z: 1430 },
    { x: 332, z: 1520 },
    { x: 327, z: 1620 },
    { x: 326, z: 1660 },
    { x: 306, z: 1744 },
  ], // Gallowmere -> east of the chapel tarn -> the Ashmere's shore
  [
    { x: 296, z: 1472 },
    { x: 262, z: 1496 },
    { x: 244, z: 1512 },
  ], // Widow's Thicket -> down to the Veilmelt's grey shore
];

// No portals: walked into under the Crowgate.
export const WRAITHWOOD_PORTALS: PortalDef[] = [];

// Quests and folk follow in a later pass.
export const WRAITHWOOD_MOBS: Record<string, MobTemplate> = {
  widowsilk_spinner: {
    id: 'widowsilk_spinner',
    name: 'Widowsilk Spinner',
    minLevel: 20,
    maxLevel: 20,
    family: 'spider',
    hpBase: 56,
    hpPerLevel: 20,
    dmgBase: 12,
    dmgPerLevel: 2.4,
    attackSpeed: 1.9,
    armorPerLevel: 12,
    moveSpeed: 8.5,
    aggroRadius: 12,
    loot: [],
    scale: 1.3,
    color: 0x3a3440,
  },
  wood_wraith: {
    id: 'wood_wraith',
    name: 'Wood Wraith',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    hpBase: 52,
    hpPerLevel: 18,
    dmgBase: 11,
    dmgPerLevel: 2.3,
    attackSpeed: 2.0,
    armorPerLevel: 10,
    moveSpeed: 8,
    aggroRadius: 12, // it drifts between the trunks, and it minds trespass
    loot: [],
    scale: 1.3,
    color: 0x9ab4a0,
  },
  gravenbark_shambler: {
    id: 'gravenbark_shambler',
    name: 'Gravenbark Shambler',
    minLevel: 20,
    maxLevel: 20,
    family: 'ogre',
    hpBase: 90,
    hpPerLevel: 26,
    dmgBase: 14,
    dmgPerLevel: 2.6,
    attackSpeed: 2.6,
    armorPerLevel: 15,
    moveSpeed: 6.5, // a tree that decided to walk does not hurry
    aggroRadius: 8,
    loot: [],
    scale: 1.35,
    color: 0x4e4a3a,
  },
  pale_huntsman: {
    id: 'pale_huntsman',
    name: 'The Pale Huntsman',
    minLevel: 20,
    maxLevel: 20,
    family: 'undead',
    hpBase: 155,
    hpPerLevel: 34,
    dmgBase: 17,
    dmgPerLevel: 3.0,
    attackSpeed: 2.2,
    armorPerLevel: 17,
    moveSpeed: 8.5,
    aggroRadius: 16, // the clearing is his, and he knows when you enter it
    elite: true,
    loot: [],
    scale: 1.4,
    color: 0xc8d8c0,
  },
};
export const WRAITHWOOD_NPCS: Record<string, NpcDef> = {
  reeve_mara: {
    id: 'reeve_mara',
    name: 'Reeve Mara',
    title: 'Keeper of Gallowmere',
    pos: { x: 360, z: 1430 },
    facing: Math.PI,
    color: 0x7c6a68,
    questIds: ['q_wraithwood_lost_lantern', 'q_wraithwood_lantern_walk', 'q_wraithwood_last_hunt'],
    greeting: 'Keep a lantern close and your name closer, $C. The wood is fond of stealing both.',
  },
  lantern_iven: {
    id: 'lantern_iven',
    name: 'Lantern Iven',
    title: 'Mournstone Lamplighter',
    pos: { x: 280, z: 1484 },
    facing: Math.PI / 2,
    color: 0x9a7b5d,
    questIds: ['q_wraithwood_lost_lantern', 'q_wraithwood_lantern_walk'],
    greeting:
      'A lantern keeps back ordinary darkness. For the rest, I carry salt, bells, and very quick feet.',
  },
};
export const WRAITHWOOD_QUESTS: Record<string, QuestDef> = {
  q_wraithwood_lost_lantern: {
    id: 'q_wraithwood_lost_lantern',
    name: 'A Lantern Gone Missing',
    giverNpcId: 'reeve_mara',
    turnInNpcId: 'lantern_iven',
    text: "Iven left to relight Mournstone Chapel before dusk and never passed Widow's Thicket. Follow the western path, find our lamplighter, and do not answer if the trees call you by name.",
    completionText:
      'Mara sent you into the thicket after me? Brave of you both. The chapel lamps are still dark, and the wood has noticed.',
    objectives: [
      { type: 'interact', targetNpcId: 'lantern_iven', count: 1, label: 'Lantern Iven found' },
    ],
    xpReward: 5000,
    copperReward: 2400,
    itemRewards: {},
    minLevel: 19,
  },
  q_wraithwood_lantern_walk: {
    id: 'q_wraithwood_lantern_walk',
    name: 'The Lantern Walk',
    giverNpcId: 'lantern_iven',
    turnInNpcId: 'reeve_mara',
    text: 'The chapel flame is in this lantern, and every hungry thing in Wraithwood can smell it. Walk with me to Mournstone, $N. When the spiders descend or the wraiths close in, keep them away from the light.',
    completionText:
      'The Mournstone lamps are burning again. Every lost traveler in these woods now has a road home, including Iven.',
    objectives: [
      {
        type: 'escort',
        targetNpcId: 'lantern_iven',
        count: 1,
        label: 'Lantern Iven escorted to Mournstone Chapel',
        path: [
          { x: 280, z: 1484 },
          { x: 315, z: 1508 },
          { x: 360, z: 1532 },
          { x: 338, z: 1576 },
          { x: 300, z: 1620 },
        ],
        ambushes: [
          { atWaypoint: 1, mobId: 'widowsilk_spinner', count: 2 },
          { atWaypoint: 3, mobId: 'wood_wraith', count: 2 },
        ],
      },
    ],
    xpReward: 6200,
    copperReward: 3400,
    itemRewards: {},
    requiresQuest: 'q_wraithwood_lost_lantern',
    minLevel: 19,
  },
  q_wraithwood_last_hunt: {
    id: 'q_wraithwood_last_hunt',
    name: 'The Huntsman Hunted',
    giverNpcId: 'reeve_mara',
    turnInNpcId: 'reeve_mara',
    text: 'The chapel light has drawn the Pale Huntsman from his clearing. He has stalked Gallowmere for generations, but tonight his path is plain. Follow it north and make this his final hunt.',
    completionText:
      'No horn answers from the clearing. At last, Wraithwood is only haunted by the ordinary dead.',
    objectives: [
      { type: 'kill', targetMobId: 'pale_huntsman', count: 1, label: 'Pale Huntsman defeated' },
    ],
    xpReward: 7600,
    copperReward: 5200,
    itemRewards: {},
    requiresQuest: 'q_wraithwood_lantern_walk',
    minLevel: 20,
    suggestedPlayers: 2,
  },
};
export const WRAITHWOOD_QUEST_ORDER: string[] = [
  'q_wraithwood_lost_lantern',
  'q_wraithwood_lantern_walk',
  'q_wraithwood_last_hunt',
];
export const WRAITHWOOD_ITEMS: Record<string, ItemDef> = {};
export const WRAITHWOOD_CAMPS: CampDef[] = [
  { mobId: 'widowsilk_spinner', center: { x: 282, z: 1478 }, radius: 10, count: 3 },
  { mobId: 'widowsilk_spinner', center: { x: 468, z: 1464 }, radius: 10, count: 3 },
  { mobId: 'wood_wraith', center: { x: 306, z: 1616 }, radius: 9, count: 3 },
  { mobId: 'wood_wraith', center: { x: 418, z: 1568 }, radius: 10, count: 3 },
  { mobId: 'gravenbark_shambler', center: { x: 444, z: 1526 }, radius: 10, count: 2 },
  { mobId: 'pale_huntsman', center: { x: 380, z: 1680 }, radius: 5, count: 1 },
];
export const WRAITHWOOD_OBJECTS: GroundObjectDef[] = [];

export const WRAITHWOOD_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // Gallowmere: a shuttered hamlet under the eaves
  buildings: [
    { kind: 'inn', x: 352, z: 1434, w: 6, d: 7, rot: 0.5 },
    { kind: 'house', x: 368, z: 1426, w: 6, d: 6, rot: -1.2 },
    { kind: 'house', x: 354, z: 1420, w: 5, d: 5, rot: 2.3 },
    { kind: 'chapel', x: 365, z: 1440, w: 5, d: 7, rot: -2.2 },
  ],
  wells: [{ x: 360, z: 1432, r: 1.5 }],
  stalls: [{ x: 356, z: 1426, rot: 0.6, r: 1.6 }],
  crates: [
    [349, 1430],
    [369, 1432],
  ],
  campfires: [
    [360, 1428],
    [389, 1280], // the Crowgate's waycamp
  ],
  fences: [
    // the hamlet huddles behind its fence line
    { x1: 346, z1: 1416, x2: 374, z2: 1416 },
    { x1: 346, z1: 1446, x2: 374, z2: 1446 },
  ],
  // the Mournstone Chapel ruin and the Huntsman's ring of broken columns
  ruinRings: [
    { x: 300, z: 1620, ringR: 8, columns: 6 },
    { x: 380, z: 1680, ringR: 9, columns: 5 },
  ],
  // grave fields: the wood buries its own
  graveyards: [
    { x: 294, z: 1612 },
    { x: 386, z: 1420 },
    { x: 434, z: 1538 },
  ],
  // The giant overgrown trees the realm is named for: solid trunk colliders
  // in the sim (colliders.ts reads this record), giant canopies drawn by
  // render/haunt_features.ts from the same spots. Kept off every road.
  greatTrees: [
    { x: 326, z: 1360, r: 2.6 },
    { x: 404, z: 1390, r: 3.0 },
    { x: 308, z: 1522, r: 2.8 },
    { x: 394, z: 1530, r: 2.6 },
    { x: 344, z: 1590, r: 3.2 },
    { x: 456, z: 1580, r: 2.6 },
    { x: 264, z: 1560, r: 2.8 },
    { x: 412, z: 1636, r: 3.0 },
    { x: 330, z: 1706, r: 2.6 },
    { x: 250, z: 1440, r: 2.6 },
  ],
};
