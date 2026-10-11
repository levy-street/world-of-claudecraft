// The Buried Hoard BOSS ROOM THEMES: data. One record per boss that has a room of
// its own: its palette (which REPLACES the dig site's biome colours, so the Abyssal
// Maw never fights on a sunny beach), its Blender kit, its hero piece, the clusters
// its walls are dressed with, its floor marks, and the little that moves. The
// engine that reads these is hoard_room_kit_core.ts; the painter hoard_room_kit.ts.
//
// Rules every theme keeps (docs/design/boss-rooms/README.md):
//  - tall things stand against walls, the hero piece against the end wall, and the
//    fight's floor carries only flat, dark or dim marks;
//  - no floor tone may use the colour language of that boss's own telegraphs;
//  - nothing decorative may look like something the fight asks a player to read,
//    stand behind, or attack.

import type { BossRoomTheme, RoomKitCluster, RoomKitPut } from './hoard_room_kit_core';

const face = { yaw: 'face' } as const;

// ------------------------------------------------------------ Emberforge Tyrant
const FORGE_APRON = [0, 1].flatMap((row) =>
  [-2, -1, 0, 1, 2].map((column) => ({
    shape: 'quad' as const,
    tone: (row + column) % 2 ? 'plate' : 'plateAlt',
    depth: 10.4 + row * 4.4,
    along: column * 5.3 + (row ? 1.1 : -0.6),
    halfLength: 2.0,
    halfWidth: 2.45,
  })),
);

const FORGE_PLATES = [
  { shape: 'quad', tone: 'plate', depth: 3.6, along: -1.8, halfLength: 1.5, halfWidth: 1.7 },
  { shape: 'quad', tone: 'plateAlt', depth: 6.7, along: 2.2, halfLength: 1.5, halfWidth: 1.7 },
] as const;

const FORGE_CLUSTERS: readonly RoomKitCluster[] = [
  {
    name: 'smelter',
    puts: [
      {
        piece: 'Crucible',
        category: 'large',
        depth: 3.4,
        along: 0,
        ...face,
        yawJitter: 0.25,
        scale: 1.05,
      },
      { piece: 'Anvil', category: 'medium', depth: 6.4, along: 5.4, yaw: 'side', yawJitter: 0.55 },
      {
        piece: 'IngotStack',
        category: 'medium',
        depth: 2.8,
        along: -5.2,
        ...face,
        yawJitter: 0.7,
        scale: 0.95,
      },
      { piece: 'ChainHook', category: 'filler', depth: 1.3, along: 0.4, ...face, y: 10.5 },
    ],
    floor: [
      {
        shape: 'fan',
        tone: 'fire',
        depth: 3.4,
        along: 0,
        halfLength: 1,
        halfWidth: 0.34,
        radius: 6.5,
      },
      {
        shape: 'quad',
        tone: 'channel',
        depth: 1.9,
        along: 0,
        halfLength: 1.5,
        halfWidth: 0.35,
        yaw: 'side',
      },
      ...FORGE_PLATES,
    ],
  },
  {
    name: 'bellows',
    puts: [
      { piece: 'Vent', category: 'large', depth: 2.4, along: 0, ...face, scale: 1.1 },
      { piece: 'ForgePost', category: 'medium', depth: 4.6, along: -4.6, ...face, yawJitter: 1.5 },
      { piece: 'ForgePost', category: 'medium', depth: 4.6, along: 4.6, ...face, yawJitter: 1.5 },
      {
        piece: 'IngotStack',
        category: 'filler',
        depth: 3.0,
        along: 8.2,
        ...face,
        yawJitter: 0.8,
        scale: 0.8,
        mirror: true,
      },
    ],
    floor: FORGE_PLATES,
  },
  {
    name: 'braced',
    puts: [
      { piece: 'IronBrace', category: 'large', depth: 0.9, along: -3.6, ...face },
      {
        piece: 'IronBrace',
        category: 'large',
        depth: 0.9,
        along: 3.6,
        ...face,
        scale: 0.94,
        mirror: true,
      },
      {
        piece: 'ChainHook',
        category: 'filler',
        depth: 1.5,
        along: 0,
        ...face,
        scale: 1.15,
        y: 9.2,
      },
      {
        piece: 'Anvil',
        category: 'medium',
        depth: 5.6,
        along: 0.6,
        yaw: 'side',
        yawJitter: 0.6,
        scale: 1.1,
        mirror: true,
      },
    ],
    floor: FORGE_PLATES,
  },
  {
    name: 'stockpile',
    puts: [
      {
        piece: 'IngotStack',
        category: 'medium',
        depth: 3.0,
        along: -2.6,
        ...face,
        yawJitter: 0.6,
        scale: 1.15,
      },
      {
        piece: 'IngotStack',
        category: 'medium',
        depth: 5.4,
        along: 2.9,
        ...face,
        yawJitter: 1.1,
        scale: 0.85,
        mirror: true,
      },
      {
        piece: 'ForgePost',
        category: 'medium',
        depth: 2.2,
        along: 5.8,
        ...face,
        yawJitter: 1.5,
        scale: 1.1,
      },
      {
        piece: 'ChainHook',
        category: 'filler',
        depth: 1.4,
        along: -5.5,
        ...face,
        scale: 0.95,
        y: 9.8,
      },
    ],
    floor: FORGE_PLATES,
  },
];

export const EMBERFORGE_THEME: BossRoomTheme = {
  id: 'forge',
  boss: 'rift_boss_ember',
  palette: {
    fogColor: 0x6c4b42,
    fogNear: 74,
    fogFar: 205,
    ground: 0x342f2d,
    groundLight: 0x554239,
    cliff: 0x292729,
    cliffLight: 0x57433d,
    trunk: 0x241b18,
    accent: 0xd65b31,
  },
  kitUrl: '/models/props/hoard_forge_kit.glb',
  pieces: [
    'GreatForge',
    'Anvil',
    'Crucible',
    'IngotStack',
    'Vent',
    'ForgePost',
    'ChainHook',
    'IronBrace',
  ],
  hero: {
    piece: 'GreatForge',
    inset: 3.6,
    scale: 0.94,
    flank: [
      { piece: 'IronBrace', category: 'large', dx: 19.5, inset: 0.6, scale: 1.05 },
      { piece: 'ChainHook', category: 'filler', dx: 15.2, inset: 1.4, scale: 1.1, y: 11.5 },
      { piece: 'Vent', category: 'large', dx: 25.5, inset: 2.6, scale: 0.95 },
    ],
    floor: [
      { shape: 'fan', tone: 'fire', depth: 9, along: 0, halfLength: 1, halfWidth: 0.5, radius: 17 },
      ...FORGE_APRON,
    ],
  },
  clusters: FORGE_CLUSTERS,
  clusterSpacing: 23,
  clusterSkip: 0.28,
  tones: {
    plate: { color: 0x262223, lift: 0.03 },
    plateAlt: { color: 0x2e2927, lift: 0.03 },
    channelEdge: { color: 0x181516, lift: 0.04 },
    /** Dim beside the hammer's fire: decoration never out-glows a telegraph. */
    channel: { color: 0xb6501d, lift: 0.05, lit: true },
    ring: { color: 0x1c1919, lift: 0.035 },
    fire: { color: 0xff6a1e, lift: 0.06, lit: true },
  },
  floor: {
    rings: [
      [3.2, 0.22, 'ring'],
      [4.1, 0.12, 'ring'],
    ],
    wallRuns: [
      [1.7, 0.72, 'channelEdge'],
      [1.7, 0.32, 'channel'],
    ],
  },
  ambient: {
    pulse: [0.82, 1.06, 1.3],
    sway: ['ChainHook'],
    particles: {
      color: 0xffa64a,
      count: 56,
      size: 0.22,
      mode: 'rise',
      emitters: { GreatForge: [5, 4], Crucible: [3.3, 1.1] },
    },
  },
};

// ------------------------------------------------------------------ Abyssal Maw
// A flooded sea cave a leviathan died in. The Maw reads his fight in bright cyan
// (wave lanes, tentacle marks), so the room's own turquoise stays small, dim and at
// the walls; the floor of the fight gets only dark puddles and hairline cracks.
const ABYSS_PUDDLE = {
  shape: 'blot',
  tone: 'puddle',
  depth: 5.6,
  along: 1.5,
  halfLength: 2.6,
  halfWidth: 1.7,
} as const;

const ABYSS_CLUSTERS: readonly RoomKitCluster[] = [
  {
    name: 'shipwreck',
    puts: [
      { piece: 'Anchor', category: 'large', depth: 2.0, along: 0, ...face, yawJitter: 0.2 },
      { piece: 'Wreckage', category: 'medium', depth: 5.2, along: 5.2, ...face, yawJitter: 0.8 },
      { piece: 'Barnacles', category: 'filler', depth: 2.6, along: -4.8, ...face, yawJitter: 1.2 },
      { piece: 'HangingChain', category: 'filler', depth: 1.2, along: 3.4, ...face, y: 10.5 },
    ],
    floor: [ABYSS_PUDDLE],
  },
  {
    name: 'leviathan',
    puts: [
      { piece: 'RibBones', category: 'large', depth: 1.6, along: 0, ...face, yawJitter: 0.15 },
      {
        piece: 'CoralColumn',
        category: 'large',
        depth: 3.0,
        along: 6.4,
        ...face,
        yawJitter: 0.9,
        scale: 0.9,
      },
      { piece: 'Barnacles', category: 'medium', depth: 3.4, along: -5.6, ...face, yawJitter: 1.2 },
      { piece: 'Kelp', category: 'filler', depth: 1.0, along: -2.6, ...face, y: 9.5 },
    ],
  },
  {
    name: 'glowbed',
    puts: [
      { piece: 'CoralShelf', category: 'large', depth: 2.8, along: -3.8, ...face, yawJitter: 0.6 },
      { piece: 'GlowPolyp', category: 'medium', depth: 3.6, along: 1.6, ...face, yawJitter: 1.5 },
      {
        piece: 'GlowPolyp',
        category: 'filler',
        depth: 5.4,
        along: 4.4,
        ...face,
        yawJitter: 1.5,
        scale: 0.7,
        mirror: true,
      },
      { piece: 'Kelp', category: 'medium', depth: 1.0, along: 0.8, ...face, y: 10, scale: 1.1 },
    ],
    floor: [
      {
        shape: 'fan',
        tone: 'lure',
        depth: 3.6,
        along: 1.6,
        halfLength: 1,
        halfWidth: 0.22,
        radius: 5.5,
      },
      ABYSS_PUDDLE,
    ],
  },
  {
    name: 'reef',
    puts: [
      {
        piece: 'CoralColumn',
        category: 'large',
        depth: 2.6,
        along: 0,
        ...face,
        yawJitter: 0.9,
        scale: 1.1,
      },
      {
        piece: 'CoralShelf',
        category: 'medium',
        depth: 3.4,
        along: 5.2,
        ...face,
        yawJitter: 0.7,
        scale: 0.85,
        mirror: true,
      },
      { piece: 'Barnacles', category: 'filler', depth: 2.4, along: -4.4, ...face, yawJitter: 1.2 },
      { piece: 'Kelp', category: 'filler', depth: 1.0, along: -2.2, ...face, y: 9 },
      { piece: 'HangingChain', category: 'filler', depth: 1.3, along: 7.6, ...face, y: 11 },
    ],
  },
];

export const ABYSSAL_MAW_THEME: BossRoomTheme = {
  id: 'abyss',
  boss: 'rift_boss_tide',
  palette: {
    fogColor: 0x12343a,
    fogNear: 70,
    fogFar: 200,
    ground: 0x1c2a30,
    groundLight: 0x2b4149,
    cliff: 0x172225,
    cliffLight: 0x2d4f4c,
    trunk: 0x10181a,
    accent: 0x3fe0d0,
  },
  kitUrl: '/models/props/hoard_abyss_kit.glb',
  pieces: [
    'LeviathanArch',
    'CoralColumn',
    'CoralShelf',
    'Anchor',
    'HangingChain',
    'Barnacles',
    'Wreckage',
    'Kelp',
    'GlowPolyp',
    'RibBones',
  ],
  hero: {
    piece: 'LeviathanArch',
    inset: 5.2,
    scale: 1.15,
    flank: [
      { piece: 'CoralColumn', category: 'large', dx: 22, inset: 3.0, scale: 1.15 },
      { piece: 'Kelp', category: 'medium', dx: 25.5, inset: 1.1, y: 11.5, scale: 1.2 },
      { piece: 'RibBones', category: 'large', dx: 29, inset: 2.0, scale: 0.9 },
    ],
    floor: [
      {
        shape: 'fan',
        tone: 'lure',
        depth: 7,
        along: 0,
        halfLength: 1,
        halfWidth: 0.2,
        radius: 11,
      },
      { shape: 'blot', tone: 'puddle', depth: 8.5, along: -9, halfLength: 3.4, halfWidth: 2.0 },
      { shape: 'blot', tone: 'puddle', depth: 7.5, along: 10.5, halfLength: 2.8, halfWidth: 1.8 },
    ],
  },
  clusters: ABYSS_CLUSTERS,
  clusterSpacing: 19,
  clusterSkip: 0.2,
  tones: {
    /** Standing water: a shade off the wet stone, never a colour. */
    puddle: { color: 0x16363f, lift: 0.03 },
    crack: { color: 0x142226, lift: 0.035 },
    shell: { color: 0x8d968a, lift: 0.04 },
    /** Far dimmer than a wave lane or a tentacle mark, and only at the walls. */
    vein: { color: 0x1d6b66, lift: 0.04, lit: true },
    lure: { color: 0x2fd6c6, lift: 0.06, lit: true },
  },
  floor: {
    scatter: [
      { shape: 'blot', tone: 'puddle', count: 9, region: 'edge', size: [1.6, 3.4] },
      { shape: 'blot', tone: 'puddle', count: 3, region: 'center', size: [1.2, 2.2] },
      {
        shape: 'line',
        tone: 'crack',
        count: 7,
        region: 'center',
        size: [0.7, 1.6],
        width: 0.045,
        branches: 1,
      },
      {
        shape: 'line',
        tone: 'vein',
        count: 12,
        region: 'edge',
        size: [0.8, 1.8],
        width: 0.05,
        branches: 1,
      },
      { shape: 'point', tone: 'shell', count: 14, region: 'edge', size: [0.09, 0.16] },
    ],
  },
  ambient: {
    pulse: [0.5, 1.0, 0.7],
    sway: ['Kelp', 'HangingChain'],
    particles: { color: 0x8fded6, count: 70, size: 0.14, mode: 'drift' },
  },
};

// A cluster prop that faces the room: most of them do.
const at = (
  piece: string,
  category: RoomKitPut['category'],
  depth: number,
  along: number,
  more: Partial<RoomKitPut> = {},
): RoomKitPut => ({ piece, category, depth, along, yaw: 'face', ...more });

/** Flagstones before a hero piece: two staggered rows, alternating two tones. */
const apron = (toneA: string, toneB: string, depth: number) =>
  [0, 1].flatMap((row) =>
    [-2, -1, 0, 1, 2].map((column) => ({
      shape: 'quad' as const,
      tone: (row + column) % 2 ? toneA : toneB,
      depth: depth + row * 4.4,
      along: column * 5.3 + (row ? 1.1 : -0.6),
      halfLength: 2.0,
      halfWidth: 2.45,
    })),
  );

// ------------------------------------------------------------- Hoarfrost Warden
// A fortress throne hall frozen in time. His fight is read in bright frost and in
// the thick lone pillars of the Ice Age, so the floor goes DARK, no mark is a ring,
// and the decorative ice stays low, clustered and on the walls.
export const HOARFROST_THEME: BossRoomTheme = {
  id: 'frost',
  boss: 'rift_boss_frost',
  palette: {
    fogColor: 0x8496ab,
    fogNear: 64,
    fogFar: 195,
    ground: 0x2b3644,
    groundLight: 0x435268,
    cliff: 0x39424f,
    cliffLight: 0x73859b,
    trunk: 0x20262e,
    accent: 0x9fe8ff,
  },
  kitUrl: '/models/props/hoard_frost_kit.glb',
  pieces: [
    'FrozenThrone',
    'FrozenSoldier',
    'FrozenBanner',
    'DeadBrazier',
    'EmbeddedWeapons',
    'WallIcicles',
    'FrozenRuin',
  ],
  hero: {
    piece: 'FrozenThrone',
    inset: 4.8,
    scale: 1,
    flank: [
      { piece: 'FrozenBanner', category: 'large', dx: 20.5, inset: 2.4, scale: 1.2 },
      { piece: 'FrozenSoldier', category: 'large', dx: 25, inset: 3.2 },
      { piece: 'WallIcicles', category: 'filler', dx: 29, inset: 1.0, y: 10 },
    ],
    floor: apron('slab', 'slabAlt', 11),
  },
  clusters: [
    {
      name: 'guard',
      puts: [
        at('FrozenSoldier', 'large', 2.8, 0, { yawJitter: 0.3 }),
        at('FrozenSoldier', 'medium', 3.4, 5.6, { yawJitter: 0.4, scale: 0.9, mirror: true }),
        at('FrozenBanner', 'medium', 1.8, -4.6),
        at('WallIcicles', 'filler', 0.9, 1.2, { y: 9.5 }),
      ],
    },
    {
      name: 'battlefield',
      puts: [
        at('DeadBrazier', 'large', 2.8, -4.4, { yawJitter: 1.5 }),
        at('EmbeddedWeapons', 'medium', 4.2, 0.6, { yawJitter: 1.0 }),
        at('EmbeddedWeapons', 'filler', 3.0, 5.8, { yawJitter: 1.0, scale: 0.8, mirror: true }),
        at('WallIcicles', 'filler', 0.9, -1.0, { y: 8.5, scale: 0.85 }),
      ],
    },
    {
      name: 'icewall',
      puts: [
        at('FrozenRuin', 'large', 2.2, 0, { yawJitter: 0.15 }),
        at('WallIcicles', 'medium', 0.9, -1.4, { y: 10 }),
        at('WallIcicles', 'filler', 0.9, 4.2, { y: 8.5, scale: 0.8, mirror: true }),
        at('DeadBrazier', 'filler', 3.0, 6.8, { scale: 0.85 }),
      ],
    },
    {
      name: 'colonnade',
      puts: [
        at('FrozenRuin', 'large', 2.2, -1.2, { mirror: true, scale: 0.95 }),
        at('FrozenBanner', 'large', 1.8, 5.8),
        at('FrozenSoldier', 'filler', 3.0, -7.0, { yawJitter: 0.4, scale: 0.85 }),
        at('EmbeddedWeapons', 'medium', 4.6, 2.2, { yawJitter: 1.2, scale: 0.9 }),
      ],
    },
  ],
  clusterSpacing: 19,
  clusterSkip: 0.2,
  tones: {
    slab: { color: 0x263040, lift: 0.03 },
    slabAlt: { color: 0x303c4e, lift: 0.03 },
    crack: { color: 0x18202a, lift: 0.04 },
    seam: { color: 0x40566c, lift: 0.04 },
    /** Rime on the stone: a shade, far under the white of his frost. */
    rime: { color: 0x4a5a6e, lift: 0.035 },
  },
  floor: {
    scatter: [
      { shape: 'blot', tone: 'rime', count: 10, region: 'edge', size: [1.5, 3.2] },
      { shape: 'blot', tone: 'rime', count: 3, region: 'center', size: [1.0, 1.9] },
      {
        shape: 'line',
        tone: 'crack',
        count: 9,
        region: 'center',
        size: [0.8, 1.9],
        width: 0.05,
        branches: 1,
      },
      { shape: 'line', tone: 'seam', count: 9, region: 'edge', size: [1.0, 2.4], width: 0.05 },
    ],
  },
  ambient: {
    pulse: [0.6, 1.0, 0.5],
    // Thin: the Ice Age blizzard must bury this, not blend with it.
    particles: { color: 0xe8f4ff, count: 56, size: 0.12, mode: 'fall' },
  },
};

// --------------------------------------------------------------- Archon Nyxaris
// An observatory that tore the sky open. He telegraphs in bright purple CIRCLES ON
// THE FLOOR: so the floor circle is engraved in a blue-grey barely off the stone,
// its stars are dull points, and every violet thing stands upright at a wall.
export const NYXARIS_THEME: BossRoomTheme = {
  id: 'void',
  boss: 'rift_boss_arcane',
  palette: {
    fogColor: 0x141a3c,
    fogNear: 72,
    fogFar: 205,
    ground: 0x1d233c,
    groundLight: 0x2e3860,
    cliff: 0x20263f,
    cliffLight: 0x414c7c,
    trunk: 0x0e1020,
    accent: 0x8a5cff,
  },
  kitUrl: '/models/props/hoard_void_kit.glb',
  pieces: [
    'Armillary',
    'RuneObelisk',
    'RuneObeliskBroken',
    'FloatingFragments',
    'BrokenMirror',
    'VoidCandles',
    'Lectern',
    'RuneWall',
  ],
  hero: {
    piece: 'Armillary',
    inset: 5,
    scale: 1.1,
    flank: [
      { piece: 'RuneObelisk', category: 'large', dx: 21, inset: 4.2, y: 0.6, scale: 1.15 },
      { piece: 'FloatingFragments', category: 'medium', dx: 25.5, inset: 3.2 },
      { piece: 'VoidCandles', category: 'filler', dx: 17.5, inset: 6.0 },
    ],
  },
  clusters: [
    {
      name: 'observatory',
      puts: [
        at('FloatingFragments', 'large', 3.4, 0, { yawJitter: 1.5 }),
        at('RuneObelisk', 'large', 3.0, -5.2, { y: 0.6, yawJitter: 0.3 }),
        at('RuneWall', 'medium', 1.8, 5.8, { yawJitter: 0.15 }),
        at('VoidCandles', 'filler', 4.6, 2.4, { yawJitter: 1.5 }),
      ],
    },
    {
      name: 'archive',
      puts: [
        at('BrokenMirror', 'large', 1.7, 0, { yawJitter: 0.12 }),
        at('Lectern', 'medium', 4.2, -4.6, { yawJitter: 0.5 }),
        at('VoidCandles', 'medium', 3.0, 3.8, { yawJitter: 1.5 }),
        at('VoidCandles', 'filler', 4.4, -7.4, { yawJitter: 1.5, scale: 0.85 }),
      ],
    },
    {
      name: 'ruin',
      puts: [
        at('RuneWall', 'large', 1.7, 0, { yawJitter: 0.15, mirror: true }),
        at('RuneObeliskBroken', 'large', 3.2, 5.8, { y: 0.6, yawJitter: 0.3 }),
        at('FloatingFragments', 'medium', 3.6, -5.6, { yawJitter: 1.5, scale: 0.8, mirror: true }),
        at('Lectern', 'filler', 4.4, 2.6, { yawJitter: 0.6, scale: 0.9 }),
      ],
    },
    {
      name: 'sentinels',
      puts: [
        at('RuneObeliskBroken', 'large', 3.0, -2.6, { y: 0.6, yawJitter: 0.3 }),
        at('RuneObelisk', 'large', 3.6, 3.2, { y: 0.7, yawJitter: 0.3, scale: 0.85 }),
        at('FloatingFragments', 'filler', 3.0, 7.4, { yawJitter: 1.5, scale: 0.75 }),
        at('BrokenMirror', 'medium', 1.7, -7.6, { yawJitter: 0.12, scale: 0.85, mirror: true }),
      ],
    },
  ],
  clusterSpacing: 19,
  clusterSkip: 0.2,
  tones: {
    /** The great circle: engraved, never lit, a breath lighter than the floor. */
    engrave: { color: 0x353f66, lift: 0.035 },
    engraveFaint: { color: 0x2a3252, lift: 0.03 },
    crack: { color: 0x0c0f1c, lift: 0.04 },
    star: { color: 0x6f7aa8, lift: 0.045 },
  },
  floor: {
    rings: [
      [2.4, 0.16, 'engrave'],
      [3.3, 0.05, 'engraveFaint'],
      [7.0, 0.09, 'engraveFaint'],
    ],
    scatter: [
      {
        shape: 'line',
        tone: 'engraveFaint',
        count: 9,
        region: 'dais',
        size: [1.4, 3.0],
        width: 0.04,
        reach: 20,
      },
      { shape: 'point', tone: 'star', count: 22, region: 'dais', size: [0.05, 0.1], reach: 21 },
      {
        shape: 'line',
        tone: 'crack',
        count: 7,
        region: 'center',
        size: [0.8, 1.8],
        width: 0.05,
        branches: 1,
      },
      { shape: 'point', tone: 'star', count: 10, region: 'edge', size: [0.05, 0.09] },
    ],
  },
  ambient: {
    pulse: [0.55, 1.0, 0.6],
    hover: ['RuneObelisk', 'RuneObeliskBroken', 'FloatingFragments'],
    particles: {
      color: 0x9a6cff,
      count: 40,
      size: 0.15,
      mode: 'rise',
      emitters: { Armillary: [9, 5], VoidCandles: [3.6, 0.5] },
    },
  },
};

// --------------------------------------------------------------- Tempest Vharok
// A summit under a storm that never ends. He telegraphs in bright circles, so the
// floor carries only black branching scorch and dull grass, never a ring, and the
// cyan lives in split stone and at the tips of rods.
export const VHAROK_THEME: BossRoomTheme = {
  id: 'storm',
  boss: 'rift_boss_storm',
  palette: {
    fogColor: 0x5a6878,
    fogNear: 64,
    fogFar: 192,
    ground: 0x3b424b,
    groundLight: 0x525c69,
    cliff: 0x30363f,
    cliffLight: 0x63707f,
    trunk: 0x1c1d20,
    accent: 0x56e6f0,
  },
  kitUrl: '/models/props/hoard_storm_kit.glb',
  pieces: [
    'LightningSpire',
    'SplitMenhir',
    'LightningRod',
    'TornBanner',
    'BoneCluster',
    'GroundingChain',
    'StormShrine',
  ],
  hero: {
    piece: 'LightningSpire',
    inset: 5.4,
    scale: 1.05,
    flank: [
      { piece: 'LightningRod', category: 'large', dx: 21.5, inset: 4.0, scale: 1.15 },
      { piece: 'SplitMenhir', category: 'large', dx: 26, inset: 3.0, scale: 1.2 },
      { piece: 'TornBanner', category: 'medium', dx: 30, inset: 2.6 },
    ],
    floor: [
      // The storm's light at the tower's foot: dim, additive, and against the wall.
      {
        shape: 'fan',
        tone: 'arc',
        depth: 8,
        along: 0,
        halfLength: 1,
        halfWidth: 0.24,
        radius: 13,
      },
      ...apron('slab', 'slabAlt', 12),
      { shape: 'blot', tone: 'scorch', depth: 9, along: -5, halfLength: 3.2, halfWidth: 2.0 },
      { shape: 'blot', tone: 'scorch', depth: 8, along: 6.5, halfLength: 2.6, halfWidth: 1.8 },
    ],
  },
  clusters: [
    {
      name: 'rods',
      puts: [
        at('LightningRod', 'large', 3.0, 0, { yawJitter: 1.5 }),
        at('GroundingChain', 'medium', 0.5, 4.6),
        at('LightningRod', 'medium', 3.8, -5.2, { yawJitter: 1.5, scale: 0.78 }),
        at('SplitMenhir', 'filler', 2.8, 8.6, { yawJitter: 0.5, scale: 0.75 }),
      ],
      floor: [
        {
          shape: 'fan',
          tone: 'arc',
          depth: 3.0,
          along: 0,
          halfLength: 1,
          halfWidth: 0.2,
          radius: 5,
        },
      ],
    },
    {
      name: 'wartorn',
      puts: [
        at('BoneCluster', 'large', 3.0, 5.4, { yawJitter: 0.4 }),
        at('TornBanner', 'large', 2.0, 0),
        at('StormShrine', 'medium', 2.6, -5.8, { yawJitter: 0.2 }),
        at('TornBanner', 'filler', 2.4, -10, { scale: 0.85, mirror: true }),
      ],
    },
    {
      name: 'field',
      puts: [
        at('SplitMenhir', 'large', 3.0, 0, { yawJitter: 0.5, scale: 1.1 }),
        at('SplitMenhir', 'medium', 3.8, 5.0, { yawJitter: 0.6, scale: 0.8, mirror: true }),
        at('LightningRod', 'filler', 3.0, -4.6, { yawJitter: 1.5, scale: 0.9 }),
      ],
      floor: [
        { shape: 'blot', tone: 'scorch', depth: 5.4, along: 1.5, halfLength: 2.6, halfWidth: 1.6 },
      ],
    },
    {
      name: 'shrine',
      puts: [
        at('StormShrine', 'large', 2.6, 0, { yawJitter: 0.2 }),
        at('TornBanner', 'medium', 2.0, 5.4),
        at('BoneCluster', 'filler', 3.2, -6.4, { yawJitter: 0.5, scale: 0.8, mirror: true }),
        at('GroundingChain', 'filler', 0.5, 8.6, { mirror: true }),
      ],
    },
  ],
  clusterSpacing: 19,
  clusterSkip: 0.2,
  tones: {
    slab: { color: 0x333941, lift: 0.03 },
    slabAlt: { color: 0x424a55, lift: 0.03 },
    scorch: { color: 0x1b1e23, lift: 0.035 },
    crackle: { color: 0x242930, lift: 0.04 },
    /** What grass the wind has left: grey, barely green, and only by the walls. */
    grass: { color: 0x3d4744, lift: 0.03 },
    /** Storm light on the stone: dim, and only at the walls. His circles are far brighter. */
    arc: { color: 0x3fd6e6, lift: 0.06, lit: true },
  },
  floor: {
    scatter: [
      { shape: 'blot', tone: 'grass', count: 9, region: 'edge', size: [1.6, 3.2] },
      {
        shape: 'line',
        tone: 'scorch',
        count: 7,
        region: 'center',
        size: [0.8, 1.8],
        width: 0.05,
        branches: 2,
      },
      {
        shape: 'line',
        tone: 'crackle',
        count: 9,
        region: 'edge',
        size: [0.8, 2.0],
        width: 0.05,
        branches: 1,
      },
    ],
  },
  ambient: {
    // The caught lightning flickers; sparks climb off every conductor.
    pulse: [0.5, 1.15, 3.4],
    sway: ['TornBanner'],
    particles: {
      color: 0x9ff6ff,
      count: 54,
      size: 0.17,
      mode: 'rise',
      emitters: { LightningSpire: [33, 2.4], LightningRod: [8.4, 0.7], SplitMenhir: [5.5, 0.6] },
    },
  },
};

// ---------------------------------------------------------------- Warlord Grask
// His war camp. The boulders roll the length of the room, so the camp is wall
// furniture and the floor is only trampled: nothing on it is round, grey or big.
export const GRASK_THEME: BossRoomTheme = {
  id: 'warcamp',
  boss: 'rift_boss_brute',
  palette: {
    fogColor: 0x6a5743,
    fogNear: 66,
    fogFar: 198,
    ground: 0x4a3a2a,
    groundLight: 0x68523b,
    cliff: 0x3a2f28,
    cliffLight: 0x6c5644,
    trunk: 0x2a1f18,
    accent: 0xd8602a,
  },
  kitUrl: '/models/props/hoard_warcamp_kit.glb',
  pieces: [
    'WarlordGate',
    'Palisade',
    'SkullStake',
    'WarDrum',
    'Campfire',
    'PrisonCage',
    'WeaponRack',
    'BrokenCart',
    'HangingTrophies',
  ],
  hero: {
    piece: 'WarlordGate',
    inset: 3.8,
    scale: 1.08,
    flank: [
      { piece: 'Palisade', category: 'large', dx: 23.5, inset: 2.2, scale: 1.15 },
      { piece: 'SkullStake', category: 'medium', dx: 20, inset: 6.0, scale: 1.1 },
      { piece: 'HangingTrophies', category: 'filler', dx: 28.5, inset: 1.2, y: 10 },
    ],
    floor: [
      { shape: 'blot', tone: 'dirt', depth: 8, along: 0, halfLength: 5.0, halfWidth: 2.4 },
      { shape: 'blot', tone: 'ash', depth: 7, along: -12, halfLength: 2.4, halfWidth: 1.6 },
    ],
  },
  clusters: [
    {
      name: 'prison',
      puts: [
        at('PrisonCage', 'large', 2.8, 0, { yawJitter: 0.3 }),
        at('WeaponRack', 'medium', 1.8, 5.4, { yawJitter: 0.15 }),
        at('SkullStake', 'medium', 3.8, -4.6, { yawJitter: 0.6 }),
        at('SkullStake', 'filler', 2.6, 8.8, { yawJitter: 0.6, scale: 0.85, mirror: true }),
        at('HangingTrophies', 'filler', 1.1, -1.6, { y: 9.5 }),
      ],
    },
    {
      name: 'camp',
      puts: [
        at('WarDrum', 'large', 3.0, -4.8, { yawJitter: 0.4 }),
        at('BrokenCart', 'large', 3.2, 6.6, { yawJitter: 0.5 }),
        at('Campfire', 'medium', 4.4, 0.6, { yawJitter: 1.5 }),
      ],
      floor: [
        {
          shape: 'fan',
          tone: 'fire',
          depth: 4.4,
          along: 0.6,
          halfLength: 1,
          halfWidth: 0.3,
          radius: 5.5,
        },
        { shape: 'blot', tone: 'ash', depth: 4.4, along: 0.6, halfLength: 2.4, halfWidth: 2.0 },
      ],
    },
    {
      name: 'stockade',
      puts: [
        at('Palisade', 'large', 1.6, 0, { yawJitter: 0.08 }),
        at('Palisade', 'large', 1.8, 6.8, { yawJitter: 0.1, scale: 0.95, mirror: true }),
        at('WeaponRack', 'filler', 1.9, -5.8, { yawJitter: 0.15, mirror: true }),
        at('HangingTrophies', 'filler', 1.1, 3.2, { y: 9 }),
      ],
    },
    {
      name: 'trophies',
      puts: [
        at('SkullStake', 'medium', 3.0, -2.2, { yawJitter: 0.6 }),
        at('SkullStake', 'medium', 2.4, 2.6, { yawJitter: 0.6, scale: 1.15, mirror: true }),
        at('Palisade', 'large', 1.4, 0.2, { yawJitter: 0.08 }),
        at('WarDrum', 'filler', 3.2, 7.2, { yawJitter: 0.5, scale: 0.85 }),
      ],
    },
  ],
  clusterSpacing: 19,
  clusterSkip: 0.2,
  tones: {
    dirt: { color: 0x3c2f23, lift: 0.03 },
    track: { color: 0x33281e, lift: 0.035 },
    ash: { color: 0x2a2522, lift: 0.035 },
    /** A camp fire, at the wall; his boulders carry no light to confuse it with. */
    fire: { color: 0xff7a2a, lift: 0.06, lit: true },
  },
  floor: {
    scatter: [
      { shape: 'blot', tone: 'dirt', count: 9, region: 'center', size: [1.6, 3.2] },
      { shape: 'blot', tone: 'ash', count: 8, region: 'edge', size: [1.2, 2.4] },
      { shape: 'line', tone: 'track', count: 6, region: 'center', size: [2.4, 4.6], width: 0.11 },
      { shape: 'point', tone: 'track', count: 22, region: 'center', size: [0.1, 0.17] },
    ],
  },
  ambient: {
    pulse: [0.75, 1.1, 3.0],
    sway: ['HangingTrophies'],
    particles: {
      color: 0xffa048,
      count: 36,
      size: 0.18,
      mode: 'rise',
      emitters: { Campfire: [1.4, 0.8] },
    },
  },
};

// ----------------------------------------------------------- Broodmother Vysska
// Her nest. In this fight a live cocoon, a live egg and bright green all mean ACT:
// so the room is grey silk, empty shells and old dark stains, hung on the walls.
export const VYSSKA_THEME: BossRoomTheme = {
  id: 'nest',
  boss: 'rift_boss_venom',
  palette: {
    fogColor: 0x121c14,
    fogNear: 60,
    fogFar: 182,
    ground: 0x242b23,
    groundLight: 0x363e31,
    cliff: 0x1b211c,
    cliffLight: 0x364035,
    trunk: 0x15130f,
    accent: 0x7a9a3a,
  },
  kitUrl: '/models/props/hoard_nest_kit.glb',
  pieces: [
    'GreatWeb',
    'WallWeb',
    'EggShells',
    'WrappedPrey',
    'BoneCluster',
    'TwistedRoots',
    'SilkColumn',
  ],
  hero: {
    piece: 'GreatWeb',
    inset: 3.8,
    scale: 1.12,
    flank: [
      { piece: 'TwistedRoots', category: 'large', dx: 23, inset: 1.6, scale: 1.15 },
      { piece: 'WrappedPrey', category: 'medium', dx: 19.5, inset: 1.8, y: 11 },
      { piece: 'SilkColumn', category: 'large', dx: 28, inset: 2.0 },
    ],
    floor: [
      { shape: 'blot', tone: 'stain', depth: 8, along: -7, halfLength: 3.0, halfWidth: 1.8 },
      { shape: 'blot', tone: 'stain', depth: 7, along: 8.5, halfLength: 2.4, halfWidth: 1.6 },
    ],
  },
  clusters: [
    {
      name: 'brood',
      puts: [
        at('WallWeb', 'large', 1.2, -5.2, { yawJitter: 0.1 }),
        at('SilkColumn', 'large', 1.6, 6.8, { yawJitter: 0.2 }),
        at('EggShells', 'medium', 3.2, 0.4, { yawJitter: 1.5 }),
        at('EggShells', 'filler', 4.6, 4.2, { yawJitter: 1.5, scale: 0.8, mirror: true }),
      ],
    },
    {
      name: 'larder',
      puts: [
        at('WallWeb', 'large', 1.2, 5.8, { yawJitter: 0.1, mirror: true }),
        at('WrappedPrey', 'medium', 1.7, -1.8, { y: 10.5 }),
        at('BoneCluster', 'medium', 3.8, 0.4, { yawJitter: 1.2 }),
        at('WrappedPrey', 'filler', 2.0, 1.6, { y: 9, scale: 0.85, mirror: true }),
      ],
      floor: [
        { shape: 'blot', tone: 'stain', depth: 4.6, along: 0, halfLength: 2.2, halfWidth: 1.5 },
      ],
    },
    {
      name: 'roots',
      puts: [
        at('TwistedRoots', 'large', 1.4, 0, { yawJitter: 0.15 }),
        at('WallWeb', 'medium', 1.2, -6.4, { yawJitter: 0.1, scale: 0.9 }),
        at('BoneCluster', 'filler', 3.6, 4.8, { yawJitter: 1.2, scale: 0.8 }),
        at('EggShells', 'filler', 3.0, -2.8, { yawJitter: 1.5, scale: 0.7 }),
      ],
    },
    {
      name: 'silk',
      puts: [
        at('SilkColumn', 'large', 1.6, 0, { yawJitter: 0.2, mirror: true }),
        at('TwistedRoots', 'large', 1.4, -6.4, { yawJitter: 0.15, scale: 0.9, mirror: true }),
        at('WrappedPrey', 'medium', 1.8, 4.2, { y: 10 }),
        at('BoneCluster', 'filler', 4.0, 5.6, { yawJitter: 1.2, scale: 0.75 }),
      ],
    },
  ],
  clusterSpacing: 19,
  clusterSkip: 0.2,
  tones: {
    /** Old threads across the stone: hairlines of dust-grey. */
    silk: { color: 0x4d524a, lift: 0.04 },
    /** Old venom, dried black-green. Bright green is hers alone. */
    stain: { color: 0x1b2316, lift: 0.03 },
    chip: { color: 0x85836f, lift: 0.04 },
  },
  floor: {
    scatter: [
      {
        shape: 'line',
        tone: 'silk',
        count: 12,
        region: 'center',
        size: [1.4, 3.4],
        width: 0.03,
        branches: 1,
      },
      {
        shape: 'line',
        tone: 'silk',
        count: 14,
        region: 'edge',
        size: [1.2, 3.0],
        width: 0.04,
        branches: 2,
      },
      { shape: 'blot', tone: 'stain', count: 9, region: 'edge', size: [1.2, 2.6] },
      { shape: 'blot', tone: 'stain', count: 3, region: 'center', size: [0.8, 1.5] },
      { shape: 'point', tone: 'chip', count: 14, region: 'edge', size: [0.07, 0.13] },
    ],
  },
  ambient: {
    pulse: [0.4, 0.8, 0.5],
    sway: ['WrappedPrey'],
    particles: { color: 0xcfd2c4, count: 56, size: 0.1, mode: 'drift' },
  },
};

// ---------------------------------------------------------------------- Xarreth
// A cathedral of the dead, found buried. His scythe sweeps wide arcs over the whole
// floor, so the floor carries only straight seams and square tiles, never a curve,
// and the spectral green is candle flames held high at the walls.
export const XARRETH_THEME: BossRoomTheme = {
  id: 'crypt',
  boss: 'rift_boss_necro',
  palette: {
    fogColor: 0x474d56,
    fogNear: 56,
    fogFar: 182,
    ground: 0x35383e,
    groundLight: 0x4c5058,
    cliff: 0x272a31,
    cliffLight: 0x4c5262,
    trunk: 0x1c1d22,
    accent: 0x5dffa0,
  },
  kitUrl: '/models/props/hoard_crypt_kit.glb',
  pieces: [
    'OssuaryAltar',
    'Tombstones',
    'Sarcophagus',
    'BoneCandelabrum',
    'BrokenColumn',
    'FallenColumn',
    'SkullPile',
    'CryptArch',
    'HangingCenser',
  ],
  hero: {
    piece: 'OssuaryAltar',
    inset: 4.8,
    scale: 1.05,
    flank: [
      { piece: 'BrokenColumn', category: 'large', dx: 18, inset: 5.6 },
      { piece: 'CryptArch', category: 'large', dx: 25.5, inset: 1.6 },
      { piece: 'BoneCandelabrum', category: 'medium', dx: 14.5, inset: 8.0 },
      { piece: 'HangingCenser', category: 'filler', dx: 21.5, inset: 2.0, y: 12 },
    ],
    floor: [
      ...apron('tile', 'tileDark', 11),
      // The funerary mark before the altar: a plain cross, cut, never lit.
      { shape: 'quad', tone: 'seam', depth: 13.2, along: 0, halfLength: 3.2, halfWidth: 0.22 },
      {
        shape: 'quad',
        tone: 'seam',
        depth: 12.2,
        along: 0,
        halfLength: 1.6,
        halfWidth: 0.22,
        yaw: 'side',
      },
    ],
  },
  clusters: [
    {
      name: 'burial',
      puts: [
        at('Sarcophagus', 'large', 3.0, 0, { yawJitter: 0.2 }),
        at('Tombstones', 'medium', 2.6, -6.2, { yawJitter: 0.3 }),
        at('SkullPile', 'medium', 2.4, 6.2, { yawJitter: 0.6 }),
        at('BoneCandelabrum', 'filler', 4.8, 3.4, { yawJitter: 1.5 }),
      ],
      floor: [
        {
          shape: 'fan',
          tone: 'ghost',
          depth: 4.8,
          along: 3.4,
          halfLength: 1,
          halfWidth: 0.18,
          radius: 4.5,
        },
      ],
    },
    {
      name: 'ruin',
      puts: [
        at('CryptArch', 'large', 1.3, 0, { yawJitter: 0.06 }),
        at('FallenColumn', 'large', 3.2, 7.2, { yawJitter: 0.15 }),
        at('SkullPile', 'filler', 2.6, -5.8, { yawJitter: 0.6, scale: 0.85 }),
        at('HangingCenser', 'filler', 2.0, 0, { y: 10.5 }),
      ],
    },
    {
      name: 'nave',
      puts: [
        at('BrokenColumn', 'large', 2.6, -3.4, { yawJitter: 1.5 }),
        at('BrokenColumn', 'large', 2.6, 3.8, { yawJitter: 1.5, scale: 0.9, mirror: true }),
        at('Tombstones', 'medium', 2.4, 8.6, { yawJitter: 0.3, mirror: true }),
        at('BoneCandelabrum', 'medium', 4.8, 0.2, { yawJitter: 1.5 }),
      ],
      floor: [
        {
          shape: 'fan',
          tone: 'ghost',
          depth: 4.8,
          along: 0.2,
          halfLength: 1,
          halfWidth: 0.18,
          radius: 4.5,
        },
      ],
    },
    {
      name: 'ossuary',
      puts: [
        at('CryptArch', 'large', 1.3, -6.6, { yawJitter: 0.06, mirror: true }),
        at('SkullPile', 'medium', 2.2, 0, { yawJitter: 0.5, scale: 1.2 }),
        at('Tombstones', 'filler', 2.8, 5.2, { yawJitter: 0.3, scale: 0.9 }),
        at('HangingCenser', 'filler', 2.0, -6.6, { y: 9.5 }),
      ],
    },
  ],
  clusterSpacing: 19,
  clusterSkip: 0.2,
  tones: {
    tile: { color: 0x3d4047, lift: 0.03 },
    tileDark: { color: 0x2e3137, lift: 0.03 },
    seam: { color: 0x23252a, lift: 0.04 },
    /** The green of a candle on the stones beside it: small, and only at the walls. */
    ghost: { color: 0x3dff8a, lift: 0.06, lit: true },
  },
  floor: {
    scatter: [
      { shape: 'line', tone: 'seam', count: 11, region: 'center', size: [1.4, 3.0], width: 0.05 },
      { shape: 'line', tone: 'seam', count: 9, region: 'edge', size: [1.0, 2.4], width: 0.05 },
      { shape: 'point', tone: 'tileDark', count: 9, region: 'center', size: [0.4, 0.8] },
      { shape: 'point', tone: 'tile', count: 8, region: 'edge', size: [0.4, 0.8] },
    ],
  },
  ambient: {
    pulse: [0.6, 1.0, 1.6],
    sway: ['HangingCenser'],
    particles: { color: 0x9dffc4, count: 34, size: 0.13, mode: 'drift' },
  },
};

export const BOSS_ROOM_THEMES: readonly BossRoomTheme[] = [
  EMBERFORGE_THEME,
  ABYSSAL_MAW_THEME,
  HOARFROST_THEME,
  NYXARIS_THEME,
  VHAROK_THEME,
  GRASK_THEME,
  VYSSKA_THEME,
  XARRETH_THEME,
];

/** The room theme of a hoard floor's boss, or null for a boss with no room of its own. */
export function bossRoomThemeFor(bossTemplateId: string | undefined): BossRoomTheme | null {
  if (!bossTemplateId) return null;
  return BOSS_ROOM_THEMES.find((theme) => theme.boss === bossTemplateId) ?? null;
}
