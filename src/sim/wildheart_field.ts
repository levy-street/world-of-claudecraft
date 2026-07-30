// The Wildheart Basin open-field interior. This pure module owns the shared
// terrain height, prop placement, and static collision contract for every
// instance. All coordinates are instance-local and stay inside one 500 yd slot.

export type WildheartPropKind =
  | 'wildheart_limestone_cliff'
  | 'wildheart_jaguar_gate'
  | 'wildheart_ritual_pyramid'
  | 'wildheart_canopy_platform'
  | 'wildheart_rope_bridge'
  | 'wildheart_beast_den'
  | 'wildheart_mask_totem'
  | 'wildheart_jungle_canopy_tree'
  | 'wildheart_giant_fern'
  | 'wildheart_ancestor_ruin';

export interface WildheartPropPlacement {
  kind: WildheartPropKind;
  x: number;
  z: number;
  rot: number;
  scale?: number;
}

export const WILDHEART_FIELD_BOUNDS = { minX: -82, maxX: 82, minZ: -24, maxZ: 242 } as const;

export const WILDHEART_FIELD_WALLS: readonly {
  x: number;
  z: number;
  hw: number;
  hd: number;
}[] = [
  { x: -82, z: 109, hw: 1, hd: 133 },
  { x: 82, z: 109, hw: 1, hd: 133 },
  { x: 0, z: 242, hw: 83, hd: 1 },
  { x: 0, z: -24, hw: 83, hd: 1 },
];

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mound(x: number, z: number, cx: number, cz: number, rx: number, rz: number): number {
  const d = Math.hypot((x - cx) / rx, (z - cz) / rz);
  return 1 - smoothstep(0.25, 1, d);
}

/** Center of the shallow stream that braids through the lower basin. */
export function wildheartStreamCenter(lz: number): number {
  return Math.sin(lz * 0.047 - 0.8) * 7 + Math.sin(lz * 0.019 + 1.2) * 3;
}

/**
 * A flooded jungle caldera with two raised routes around a central cenote.
 * The western and eastern shelves are deliberately asymmetric, then converge
 * on a broad boss terrace below the ritual pyramid.
 */
export function wildheartFieldHeight(lx: number, lz: number): number {
  const arrival = smoothstep(8, 34, lz);
  const edgeDistance = Math.abs(lx);
  const smallRelief =
    0.34 * Math.sin(lx * 0.067 + lz * 0.026) + 0.24 * Math.sin(lx * 0.029 - lz * 0.057 + 1.7);
  const gradualClimb =
    0.8 * smoothstep(34, 62, lz) + 1.2 * smoothstep(90, 122, lz) + 1.8 * smoothstep(148, 182, lz);

  const cenote = -3.3 * mound(lx, lz, 0, 104, 42, 64);
  const streamX = wildheartStreamCenter(lz);
  const stream =
    -0.85 *
    (1 - smoothstep(3.4, 10.5, Math.abs(lx - streamX))) *
    smoothstep(25, 44, lz) *
    (1 - smoothstep(162, 184, lz));
  const westRoute = 4.2 * mound(lx, lz, -37, 96, 31, 73);
  const eastRoute = 3.8 * mound(lx, lz, 38, 108, 30, 68);
  const beastIsland = 4.6 * mound(lx, lz, 0, 132, 28, 28);
  const upperShelf = 3.6 * mound(lx, lz, 0, 176, 46, 43);
  const calderaShoulder = (11 + 5 * smoothstep(80, 210, lz)) * smoothstep(52, 77, edgeDistance);

  let height =
    (smallRelief +
      gradualClimb +
      cenote +
      stream +
      westRoute +
      eastRoute +
      beastIsland +
      upperShelf +
      calderaShoulder) *
    arrival;

  const templeBlend = smoothstep(188, 211, lz) * (1 - smoothstep(33, 46, Math.abs(lx)));
  height += (10.5 - height) * templeBlend;
  return height;
}

/** Water visibility mask shared by terrain paint and the rendered water ribbons. */
export function wildheartWaterMask(lx: number, lz: number): number {
  const cenote = mound(lx, lz, 0, 104, 35, 52);
  const stream =
    (1 - smoothstep(2.8, 8.2, Math.abs(lx - wildheartStreamCenter(lz)))) *
    smoothstep(25, 42, lz) *
    (1 - smoothstep(160, 178, lz));
  return Math.max(cenote, stream);
}

const PI = Math.PI;

export const WILDHEART_FIELD_PLACEMENTS: readonly WildheartPropPlacement[] = [
  // The maw threshold opens directly into the flooded bowl.
  { kind: 'wildheart_jaguar_gate', x: 0, z: 16, rot: 0, scale: 1.1 },
  { kind: 'wildheart_mask_totem', x: -18, z: 25, rot: 0.18, scale: 0.9 },
  { kind: 'wildheart_mask_totem', x: 18, z: 25, rot: -0.18, scale: 0.9 },
  { kind: 'wildheart_rope_bridge', x: 0, z: 48, rot: PI / 2, scale: 1.05 },

  // Western hunt terraces: dens and tall platforms over the lower route.
  { kind: 'wildheart_canopy_platform', x: -57, z: 61, rot: 0.55 },
  { kind: 'wildheart_beast_den', x: -49, z: 86, rot: 0.45, scale: 1.05 },
  { kind: 'wildheart_mask_totem', x: -24, z: 69, rot: 0.25, scale: 1.05 },
  { kind: 'wildheart_mask_totem', x: -55, z: 107, rot: 0.1 },
  { kind: 'wildheart_rope_bridge', x: -30, z: 118, rot: 0.12 },

  // Eastern waterfall walk: platforms and a second crossing at a new angle.
  { kind: 'wildheart_canopy_platform', x: 57, z: 73, rot: -0.5, scale: 1.05 },
  { kind: 'wildheart_beast_den', x: 49, z: 104, rot: -0.5, scale: 0.95 },
  { kind: 'wildheart_mask_totem', x: 25, z: 83, rot: -0.2, scale: 1.05 },
  { kind: 'wildheart_mask_totem', x: 57, z: 126, rot: PI, scale: 1.1 },
  { kind: 'wildheart_rope_bridge', x: 30, z: 136, rot: -0.14, scale: 1.05 },

  // The beast island is the visual and encounter hub of the circular route.
  { kind: 'wildheart_beast_den', x: 0, z: 132, rot: PI, scale: 1.15 },
  { kind: 'wildheart_mask_totem', x: -19, z: 125, rot: 0.55, scale: 1.15 },
  { kind: 'wildheart_mask_totem', x: 19, z: 125, rot: -0.55, scale: 1.15 },
  { kind: 'wildheart_mask_totem', x: -16, z: 148, rot: 0.2 },
  { kind: 'wildheart_mask_totem', x: 16, z: 148, rot: -0.2 },

  // Upper convergence and the approach to the high shrine.
  { kind: 'wildheart_canopy_platform', x: -59, z: 161, rot: PI / 2, scale: 1.08 },
  { kind: 'wildheart_canopy_platform', x: 59, z: 173, rot: -PI / 2 },
  { kind: 'wildheart_rope_bridge', x: -27, z: 174, rot: PI / 2, scale: 0.9 },
  { kind: 'wildheart_rope_bridge', x: 27, z: 174, rot: PI / 2, scale: 0.9 },
  { kind: 'wildheart_mask_totem', x: -28, z: 194, rot: 0.12, scale: 1.3 },
  { kind: 'wildheart_mask_totem', x: 28, z: 194, rot: -0.12, scale: 1.3 },
  { kind: 'wildheart_mask_totem', x: -17, z: 212, rot: 0.22, scale: 1.2 },
  { kind: 'wildheart_mask_totem', x: 17, z: 212, rot: -0.22, scale: 1.2 },
  { kind: 'wildheart_ritual_pyramid', x: 0, z: 237, rot: 0, scale: 1.15 },

  // A dense jungle frame closes the horizon while preserving both readable
  // routes. Ferns are non-blocking ground dressing; trees collide only at the
  // trunk, and the four ancestor ruins sit outside combat pull footprints.
  ...[
    [-66, 31, 0.4, 1.05],
    [64, 49, -0.7, 1.1],
    [56, 94, 0.25, 0.95],
    [-66, 112, 1.1, 1.15],
    [67, 130, -1.2, 1.05],
    [-54, 143, 0.65, 0.92],
    [-65, 174, -0.4, 1.1],
    [66, 193, 0.8, 1.15],
    [48, 220, -0.5, 1.05],
    [-48, 223, 0.45, 1.08],
  ].map(([x, z, rot, scale]) => ({
    kind: 'wildheart_jungle_canopy_tree' as const,
    x,
    z,
    rot,
    scale,
  })),
  ...[
    [-44, 43, 0.2],
    [-58, 52, -0.6],
    [45, 55, 0.8],
    [61, 66, -0.2],
    [-49, 75, 1.1],
    [48, 82, -1.1],
    [-27, 90, 0.4],
    [27, 94, -0.3],
    [-62, 101, 0.7],
    [63, 110, -0.8],
    [-24, 118, -0.4],
    [24, 121, 0.5],
    [-48, 129, 0.9],
    [46, 136, -0.7],
    [-31, 143, -0.25],
    [32, 148, 0.35],
    [-60, 157, 1.2],
    [61, 166, -1.1],
    [-41, 177, 0.4],
    [43, 181, -0.45],
    [-58, 196, -0.8],
    [58, 201, 0.85],
    [-35, 216, 0.2],
    [36, 220, -0.25],
  ].map(([x, z, rot], index) => ({
    kind: 'wildheart_giant_fern' as const,
    x,
    z,
    rot,
    scale: 0.82 + (index % 4) * 0.1,
  })),
  { kind: 'wildheart_ancestor_ruin', x: -54, z: 126, rot: 0.55, scale: 1.05 },
  { kind: 'wildheart_ancestor_ruin', x: 54, z: 150, rot: -0.7 },
  { kind: 'wildheart_ancestor_ruin', x: -40, z: 202, rot: 0.25, scale: 1.12 },
  { kind: 'wildheart_ancestor_ruin', x: 42, z: 205, rot: -0.3, scale: 1.08 },

  // Pale ritual spires punctuate the caldera rim. The heightfield shoulder and
  // four OBB walls remain the authoritative visual and collision perimeter.
  ...[0, 38, 78, 119, 160, 202, 231].flatMap((z, i) => [
    {
      kind: 'wildheart_limestone_cliff' as const,
      x: -76 + (i % 2) * 2,
      z,
      rot: PI / 2 + i * 0.31,
      scale: 0.9 + (i % 3) * 0.12,
    },
    {
      kind: 'wildheart_limestone_cliff' as const,
      x: 76 - (i % 2) * 2,
      z,
      rot: -PI / 2 - i * 0.27,
      scale: 0.94 + ((i + 1) % 3) * 0.11,
    },
  ]),
  ...[-58, 0, 58].map((x, i) => ({
    kind: 'wildheart_limestone_cliff' as const,
    x,
    z: 241,
    rot: PI + i * 0.36,
    scale: 1.02 + (i % 2) * 0.14,
  })),
];

interface WildheartFootprint {
  r: number;
  h: number;
  posts?: readonly { dx: number; dz: number; r: number }[];
}

const WILDHEART_PROP_FOOTPRINTS: Record<WildheartPropKind, WildheartFootprint> = {
  wildheart_limestone_cliff: { r: 0, h: 14 },
  wildheart_jaguar_gate: {
    r: 0,
    h: 13,
    posts: [
      { dx: -12.5, dz: -5, r: 4.3 },
      { dx: -12.5, dz: 4, r: 4.3 },
      { dx: 12.5, dz: -5, r: 4.3 },
      { dx: 12.5, dz: 4, r: 4.3 },
    ],
  },
  wildheart_ritual_pyramid: { r: 12, h: 19 },
  wildheart_canopy_platform: { r: 4.2, h: 11 },
  wildheart_rope_bridge: { r: 0, h: 3.2 },
  wildheart_beast_den: { r: 4.4, h: 7 },
  wildheart_mask_totem: { r: 1.25, h: 7 },
  wildheart_jungle_canopy_tree: { r: 1.65, h: 12 },
  wildheart_giant_fern: { r: 0, h: 3.5 },
  wildheart_ancestor_ruin: { r: 3.2, h: 7 },
};

export interface WildheartColliderSpec {
  kind: WildheartPropKind;
  x: number;
  z: number;
  r: number;
  h: number;
}

export const WILDHEART_FIELD_COLLIDER_SPECS: readonly WildheartColliderSpec[] =
  WILDHEART_FIELD_PLACEMENTS.flatMap((placement) => {
    const footprint = WILDHEART_PROP_FOOTPRINTS[placement.kind];
    const scale = placement.scale ?? 1;
    if (footprint.posts) {
      const c = Math.cos(placement.rot);
      const s = Math.sin(placement.rot);
      return footprint.posts.map((post) => ({
        kind: placement.kind,
        x: placement.x + (post.dx * c + post.dz * s) * scale,
        z: placement.z + (-post.dx * s + post.dz * c) * scale,
        r: post.r * scale,
        h: footprint.h * scale,
      }));
    }
    if (footprint.r <= 0) return [];
    return [
      {
        kind: placement.kind,
        x: placement.x,
        z: placement.z,
        r: footprint.r * scale,
        h: footprint.h * scale,
      },
    ];
  });
