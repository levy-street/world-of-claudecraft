// The Nightbloom (level 20). North past the Willowfen the road climbs the
// Nightgate into a realm that is dreaming: violet downs under a luminous
// lavender sky where a sleeping world hangs among the clouds, and the
// namesake flowers glow in the dream-light. The lantern village of Moonrest,
// the round Moonwell tarn, Gloamfield's flower downs, the Standing Vigil
// stone circle where the hovering nightkin keep their watch, and the
// Sleepless Barrow in the far north. Terrain: the NIGHT_* tables in
// world.ts; the glowing flora, dreambeams, and standing stones live in
// render/night_features.ts.

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

export const NIGHTBLOOM_ZONE: ZoneDef = {
  id: 'nightbloom',
  name: 'The Nightbloom',
  riftPortalEligible: true,
  riftTierWeights: { A: 0.4, S: 0.6 },
  zMin: 1260,
  zMax: 1820,
  xMin: -540,
  xMax: -180,
  levelRange: [20, 20],
  biome: 'night',
  southPassX: -330, // the Nightgate: where the jungle road climbs into the dark
  hub: { x: -370, z: 1420, radius: 18, name: 'Moonrest' },
  graveyard: { x: -388, z: 1402 },
  lakes: [
    { x: -290, z: 1380, radius: 14 }, // the Moonwell: a round mirror tarn
    // the Gloamfield pools, scattered through the flower downs
    { x: -440, z: 1520, radius: 10 },
    { x: -462, z: 1492, radius: 8 },
    { x: -336, z: 1682, radius: 12 }, // the Barrowmere below the Sleepless Barrow
  ],
  pois: [
    { x: -370, z: 1420, label: 'Moonrest', id: 'moonrest' },
    { x: -390, z: 1292, label: 'The Nightgate', id: 'the_nightgate' },
    { x: -290, z: 1380, label: 'The Moonwell', id: 'the_moonwell' },
    { x: -444, z: 1496, label: 'Gloamfield', id: 'gloamfield' },
    { x: -272, z: 1538, label: 'The Standing Vigil', id: 'the_standing_vigil' },
    { x: -360, z: 1650, label: 'The Sleepless Barrow', id: 'the_sleepless_barrow' },
  ],
  welcome:
    'Past the Nightgate the air itself dreams. Follow the flower-light to Moonrest, and mind the sleeping world that hangs in the sky.',
};

export const NIGHTBLOOM_ROADS: { x: number; z: number }[][] = [
  [
    { x: -330, z: 1264 },
    { x: -352, z: 1330 },
    { x: -368, z: 1382 },
    { x: -370, z: 1420 },
  ], // the Nightgate -> Moonrest
  [
    { x: -370, z: 1420 },
    { x: -334, z: 1402 },
    { x: -308, z: 1388 },
  ], // Moonrest -> the Moonwell's shore
  [
    { x: -370, z: 1420 },
    { x: -408, z: 1452 },
    { x: -432, z: 1480 },
  ], // Moonrest -> Gloamfield
  [
    { x: -370, z: 1420 },
    { x: -332, z: 1462 },
    { x: -298, z: 1508 },
    { x: -276, z: 1532 },
  ], // Moonrest -> the Standing Vigil
  [
    { x: -370, z: 1420 },
    { x: -366, z: 1500 },
    { x: -362, z: 1570 },
    { x: -360, z: 1636 },
  ], // Moonrest -> the Sleepless Barrow
  [
    { x: -360, z: 1636 },
    { x: -356, z: 1700 },
    { x: -350, z: 1760 },
    { x: -348, z: 1816 },
  ], // the Barrow -> the gold road, west around the Barrowmere
  [
    { x: -280, z: 1550 },
    { x: -240, z: 1546 },
  ], // the Standing Vigil -> the Palewater's shore
  [
    { x: -420, z: 1480 },
    { x: -470, z: 1514 },
  ], // Gloamfield -> the sunset shore
];

// No portals: walked into over the Nightgate.
export const NIGHTBLOOM_PORTALS: PortalDef[] = [];

// Quests and folk follow in a later pass.
export const NIGHTBLOOM_MOBS: Record<string, MobTemplate> = {
  moonfleece_grazer: {
    id: 'moonfleece_grazer',
    name: 'Moonfleece Grazer',
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    hpBase: 60,
    hpPerLevel: 20,
    dmgBase: 10,
    dmgPerLevel: 2.2,
    attackSpeed: 2.1,
    armorPerLevel: 12,
    moveSpeed: 7.5,
    aggroRadius: 0, // placid silver-wooled herds drifting the downs
    loot: [],
    scale: 1.1,
    color: 0xe6e9f4,
  },
  gloam_strider: {
    id: 'gloam_strider',
    name: 'Gloam Strider',
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    hpBase: 58,
    hpPerLevel: 20,
    dmgBase: 12,
    dmgPerLevel: 2.4,
    attackSpeed: 1.8,
    armorPerLevel: 12,
    moveSpeed: 9.5, // sleek night hunters: fast, keen-eyed
    aggroRadius: 14,
    loot: [],
    scale: 1.1,
    color: 0x4c4a72,
  },
  nightkin_stargazer: {
    id: 'nightkin_stargazer',
    name: 'Nightkin Stargazer',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    hpBase: 54,
    hpPerLevel: 18,
    dmgBase: 10,
    dmgPerLevel: 2.2,
    attackSpeed: 2.0,
    armorPerLevel: 11,
    moveSpeed: 7.5,
    aggroRadius: 0, // masked watchers adrift around their stones
    loot: [],
    scale: 1.0,
    color: 0x8fa8e0,
  },
  barrow_king: {
    id: 'barrow_king',
    name: 'The Barrow King',
    minLevel: 20,
    maxLevel: 20,
    family: 'undead',
    hpBase: 150,
    hpPerLevel: 34,
    dmgBase: 17,
    dmgPerLevel: 3.0,
    attackSpeed: 2.4,
    armorPerLevel: 17,
    moveSpeed: 7.5,
    aggroRadius: 14,
    elite: true,
    loot: [],
    scale: 1.5,
    color: 0xb8cce8,
  },
};
export const NIGHTBLOOM_NPCS: Record<string, NpcDef> = {
  dreamkeeper_luma: {
    id: 'dreamkeeper_luma',
    name: 'Dreamkeeper Luma',
    title: 'Warden of Moonrest',
    pos: { x: -370, z: 1420 },
    facing: Math.PI,
    color: 0x9270b7,
    questIds: ['q_nightbloom_vigil', 'q_nightbloom_barrow_crown'],
    greeting:
      'Nightbloom is not asleep, $C. It is dreaming, and tonight the dream has begun to bare its teeth.',
  },
  stargazer_oril: {
    id: 'stargazer_oril',
    name: 'Stargazer Oril',
    title: 'Keeper of the Standing Vigil',
    pos: { x: -272, z: 1538 },
    facing: Math.PI,
    color: 0x8268a8,
    questIds: ['q_nightbloom_vigil', 'q_nightbloom_dream_anchors', 'q_nightbloom_barrow_crown'],
    greeting:
      'The stars above the Vigil are wrong by one. I have counted them a hundred times, and the missing light is under our feet.',
  },
};
export const NIGHTBLOOM_QUESTS: Record<string, QuestDef> = {
  q_nightbloom_vigil: {
    id: 'q_nightbloom_vigil',
    name: 'A Star Missing',
    giverNpcId: 'dreamkeeper_luma',
    turnInNpcId: 'stargazer_oril',
    text: 'Oril keeps the Standing Vigil beyond Gloamfield and has sent no star count for three nights. Find the stargazer among the ancient stones and ask what shadow has silenced the signal.',
    completionText:
      'Luma still trusts my count. Good. Help me trace the missing star through the anchors that hold Nightbloom in its gentle dream.',
    objectives: [
      { type: 'interact', targetNpcId: 'stargazer_oril', count: 1, label: 'Stargazer Oril found' },
    ],
    xpReward: 5000,
    copperReward: 2400,
    itemRewards: {},
    minLevel: 19,
  },
  q_nightbloom_dream_anchors: {
    id: 'q_nightbloom_dream_anchors',
    name: 'Anchors of the Dream',
    giverNpcId: 'stargazer_oril',
    turnInNpcId: 'stargazer_oril',
    text: 'Read the moon runes at the Moonwell, Gloamfield, and the Sleepless Barrow. Each anchor should hold one bright reflection. If one reflects darkness, we will know where the lost star fell.',
    completionText:
      'The barrow rune showed a crown instead of a star. Its old king has taken the missing light and used it to wake his court.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'nightbloom_anchor_moonwell',
        count: 1,
        label: 'Moonwell dream anchor read',
      },
      {
        type: 'interact',
        targetObjectItemId: 'nightbloom_anchor_gloamfield',
        count: 1,
        label: 'Gloamfield dream anchor read',
      },
      {
        type: 'interact',
        targetObjectItemId: 'nightbloom_anchor_barrow',
        count: 1,
        label: 'Sleepless Barrow dream anchor read',
      },
    ],
    xpReward: 6200,
    copperReward: 3400,
    itemRewards: {},
    requiresQuest: 'q_nightbloom_vigil',
    minLevel: 19,
  },
  q_nightbloom_barrow_crown: {
    id: 'q_nightbloom_barrow_crown',
    name: 'The Crown Below',
    giverNpcId: 'stargazer_oril',
    turnInNpcId: 'dreamkeeper_luma',
    text: 'The Barrow King has stolen a star from the dream and set it in his crown. Enter the Sleepless Barrow, defeat the risen king, and let Nightbloom forget his name again.',
    completionText:
      'There is the missing light, back in the sky. Nightbloom dreams softly again because you walked where the rest of us feared to wake.',
    objectives: [
      { type: 'kill', targetMobId: 'barrow_king', count: 1, label: 'Barrow King defeated' },
    ],
    xpReward: 7600,
    copperReward: 5200,
    itemRewards: {},
    requiresQuest: 'q_nightbloom_dream_anchors',
    minLevel: 20,
    suggestedPlayers: 2,
  },
};
export const NIGHTBLOOM_QUEST_ORDER: string[] = [
  'q_nightbloom_vigil',
  'q_nightbloom_dream_anchors',
  'q_nightbloom_barrow_crown',
];
export const NIGHTBLOOM_ITEMS: Record<string, ItemDef> = {
  nightbloom_anchor_moonwell: {
    id: 'nightbloom_anchor_moonwell',
    name: 'Moonwell Dream Anchor',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_nightbloom_dream_anchors',
    noVendorSell: true,
  },
  nightbloom_anchor_gloamfield: {
    id: 'nightbloom_anchor_gloamfield',
    name: 'Gloamfield Dream Anchor',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_nightbloom_dream_anchors',
    noVendorSell: true,
  },
  nightbloom_anchor_barrow: {
    id: 'nightbloom_anchor_barrow',
    name: 'Barrow Dream Anchor',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_nightbloom_dream_anchors',
    noVendorSell: true,
  },
};
export const NIGHTBLOOM_CAMPS: CampDef[] = [
  { mobId: 'moonfleece_grazer', center: { x: -436, z: 1466 }, radius: 12, count: 4 },
  { mobId: 'moonfleece_grazer', center: { x: -320, z: 1446 }, radius: 10, count: 3 },
  { mobId: 'gloam_strider', center: { x: -410, z: 1522 }, radius: 10, count: 3 },
  { mobId: 'gloam_strider', center: { x: -240, z: 1402 }, radius: 10, count: 3 },
  { mobId: 'nightkin_stargazer', center: { x: -272, z: 1538 }, radius: 8, count: 3 },
  { mobId: 'barrow_king', center: { x: -360, z: 1650 }, radius: 5, count: 1 },
];
export const NIGHTBLOOM_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'nightbloom_anchor_moonwell',
    name: 'Moonwell Dream Anchor',
    positions: [{ x: -290, z: 1380 }],
  },
  {
    itemId: 'nightbloom_anchor_gloamfield',
    name: 'Gloamfield Dream Anchor',
    positions: [{ x: -444, z: 1496 }],
  },
  {
    itemId: 'nightbloom_anchor_barrow',
    name: 'Barrow Dream Anchor',
    positions: [{ x: -330, z: 1650 }],
  },
];

export const NIGHTBLOOM_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // Moonrest: a snug lantern village on its rise
  buildings: [
    { kind: 'inn', x: -378, z: 1424, w: 6, d: 7, rot: 0.6 },
    { kind: 'house', x: -361, z: 1416, w: 6, d: 6, rot: -1.1 },
    { kind: 'house', x: -376, z: 1410, w: 5, d: 5, rot: 2.2 },
    { kind: 'chapel', x: -364, z: 1430, w: 5, d: 7, rot: -2.4 }, // the moon shrine
  ],
  wells: [{ x: -370, z: 1422, r: 1.5 }],
  stalls: [
    { x: -373, z: 1416, rot: 0.4, r: 1.6 },
    { x: -365, z: 1424, rot: -1.5, r: 1.6 },
  ],
  crates: [
    [-375, 1420],
    [-362, 1412],
  ],
  campfires: [
    [-370, 1418],
    [-389, 1280], // the Nightgate's waycamp
  ],
  // the Standing Vigil: a ring of columns where the nightkin drift, and the
  // Sleepless Barrow: a tighter, older ring around the king's mound
  ruinRings: [
    { x: -272, z: 1538, ringR: 9, columns: 7 },
    { x: -360, z: 1650, ringR: 7, columns: 5 },
  ],
  graveyards: [{ x: -354, z: 1660 }], // barrow field at the king's feet
};
