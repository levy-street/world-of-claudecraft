// The Palmreach (level 20). North past the Wraithwood's last black eaves
// the road spills out of the Tanglemouth onto hot white sand: a tropical
// realm of flat coral beaches ringed with palms, a jungle interior so green
// it eats the horizon, giant vine-hung banyans at the Vinefall, and the
// turquoise Sapphire Lagoon cupped in the eastern arm. The beach village of
// Drifthaven keeps its fires lit on the strand. Terrain: the REACH_* tables
// in world.ts (the coast applier flattens every shore into wide beach);
// the palms, banyans, and vines live in render/jungle_features.ts (the
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

export const PALMREACH_ZONE: ZoneDef = {
  id: 'palmreach',
  name: 'The Palmreach',
  riftPortalEligible: true,
  riftTierWeights: { A: 0.4, S: 0.6 },
  zMin: 700,
  zMax: 1260,
  xMin: -540,
  xMax: -180,
  levelRange: [20, 20],
  biome: 'jungle',
  southPassX: -400, // the Tanglemouth: up from the fen into the green
  eastPassZ: 820, // the Sunway: off the heights, down into the sun
  hub: { x: -300, z: 820, radius: 16, name: 'Drifthaven' },
  graveyard: { x: -318, z: 802 },
  lakes: [
    { x: -270, z: 950, radius: 15 }, // the Sapphire Lagoon
    { x: -380, z: 1000, radius: 10 }, // the jungle pool
    { x: -336, z: 1158, radius: 11 }, // the northern tarn
  ],
  pois: [
    { x: -300, z: 820, label: 'Drifthaven', id: 'drifthaven' },
    { x: -420, z: 732, label: 'The Tanglemouth', id: 'the_tanglemouth' },
    { x: -460, z: 890, label: 'The Palmstrand', id: 'the_palmstrand' },
    { x: -360, z: 980, label: 'The Emerald Tangle', id: 'the_emerald_tangle' },
    { x: -400, z: 1080, label: 'The Vinefall', id: 'the_vinefall' },
    { x: -270, z: 950, label: 'The Sapphire Lagoon', id: 'the_sapphire_lagoon' },
    { x: -256, z: 1090, label: 'The Sunken Idol', id: 'the_sunken_idol' },
  ],
  welcome:
    'Warm sand, loud birds, and a jungle that eats the horizon. Drifthaven keeps a fire lit on the beach for you.',
};

export const PALMREACH_ROADS: { x: number; z: number }[][] = [
  [
    { x: -402, z: 706 },
    { x: -400, z: 752 },
    { x: -356, z: 790 },
    { x: -300, z: 820 },
  ], // the Tanglemouth -> along the shore -> Drifthaven
  [
    { x: -300, z: 820 },
    { x: -360, z: 860 },
    { x: -420, z: 880 },
    { x: -452, z: 888 },
  ], // Drifthaven -> the Palmstrand
  [
    { x: -300, z: 820 },
    { x: -326, z: 900 },
    { x: -350, z: 964 },
  ], // Drifthaven -> the Emerald Tangle
  [
    { x: -350, z: 964 },
    { x: -378, z: 1030 },
    { x: -396, z: 1070 },
  ], // the Tangle -> the Vinefall
  [
    { x: -300, z: 820 },
    { x: -276, z: 890 },
    { x: -242, z: 928 },
    { x: -238, z: 1018 },
    { x: -256, z: 1072 },
  ], // Drifthaven -> east around the Lagoon -> the Sunken Idol
  [
    { x: -256, z: 1072 },
    { x: -274, z: 1142 },
    { x: -296, z: 1196 },
    { x: -318, z: 1236 },
    { x: -330, z: 1254 },
  ], // the Sunken Idol -> up the north cape -> the Nightgate
  [
    { x: -242, z: 928 },
    { x: -212, z: 874 },
    { x: -186, z: 822 },
  ], // the lagoon road -> east down the Sunway (off the heights)
] as { x: number; z: number }[][];

// No portals: walked into through the Tanglemouth.
export const PALMREACH_PORTALS: PortalDef[] = [];

// Quests and folk follow in a later pass.
export const PALMREACH_MOBS: Record<string, MobTemplate> = {
  tide_scuttler: {
    id: 'tide_scuttler',
    name: 'Tide Scuttler',
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    hpBase: 54,
    hpPerLevel: 18,
    dmgBase: 10,
    dmgPerLevel: 2.2,
    attackSpeed: 2.0,
    armorPerLevel: 14, // shell
    moveSpeed: 7,
    aggroRadius: 8, // beach crabs mind their tidepools
    loot: [],
    scale: 1.15,
    color: 0xe86848,
  },
  thicket_boar: {
    id: 'thicket_boar',
    name: 'Thicket Boar',
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    hpBase: 62,
    hpPerLevel: 20,
    dmgBase: 12,
    dmgPerLevel: 2.4,
    attackSpeed: 1.9,
    armorPerLevel: 12,
    moveSpeed: 8.5,
    aggroRadius: 11,
    loot: [],
    scale: 1.2,
    color: 0x6a4e38,
  },
  canopy_weaver: {
    id: 'canopy_weaver',
    name: 'Canopy Weaver',
    minLevel: 20,
    maxLevel: 20,
    family: 'spider',
    hpBase: 56,
    hpPerLevel: 19,
    dmgBase: 12,
    dmgPerLevel: 2.3,
    attackSpeed: 1.9,
    armorPerLevel: 11,
    moveSpeed: 8.5,
    aggroRadius: 12,
    loot: [],
    scale: 1.25,
    color: 0x4e8a3c,
  },
  idol_guardian: {
    id: 'idol_guardian',
    name: 'The Idol Guardian',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    hpBase: 150,
    hpPerLevel: 34,
    dmgBase: 17,
    dmgPerLevel: 3.0,
    attackSpeed: 2.4,
    armorPerLevel: 18, // carved stone
    moveSpeed: 7,
    aggroRadius: 14,
    elite: true,
    loot: [],
    scale: 1.5,
    color: 0x9aa87e,
  },
};
export const PALMREACH_NPCS: Record<string, NpcDef> = {
  tidecaller_miri: {
    id: 'tidecaller_miri',
    name: 'Tidecaller Miri',
    title: 'Voice of Drifthaven',
    pos: { x: -300, z: 820 },
    facing: Math.PI,
    color: 0x4c9a8a,
    questIds: ['q_palmreach_green_trail', 'q_palmreach_idol_guardian'],
    greeting: 'The tide returns what it borrows. The jungle, $C, has never learned that courtesy.',
  },
  trailblazer_cas: {
    id: 'trailblazer_cas',
    name: 'Trailblazer Cas',
    title: 'Emerald Tangle Guide',
    pos: { x: -360, z: 980 },
    facing: Math.PI,
    color: 0x3f7f5a,
    questIds: ['q_palmreach_green_trail', 'q_palmreach_waymarks', 'q_palmreach_idol_guardian'],
    greeting:
      'Every trail here grows over by breakfast. I mark them at dawn and start over before supper.',
  },
};
export const PALMREACH_QUESTS: Record<string, QuestDef> = {
  q_palmreach_green_trail: {
    id: 'q_palmreach_green_trail',
    name: 'The Green Trail',
    giverNpcId: 'tidecaller_miri',
    turnInNpcId: 'trailblazer_cas',
    text: 'Cas went into the Emerald Tangle to reopen the route to Vinefall. Follow the old shell markers inland, find the trailblazer, and learn what has made the jungle swallow a road overnight.',
    completionText:
      'Miri sent you? Then Drifthaven still needs this road. Help me wake the old waymarks before the vines bury them for good.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'trailblazer_cas',
        count: 1,
        label: 'Trailblazer Cas found',
      },
    ],
    xpReward: 5000,
    copperReward: 2400,
    itemRewards: {},
    minLevel: 19,
  },
  q_palmreach_waymarks: {
    id: 'q_palmreach_waymarks',
    name: 'A Road the Jungle Remembers',
    giverNpcId: 'trailblazer_cas',
    turnInNpcId: 'trailblazer_cas',
    text: 'Cut free the old waymarks at Palmstrand, Vinefall, and the Sapphire Lagoon. They are carved from idol stone, and if all three wake, the safe trail will reveal itself again.',
    completionText:
      'The trail is open, but the marks all turned toward the Sunken Idol. Its guardian is calling every piece of carved stone home.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'palmreach_waymark_strand',
        count: 1,
        label: 'Palmstrand waymark uncovered',
      },
      {
        type: 'interact',
        targetObjectItemId: 'palmreach_waymark_vinefall',
        count: 1,
        label: 'Vinefall waymark uncovered',
      },
      {
        type: 'interact',
        targetObjectItemId: 'palmreach_waymark_lagoon',
        count: 1,
        label: 'Sapphire Lagoon waymark uncovered',
      },
    ],
    xpReward: 6200,
    copperReward: 3400,
    itemRewards: {},
    requiresQuest: 'q_palmreach_green_trail',
    minLevel: 19,
  },
  q_palmreach_idol_guardian: {
    id: 'q_palmreach_idol_guardian',
    name: 'The Idol Calls Them Home',
    giverNpcId: 'trailblazer_cas',
    turnInNpcId: 'tidecaller_miri',
    text: 'The Idol Guardian is pulling every waystone from the earth and closing the trails behind it. Go to the drowned shrine, break its hold, and keep Palmreach connected to the shore.',
    completionText:
      'The shell markers are shining from here to Vinefall. Palmreach has a road again, and Drifthaven has you to thank for it.',
    objectives: [
      { type: 'kill', targetMobId: 'idol_guardian', count: 1, label: 'Idol Guardian defeated' },
    ],
    xpReward: 7600,
    copperReward: 5200,
    itemRewards: {},
    requiresQuest: 'q_palmreach_waymarks',
    minLevel: 20,
    suggestedPlayers: 2,
  },
};
export const PALMREACH_QUEST_ORDER: string[] = [
  'q_palmreach_green_trail',
  'q_palmreach_waymarks',
  'q_palmreach_idol_guardian',
];
export const PALMREACH_ITEMS: Record<string, ItemDef> = {
  palmreach_waymark_strand: {
    id: 'palmreach_waymark_strand',
    name: 'Palmstrand Waymark',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_palmreach_waymarks',
    noVendorSell: true,
  },
  palmreach_waymark_vinefall: {
    id: 'palmreach_waymark_vinefall',
    name: 'Vinefall Waymark',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_palmreach_waymarks',
    noVendorSell: true,
  },
  palmreach_waymark_lagoon: {
    id: 'palmreach_waymark_lagoon',
    name: 'Lagoon Waymark',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_palmreach_waymarks',
    noVendorSell: true,
  },
};
export const PALMREACH_CAMPS: CampDef[] = [
  { mobId: 'tide_scuttler', center: { x: -456, z: 878 }, radius: 10, count: 3 },
  { mobId: 'tide_scuttler', center: { x: -252, z: 840 }, radius: 10, count: 3 },
  { mobId: 'thicket_boar', center: { x: -368, z: 940 }, radius: 10, count: 3 },
  { mobId: 'thicket_boar', center: { x: -416, z: 1004 }, radius: 10, count: 3 },
  { mobId: 'canopy_weaver', center: { x: -326, z: 1060 }, radius: 10, count: 3 },
  { mobId: 'canopy_weaver', center: { x: -426, z: 1120 }, radius: 10, count: 2 },
  { mobId: 'idol_guardian', center: { x: -256, z: 1090 }, radius: 5, count: 1 },
];
export const PALMREACH_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'palmreach_waymark_strand',
    name: 'Palmstrand Waymark',
    positions: [{ x: -460, z: 890 }],
  },
  {
    itemId: 'palmreach_waymark_vinefall',
    name: 'Vinefall Waymark',
    positions: [{ x: -400, z: 1080 }],
  },
  {
    itemId: 'palmreach_waymark_lagoon',
    name: 'Lagoon Waymark',
    positions: [{ x: -270, z: 950 }],
  },
];

export const PALMREACH_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // Drifthaven: a driftwood village on the strand
  buildings: [
    { kind: 'inn', x: -308, z: 824, w: 6, d: 7, rot: 0.9 },
    { kind: 'house', x: -292, z: 814, w: 5, d: 5, rot: -0.7 },
  ],
  wells: [{ x: -300, z: 822, r: 1.5 }],
  stalls: [
    { x: -296, z: 828, rot: 0.4, r: 1.6 },
    { x: -305, z: 812, rot: -1.6, r: 1.6 },
  ],
  tents: [
    { x: -288, z: 826, rot: 1.1, scale: 1 },
    { x: -312, z: 834, rot: -2.0, scale: 1.1 },
  ],
  crates: [
    [-302, 816],
    [-294, 820],
  ],
  campfires: [
    [-300, 818],
    [-418, 720], // the Tanglemouth's waycamp
  ],
  // a fishing dock running off the village beach into the shallows
  // Drifthaven's beach dock (kept on the strand: the flat coast has no open
  // water nearby to reach). hw/hd 0: no hut, so no thin post floats off it.
  docks: [{ x: -286, z: 838, rot: 0.6, hutLocal: { x: 40, z: 40, hw: 0, hd: 0 } }],
  mudHuts: [
    [-316, 826],
    [-290, 808],
  ],
  // the Sunken Idol: a mossy ring of drowned-temple columns
  ruinRings: [{ x: -256, z: 1090, ringR: 8, columns: 6 }],
  // The giant banyans of the Vinefall and the deep Tangle: solid trunk
  // colliders in the sim, vine-hung crowns drawn by jungle_features.ts.
  greatTrees: [
    { x: -400, z: 1080, r: 3.2 },
    { x: -422, z: 1058, r: 2.8 },
    { x: -378, z: 1100, r: 3.0 },
    { x: -354, z: 1004, r: 2.8 },
    { x: -390, z: 930, r: 2.6 },
    { x: -320, z: 980, r: 2.6 },
    { x: -446, z: 1030, r: 2.6 },
    { x: -338, z: 1120, r: 2.8 },
  ],
};
