// The Drowned Litany: irregular marsh-ruin room geometry (sim layer, no Three.js).
import type { Collider } from './colliders';
import {
  DUNGEON_END_WALL_HW,
  DUNGEON_WALL_HW,
  type DungeonLayout,
  PILLAR_COLLIDER_R,
  TOMB_HD,
  TOMB_HW,
} from './dungeon_layout';
import type { Point2D } from './geometry2d';
import type { DelveHazardZone } from './types';

export type LitanyModuleId =
  | 'litany_sluice'
  | 'litany_ledger'
  | 'litany_ring'
  | 'litany_baptistry'
  | 'litany_choir_loft'
  | 'litany_causeway'
  | 'litany_apse';

export type LitanyShapeProfile =
  | 'crescent'
  | 'island_cluster'
  | 'ring'
  | 'sinkhole'
  | 'fan'
  | 'y_split'
  | 'asymmetric_apse';

export interface LitanyIsland {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface LitanyDressingAnchor {
  kind:
    | 'reed_cluster'
    | 'plank_bridge'
    | 'shrine_fragment'
    | 'corpse_candle'
    | 'bell_fragment'
    | 'bone_pile'
    | 'sluice_post'
    | 'root_wall'
    | 'broken_bell_frame'
    | 'dead_tree';
  x: number;
  z: number;
  rot?: number;
}

export interface LitanyWalkableShape {
  points: Array<{ x: number; z: number }>;
}

export interface LitanyHazardZone {
  x: number;
  z: number;
  r: number;
  rx?: number;
  rz?: number;
  blocksMovement?: boolean;
  tier?: 'shallow' | 'deep';
}

export interface LitanyModuleGeometry {
  moduleId: LitanyModuleId;
  profile: LitanyShapeProfile;
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number };
  zMin: number;
  zMax: number;
  wallX: number;
  doorZ: number;
  dais: { x: number; z: number; r: number };
  /** Star-shaping pole for `walkable[0].points` (see geometry2d.polygonIsStarShaped).
   * Defaults to room centre when unset on the authored def. */
  pole: { x: number; z: number };
  walkable: LitanyWalkableShape[];
  hazards: LitanyHazardZone[];
  islands: LitanyIsland[];
  pillars: Array<{ x: number; z: number }>;
  stubs: Array<{ x: number; z: number; hw: number; hd: number }>;
  tombs: Array<{ x: number; z: number }>;
  clutter: Array<{ x: number; z: number }>;
  dressing: LitanyDressingAnchor[];
}

export type LitanyMapPrimitive =
  | { kind: 'polygon'; points: Array<{ x: number; z: number }> }
  | {
      kind: 'circle';
      x: number;
      z: number;
      r: number;
      // World-space ellipse radii (e.g. the apse moat); default to r/r for a
      // plain circle. Independent of the map canvas's own per-axis scale.
      rx?: number;
      rz?: number;
      role: 'blackwater' | 'dais' | 'exit' | 'blocker';
    }
  | { kind: 'rect'; x: number; z: number; hw: number; hd: number; role: 'island' | 'blocker' };

export const LITANY_Z_MIN = -19;
export const LITANY_Z_MAX = 91;
export const LITANY_WALL_X = 25;
export const LITANY_SIDE_Z = 36;
export const LITANY_SIDE_HD = 55;
export const LITANY_DOOR_Z = -17;

export const LITANY_MODULE_IDS = [
  'litany_sluice',
  'litany_ledger',
  'litany_ring',
  'litany_baptistry',
  'litany_choir_loft',
  'litany_causeway',
  'litany_apse',
] as const;

const LITANY_BOUNDS = { xMin: -25, xMax: 25, zMin: LITANY_Z_MIN, zMax: LITANY_Z_MAX } as const;

type LitanyRoomDef = Omit<LitanyModuleGeometry, 'bounds' | 'doorZ' | 'pole'> & {
  wallX?: number;
  zMin?: number;
  zMax?: number;
  pole?: { x: number; z: number };
};

function litanyRoom(def: LitanyRoomDef): LitanyModuleGeometry {
  const wallX = def.wallX ?? LITANY_WALL_X;
  const zMin = def.zMin ?? LITANY_Z_MIN;
  const zMax = def.zMax ?? LITANY_Z_MAX;
  const pole = def.pole ?? { x: 0, z: (zMin + zMax) / 2 };
  return {
    bounds: { xMin: -wallX, xMax: wallX, zMin, zMax },
    doorZ: LITANY_DOOR_Z,
    ...def,
    wallX,
    zMin,
    zMax,
    pole,
  };
}

function legacyRectShellColliders(geo: LitanyModuleGeometry): Collider[] {
  const out: Collider[] = [];
  const sideZ = (geo.zMin + geo.zMax) / 2;
  const sideHd = (geo.zMax - geo.zMin) / 2;
  for (const sx of [-geo.wallX, geo.wallX]) {
    out.push({
      type: 'obb',
      x: sx,
      z: sideZ,
      hw: DUNGEON_WALL_HW,
      hd: sideHd,
      rot: 0,
    });
  }
  out.push({
    type: 'obb',
    x: 0,
    z: geo.zMax,
    hw: DUNGEON_END_WALL_HW,
    hd: DUNGEON_WALL_HW,
    rot: 0,
  });
  out.push({
    type: 'obb',
    x: 0,
    z: geo.zMin,
    hw: DUNGEON_END_WALL_HW,
    hd: DUNGEON_WALL_HW,
    rot: 0,
  });
  return out;
}

// Longest world-unit span a single wall-shell OBB segment may cover along an
// authored polygon edge before it is split into more pieces.
const WALL_SEGMENT_MAX = 6;

export interface LitanyWallSegment {
  x: number;
  z: number;
  halfLength: number;
  rot: number;
}

/** Exact wall-module spans for a polygon shell. Render and collision both consume
 * these segments so short or angled edges never draw past their solid footprint. */
export function polygonWallSegments(points: readonly Point2D[]): LitanyWallSegment[] {
  const out: LitanyWallSegment[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const segCount = Math.max(1, Math.ceil(len / WALL_SEGMENT_MAX));
    const segLen = len / segCount;
    const rot = Math.atan2(-dz, dx);
    for (let s = 0; s < segCount; s++) {
      const midT = (s + 0.5) / segCount;
      out.push({
        x: a.x + dx * midT,
        z: a.z + dz * midT,
        halfLength: segLen / 2,
        rot,
      });
    }
  }
  return out;
}

/** Chain of rotated OBB wall segments tracing a CCW simple polygon boundary.
 * Each edge is split into ceil(len / WALL_SEGMENT_MAX) equal segments so a
 * long straight run still reads as a wall of DUNGEON_WALL_HW thickness. The
 * OBB rotation aligns its local hw-axis (half-width, local x) with the edge
 * direction under colliders.ts's rotY convention (rotY(1,0,rot) =
 * {x:cos(rot), z:-sin(rot)} is the world direction of local +x), so
 * rot = atan2(-edgeDz, edgeDx) points the OBB's long axis along the edge:
 * the same atan2(-dz, dx) convention colliders.ts already uses for fences. */
export function polygonShellColliders(points: readonly Point2D[]): Collider[] {
  return polygonWallSegments(points).map((segment) => ({
    type: 'obb',
    x: segment.x,
    z: segment.z,
    hw: segment.halfLength,
    hd: DUNGEON_WALL_HW,
    rot: segment.rot,
  }));
}

function shellColliders(geo: LitanyModuleGeometry): Collider[] {
  if (geo.walkable.length) return polygonShellColliders(geo.walkable[0].points);
  return legacyRectShellColliders(geo);
}

function interiorColliders(geo: LitanyModuleGeometry, includeHazards: boolean): Collider[] {
  const out: Collider[] = [];
  for (const s of geo.stubs) out.push({ type: 'obb', x: s.x, z: s.z, hw: s.hw, hd: s.hd, rot: 0 });
  for (const p of geo.pillars) out.push({ type: 'circle', x: p.x, z: p.z, r: PILLAR_COLLIDER_R });
  for (const t of geo.tombs)
    out.push({ type: 'obb', x: t.x, z: t.z, hw: TOMB_HW, hd: TOMB_HD, rot: 0 });
  for (const c of geo.clutter) out.push({ type: 'circle', x: c.x, z: c.z, r: 0.8 });
  if (includeHazards) {
    // Blackwater is shallow: walkable AND damaging (the tickDelveBlackwater hazard
    // only damages players who can STAND in it, and mobs/pathing ignore it). It is
    // never a movement wall unless a zone explicitly opts in (a future deep font).
    for (const hz of geo.hazards) {
      if (!hz.blocksMovement) continue;
      out.push({ type: 'circle', x: hz.x, z: hz.z, r: hz.rx ?? hz.r });
    }
  }
  return out;
}

// Per-room geometry (coordinate spec from docs/prd/drowned-litany-redesign.md)

// 1. Sluice (TIGHT) hw 14, z0 -12, z1 62
const LITANY_SLUICE = litanyRoom({
  moduleId: 'litany_sluice',
  profile: 'crescent',
  wallX: 14,
  zMin: -12,
  zMax: 62,
  dais: { x: 0, z: 59, r: 5 },
  pole: { x: 0, z: 25 },
  // Crescent: the west side bows out to |x|~19 (pools are exempt but the dry
  // bank still reads as a curved bow), the east side stays close to straight
  // near wallX so the room's silhouette is lopsided like a marsh channel bend.
  walkable: [
    {
      points: [
        { x: -7, z: -14 },
        { x: 7, z: -14 },
        { x: 13.5, z: -4 },
        { x: 15, z: 10 },
        { x: 15.5, z: 26 },
        { x: 15, z: 42 },
        { x: 15, z: 54 },
        { x: 15, z: 58 },
        { x: 7, z: 65 },
        { x: -7, z: 65 },
        { x: -13, z: 54 },
        { x: -18.5, z: 40 },
        { x: -19, z: 24 },
        { x: -18, z: 8 },
        { x: -13, z: -4 },
      ],
    },
  ],
  // Wall-hugging pool chain: west, east, west. The dry lane snakes between the
  // pools instead of skirting one central blob. Each shallow/deep pair stays
  // concentric; the east z33 and west z47 pairs are pulled a touch inward (x 7->5,
  // -7->-6) so the shallow rim keeps a ~2yd dry margin off the side wall (at the
  // authored x it reached the wall edge and drowned the outer walkway ring).
  hazards: [
    { x: -8, z: 18, r: 8, tier: 'shallow' },
    { x: -8, z: 18, r: 5, tier: 'deep' },
    { x: 5, z: 33, r: 8, tier: 'shallow' },
    { x: 5, z: 33, r: 5, tier: 'deep' },
    { x: -6, z: 47, r: 7, tier: 'shallow' },
    { x: -6, z: 47, r: 4, tier: 'deep' },
  ],
  islands: [
    { x: 0, z: -9, hw: 5, hd: 3 },
    { x: 9, z: 5, hw: 3, hd: 3 },
    { x: 11, z: 22, hw: 3, hd: 3 },
    { x: 8, z: 40, hw: 3, hd: 3 },
    { x: 2, z: 54, hw: 4, hd: 3 },
    { x: 0, z: 59, hw: 4, hd: 3 },
  ],
  stubs: [],
  pillars: [
    { x: -9, z: 16 },
    { x: -7, z: 36 },
    { x: 5, z: 30 },
    { x: -3, z: 50 },
  ],
  tombs: [],
  clutter: [],
  dressing: [
    { kind: 'dead_tree', x: -9, z: 16 },
    { kind: 'dead_tree', x: -7, z: 36 },
    { kind: 'dead_tree', x: 5, z: 30 },
    { kind: 'dead_tree', x: -3, z: 50 },
    // Reed rims on the two shallow pools nearest the entry aisle (r 8, r+1 out).
    { kind: 'reed_cluster', x: -8, z: 27 },
    { kind: 'reed_cluster', x: -8, z: 9 },
    { kind: 'reed_cluster', x: 7, z: 24 },
    { kind: 'reed_cluster', x: 7, z: 42 },
    // Rim of the west deep pool near the third pillar.
    { kind: 'reed_cluster', x: -7, z: 39 },
    // Sluice-post pair flanking the entry lane, clear of the entry spawn.
    { kind: 'sluice_post', x: -12, z: 1 },
    { kind: 'sluice_post', x: 12, z: 1 },
    // Dry bone/candle dressing near islands on the approach to the dais.
    { kind: 'bone_pile', x: 9, z: 44 },
    { kind: 'corpse_candle', x: 4, z: 49 },
  ],
});

// 2. Ledger (MEDIUM) hw 22, z0 -14, z1 86
const LITANY_LEDGER = litanyRoom({
  moduleId: 'litany_ledger',
  profile: 'island_cluster',
  wallX: 22,
  zMin: -14,
  zMax: 86,
  dais: { x: 0, z: 82, r: 6 },
  pole: { x: 0, z: 36 },
  // Island cluster: gentle lobes alternating sides, one bulge per island
  // stepping-stone knot (east near z=24, west near z=42-51, east again near
  // z=52-68), so the outline reads as scattered ledges rather than one oval.
  walkable: [
    {
      points: [
        { x: -8, z: -16 },
        { x: 8, z: -16 },
        { x: 15, z: -6 },
        { x: 18, z: 4 },
        { x: 20, z: 12 },
        { x: 21, z: 24 },
        { x: 20, z: 34 },
        { x: 18, z: 42 },
        { x: 20, z: 52 },
        { x: 21, z: 62 },
        { x: 18, z: 72 },
        { x: 14, z: 84 },
        { x: 7, z: 89 },
        { x: -7, z: 89 },
        { x: -14, z: 84 },
        { x: -20, z: 72 },
        { x: -20, z: 62 },
        { x: -21, z: 51 },
        { x: -20, z: 33 },
        { x: -22, z: 22 },
        { x: -22, z: 12 },
        { x: -19, z: 4 },
        { x: -15, z: -6 },
      ],
    },
  ],
  // Staggered pool chain east, center, west, east: the island line threads the
  // center pool as stepping stones while the dry bank alternates sides. The three
  // wall-side pairs are pulled inward (x 14->9, -13->-9, 13->10), keeping each
  // shallow/deep pair concentric, so the shallow rim clears the side wall by ~2yd:
  // at the authored x these rims crossed the wall edge and drowned the walkway ring.
  hazards: [
    { x: 9, z: 24, r: 9, tier: 'shallow' },
    { x: 9, z: 24, r: 6, tier: 'deep' },
    { x: 0, z: 40, r: 7, tier: 'shallow' },
    { x: -9, z: 42, r: 9, tier: 'shallow' },
    { x: -9, z: 42, r: 6, tier: 'deep' },
    { x: 10, z: 60, r: 8, tier: 'shallow' },
    { x: 10, z: 60, r: 5, tier: 'deep' },
  ],
  islands: [
    { x: 0, z: -11, hw: 5, hd: 3 },
    { x: -12, z: 8, hw: 4, hd: 3 },
    { x: -6, z: 24, hw: 4, hd: 3 },
    { x: 3, z: 40, hw: 4, hd: 4 },
    { x: 9, z: 56, hw: 4, hd: 3 },
    { x: 2, z: 72, hw: 4, hd: 3 },
    { x: 0, z: 82, hw: 5, hd: 3 },
  ],
  stubs: [],
  pillars: [
    { x: 16, z: 30 },
    { x: -16, z: 42 },
    { x: 15, z: 62 },
    { x: -15, z: 16 },
  ],
  tombs: [],
  clutter: [],
  dressing: [
    { kind: 'dead_tree', x: 16, z: 30 },
    { kind: 'dead_tree', x: -16, z: 42 },
    { kind: 'dead_tree', x: 15, z: 62 },
    { kind: 'dead_tree', x: -15, z: 16 },
    // Reed rims on the east pool chain (r 9, r+0.5 out).
    { kind: 'reed_cluster', x: 14, z: 14.5 },
    { kind: 'reed_cluster', x: 14, z: 33.5 },
    // Reed rims on the west and center pools.
    { kind: 'reed_cluster', x: -13, z: 32.5 },
    { kind: 'reed_cluster', x: -13, z: 51.5 },
    { kind: 'reed_cluster', x: 13, z: 51.5 },
    { kind: 'reed_cluster', x: 13, z: 68.5 },
    // Corpse candles marking the dry bank between pools.
    { kind: 'corpse_candle', x: -6, z: 24 },
    { kind: 'corpse_candle', x: 3, z: 33 },
    // Plank bridge onto the island line threading the center pool.
    { kind: 'plank_bridge', x: 9, z: 51.5, rot: 1.571 },
  ],
});

// 3. Ring (LARGE) hw 25, z0 -16, z1 90
const LITANY_RING = litanyRoom({
  moduleId: 'litany_ring',
  profile: 'ring',
  wallX: 25,
  zMin: -16,
  zMax: 90,
  dais: { x: 0, z: 82, r: 6 },
  pole: { x: 0, z: 37 },
  // Ring: a broad oval waisted at both mouths (south approach and the north
  // dais neck taper in), with a wide constant-|x| run down both flanks to
  // clear the root_wall anchors at x=+-23, z=4/26/52/72 with margin.
  walkable: [
    {
      points: [
        { x: -9, z: -17 },
        { x: 9, z: -17 },
        { x: 20, z: -10 },
        { x: 26.2, z: -2 },
        { x: 26.2, z: 15 },
        { x: 26.2, z: 37 },
        { x: 26.2, z: 41 },
        { x: 26.2, z: 63 },
        { x: 24.7, z: 75 },
        { x: 22, z: 82 },
        { x: 15, z: 88 },
        { x: 8, z: 92 },
        { x: -8, z: 92 },
        { x: -15, z: 88 },
        { x: -22, z: 82 },
        { x: -24.7, z: 75 },
        { x: -26.2, z: 63 },
        { x: -26.2, z: 41 },
        { x: -26.2, z: 37 },
        { x: -26.2, z: 15 },
        { x: -26.2, z: -2 },
        { x: -20, z: -10 },
      ],
    },
  ],
  // Central lake plus offset neck pools at each mouth of the loop: entering
  // biases you west, leaving biases you east, so the ring is walked as an S.
  hazards: [
    { x: 0, z: 40, r: 17, tier: 'shallow' },
    { x: 0, z: 40, r: 13, tier: 'deep' },
    { x: 6, z: 12, r: 7, tier: 'shallow' },
    { x: -6, z: 66, r: 7, tier: 'shallow' },
  ],
  islands: [
    // dry perimeter
    { x: -20, z: 4, hw: 4, hd: 5 },
    { x: -21, z: 26, hw: 4, hd: 11 },
    { x: -21, z: 52, hw: 4, hd: 11 },
    { x: -16, z: 72, hw: 4, hd: 5 },
    { x: 20, z: 4, hw: 4, hd: 5 },
    { x: 21, z: 26, hw: 4, hd: 11 },
    { x: 21, z: 52, hw: 4, hd: 11 },
    { x: 16, z: 72, hw: 4, hd: 5 },
    { x: 0, z: -13, hw: 5, hd: 3 },
    { x: 0, z: 82, hw: 6, hd: 4 },
    // optional shortcut stones
    { x: 0, z: 20, hw: 3, hd: 3 },
    { x: 0, z: 40, hw: 3, hd: 3 },
    { x: 0, z: 60, hw: 3, hd: 3 },
  ],
  stubs: [],
  pillars: [
    { x: -8, z: 40 },
    { x: 8, z: 40 },
    { x: 0, z: 30 },
  ],
  tombs: [],
  clutter: [],
  dressing: [
    { kind: 'dead_tree', x: -8, z: 40 },
    { kind: 'dead_tree', x: 8, z: 40 },
    { kind: 'dead_tree', x: 0, z: 30 },
    // Root walls against both outer side walls, spaced along the whole loop.
    { kind: 'root_wall', x: -23, z: 4, rot: 1.571 },
    { kind: 'root_wall', x: -23, z: 26, rot: 1.571 },
    { kind: 'root_wall', x: -23, z: 52, rot: 1.571 },
    { kind: 'root_wall', x: -23, z: 72, rot: 1.571 },
    { kind: 'root_wall', x: 23, z: 4, rot: -1.571 },
    { kind: 'root_wall', x: 23, z: 26, rot: -1.571 },
    { kind: 'root_wall', x: 23, z: 52, rot: -1.571 },
    { kind: 'root_wall', x: 23, z: 72, rot: -1.571 },
    // Reeds at the central lake rim, north/south/east/west of the ring.
    { kind: 'reed_cluster', x: 0, z: 58.5 },
    { kind: 'reed_cluster', x: 0, z: 21.5 },
    { kind: 'reed_cluster', x: -14, z: 29 },
    { kind: 'reed_cluster', x: 14, z: 29 },
  ],
});

// 4. Baptistry (MEDIUM-TIGHT, fully dry) hw 18, z0 -12, z1 72
const LITANY_BAPTISTRY = litanyRoom({
  moduleId: 'litany_baptistry',
  profile: 'sinkhole',
  wallX: 18,
  zMin: -12,
  zMax: 72,
  dais: { x: 0, z: 64, r: 6 },
  pole: { x: 0, z: 30 },
  // Sinkhole: a rounded bowl around the central font, tapering to a narrower
  // south entry throat (the room profile's "slight taper to south entry").
  walkable: [
    {
      points: [
        { x: -7, z: -14 },
        { x: 7, z: -14 },
        { x: 13, z: -6 },
        { x: 20, z: 4 },
        { x: 21, z: 16 },
        { x: 21, z: 30 },
        { x: 21, z: 42 },
        { x: 20, z: 54 },
        { x: 15, z: 65 },
        { x: 8, z: 73 },
        { x: -8, z: 73 },
        { x: -15, z: 64 },
        { x: -21, z: 56 },
        { x: -21, z: 42 },
        { x: -21, z: 30 },
        { x: -21, z: 16 },
        { x: -20, z: 4 },
        { x: -13, z: -6 },
      ],
    },
  ],
  // Sinkhole font with a diagonal feed: inlet channel from the northeast,
  // outlet to the southwest, so the rim walk spirals rather than circles. The
  // two feeder pools are pulled in (x 14->12, -14->-12) so their rims keep a
  // ~2yd dry margin off the side wall: at the authored x they touched the wall
  // edge and drowned the outer walkway ring.
  hazards: [
    { x: 0, z: 38, r: 14, tier: 'shallow' },
    { x: 0, z: 38, r: 10, tier: 'deep' },
    { x: 12, z: 24, r: 7, tier: 'shallow' },
    { x: -12, z: 50, r: 7, tier: 'shallow' },
  ],
  islands: [
    { x: 0, z: -9, hw: 5, hd: 3 },
    { x: 15, z: 9, hw: 4, hd: 4 },
    { x: 16, z: 34, hw: 4, hd: 5 },
    { x: 12, z: 56, hw: 4, hd: 4 },
    { x: 0, z: 64, hw: 6, hd: 4 },
  ],
  stubs: [],
  pillars: [
    { x: 8, z: 34 },
    { x: -8, z: 34 },
    { x: 8, z: 46 },
    { x: -8, z: 46 },
  ],
  tombs: [],
  clutter: [],
  dressing: [
    { kind: 'dead_tree', x: 8, z: 34 },
    { kind: 'dead_tree', x: -8, z: 34 },
    { kind: 'dead_tree', x: 8, z: 46 },
    { kind: 'dead_tree', x: -8, z: 46 },
    // Bone piles on the dry rim north and south of the sinkhole font.
    { kind: 'bone_pile', x: 0, z: 23 },
    { kind: 'bone_pile', x: 0, z: 53 },
    // Corpse candles on the east/west rim.
    { kind: 'corpse_candle', x: 15, z: 34 },
    { kind: 'corpse_candle', x: -15, z: 42 },
    // Plank at the northeast inlet channel.
    { kind: 'plank_bridge', x: 16, z: 20, rot: 0.785 },
    // Extra bone pile near the south island, off the dais approach.
    { kind: 'bone_pile', x: 12, z: 60 },
  ],
});

// 5. Choir Loft (WIDE/LARGE, fully dry) hw 25, z0 -12, z1 84
const LITANY_CHOIR_LOFT = litanyRoom({
  moduleId: 'litany_choir_loft',
  profile: 'fan',
  wallX: 25,
  zMin: -12,
  zMax: 84,
  dais: { x: 0, z: 74, r: 6 },
  pole: { x: 0, z: 35 },
  // Fan: narrow at the south entry throat, flaring wide toward the north
  // dais bowl so the ranked choir reads as a widening congregation hall.
  walkable: [
    {
      points: [
        { x: -6, z: -14 },
        { x: 6, z: -14 },
        { x: 10, z: -4 },
        { x: 13, z: 3 },
        { x: 16, z: 14 },
        { x: 20, z: 18 },
        { x: 25.7, z: 21 },
        { x: 25.5, z: 34 },
        { x: 25.5, z: 40 },
        { x: 25.5, z: 48 },
        { x: 25.5, z: 60 },
        { x: 22, z: 66 },
        { x: 15, z: 76 },
        { x: 8, z: 86 },
        { x: -8, z: 86 },
        { x: -15, z: 76 },
        { x: -22, z: 66 },
        { x: -25.5, z: 60 },
        { x: -25.5, z: 48 },
        { x: -25.5, z: 40 },
        { x: -25.5, z: 34 },
        { x: -25.7, z: 21 },
        { x: -20, z: 18 },
        { x: -17.2, z: 14 },
        { x: -13, z: 3 },
        { x: -10, z: -4 },
      ],
    },
  ],
  // Two slanted seepage channels drifting inward toward the dais: the fan's
  // dry aisles zigzag between them instead of running three straight lanes. The
  // two wall-side pairs are pulled inward (x -16->-12, 16->15), staying
  // concentric, so their shallow rims keep a ~2yd dry margin off the side wall:
  // at the authored x they overshot the wall and drowned the outer walkway ring.
  hazards: [
    { x: -12, z: 22, r: 7, tier: 'shallow' },
    { x: -12, z: 22, r: 4, tier: 'deep' },
    { x: -11, z: 36, r: 7, tier: 'shallow' },
    { x: 2, z: 30, r: 7, tier: 'shallow' },
    { x: -3, z: 46, r: 7, tier: 'shallow' },
    { x: -3, z: 46, r: 4, tier: 'deep' },
    { x: 15, z: 28, r: 8, tier: 'shallow' },
    { x: 15, z: 28, r: 5, tier: 'deep' },
    { x: 9, z: 46, r: 7, tier: 'shallow' },
  ],
  islands: [
    { x: 0, z: -9, hw: 4, hd: 3 },
    { x: -7, z: 8, hw: 4, hd: 3 },
    { x: -20, z: 28, hw: 4, hd: 6 },
    { x: -14, z: 54, hw: 4, hd: 5 },
    { x: 0, z: 74, hw: 6, hd: 4 },
    { x: 7, z: 8, hw: 3, hd: 6 },
    { x: 20, z: 28, hw: 4, hd: 6 },
    { x: 14, z: 54, hw: 4, hd: 5 },
  ],
  stubs: [],
  pillars: [
    { x: -20, z: 48 },
    { x: 20, z: 48 },
    { x: -12, z: 18 },
    { x: 12, z: 18 },
  ],
  tombs: [],
  clutter: [],
  dressing: [
    { kind: 'dead_tree', x: -20, z: 48 },
    { kind: 'dead_tree', x: 20, z: 48 },
    { kind: 'dead_tree', x: -12, z: 18 },
    { kind: 'dead_tree', x: 12, z: 18 },
    // Reed rows echoing the fan of seepage channels.
    { kind: 'reed_cluster', x: -16, z: 14 },
    { kind: 'reed_cluster', x: -11, z: 28 },
    { kind: 'reed_cluster', x: 2, z: 22 },
    { kind: 'reed_cluster', x: 16, z: 20 },
    { kind: 'reed_cluster', x: 9, z: 38 },
    { kind: 'reed_cluster', x: -3, z: 54 },
    // Shrine fragments flanking the wide back of the fan near the dais.
    { kind: 'shrine_fragment', x: -20, z: 64 },
    { kind: 'shrine_fragment', x: 20, z: 64 },
  ],
});

// 6. Causeway (TIGHT/LONG) hw 15, z0 -14, z1 92
const LITANY_CAUSEWAY = litanyRoom({
  moduleId: 'litany_causeway',
  profile: 'y_split',
  wallX: 15,
  zMin: -14,
  zMax: 92,
  dais: { x: 0, z: 82, r: 4 },
  pole: { x: 0, z: 39 },
  // Y-split: a narrow central throat that bows gently outward twice (around
  // the two pillar/reed knots) before narrowing again at the north dais.
  walkable: [
    {
      points: [
        { x: -6, z: -14 },
        { x: 6, z: -14 },
        { x: 9, z: -4 },
        { x: 11.5, z: 6 },
        { x: 13, z: 16 },
        { x: 13, z: 30 },
        { x: 13.5, z: 40 },
        { x: 13, z: 52 },
        { x: 13, z: 64 },
        { x: 11, z: 74 },
        { x: 9, z: 84 },
        { x: 6, z: 94 },
        { x: -6, z: 94 },
        { x: -10.5, z: 84 },
        { x: -11, z: 74 },
        { x: -13, z: 64 },
        { x: -13, z: 52 },
        { x: -13.5, z: 40 },
        { x: -13, z: 30 },
        { x: -13, z: 16 },
        { x: -11.5, z: 6 },
        { x: -9, z: -4 },
      ],
    },
  ],
  // Flanking pool chains pinch the causeway from both banks for its whole
  // length (the old rx/rz ellipses never rendered; these circles do), with the
  // three deep crossings kept at the hop stones on the center line.
  hazards: [
    { x: -10, z: 10, r: 8, tier: 'shallow' },
    { x: 10, z: 10, r: 8, tier: 'shallow' },
    { x: -11, z: 30, r: 9, tier: 'shallow' },
    { x: 11, z: 30, r: 9, tier: 'shallow' },
    { x: -10, z: 50, r: 9, tier: 'shallow' },
    { x: 10, z: 50, r: 9, tier: 'shallow' },
    { x: -11, z: 70, r: 9, tier: 'shallow' },
    { x: 11, z: 70, r: 9, tier: 'shallow' },
    { x: 0, z: 22, r: 4, tier: 'deep' },
    { x: 0, z: 50, r: 4, tier: 'deep' },
    { x: 0, z: 72, r: 4, tier: 'deep' },
  ],
  islands: [
    { x: 0, z: -9, hw: 4, hd: 4 },
    { x: 0, z: 9, hw: 3, hd: 5 },
    { x: 0, z: 22, hw: 2, hd: 2 },
    { x: 0, z: 35, hw: 3, hd: 5 },
    { x: 0, z: 50, hw: 2, hd: 2 },
    { x: 0, z: 61, hw: 3, hd: 5 },
    { x: 0, z: 72, hw: 2, hd: 2 },
    { x: 0, z: 82, hw: 4, hd: 4 },
  ],
  stubs: [],
  pillars: [
    { x: -10, z: 16 },
    { x: 10, z: 30 },
    { x: -10, z: 52 },
    { x: 10, z: 64 },
    { x: -8, z: 82 },
  ],
  tombs: [],
  clutter: [],
  dressing: [
    { kind: 'dead_tree', x: -10, z: 16 },
    { kind: 'dead_tree', x: 10, z: 30 },
    { kind: 'dead_tree', x: -10, z: 52 },
    { kind: 'dead_tree', x: 10, z: 64 },
    { kind: 'dead_tree', x: -8, z: 82 },
    // Plank bridge at each of the three deep hop-stone crossings, spanning
    // along x (rot 0) since the causeway runs along z.
    { kind: 'plank_bridge', x: 0, z: 22, rot: 0 },
    { kind: 'plank_bridge', x: 0, z: 50, rot: 0 },
    { kind: 'plank_bridge', x: 0, z: 72, rot: 0 },
    // Reeds along both flanking pool chains, rim of each pool (r+0.3).
    { kind: 'reed_cluster', x: -10, z: 18.3 },
    { kind: 'reed_cluster', x: 10, z: 18.3 },
    { kind: 'reed_cluster', x: -11, z: 39.3 },
    { kind: 'reed_cluster', x: 11, z: 39.3 },
    { kind: 'reed_cluster', x: -10, z: 59.3 },
    { kind: 'reed_cluster', x: 10, z: 59.3 },
  ],
});

// 7. Apse (BOSS/LARGE) hw 25, z0 -16, z1 92
const LITANY_APSE = litanyRoom({
  moduleId: 'litany_apse',
  profile: 'asymmetric_apse',
  wallX: 25,
  zMin: -16,
  zMax: 92,
  dais: { x: 0, z: 72, r: 12 },
  pole: { x: 0, z: 40 },
  // Asymmetric apse: a narrow south approach (biased so the west shoulder
  // pulls in deeper than the east, e.g. x:-18 vs x:21.5 at z=41) opening
  // into a full-width north boss bowl. The stomp-ring test requires every
  // shell segment north of z=50 to sit at |x|>=23.4, so the west/east flanks
  // hold a wide, near-constant run from z~48 through z=90 (the asymmetric
  // read lives entirely south of z=50); only the true end-cap taper past
  // z=90 (outside the test's zMax-2 window) is allowed to narrow.
  walkable: [
    {
      points: [
        { x: -6, z: -19 },
        { x: 6, z: -19 },
        { x: 10, z: -10 },
        { x: 14, z: 0 },
        { x: 23, z: 6 },
        { x: 24, z: 30 },
        { x: 21.5, z: 41 },
        { x: 23.9, z: 48 },
        { x: 23.6, z: 91 },
        { x: 10, z: 94 },
        { x: -10, z: 94 },
        { x: -23.6, z: 91 },
        { x: -23.9, z: 48 },
        { x: -18, z: 41 },
        { x: -24, z: 30 },
        { x: -26, z: 7 },
        { x: -17, z: -1 },
        { x: -10, z: -10 },
      ],
    },
  ],
  hazards: [
    // Shallow moat rx pulls in to 22 (from 24) so the outer walkway ring
    // (|x| ~= 23.8 at z 48 to 91) keeps a dry flank margin: at rx 24 the moat
    // edge reached x=24 at z=56 and drowned the authored safe path.
    { x: 0, z: 56, rx: 22, rz: 17, r: 22, tier: 'shallow' },
    { x: 0, z: 56, rx: 21, rz: 14, r: 21, tier: 'deep' },
    { x: -12, z: 22, r: 6, tier: 'deep' },
    { x: 12, z: 26, r: 6, tier: 'deep' },
  ],
  islands: [
    { x: 0, z: -13, hw: 5, hd: 3 },
    { x: -12, z: 6, hw: 5, hd: 4 },
    { x: 12, z: 8, hw: 5, hd: 4 },
    { x: -10, z: 30, hw: 4, hd: 4 },
    { x: 10, z: 32, hw: 4, hd: 4 },
    { x: 0, z: 44, hw: 5, hd: 4 },
    { x: 0, z: 60, hw: 9, hd: 9 },
    { x: 0, z: 72, hw: 11, hd: 11 },
  ],
  stubs: [],
  pillars: [
    { x: -16, z: 12 },
    { x: 16, z: 14 },
    { x: -16, z: 26 },
    { x: 16, z: 28 },
  ],
  tombs: [],
  clutter: [],
  dressing: [
    { kind: 'dead_tree', x: -18, z: 52 },
    { kind: 'dead_tree', x: 18, z: 54 },
    { kind: 'broken_bell_frame', x: 0, z: 88 },
    { kind: 'shrine_fragment', x: 0, z: 72 },
    // Boss-arena approach dressing kept south of z 45 or tight against the
    // walls, clear of the moat and the altar island so the arena stays
    // readable.
    { kind: 'bone_pile', x: -22, z: 6 },
    { kind: 'bone_pile', x: 22, z: 8 },
    { kind: 'reed_cluster', x: -12, z: 29 },
    { kind: 'reed_cluster', x: 12, z: 33 },
  ],
});

const LITANY_GEOMETRY: Record<(typeof LITANY_MODULE_IDS)[number], LitanyModuleGeometry> = {
  litany_sluice: LITANY_SLUICE,
  litany_ledger: LITANY_LEDGER,
  litany_ring: LITANY_RING,
  litany_baptistry: LITANY_BAPTISTRY,
  litany_choir_loft: LITANY_CHOIR_LOFT,
  litany_causeway: LITANY_CAUSEWAY,
  litany_apse: LITANY_APSE,
};

export function isLitanyModuleId(id: string): id is (typeof LITANY_MODULE_IDS)[number] {
  return (LITANY_MODULE_IDS as readonly string[]).includes(id);
}

export function litanyModuleGeometry(moduleId: LitanyModuleId): LitanyModuleGeometry | null {
  if (!isLitanyModuleId(moduleId)) return null;
  return LITANY_GEOMETRY[moduleId];
}

/** Movement + shell collision for a Litany module. */
export function litanyModuleColliders(moduleId: LitanyModuleId): Collider[] {
  const geo = litanyModuleGeometry(moduleId);
  if (!geo) return [];
  return [...shellColliders(geo), ...interiorColliders(geo, true)];
}

/** Tall obstacles that block ranged line of sight (excludes shallow Blackwater). */
export function litanyModuleLosColliders(moduleId: LitanyModuleId): Collider[] {
  const geo = litanyModuleGeometry(moduleId);
  if (!geo) return [];
  return [...shellColliders(geo), ...interiorColliders(geo, false)];
}

/** Blackwater hazard zones for module defs / tick (instance-local). */
export function litanyModuleHazards(moduleId: LitanyModuleId): DelveHazardZone[] {
  const geo = litanyModuleGeometry(moduleId);
  if (!geo) return [];
  return geo.hazards.map((h) => ({ x: h.x, z: h.z, r: h.r, rx: h.rx, rz: h.rz, tier: h.tier }));
}

export function litanyModuleDressing(moduleId: LitanyModuleId): LitanyDressingAnchor[] {
  return litanyModuleGeometry(moduleId)?.dressing ?? [];
}

export function litanyModuleMapPrimitives(moduleId: LitanyModuleId): LitanyMapPrimitive[] {
  const geo = litanyModuleGeometry(moduleId);
  if (!geo) return [];
  const out: LitanyMapPrimitive[] = [];
  for (const shape of geo.walkable) out.push({ kind: 'polygon', points: shape.points });
  for (const isl of geo.islands) {
    out.push({ kind: 'rect', x: isl.x, z: isl.z, hw: isl.hw, hd: isl.hd, role: 'island' });
  }
  for (const hz of geo.hazards) {
    out.push({
      kind: 'circle',
      x: hz.x,
      z: hz.z,
      r: hz.r,
      rx: hz.rx,
      rz: hz.rz,
      role: 'blackwater',
    });
  }
  for (const s of geo.stubs) {
    out.push({ kind: 'rect', x: s.x, z: s.z, hw: s.hw, hd: s.hd, role: 'blocker' });
  }
  for (const p of geo.pillars) {
    out.push({ kind: 'circle', x: p.x, z: p.z, r: PILLAR_COLLIDER_R, role: 'blocker' });
  }
  for (const t of geo.tombs) {
    out.push({ kind: 'rect', x: t.x, z: t.z, hw: TOMB_HW, hd: TOMB_HD, role: 'blocker' });
  }
  out.push({ kind: 'circle', x: geo.dais.x, z: geo.dais.z, r: geo.dais.r, role: 'dais' });
  out.push({ kind: 'circle', x: 0, z: geo.zMax - 2, r: 2, role: 'exit' });
  return out;
}

/** DungeonLayout bridge for reliquary-era consumers (entry, span, legacy schematic). */
export function litanyModuleLayout(
  moduleId: LitanyModuleId,
): (DungeonLayout & { litanyModuleId: LitanyModuleId }) | null {
  const geo = litanyModuleGeometry(moduleId);
  if (!geo) return null;
  return {
    zMin: geo.zMin,
    zMax: geo.zMax,
    sideWallZ: (geo.zMin + geo.zMax) / 2,
    sideWallHd: (geo.zMax - geo.zMin) / 2,
    wallX: geo.wallX,
    doorZ: geo.doorZ,
    pillars: geo.pillars,
    tombs: geo.tombs,
    stubs: geo.stubs,
    dais: geo.dais,
    clutter: geo.clutter,
    shellPolygon: geo.walkable[0]?.points,
    shellPole: geo.pole,
    litanyModuleId: moduleId,
  };
}

/** True when walkable islands do not fill the bounding rectangle (data, not object count). */
export function litanyModuleIsNonRectangular(moduleId: LitanyModuleId): boolean {
  const geo = litanyModuleGeometry(moduleId);
  if (!geo) return false;
  const fullArea = geo.wallX * 2 * (geo.zMax - geo.zMin);
  const islandArea = geo.islands.reduce((sum, i) => sum + i.hw * 2 * i.hd * 2, 0);
  return islandArea < fullArea * 0.55;
}

export function litanyModuleBounds(moduleId: LitanyModuleId): {
  minX: number;
  maxX: number;
  zMin: number;
  zMax: number;
} {
  const geo = litanyModuleGeometry(moduleId);
  if (!geo) return { minX: -23, maxX: 23, zMin: LITANY_Z_MIN, zMax: LITANY_Z_MAX };
  return { minX: -geo.wallX, maxX: geo.wallX, zMin: geo.zMin, zMax: geo.zMax };
}
