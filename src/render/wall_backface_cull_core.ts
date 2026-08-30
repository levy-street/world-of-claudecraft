// Pure backface-cull policy for the Ignivar raid shell walls. The raid rooms
// are convex polygon shells whose chase camera has no collision pull-in, so
// an orbit routinely places the camera OUTSIDE a wall; the per-segment
// sightline fade then ghosts only the one crossed segment (a peephole) while
// every neighbouring segment stays opaque and fills the frame. This core
// answers the classic-dungeon question instead: is the camera on the OUTSIDE
// of a wall's plane (seeing its back face)? Every segment of that face culls
// as one, and the wall-mounted dressing props assigned to the face cull with
// it. Three-free on purpose (RENDER_PURE_CORES): a Vitest drives it directly.

/** One wall face's cull plane: a point on the wall centreline plus the unit
 *  outward normal (away from the room interior), in whatever space the
 *  caller keeps its camera. */
export interface WallCullPlane {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/**
 * How far past the wall CENTRELINE toward the room the cull begins, in world
 * units: the wall's half-depth (DUNGEON_WALL_HW = 1) plus clearance for the
 * camera near plane (0.2) with margin, so the wall is gone before the near
 * plane can clip into the slab and tear it open. A camera more than half a
 * unit inside the room face never triggers it.
 */
export const WALL_BACKFACE_CULL_MARGIN = 1.5;

/**
 * The half-space test only fires within this range of the wall (in plan), so
 * a RESIDENT interior the camera is nowhere near keeps its shells intact:
 * instance origins sit 600 apart and the old sightline test was naturally
 * bounded by the eye-to-camera segment. 120 covers every in-room orbit (max
 * wheel zoom 22 plus the largest room radius 40; the longest shell, the
 * approach at 116 across, still fits end to end) while staying far under
 * the 600-unit origin spacing.
 */
export const WALL_BACKFACE_CULL_RANGE = 120;

/**
 * Unit outward normal for a wall segment placed by polygonWallSegments: the
 * segment's long axis runs along world (cos(rot), -sin(rot)), and of the two
 * perpendiculars the outward one points AWAY from the room's star-shaping
 * pole. Star-shaped polygons guarantee the pole is on the interior side of
 * every edge, so the sign test is exact.
 */
export function wallSegmentOutward(
  segX: number,
  segZ: number,
  rot: number,
  poleX: number,
  poleZ: number,
): { nx: number; nz: number } {
  let nx = Math.sin(rot);
  let nz = Math.cos(rot);
  if ((segX - poleX) * nx + (segZ - poleZ) * nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  return { nx, nz };
}

/** Whether the camera is on the back (outside) of a wall face's plane, with
 *  the near-clip margin above; false beyond the cull range either way. */
export function cameraSeesWallBack(
  plane: WallCullPlane,
  camX: number,
  camZ: number,
  margin = WALL_BACKFACE_CULL_MARGIN,
  range = WALL_BACKFACE_CULL_RANGE,
): boolean {
  const dx = camX - plane.x;
  const dz = camZ - plane.z;
  if (dx * dx + dz * dz > range * range) return false;
  return dx * plane.nx + dz * plane.nz > -margin;
}

/**
 * Dressing prop kinds that are MOUNTED ON the shell walls (doors set into the
 * wall, cladding panels, wall gears and reliefs, beams and pipe runs along a
 * wall course, spouts, hooks and rings, wall pilasters, the kit sconce).
 * These must cull with their wall or they float in the void once it hides.
 * Floor-standing machines pushed against a wall (forges, furnaces, presses,
 * reactors) and floor gutters (lava channels) deliberately stay: they sit on
 * the floor, which never culls.
 */
export const WALL_MOUNTED_PROP_KINDS: ReadonlySet<string> = new Set([
  'vault_door',
  'gear_wall_rusty',
  'square_wall',
  'lava_face',
  'beam',
  'steam_pipes',
  'industrial_pipe',
  'lava_outlet',
  'lava_port',
  'hanging_hook',
  'chain_link',
  'chain_hanging',
  'pillar_slim',
  'torch',
]);

/** A placement counts as on-the-wall only within this distance of a shell
 *  edge (wall half-depth 1 plus the deepest mounted prop footprint). */
export const WALL_PROP_EDGE_MAX_DIST = 3.5;

export interface WallFaceBucket<T> {
  /** polygon edge index the bucket's props mount on */
  edge: number;
  /** the face's cull plane at the edge midpoint (same space as the polygon) */
  plane: WallCullPlane;
  items: T[];
}

export interface WallMountedSplit<T> {
  /** placements that stay with the room body (floor props, mid-room rigs) */
  interior: T[];
  /** wall-mounted placements grouped per shell edge */
  faces: WallFaceBucket<T>[];
}

function distanceToEdge(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  px: number,
  pz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

/**
 * Split a dressing plan into interior placements and per-wall-face buckets.
 * A placement joins a face only when its kind is wall-mounted AND its centre
 * sits within `maxDist` of that shell edge (nearest edge wins, so a corner
 * prop belongs to exactly one face). Every input lands in exactly one output
 * list; without a polygon the split is a no-op and everything stays interior.
 */
export function splitWallMountedItems<T extends { key: string; x: number; z: number }>(
  items: readonly T[],
  polygon: ReadonlyArray<{ x: number; z: number }> | undefined,
  pole: { x: number; z: number } | undefined,
  kinds: ReadonlySet<string> = WALL_MOUNTED_PROP_KINDS,
  maxDist = WALL_PROP_EDGE_MAX_DIST,
): WallMountedSplit<T> {
  const interior: T[] = [];
  if (!polygon || polygon.length < 3 || !pole) {
    interior.push(...items);
    return { interior, faces: [] };
  }
  const n = polygon.length;
  const buckets = new Map<number, T[]>();
  for (const item of items) {
    if (!kinds.has(item.key)) {
      interior.push(item);
      continue;
    }
    let best = Infinity;
    let bestEdge = -1;
    for (let i = 0; i < n; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      const d = distanceToEdge(a.x, a.z, b.x, b.z, item.x, item.z);
      if (d < best) {
        best = d;
        bestEdge = i;
      }
    }
    if (bestEdge < 0 || best > maxDist) {
      interior.push(item);
      continue;
    }
    const list = buckets.get(bestEdge);
    if (list) list.push(item);
    else buckets.set(bestEdge, [item]);
  }
  const faces: WallFaceBucket<T>[] = [];
  for (const [edge, list] of [...buckets].sort((a, b) => a[0] - b[0])) {
    const a = polygon[edge];
    const b = polygon[(edge + 1) % n];
    const midX = (a.x + b.x) / 2;
    const midZ = (a.z + b.z) / 2;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    let nx = (b.z - a.z) / len;
    let nz = -(b.x - a.x) / len;
    if ((midX - pole.x) * nx + (midZ - pole.z) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    faces.push({ edge, plane: { x: midX, z: midZ, nx, nz }, items: list });
  }
  return { interior, faces };
}
