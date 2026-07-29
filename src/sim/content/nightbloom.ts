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
  welcomeQuestId: 'q_nb_road_of_lanterns',
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

// The realm's beasts and watchers: silver herds and their sleek hunters on
// the downs, masked nightkin adrift at their stones, and, since the stars
// shifted, the barrow dead walking their own grave rows.
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
    loot: [
      { copper: 105, chance: 1 },
      { itemId: 'moonfleece_tuft', chance: 0.6, questId: 'q_nb_wool_by_moonlight' },
    ],
    scale: 1.1,
    color: 0xe6e9f4,
    componentTags: ['hide', 'meat'],
  },
  gloam_strider: {
    id: 'gloam_strider',
    name: 'Gloam Strider',
    minLevel: 20,
    maxLevel: 20,
    family: 'reptile',
    hpBase: 58,
    hpPerLevel: 20,
    dmgBase: 12,
    dmgPerLevel: 2.4,
    attackSpeed: 1.8,
    armorPerLevel: 12,
    moveSpeed: 9.5, // sleek night hunters: fast, keen-eyed
    aggroRadius: 14,
    loot: [{ copper: 105, chance: 1 }],
    scale: 1.1,
    color: 0x4c4a72,
    componentTags: ['hide', 'fang'],
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
    loot: [{ copper: 100, chance: 1 }],
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
    loot: [
      { copper: 100, chance: 1 },
      { itemId: 'bone_fragments', chance: 1 },
    ],
    scale: 1.5,
    color: 0xb8cce8,
  },
  // The barrow field's risen dead (q_nb_restless_mounds): grave-row wights
  // clawing out of the opened mounds as the king stirs below. Spawned by the
  // quest camps appended at the END of the merged CAMPS array (draw-order rule).
  barrow_wight: {
    id: 'barrow_wight',
    name: 'Barrow Wight',
    minLevel: 20,
    maxLevel: 20,
    family: 'undead',
    hpBase: 70,
    hpPerLevel: 22,
    dmgBase: 13,
    dmgPerLevel: 2.5,
    attackSpeed: 2.1,
    armorPerLevel: 14,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [
      { copper: 100, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.5 },
    ],
    scale: 1.15,
    color: 0x9fb0c4,
  },
};
// The folk of the Nightbloom: a lamplighter holds the Nightgate waycamp, the
// night-gardener and the weaver keep Moonrest, and the astronomer reads the
// sky from his observatory camp by the Standing Vigil. Cassian stands far
// from the hub on purpose: the chain sends players out to find him.
export const NIGHTBLOOM_NPCS: Record<string, NpcDef> = {
  lamplighter_sorrel: {
    id: 'lamplighter_sorrel',
    name: 'Lamplighter Sorrel',
    title: 'Keeper of the Nightgate',
    pos: { x: -388, z: 1284 },
    facing: 0.4,
    color: 0xd9b066,
    questIds: ['q_nb_road_of_lanterns'],
    greeting: 'Mind the lamps, friend. Past this gate the sun gives up and the flowers take over.',
  },
  lira_dewsong: {
    id: 'lira_dewsong',
    name: 'Lira Dewsong',
    title: 'Night-Gardener of Moonrest',
    pos: { x: -372, z: 1417 },
    facing: 2.2,
    color: 0x9fc79a,
    questIds: [
      'q_nb_road_of_lanterns',
      'q_nb_striders_in_the_dark',
      'q_nb_night_gardens',
      'q_nb_eyes_on_the_vigil',
    ],
    greeting: 'Welcome to Moonrest, where the flowers do our dawning for us.',
  },
  weaver_amelle: {
    id: 'weaver_amelle',
    name: 'Weaver Amelle',
    title: 'Moonfleece Weaver',
    pos: { x: -366, z: 1423 },
    facing: -1.4,
    color: 0xe6e9f4,
    questIds: ['q_nb_wool_by_moonlight'],
    greeting: 'Feel that? Moonfleece on the loom. Warmer than any fire you have sat beside.',
  },
  astronomer_cassian: {
    id: 'astronomer_cassian',
    name: 'Astronomer Cassian',
    title: 'Watcher at the Vigil',
    pos: { x: -278, z: 1548 },
    facing: -2.0,
    color: 0x9a8fd0,
    questIds: [
      'q_nb_eyes_on_the_vigil',
      'q_nb_charts_of_the_stones',
      'q_nb_restless_mounds',
      'q_nb_the_barrow_king',
    ],
    greeting: 'Hush now. The sky never dawns here, so it never stops talking either.',
  },
};

export const NIGHTBLOOM_QUESTS: Record<string, QuestDef> = {
  q_nb_road_of_lanterns: {
    id: 'q_nb_road_of_lanterns',
    name: 'The Road of Lanterns',
    giverNpcId: 'lamplighter_sorrel',
    turnInNpcId: 'lira_dewsong',
    text: 'Up here the sun never follows, $N, only the lamps I keep lit along the climb. Moonrest lies north where the flower-light gathers. Find Lira Dewsong among her gardens and tell her the Nightgate lamps still burn.',
    completionText:
      'The lamps still burn, and the road still carries strangers to us. Sorrel has kept that gate longer than anyone in Moonrest remembers. Welcome, $N, to the realm that never dawns.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'lira_dewsong',
        count: 1,
        label: 'Find Lira Dewsong in Moonrest',
      },
    ],
    xpReward: 2600,
    copperReward: 950,
    itemRewards: {},
    minLevel: 19,
  },
  q_nb_striders_in_the_dark: {
    id: 'q_nb_striders_in_the_dark',
    name: 'Striders in the Dark',
    giverNpcId: 'lira_dewsong',
    turnInNpcId: 'lira_dewsong',
    text: 'The gloam striders were always patient hunters, $N, but of late they slip right into the flower beds and take moonfleece lambs beneath our lanterns. Cull ten of them and give the downs back their quiet.',
    completionText:
      'Ten striders fewer, and the herds already graze easier. The gardens keep their own hours, but tonight they keep them in peace.',
    objectives: [
      { type: 'kill', targetMobId: 'gloam_strider', count: 10, label: 'Gloam Strider slain' },
    ],
    xpReward: 4600,
    copperReward: 2200,
    itemRewards: {},
    requiresQuest: 'q_nb_road_of_lanterns',
  },
  q_nb_wool_by_moonlight: {
    id: 'q_nb_wool_by_moonlight',
    name: 'Wool by Moonlight',
    giverNpcId: 'weaver_amelle',
    turnInNpcId: 'weaver_amelle',
    text: 'Nothing warms like moonfleece, $N, and nothing spins so fine. The grazers carry their silver wool loose in tufts as they drift the downs. Bring me six good tufts off the herds and I will weave you something worth the walking.',
    completionText:
      'Silver as starlight and twice as soft. Here, $N: mitts from the last batch, lined the way only moonfleece lines.',
    objectives: [
      { type: 'collect', itemId: 'moonfleece_tuft', count: 6, label: 'Moonfleece Tuft' },
    ],
    xpReward: 4600,
    copperReward: 2200,
    itemRewards: {
      warrior: 'moonfleece_mitts',
      mage: 'moonfleece_mitts',
      rogue: 'moonfleece_mitts',
    },
    requiresQuest: 'q_nb_road_of_lanterns',
  },
  q_nb_night_gardens: {
    id: 'q_nb_night_gardens',
    name: 'The Night Gardens',
    giverNpcId: 'lira_dewsong',
    turnInNpcId: 'lira_dewsong',
    text: 'The nightbloom opens only under this sky, and Gloamfield holds the oldest beds in the realm. I need four fresh blossoms for the shrine garlands, $N. Cut them gently: a bed remembers a rough hand for a season.',
    completionText:
      'Still glowing, every petal. The shrine will smell of night for a week, and Moonrest sleeps easier for it.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'gloamfield_nightbloom',
        count: 4,
        label: 'Nightbloom Blossom gathered',
      },
    ],
    xpReward: 4800,
    copperReward: 2200,
    itemRewards: {},
    requiresQuest: 'q_nb_road_of_lanterns',
  },
  q_nb_eyes_on_the_vigil: {
    id: 'q_nb_eyes_on_the_vigil',
    name: 'Eyes on the Vigil',
    giverNpcId: 'lira_dewsong',
    turnInNpcId: 'astronomer_cassian',
    text: 'Something has the striders bold and the herds uneasy, $N, and I cannot read it in the flowers. Cassian can read it in the sky. He keeps his observatory camp by the Standing Vigil east of here, where the nightkin drift among the stones. Find him, and ask what the stars are saying.',
    completionText:
      'Lira sent you? Then the gardens feel it too. Sit by the glass a moment, $N. The stars have been restless for a month, and every chart I draw leans north toward the barrow.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'astronomer_cassian',
        count: 1,
        label: 'Find Astronomer Cassian at the Standing Vigil',
      },
    ],
    xpReward: 2800,
    copperReward: 1050,
    itemRewards: {},
    requiresQuest: 'q_nb_striders_in_the_dark',
    minLevel: 20,
  },
  q_nb_charts_of_the_stones: {
    id: 'q_nb_charts_of_the_stones',
    name: 'The Charts in the Stones',
    giverNpcId: 'astronomer_cassian',
    turnInNpcId: 'astronomer_cassian',
    text: 'The Vigil stones are older than Moonrest, older than the nightkin who tend them, and their faces are cut with star charts I have spent my life learning to read. The sky has shifted, $N, and I must know how far. Read the charts on three of the stones and bring me their bearings.',
    completionText:
      'No doubt is left. Every bearing has crept toward the Sleepless Barrow, as if the sky itself leans over that mound to watch. The old kings were buried under aligned stars for a reason, $N.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'vigil_star_chart',
        count: 3,
        label: 'Star chart read',
      },
    ],
    xpReward: 5000,
    copperReward: 2400,
    itemRewards: {},
    requiresQuest: 'q_nb_eyes_on_the_vigil',
  },
  q_nb_restless_mounds: {
    id: 'q_nb_restless_mounds',
    name: 'The Restless Mounds',
    giverNpcId: 'astronomer_cassian',
    turnInNpcId: 'astronomer_cassian',
    text: 'The charts were a warning, and the barrow field proves it: the mounds are opening from beneath. Wights walk the grave rows wearing the old honors, and the offerings that kept them sleeping lie scattered in the grass. Put eight of them down, $N, and gather four of the offerings back to me.',
    completionText:
      'Grave gold, still cold from the soil. The wights are not rising on their own, $N: something beneath the great mound is calling them out, and I fear the charts have already told us its name.',
    objectives: [
      { type: 'kill', targetMobId: 'barrow_wight', count: 8, label: 'Barrow Wight slain' },
      {
        type: 'interact',
        targetObjectItemId: 'barrow_grave_offering',
        count: 4,
        label: 'Grave offering recovered',
      },
    ],
    xpReward: 5400,
    copperReward: 2800,
    itemRewards: {},
    requiresQuest: 'q_nb_charts_of_the_stones',
    minLevel: 20,
  },
  q_nb_the_barrow_king: {
    id: 'q_nb_the_barrow_king',
    name: 'The Barrow King Wakes',
    giverNpcId: 'astronomer_cassian',
    turnInNpcId: 'astronomer_cassian',
    text: 'Every bearing, every restless star, every opened mound points to one thing: the Barrow King is waking beneath the great mound, and this realm has no dawn to hold him back. He must be put to rest before he remembers his crown, $N. Do not go alone: bring a friend, and keep the flower-light at your back.',
    completionText:
      'The stars have settled for the first time in a season, $N. The mounds are closed, the nightkin have gone still at their stones, and the king sleeps below once more. Wear this mantle: Moonrest cut it for whoever the night finally trusted.',
    objectives: [
      { type: 'kill', targetMobId: 'barrow_king', count: 1, label: 'The Barrow King put to rest' },
    ],
    xpReward: 6200,
    copperReward: 3800,
    itemRewards: {
      warrior: 'barrowshade_mantle',
      mage: 'barrowshade_mantle',
      rogue: 'barrowshade_mantle',
    },
    requiresQuest: 'q_nb_restless_mounds',
    minLevel: 20,
    suggestedPlayers: 2,
  },
};

// Level-braided presentation order (not strictly chain order), matching the
// Veiled Hollow convention.
export const NIGHTBLOOM_QUEST_ORDER: string[] = [
  'q_nb_road_of_lanterns',
  'q_nb_striders_in_the_dark',
  'q_nb_wool_by_moonlight',
  'q_nb_night_gardens',
  'q_nb_eyes_on_the_vigil',
  'q_nb_charts_of_the_stones',
  'q_nb_restless_mounds',
  'q_nb_the_barrow_king',
];

export const NIGHTBLOOM_ITEMS: Record<string, ItemDef> = {
  // --- quest items ---
  moonfleece_tuft: {
    id: 'moonfleece_tuft',
    name: 'Moonfleece Tuft',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_nb_wool_by_moonlight',
  },
  gloamfield_nightbloom: {
    id: 'gloamfield_nightbloom',
    name: 'Nightbloom Blossom',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_nb_night_gardens',
    noVendorSell: true,
  },
  vigil_star_chart: {
    id: 'vigil_star_chart',
    name: 'Vigil Star Chart',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_nb_charts_of_the_stones',
    noVendorSell: true,
  },
  barrow_grave_offering: {
    id: 'barrow_grave_offering',
    name: 'Scattered Grave Offering',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_nb_restless_mounds',
    noVendorSell: true,
  },
  // --- quest rewards ---
  moonfleece_mitts: {
    id: 'moonfleece_mitts',
    name: 'Moonfleece Mitts',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'uncommon',
    stats: { armor: 54, sta: 3, spi: 3 },
    sellValue: 1000,
  },
  barrowshade_mantle: {
    id: 'barrowshade_mantle',
    name: 'Barrowshade Mantle',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'rare',
    stats: { armor: 76, sta: 6, spi: 4 },
    sellValue: 2400,
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
    itemId: 'gloamfield_nightbloom',
    name: 'Nightbloom Blossom',
    // The oldest flower beds in the realm, scattered through Gloamfield
    // between the pools and the Moonrest road.
    positions: [
      { x: -436, z: 1486 },
      { x: -448, z: 1502 },
      { x: -428, z: 1508 },
      { x: -456, z: 1478 },
    ],
  },
  {
    itemId: 'vigil_star_chart',
    name: 'Star-Cut Stone',
    // Chart faces on the outer stones of the Standing Vigil ring, where the
    // nightkin drift.
    positions: [
      { x: -262, z: 1534 },
      { x: -282, z: 1546 },
      { x: -266, z: 1548 },
    ],
  },
  {
    itemId: 'barrow_grave_offering',
    name: 'Scattered Grave Offering',
    // Grave-goods thrown from the opened mounds across the barrow field,
    // clear of the great mound where the king stirs.
    positions: [
      { x: -346, z: 1662 },
      { x: -378, z: 1664 },
      { x: -352, z: 1674 },
      { x: -368, z: 1668 },
    ],
  },
];

// Quest-camp additions (barrow wights on the grave rows). Kept separate from
// NIGHTBLOOM_CAMPS and appended at the very END of the merged CAMPS array in
// data.ts: camps draw world-gen rng in array order, so only a tail append
// leaves every existing spawn untouched.
export const NIGHTBLOOM_QUEST_CAMPS: CampDef[] = [
  { mobId: 'barrow_wight', center: { x: -326, z: 1660 }, radius: 9, count: 3 },
  { mobId: 'barrow_wight', center: { x: -382, z: 1636 }, radius: 9, count: 3 },
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
    [-389, 1280], // the Nightgate's waycamp, Lamplighter Sorrel's post
    [-276, 1546], // Astronomer Cassian's observatory fire by the Vigil
  ],
  tents: [
    { x: -280, z: 1551, rot: 0.8, scale: 1 }, // Cassian's observatory camp
  ],
  // the Standing Vigil: a ring of columns where the nightkin drift, and the
  // Sleepless Barrow: a tighter, older ring around the king's mound
  ruinRings: [
    { x: -272, z: 1538, ringR: 9, columns: 7 },
    { x: -360, z: 1650, ringR: 7, columns: 5 },
  ],
  graveyards: [{ x: -354, z: 1660 }], // barrow field at the king's feet
};
