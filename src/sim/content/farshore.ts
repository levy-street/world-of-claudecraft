// The Farshore (levels 3-7). A small island in the starter sea east of
// Eastbrook Vale, all but surrounded by open ocean and joined to the
// mainland only by the Ferrywalk: a thin natural sandbar causeway from the
// vale's east point to the island's Landing, walked on foot (no teleport;
// the causeway terrain is in world.ts). The deeper strait to either side
// keeps its swim fatigue.
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

export const FARSHORE_ZONE: ZoneDef = {
  id: 'farshore_isle',
  name: 'The Farshore',
  riftPortalEligible: true,
  riftTierWeights: { C: 0.7, B: 0.3 },
  zMin: -180,
  zMax: 180,
  xMin: 180,
  xMax: 540,
  levelRange: [3, 7],
  biome: 'vale',
  hub: { x: 305, z: 70, radius: 15, name: 'Gullhaven' },
  graveyard: { x: 290, z: 86 },
  lakes: [
    { x: 388, z: 26, radius: 8 }, // the Hilltop Spring, under the Watch Meadow
  ],
  pois: [
    { x: 305, z: 70, label: 'Gullhaven', id: 'gullhaven' },
    { x: 250, z: 14, label: 'The Landing', id: 'the_landing' },
    { x: 375, z: -5, label: 'The Watch Meadow', id: 'the_watch_meadow' },
    { x: 402, z: -72, label: 'The Sundered Cliffs', id: 'the_sundered_cliffs' },
    { x: 434, z: 58, label: 'The Riftfields', id: 'the_riftfields' },
  ],
  welcome:
    "Cross the sandbar and Gullhaven's bell will find you before the town does. The breaks tear open without warning, and the redoubt holds its shore against whatever pours through. They have been waiting a long while for someone like you.",
};

export const FARSHORE_ROADS: { x: number; z: number }[][] = [
  [
    { x: 150, z: -46 },
    { x: 173, z: -30 },
    { x: 195, z: -14 },
    { x: 217, z: 1 },
    { x: 238, z: 12 },
    { x: 252, z: 15 },
  ], // the Ferrywalk causeway: the vale's east point -> the Landing
  [
    { x: 250, z: 14 },
    { x: 276, z: 42 },
    { x: 305, z: 68 },
  ], // the Landing -> up the shore road -> Gullhaven
  [
    { x: 308, z: 66 },
    { x: 340, z: 32 },
    { x: 372, z: 0 },
  ], // Gullhaven -> the Watch Meadow (the riftwatchers' vigil)
  [
    { x: 374, z: -4 },
    { x: 392, z: -40 },
    { x: 402, z: -68 },
  ], // the Watch Meadow -> the Sundered Cliffs
  [
    { x: 376, z: 0 },
    { x: 408, z: 30 },
    { x: 432, z: 54 },
  ], // the Watch Meadow -> the Riftfields
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
    loot: [],
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
    loot: [],
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
};

// The defenders. Everyone left in Gullhaven knows what is happening and has
// found their place in the holding of it: a commander, a scholar who reads
// the breaks, a quartermaster, a surgeon, the bellkeeper who rings for aid,
// and a fisher who has seen one too many. Their quests lead newcomers from
// the breach watch to a bellkeeper escort and the final hunt below the cliffs.
export const FARSHORE_NPCS: Record<string, NpcDef> = {
  warden_coalfast: {
    id: 'warden_coalfast',
    name: 'Warden Coalfast',
    title: 'Redoubt Commander',
    pos: { x: 305, z: 66 },
    facing: 0,
    color: 0x8a4b2b,
    questIds: ['q_farshore_watch_meadow', 'q_farshore_horror'],
    greeting:
      'The breaks do not care that Gullhaven is small, $C. We hold this shore, or there is no shore left to hold. Stand with us and I will not forget it.',
  },
  riftwatch_ollun: {
    id: 'riftwatch_ollun',
    name: 'Riftwatch Ollun',
    title: 'Breach Scholar',
    pos: { x: 372, z: 2 },
    facing: Math.PI,
    color: 0x3f5f8a,
    questIds: ['q_farshore_watch_meadow', 'q_farshore_ferrywalk', 'q_farshore_horror'],
    greeting:
      'Every break sings before it opens, if you have the ear for it. I can hear three of them stirring on the island right now, and one of them is close.',
  },
  quartermaster_edda: {
    id: 'quartermaster_edda',
    name: 'Quartermaster Edda',
    title: 'Redoubt Armorer',
    pos: { x: 298, z: 74 },
    facing: Math.PI / 2,
    color: 0x6b6b3a,
    questIds: [],
    greeting:
      'Steel and salt, $C, it is all I have left to hand out. Take it and make the breaks regret opening where I could reach them.',
  },
  mender_saul: {
    id: 'mender_saul',
    name: 'Mender Saul',
    title: 'Field Surgeon',
    pos: { x: 312, z: 78 },
    facing: -Math.PI / 2,
    color: 0x9a3b3b,
    questIds: [],
    greeting:
      'I have set more bones this one month than in ten years of mending fishing falls. The breaks do not leave much of what they take. Come back to me whole, if you can manage it.',
  },
  bellkeeper_tam: {
    id: 'bellkeeper_tam',
    name: 'Bellkeeper Tam',
    title: 'Watchbell Keeper',
    pos: { x: 252, z: 18 },
    facing: Math.PI / 2,
    color: 0x4a7b6b,
    questIds: ['q_farshore_ferrywalk'],
    greeting:
      'The bell is the only warning the breaks give us, $C. One toll for the fields, two for the cliffs, three when it is close enough that running will not help. Keep an ear on it, and it may keep you whole.',
  },
  fisher_nell: {
    id: 'fisher_nell',
    name: 'Frightened Nell',
    title: 'Gullhaven Fisher',
    pos: { x: 296, z: 80 },
    facing: 0,
    color: 0x5a7a9a,
    questIds: [],
    greeting:
      'It opened right where the nets dry. Right there, where I stood every morning of my life. I do not go down to the shore anymore. I do not go much of anywhere anymore.',
  },
};

export const FARSHORE_QUESTS: Record<string, QuestDef> = {
  q_farshore_watch_meadow: {
    id: 'q_farshore_watch_meadow',
    name: 'The Watch Beyond the Meadow',
    giverNpcId: 'warden_coalfast',
    turnInNpcId: 'riftwatch_ollun',
    text: 'Ollun keeps watch beyond the meadow where the island first split. He has heard three breaks singing at once. Cross the old landing road, find him, and learn which one will open first.',
    completionText:
      'Coalfast sent another pair of ears. Good. The nearest break is following the watchbell, and Tam must carry it to a place where we can spring the trap.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'riftwatch_ollun',
        count: 1,
        label: 'Riftwatch Ollun found',
      },
    ],
    xpReward: 450,
    copperReward: 180,
    itemRewards: {},
    minLevel: 3,
  },
  q_farshore_ferrywalk: {
    id: 'q_farshore_ferrywalk',
    name: 'Walk the Warning Bell',
    giverNpcId: 'riftwatch_ollun',
    turnInNpcId: 'riftwatch_ollun',
    text: 'Tam will carry the watchbell from the Landing to my meadow post. The breaches will come for its sound. Escort the bellkeeper, hold the road when they attack, and bring the warning safely into our trap.',
    completionText:
      'The bell is in place and the break showed us its teeth. Now I know which scar to close first, and what guards it.',
    objectives: [
      {
        type: 'escort',
        targetNpcId: 'bellkeeper_tam',
        count: 1,
        label: 'Bellkeeper Tam escorted to the meadow watch',
        path: [
          { x: 252, z: 18 },
          { x: 276, z: 42 },
          { x: 305, z: 68 },
          { x: 340, z: 32 },
          { x: 372, z: 2 },
        ],
        ambushes: [
          { atWaypoint: 1, mobId: 'breach_wretch', count: 2 },
          { atWaypoint: 3, mobId: 'riftspawn', count: 2 },
        ],
      },
    ],
    xpReward: 700,
    copperReward: 320,
    itemRewards: {},
    requiresQuest: 'q_farshore_watch_meadow',
    minLevel: 4,
  },
  q_farshore_horror: {
    id: 'q_farshore_horror',
    name: 'The Sundered Horror',
    giverNpcId: 'riftwatch_ollun',
    turnInNpcId: 'warden_coalfast',
    text: 'The bell drew out the master of the cliff break, a horror stitched from everything the rift has swallowed. Hunt it at the Sundered Cliffs, then tell Coalfast the island still has a shore worth holding.',
    completionText:
      'We heard the break close from Gullhaven. Farshore is still wounded, but today it stopped bleeding. You have our thanks, $N.',
    objectives: [
      { type: 'kill', targetMobId: 'sundered_horror', count: 1, label: 'Sundered Horror defeated' },
    ],
    xpReward: 1100,
    copperReward: 500,
    itemRewards: {},
    requiresQuest: 'q_farshore_ferrywalk',
    minLevel: 6,
    suggestedPlayers: 2,
  },
};
export const FARSHORE_QUEST_ORDER: string[] = [
  'q_farshore_watch_meadow',
  'q_farshore_ferrywalk',
  'q_farshore_horror',
];
export const FARSHORE_ITEMS: Record<string, ItemDef> = {};
export const FARSHORE_CAMPS: CampDef[] = [
  // the break-spawned hold the island's fringe; the redoubt keeps the town
  { mobId: 'breach_wretch', center: { x: 430, z: 44 }, radius: 12, count: 4 }, // the Riftfields
  { mobId: 'breach_wretch', center: { x: 400, z: 96 }, radius: 11, count: 3 }, // the north downs
  { mobId: 'riftspawn', center: { x: 452, z: 66 }, radius: 11, count: 3 }, // deep in the Riftfields
  { mobId: 'riftspawn', center: { x: 388, z: -44 }, radius: 11, count: 3 }, // above the Sundered Cliffs
  { mobId: 'void_stalker', center: { x: 418, z: -30 }, radius: 12, count: 2 }, // the cliff approach
  { mobId: 'void_stalker', center: { x: 462, z: 20 }, radius: 11, count: 2 }, // the east reach
  { mobId: 'sundered_horror', center: { x: 402, z: -78 }, radius: 6, count: 1 }, // the cliffs' great break
];
export const FARSHORE_OBJECTS: GroundObjectDef[] = [];

export const FARSHORE_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // Gullhaven, the redoubt: a fishing town turned to holding a line. The
  // homes still stand, but a war camp crowds the market and the fences have
  // become a barricade ring.
  buildings: [
    { kind: 'inn', x: 298, z: 64, w: 6, d: 7, rot: 0.5 }, // the muster hall
    { kind: 'house', x: 312, z: 78, w: 5, d: 5, rot: -1.1 },
    { kind: 'house', x: 296, z: 78, w: 5, d: 5, rot: 2.1 },
    { kind: 'chapel', x: 316, z: 62, w: 5, d: 7, rot: -2.4 }, // the menders' hall
  ],
  wells: [{ x: 305, z: 71, r: 1.5 }],
  stalls: [
    { x: 310, z: 68, rot: 0.6, r: 1.6 }, // the quartermaster's arming table
    { x: 300, z: 74, rot: -1.3, r: 1.6 },
  ],
  crates: [
    [294, 68],
    [312, 72],
    [308, 60], // ration and quarrel stores against the siege
    [290, 72],
  ],
  campfires: [
    [304, 66], // the muster fire
    [252, 18], // the Landing's brazier, at the causeway's island end
    [372, 4], // the Watch Meadow's signal fire, kept burning for the vigil
  ],
  // the barricade ring: the town's old windward fences, doubled and closed
  // into a defensive line around the muster
  fences: [
    { x1: 288, z1: 56, x2: 308, z2: 54 },
    { x1: 314, z1: 56, x2: 322, z2: 64 },
    { x1: 292, z1: 86, x2: 312, z2: 88 },
    { x1: 284, z1: 66, x2: 286, z2: 78 },
  ],
  // the war camp: tents crowd the market where the fish stalls used to stand
  tents: [
    { x: 300, z: 60, rot: 0.4, scale: 1 },
    { x: 314, z: 70, rot: -1.8, scale: 1 },
    { x: 292, z: 62, rot: 2.3, scale: 1 },
  ],
  // the Landing's fishing pier, at the island end of the causeway. No stone
  // hut on this dock: hw/hd 0 collapse the optional hut to nothing (with the
  // old 0.1/0.1 it drew as a thin post floating out over the water).
  docks: [{ x: 246, z: 12, rot: -1.7, hutLocal: { x: 40, z: 40, hw: 0, hd: 0 } }],
  graveyards: [{ x: 290, z: 86 }],
};
