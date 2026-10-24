// Cave/tunnel geometry: the ONE analytic model shared by the sim (ground
// sheets, wall confinement, camera clamp) and the renderer (the standalone
// tube mesh). Everything derives from the CaveDef node chains; no RNG, no
// DOM/Three imports, pure math ? the same contract as terrainHeight/
// HeightStamp.
//
// Geometry model (v2 ? terrain-independent)
// -----------------------------------------
// A cave is a capsule chain in XZ: consecutive nodes form segments, each point
// inside a node's radius (interpolated along the segment, scaled by the
// cave's `width` multiplier) is "in the bore". The FLOOR height is the node
// `y` interpolated along the chain. The bore has a horseshoe cross-section:
// the ceiling sits `clearance` above the floor at the centerline (scaled by
// the cave's `height` multiplier) and drops to the floor at the lateral edge:
//
//   ceiling(q) = floor + clearance * sqrt(1 - (q/r)^2)   (q = lateral offset)
//
// The tube exists EXACTLY as authored, everywhere along the chain. It is
// never carved into the terrain, never clamped under it, and never collapsed
// by it: a cave that pokes out of a hillside simply shows its rock shell.
// Openings into the ground are TerrainCut solids (sim/terrain_cuts.ts) that
// cut the terrain sheet away. A cave can carve its OWN (set `autoMouth`, see
// caveBoreCut below), which is the one gesture the Unreal-style boolean tool
// gets right and the v1 workflow did not; a maker can still line up a cut by
// hand, which is what every v1 document does.
//
// Movement: the walkable cave floor is a SECOND ground sheet wherever a tube
// runs. Movers pick the sheet closest to their previous height
// (groundHeightNear in world.ts), so walking through a mouth transfers layers
// with no teleport and no per-mover state. Inside a hole the terrain sheet is
// ABSENT: a tube below catches the mover, and a hole with nothing underneath
// walls the step off (nothing to stand on).

import { noise2 } from './rng';
import type { CaveDef, CaveNode, TerrainCut, TerrainCutNode } from './types';

// The terrain-cut model moved to its own module when the Hole tool grew from
// spheres to a shape stack (sphere/box/capsule/tube evaluated as one signed
// distance field). Re-exported here so every v1 import site keeps working.
export {
  cutBounds,
  cutSdfAt,
  cutsSdfAt,
  HOLE_MAX_RADIUS,
  HOLE_MIN_RADIUS,
  HOLE_WALL_RISE,
  holeBounds,
  inTerrainCut,
  inTerrainHole,
  MAX_HOLE_PATCHES,
  MAX_TERRAIN_HOLES,
  sanitizeTerrainCut,
  sanitizeTerrainHole,
} from './terrain_cuts';

// Headroom above the cave floor at the centerline (before the cave's height
// multiplier). Derived from the bore radius but never cramped: a player is
// ~2yd tall and the camera wants room to breathe.
export function caveClearance(radius: number, heightMult = 1): number {
  return Math.max(3.0, radius * 0.85) * heightMult;
}

// ---------------------------------------------------------------------------
// Floor bumps (the Cave panel's "Floor bumps" slider): deterministic value
// noise added to the WALKABLE floor, attenuated to zero at the lateral walls
// so the bumped floor still meets the arch cleanly. A pure function of
// (cave, x, z, lat): the sim's ground sheet and the render mesh both call it,
// so what you walk on is exactly what you see. The ceiling arch derives from
// the UNBUMPED floor line ? bumps make the floor roll, not the roof.
// ---------------------------------------------------------------------------

// Peak bump amplitude (yards) at floorVariance 1 on the centerline.
const FLOOR_BUMP_AMP = 1.1;

// Per-cave noise salt, cached: sampleCave runs per mover per tick.
const floorSaltCache = new WeakMap<CaveDef, number>();

function caveFloorSalt(cave: CaveDef): number {
  let salt = floorSaltCache.get(cave);
  if (salt === undefined) {
    salt = 0;
    for (let i = 0; i < cave.id.length; i++) salt = (salt * 31 + cave.id.charCodeAt(i)) % 9973;
    floorSaltCache.set(cave, salt);
  }
  return salt;
}

/** The floor-noise offset at (x, z). `lat` = |q|/r in [0,1] (0 = centerline,
 *  1 = wall base); the bump fades quadratically to 0 at the walls. */
export function caveFloorBumpAt(cave: CaveDef, x: number, z: number, lat: number): number {
  const fv = cave.floorVariance ?? 0;
  if (fv <= 0) return 0;
  const salt = caveFloorSalt(cave);
  // Two octaves: broad rolls plus finer rubble.
  const n =
    noise2(x * 0.33, z * 0.33, salt) - 0.5 + (noise2(x * 0.9, z * 0.9, salt + 7) - 0.5) * 0.45;
  const wall = Math.max(0, 1 - lat * lat);
  return n * 2 * fv * FLOOR_BUMP_AMP * wall;
}

// Sanitizer caps (also enforced by map_doc.ts): keep documents bounded.
export const MAX_CAVES = 32;
export const MAX_CAVE_NODES = 400;
export const CAVE_MIN_RADIUS = 1.5;
export const CAVE_MAX_RADIUS = 20;
export const CAVE_MIN_MULT = 0.5;
export const CAVE_MAX_MULT = 3;
export const CAVE_SPIKE_SIZE_MIN = 0.3;
export const CAVE_SPIKE_SIZE_MAX = 3;

export interface CaveSample {
  cave: number; // index into the caves array
  floor: number; // walkable floor height at this XZ
  ceiling: number; // horseshoe ceiling height at this XZ (== floor at the edge)
  q: number; // lateral distance from the centerline (yards)
  radius: number; // EFFECTIVE bore radius at the closest chain point
  clearance: number; // EFFECTIVE centerline headroom at the closest chain point
  mouth: boolean; // in the apron BEYOND an OPEN end node: the mouth opening, not rock
}

/** Whether each end of the tube is an open mouth (absent flags = open). */
export function caveStartOpen(cave: CaveDef): boolean {
  return cave.startOpen !== false;
}
export function caveEndOpen(cave: CaveDef): boolean {
  return cave.endOpen !== false;
}

/**
 * Closest-point sample of ONE cave's capsule chain at (x, z), or null when the
 * point is outside the bore footprint. When several segments cover the point,
 * the one whose centerline is nearest (smallest q/r) wins, so junctions and
 * switchbacks resolve to the dominant bore.
 */
function sampleCave(cave: CaveDef, x: number, z: number): Omit<CaveSample, 'cave'> | null {
  const nodes = cave.nodes;
  if (nodes.length === 0) return null;
  const widthMult = cave.width ?? 1;
  const heightMult = cave.height ?? 1;
  let best: { q: number; r: number; floor: number; mouth: boolean } | null = null;
  let bestNorm = Infinity;
  const consider = (q: number, r: number, floor: number, mouth: boolean): void => {
    if (q >= r || r <= 0) return;
    const norm = q / r;
    if (norm < bestNorm) {
      bestNorm = norm;
      best = { q, r, floor, mouth };
    }
  };
  if (nodes.length === 1) {
    const n = nodes[0];
    consider(
      Math.hypot(x - n.x, z - n.z),
      n.radius * widthMult,
      n.y,
      caveStartOpen(cave) || caveEndOpen(cave),
    );
  }
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    let tRaw = 0;
    if (len2 > 1e-9) tRaw = ((x - a.x) * abx + (z - a.z) * abz) / len2;
    const t = tRaw < 0 ? 0 : tRaw > 1 ? 1 : tRaw;
    const cx = a.x + abx * t;
    const cz = a.z + abz * t;
    const r = (a.radius + (b.radius - a.radius) * t) * widthMult;
    const floor = a.y + (b.y - a.y) * t;
    // Strictly past an OPEN end node's plane, the dome-shaped apron is the
    // mouth OPENING (the rim annulus in the mesh), not rock: movement's wall
    // band must let movers walk straight through it.
    const mouth =
      (i === 0 && tRaw < 0 && caveStartOpen(cave)) ||
      (i + 2 === nodes.length && tRaw > 1 && caveEndOpen(cave));
    consider(Math.hypot(x - cx, z - cz), r, floor, mouth);
  }
  if (!best) return null;
  const { q, r, floor, mouth } = best as {
    q: number;
    r: number;
    floor: number;
    mouth: boolean;
  };
  const clearance = caveClearance(r, heightMult);
  const lat = q / r;
  // Ceiling arches over the UNBUMPED floor line; the walkable floor itself
  // rolls with the Floor bumps noise (0 when the slider is off).
  const ceiling = floor + clearance * Math.sqrt(Math.max(0, 1 - lat * lat));
  return {
    floor: floor + caveFloorBumpAt(cave, x, z, lat),
    ceiling,
    q,
    radius: r,
    clearance,
    mouth,
  };
}

/**
 * Sample every cave at (x, z) and return the dominant bore (nearest
 * centerline), or null when the point is under no cave footprint. Linear over
 * caves; documents are capped at MAX_CAVES.
 */
export function caveSampleAt(caves: readonly CaveDef[], x: number, z: number): CaveSample | null {
  let best: CaveSample | null = null;
  let bestNorm = Infinity;
  for (let i = 0; i < caves.length; i++) {
    const s = sampleCave(caves[i], x, z);
    if (s && s.q / s.radius < bestNorm) {
      bestNorm = s.q / s.radius;
      best = { cave: i, ...s };
    }
  }
  return best;
}

/**
 * The cave ground sheet at (x, z): the walkable tube floor when a bore runs
 * under/through this point, else null. Purely chain-derived ? terrain plays
 * no part. Not meaningfully walkable at the very edge of the horseshoe; a
 * sliver is kept so the slope gate (not a hard pop) rejects the wall.
 */
export function caveFloorAt(
  caves: readonly CaveDef[] | undefined,
  x: number,
  z: number,
): CaveSample | null {
  if (!caves || caves.length === 0) return null;
  const s = caveSampleAt(caves, x, z);
  if (!s) return null;
  if (s.q >= s.radius * 0.98) return null;
  return s;
}

// ---------------------------------------------------------------------------
// Cave mouths carve themselves
// ---------------------------------------------------------------------------
// The Tunnel tool already produces the bore as a capsule chain, and the bore's
// cross-section IS a terrain cut's `tube` shape: lateral radius r, vertical
// semi-axis `clearance`, clipped to the half above the floor line. Emitting
// one alongside the cave means a tunnel that breaches the surface opens its
// own mouth, instead of the maker punching spheres at both ends and nudging
// them until the seam looks right.
//
// The cut only bites where the SURFACE height falls inside the bore. Buried
// spans (surface above the ceiling) cut nothing; spans standing above the
// ground (surface below the floor) cut nothing either, because `bore` clips
// the solid at the floor line. What is left is exactly the breach.

/** The bore of `cave` as a terrain cut, or null when it has no usable chain.
 *  `blend` melts the mouth into any hand-placed cut beside it. */
export function caveBoreCut(cave: CaveDef, blend = 0): TerrainCut | null {
  const widthMult = cave.width ?? 1;
  const heightMult = cave.height ?? 1;
  const nodes: TerrainCutNode[] = [];
  for (const n of cave.nodes) {
    const r = n.radius * widthMult;
    if (!(r > 0)) continue;
    nodes.push({ x: n.x, y: n.y, z: n.z, radius: r, vy: caveClearance(r, heightMult) });
  }
  if (nodes.length === 0) return null;
  const first = nodes[0];
  const cut: TerrainCut = {
    shape: 'tube',
    x: first.x,
    y: first.y,
    z: first.z,
    radius: first.radius,
    nodes,
    bore: true,
  };
  if (blend > 0) cut.blend = blend;
  return cut;
}

/** Every cave's self-carved mouth cut, for the maps that opt into it. Caves
 *  with `autoMouth === false` keep the v1 contract (openings authored by hand
 *  as separate cuts), so an existing document never gains an opening it did
 *  not have. */
export function caveMouthCuts(caves: readonly CaveDef[] | undefined): TerrainCut[] {
  if (!caves || caves.length === 0) return [];
  const out: TerrainCut[] = [];
  for (const cave of caves) {
    if (cave.autoMouth !== true) continue;
    const cut = caveBoreCut(cave, cave.mouthBlend ?? 0);
    if (cut) out.push(cut);
  }
  return out;
}

// A tube span whose ceiling reaches within this of the surface counts as
// OPEN for the camera: mouths and above-ground shells never confine the
// chase cam (only genuinely buried spans do).
const CAM_OPEN_EPS = 0.2;

/**
 * Camera clamp inside BURIED tubes: the farthest distance along the segment
 * eye -> desired camera that stays inside the bore (below the horseshoe
 * ceiling, above the floor, within the footprint). Marches in short steps ?
 * the segment is at most a few dozen yards. Returns Infinity when the eye is
 * not inside a tube, the span is open/above ground (mouths, exposed shells),
 * or the march reaches such a span: from there the normal terrain/collider
 * occlusion takes over. `surfaceAt` is the terrain surface height.
 */
export function caveCameraMaxDist(
  caves: readonly CaveDef[] | undefined,
  surfaceAt: (x: number, z: number) => number,
  ex: number,
  ey: number,
  ez: number,
  cx: number,
  cy: number,
  cz: number,
  pad: number,
): number {
  if (!caves || caves.length === 0) return Infinity;
  const eyeSample = caveSampleAt(caves, ex, ez);
  if (!eyeSample) return Infinity;
  // Open span at the eye (mouth ring, tube standing above the ground): free.
  if (eyeSample.ceiling >= surfaceAt(ex, ez) - CAM_OPEN_EPS) return Infinity;
  // Eye outside the tube volume (walking the surface over a buried bore):
  // no clamp.
  if (ey > eyeSample.ceiling + 0.5 || ey < eyeSample.floor - 0.5) return Infinity;
  const dx = cx - ex;
  const dy = cy - ey;
  const dz = cz - ez;
  const maxDist = Math.hypot(dx, dy, dz);
  if (maxDist < 1e-6) return Infinity;
  const step = 0.4;
  let ok = 0;
  for (let d = step; d <= maxDist; d += step) {
    const t = d / maxDist;
    const px = ex + dx * t;
    const py = ey + dy * t;
    const pz = ez + dz * t;
    const s = caveSampleAt(caves, px, pz);
    // Leaving the footprint, or rising above the local ceiling / below the
    // floor, ends the clear span. Reaching an OPEN span (a mouth) frees the
    // camera entirely: daylight takes over from there.
    if (!s) break;
    if (s.ceiling >= surfaceAt(px, pz) - CAM_OPEN_EPS) return Infinity;
    if (py > s.ceiling - pad || py < s.floor - 0.1) break;
    ok = d;
  }
  return ok > 0 ? ok : Math.min(maxDist, 1.2);
}

/** Bounding rect of a cave footprint (for render region rebuilds). */
export function caveBounds(cave: CaveDef): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
} {
  const widthMult = cave.width ?? 1;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const n of cave.nodes) {
    const r = n.radius * widthMult;
    minX = Math.min(minX, n.x - r);
    maxX = Math.max(maxX, n.x + r);
    minZ = Math.min(minZ, n.z - r);
    maxZ = Math.max(maxZ, n.z + r);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Clamp helper for authoring + sanitizing: a node with finite fields and a
 *  radius inside the document bounds, or null when unusable. */
export function sanitizeCaveNode(n: unknown): CaveNode | null {
  if (typeof n !== 'object' || n === null) return null;
  const o = n as Record<string, unknown>;
  const x = Number(o.x);
  const y = Number(o.y);
  const z = Number(o.z);
  const radius = Number(o.radius);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z) ||
    !Number.isFinite(radius)
  ) {
    return null;
  }
  return {
    x,
    y,
    z,
    radius: Math.min(CAVE_MAX_RADIUS, Math.max(CAVE_MIN_RADIUS, radius)),
  };
}
