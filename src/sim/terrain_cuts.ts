// Terrain boolean cuts: the ONE signed-distance model shared by the sim (the
// missing ground sheet, movement's wall band, the camera clamp) and the
// renderer (the chunk mesher's dropped quads and the rim skirt band). Pure
// math, no RNG, no DOM/Three imports, the same contract as terrainHeight and
// src/sim/caves.ts.
//
// Geometry model
// --------------
// A cut is a solid in world space. The ground sheet simply does not exist
// where the SURFACE POINT (x, terrainHeight(x, z), z) lies inside the union of
// the map's cuts, and it is restored where that point also lies inside a PATCH
// cut. Four shapes cover what a maker needs:
//
//   sphere   the v1 Hole tool's ball; still the default when `shape` is absent
//   box      an oriented slab: a slot canyon, a doorway, a square shaft
//   capsule  a straight round-ended bar: an arch, a bored adit across a face
//   tube     a capsule CHAIN with an elliptical cross-section, which is the
//            shape a cave bore already has, so a tunnel carves its own mouth
//
// Distances combine with a polynomial smooth minimum, so `blend` melts
// neighbouring cuts into one opening instead of leaving a crease where they
// meet. blend 0 (the default, and every v1 document) is an exact min, so the
// legacy sphere test is preserved exactly.
//
// WHY AN SDF AND NOT A MESH BOOLEAN: the mesher runs in a worker
// (terrain_chunk_worker.ts) and the sim asks the same question hundreds of
// times a tick. An analytic field is transferable as plain numbers, costs no
// build step, and, the non-negotiable part, lets both sides ask the SAME
// question. A cut the renderer honours and the sim does not is an invisible
// wall, which is the exact failure mode already recorded for procedural
// decorations.

import type { TerrainCut, TerrainCutNode } from './types';

// Sanitizer caps (also enforced by map_doc.ts): keep documents bounded. 256,
// not the old 64: the Carve tool's Dig/Fill brushes author strokes of small
// blended solids, and every consumer narrows by bounds before evaluating.
export const MAX_TERRAIN_HOLES = 256;
export const HOLE_MIN_RADIUS = 1;
export const HOLE_MAX_RADIUS = 80;
// Patch cuts (the Patch hole mode): restore the ground inside hole cutouts.
export const MAX_HOLE_PATCHES = 256;
// Chain length for an authored `tube` cut. A cave-derived bore cut is built
// from the cave's own node chain and is capped by MAX_CAVE_NODES instead.
export const MAX_CUT_NODES = 64;
// Box half-extents and capsule half-length share the radius bounds so a maker
// cannot author a cut that outruns the region-rebuild rects.
export const CUT_MIN_HALF = 0.5;
export const CUT_MAX_HALF = 200;
export const CUT_MAX_BLEND = 12;
// FORK: organic shaping limits (the sanitizer's and the sliders' one truth).
export const CUT_MAX_WARP = 8;
export const CUT_WARP_SCALE_MIN = 1;
export const CUT_WARP_SCALE_MAX = 30;
export const CUT_WARP_SCALE_DEFAULT = 4;
export const CUT_TAPER_MIN = 0.3;
export const CUT_TAPER_MAX = 2;
export const CUT_MAX_WOBBLE = 0.6;
export const CUT_WOBBLE_LEN_MIN = 2;
export const CUT_WOBBLE_LEN_MAX = 40;
export const CUT_WOBBLE_LEN_DEFAULT = 8;
export const CUT_MAX_BEND = 1.5;
export const CUT_MAX_ARCH = 1;

// The height groundHeightNear reports for a cut with NO cave sheet under it:
// far above any climbable step, so the movement gates read it as a wall and
// nothing walks out over the void.
export const HOLE_WALL_RISE = 1000;

export const TERRAIN_CUT_SHAPES = ['sphere', 'box', 'capsule', 'tube', 'voxel'] as const;
// FORK: the dug rock volume ('voxel' shape). Cell range, the largest grid a
// document may carry, and the signed-distance quantization: an Int8 holds
// distance in units of cell / VOXEL_UNIT, saturating at +-VOXEL_RANGE cells.
export const VOXEL_CELL_MIN = 0.25;
export const VOXEL_CELL_MAX = 2;
export const VOXEL_MAX_CELLS = 24_000_000;
export const VOXEL_MAX_DIM = 1024;
export const VOXEL_RANGE = 4;
export const VOXEL_UNIT = 127 / VOXEL_RANGE;
/** Rock everywhere: the value a fresh or out-of-range voxel holds. */
export const VOXEL_ROCK = 127;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Polynomial smooth minimum. k <= 0 returns the exact min, which is what keeps
 * an unblended document identical to the v1 sphere test; larger k melts the
 * two surfaces together over roughly k yards.
 */
export function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
}

// ---------------------------------------------------------------------------
// Per-shape signed distance. Negative inside, zero on the surface. Scratch
// locals rather than allocations: cutSdfAt runs per mover per tick and per
// terrain vertex.
// ---------------------------------------------------------------------------

/** World point into the cut's local frame (yaw then pitch, inverted). */
function toLocal(cut: TerrainCut, x: number, y: number, z: number, out: number[]): void {
  let px = x - cut.x;
  let py = y - cut.y;
  let pz = z - cut.z;
  const ry = cut.rotY ?? 0;
  if (ry !== 0) {
    const c = Math.cos(-ry);
    const s = Math.sin(-ry);
    const nx = px * c - pz * s;
    pz = px * s + pz * c;
    px = nx;
  }
  const rx = cut.rotX ?? 0;
  if (rx !== 0) {
    const c = Math.cos(-rx);
    const s = Math.sin(-rx);
    const ny = py * c + pz * s;
    pz = -py * s + pz * c;
    py = ny;
  }
  out[0] = px;
  out[1] = py;
  out[2] = pz;
}

const local: number[] = [0, 0, 0];

// ---- FORK: the shaping field -------------------------------------------------
// Deterministic 3D value noise in [-1, 1]: a lattice hash smoothed with a
// quintic fade, two octaves. Pure arithmetic so the sim, the physics and the
// mesh workers agree to the last bit.
function latticeHash(ix: number, iy: number, iz: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function valueNoise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const c000 = latticeHash(ix, iy, iz);
  const c100 = latticeHash(ix + 1, iy, iz);
  const c010 = latticeHash(ix, iy + 1, iz);
  const c110 = latticeHash(ix + 1, iy + 1, iz);
  const c001 = latticeHash(ix, iy, iz + 1);
  const c101 = latticeHash(ix + 1, iy, iz + 1);
  const c011 = latticeHash(ix, iy + 1, iz + 1);
  const c111 = latticeHash(ix + 1, iy + 1, iz + 1);
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return (y0 + (y1 - y0) * fz) * 2 - 1;
}
/** Two-octave undulation in [-1, 1] with features about `scale` yards across. */
export function cutWarpNoise(x: number, y: number, z: number, scale: number): number {
  const s = 1 / Math.max(1e-3, scale);
  return (
    valueNoise3(x * s, y * s, z * s) * 0.7 +
    valueNoise3(x * s * 2.1 + 7.3, y * s * 2.1 + 1.9, z * s * 2.1 + 4.7) * 0.3
  );
}
/** The undulation term a cut adds to its primitive distance (0 when unset). */
function warpAt(cut: TerrainCut, x: number, y: number, z: number): number {
  const warp = cut.warp ?? 0;
  if (!(warp > 0)) return 0;
  const scale = cut.warpScale ?? CUT_WARP_SCALE_DEFAULT;
  // Sampled in the cut's own frame (offset by its centre) so the shape moves
  // with the cut instead of sliding through a world-fixed noise field.
  return warp * cutWarpNoise(x - cut.x, y - cut.y, z - cut.z, scale);
}
// ---- FORK: the voxel volume ---------------------------------------------------
/** Run-length code an Int8 volume: "count:value,count:value,..." (rock runs
 *  dominate, so a whole dug cave complex is a few kilobytes). */
export function encodeVoxelRle(data: Int8Array): string {
  const parts: string[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let j = i + 1;
    while (j < data.length && data[j] === v) j++;
    parts.push(`${j - i}:${v}`);
    i = j;
  }
  return parts.join(',');
}
/** Decode encodeVoxelRle output into exactly `n` cells, or null if malformed. */
export function decodeVoxelRle(text: string, n: number): Int8Array | null {
  const out = new Int8Array(n);
  if (text.length === 0) {
    out.fill(VOXEL_ROCK);
    return out;
  }
  let at = 0;
  for (const part of text.split(',')) {
    const colon = part.indexOf(':');
    if (colon <= 0) return null;
    const count = Number(part.slice(0, colon));
    const value = Number(part.slice(colon + 1));
    if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(value)) return null;
    if (value < -128 || value > 127 || at + count > n) return null;
    out.fill(value, at, at + count);
    at += count;
  }
  return at === n ? out : null;
}
interface VoxelEntry {
  data: Int8Array;
  /** Cell-index box (inclusive-exclusive) of every cell a brush has touched
   *  (value below rock), or null until scanned. The grid is a padded box
   *  around the dug shape, so the touched box is what the bounds readers and
   *  the mesher want: the grid itself can be many times larger than the cave. */
  air: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } | null;
}
const voxelCache = new WeakMap<TerrainCut, VoxelEntry>();
/** The decoded volume of a voxel cut (rock everywhere when the text is
 *  malformed), cached per record. The editor edits this array IN PLACE and
 *  re-encodes it into `vox` at the end of a stroke (setVoxelData). */
export function voxelData(cut: TerrainCut): Int8Array {
  const hit = voxelCache.get(cut);
  if (hit) return hit.data;
  const n = (cut.nx ?? 0) * (cut.ny ?? 0) * (cut.nz ?? 0);
  const data = decodeVoxelRle(cut.vox ?? '', n) ?? new Int8Array(n).fill(VOXEL_ROCK);
  voxelCache.set(cut, { data, air: null });
  return data;
}
/** Install a (mutated or reallocated) volume on a voxel cut and refresh the
 *  document text; call after every brush stroke and after a grid regrow. */
export function setVoxelData(cut: TerrainCut, data: Int8Array): void {
  voxelCache.set(cut, { data, air: null });
  cut.vox = encodeVoxelRle(data);
}
/** Widen the touched box by a cell-index box a stamp is about to write, so
 *  the bounds stay right mid-stroke without a rescan. */
export function extendVoxelAir(
  cut: TerrainCut,
  box: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number },
): void {
  voxelData(cut);
  const e = voxelCache.get(cut);
  if (!e) return;
  if (box.x1 <= box.x0 || box.y1 <= box.y0 || box.z1 <= box.z0) return;
  if (!e.air) e.air = scanVoxelAir(cut, e.data);
  const a = e.air;
  if (!a) {
    e.air = { ...box };
    return;
  }
  a.x0 = Math.min(a.x0, box.x0);
  a.y0 = Math.min(a.y0, box.y0);
  a.z0 = Math.min(a.z0, box.z0);
  a.x1 = Math.max(a.x1, box.x1);
  a.y1 = Math.max(a.y1, box.y1);
  a.z1 = Math.max(a.z1, box.z1);
}
function scanVoxelAir(
  cut: TerrainCut,
  data: Int8Array,
): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } | null {
  const nx = cut.nx ?? 0;
  const ny = cut.ny ?? 0;
  const nz = cut.nz ?? 0;
  let x0 = nx;
  let y0 = ny;
  let z0 = nz;
  let x1 = 0;
  let y1 = 0;
  let z1 = 0;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      const row = (z * ny + y) * nx;
      for (let x = 0; x < nx; x++) {
        // AIR cells (negative): the surface sits within one cell of one, so
        // the padded box below holds every zero crossing. The positive band
        // a dig leaves around itself, or a refill leaves behind, is rock and
        // must not keep a refilled tunnel's footprint alive.
        if (data[row + x] >= 0) continue;
        if (x < x0) x0 = x;
        if (x + 1 > x1) x1 = x + 1;
        if (y < y0) y0 = y;
        if (y + 1 > y1) y1 = y + 1;
        if (z < z0) z0 = z;
        if (z + 1 > z1) z1 = z + 1;
      }
    }
  }
  return x1 > x0 ? { x0, y0, z0, x1, y1, z1 } : null;
}
/** World box of the grid's AIR cells with two cells of slack (every surface
 *  crossing lies inside), or null for a grid that is all rock. */
export function voxelAirBounds(
  cut: TerrainCut,
): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | null {
  voxelData(cut);
  const e = voxelCache.get(cut);
  if (!e) return null;
  if (!e.air) e.air = scanVoxelAir(cut, e.data);
  const a = e.air;
  if (!a) return null;
  const cell = cut.cell ?? 1;
  const ox = cut.vx0 ?? 0;
  const oy = cut.vy0 ?? 0;
  const oz = cut.vz0 ?? 0;
  return {
    minX: ox + (a.x0 - 2) * cell,
    minY: oy + (a.y0 - 2) * cell,
    minZ: oz + (a.z0 - 2) * cell,
    maxX: ox + (a.x1 + 2) * cell,
    maxY: oy + (a.y1 + 2) * cell,
    maxZ: oz + (a.z1 + 2) * cell,
  };
}
/** Is there air within two cells of this world box? A cheap sub-box scan so
 *  the cavity mesher skips the rock-only tiles of a big grid. */
export function voxelTouches(
  cut: TerrainCut,
  b: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number },
): boolean {
  const cell = cut.cell ?? 1;
  const nx = cut.nx ?? 0;
  const ny = cut.ny ?? 0;
  const nz = cut.nz ?? 0;
  const lo = (v: number, o: number, n: number): number =>
    Math.max(0, Math.min(n, Math.floor((v - o) / cell) - 2));
  const hi = (v: number, o: number, n: number): number =>
    Math.max(0, Math.min(n, Math.ceil((v - o) / cell) + 3));
  const x0 = lo(b.minX, cut.vx0 ?? 0, nx);
  const x1 = hi(b.maxX, cut.vx0 ?? 0, nx);
  const y0 = lo(b.minY, cut.vy0 ?? 0, ny);
  const y1 = hi(b.maxY, cut.vy0 ?? 0, ny);
  const z0 = lo(b.minZ, cut.vz0 ?? 0, nz);
  const z1 = hi(b.maxZ, cut.vz0 ?? 0, nz);
  if (x1 <= x0 || y1 <= y0 || z1 <= z0) return false;
  const data = voxelData(cut);
  for (let z = z0; z < z1; z++) {
    for (let y = y0; y < y1; y++) {
      const row = (z * ny + y) * nx;
      for (let x = x0; x < x1; x++) if (data[row + x] < 0) return true;
    }
  }
  return false;
}
/** Signed distance of the voxel volume at a world point: trilinear over the
 *  cell-centre lattice, rock (a large positive distance) outside the grid. */
function voxelSdfAt(cut: TerrainCut, x: number, y: number, z: number): number {
  const cell = cut.cell ?? 1;
  const nx = cut.nx ?? 0;
  const ny = cut.ny ?? 0;
  const nz = cut.nz ?? 0;
  if (nx < 1 || ny < 1 || nz < 1) return Number.POSITIVE_INFINITY;
  const fx = (x - (cut.vx0 ?? 0)) / cell - 0.5;
  const fy = (y - (cut.vy0 ?? 0)) / cell - 0.5;
  const fz = (z - (cut.vz0 ?? 0)) / cell - 0.5;
  if (fx <= -1 || fy <= -1 || fz <= -1 || fx >= nx || fy >= ny || fz >= nz) {
    return VOXEL_RANGE * cell;
  }
  const data = voxelData(cut);
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const ty = fy - iy;
  const tz = fz - iz;
  const at = (cx: number, cy: number, cz: number): number => {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= nx || cy >= ny || cz >= nz) return VOXEL_ROCK;
    return data[(cz * ny + cy) * nx + cx];
  };
  const c00 = at(ix, iy, iz) + (at(ix + 1, iy, iz) - at(ix, iy, iz)) * tx;
  const c10 = at(ix, iy + 1, iz) + (at(ix + 1, iy + 1, iz) - at(ix, iy + 1, iz)) * tx;
  const c01 = at(ix, iy, iz + 1) + (at(ix + 1, iy, iz + 1) - at(ix, iy, iz + 1)) * tx;
  const c11 = at(ix, iy + 1, iz + 1) + (at(ix + 1, iy + 1, iz + 1) - at(ix, iy + 1, iz + 1)) * tx;
  const c0 = c00 + (c10 - c00) * ty;
  const c1 = c01 + (c11 - c01) * ty;
  return ((c0 + (c1 - c0) * tz) / VOXEL_UNIT) * cell;
}

/** FORK: how far the shaping dials can push a cut's surface past its
 *  primitive (bounds padding): the undulation amplitude plus the radius
 *  growth from a flared taper and the wobble. */
function shapeReach(cut: TerrainCut): number {
  const grow = Math.max(0, (cut.taper ?? 1) - 1) + Math.max(0, cut.wobble ?? 0);
  return Math.max(0, cut.warp ?? 0) + cut.radius * grow;
}

/** Exact signed distance to an axis-aligned box of the given half extents. */
function boxSdf(px: number, py: number, pz: number, hx: number, hy: number, hz: number): number {
  const qx = Math.abs(px) - hx;
  const qy = Math.abs(py) - hy;
  const qz = Math.abs(pz) - hz;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0);
}

/**
 * Distance to one segment of a tube chain, with the cross-section's vertical
 * semi-axis scaled to a circle first. Scaling is EXACT for the inside test
 * (the point is inside the ellipse iff the scaled point is inside the circle);
 * only the magnitude outside is approximate, which is visible solely through
 * the smooth-blend falloff.
 *
 * `bore` clips the solid to the half above the chain line, which is precisely
 * a cave bore's horseshoe: a tube arcing over a valley then cuts the ground it
 * passes THROUGH and never the ground beneath it.
 */
function tubeSegmentSdf(
  a: TerrainCutNode,
  b: TerrainCutNode,
  x: number,
  y: number,
  z: number,
  bore: boolean,
): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  let t = 0;
  if (len2 > 1e-9) t = clamp(((x - a.x) * abx + (z - a.z) * abz) / len2, 0, 1);
  const cx = a.x + abx * t;
  const cz = a.z + abz * t;
  const cy = a.y + (b.y - a.y) * t;
  const r = a.radius + (b.radius - a.radius) * t;
  if (r <= 0) return Number.POSITIVE_INFINITY;
  const vyA = a.vy ?? a.radius;
  const vyB = b.vy ?? b.radius;
  const vy = Math.max(1e-3, vyA + (vyB - vyA) * t);
  const dy = y - cy;
  // Squash the vertical axis onto the lateral one, then it is a plain capsule.
  const d = Math.hypot(x - cx, (dy * r) / vy, z - cz) - r;
  return bore ? Math.max(d, cy - y) : d;
}

/**
 * Signed distance to ONE cut. Negative inside the solid, zero on its surface.
 * An absent `shape` is a sphere, so every v1 document evaluates unchanged.
 */
export function cutSdfAt(cut: TerrainCut, x: number, y: number, z: number): number {
  switch (cut.shape) {
    case 'box': {
      toLocal(cut, x, y, z, local);
      const hx = cut.halfX ?? cut.radius;
      const hy = cut.halfY ?? cut.radius;
      const hz = cut.halfZ ?? cut.radius;
      return boxSdf(local[0], local[1], local[2], hx, hy, hz) + warpAt(cut, x, y, z);
    }
    case 'capsule': {
      // A capsule's rotX is its axis DIP, not a roll: yaw sets the heading,
      // then the axis pitches out of the horizontal by rotX, which is what
      // lets one solid bore a descending tunnel into a hillside. (A roll
      // about a capsule's own axis is invisible for a circular section and
      // near-invisible for the squashed one, so the slider was wasted on it.)
      let px = x - cut.x;
      let py = y - cut.y;
      let pz = z - cut.z;
      const ry = cut.rotY ?? 0;
      if (ry !== 0) {
        const c = Math.cos(-ry);
        const s = Math.sin(-ry);
        const nx = px * c - pz * s;
        pz = px * s + pz * c;
        px = nx;
      }
      const rx = cut.rotX ?? 0;
      if (rx !== 0) {
        // Dip about the local Z axis: positive rotX sinks the local +X end.
        const c = Math.cos(rx);
        const s = Math.sin(rx);
        const nx = px * c - py * s;
        py = px * s + py * c;
        px = nx;
      }
      const half = Math.max(0, cut.len ?? 0);
      // FORK: bend (horizontal) and arch (vertical) curve the axis by rotating
      // the local point about the axis origin in proportion to its reach
      // along X: a total turn of `bend` radians over the half length.
      const bend = cut.bend ?? 0;
      const arch = cut.arch ?? 0;
      if (bend !== 0 || arch !== 0) {
        const reach = Math.max(1, half);
        if (bend !== 0) {
          const a = (bend * px) / reach;
          const c = Math.cos(a);
          const s = Math.sin(a);
          const nx = c * px - s * pz;
          pz = s * px + c * pz;
          px = nx;
        }
        if (arch !== 0) {
          const a = (arch * px) / reach;
          const c = Math.cos(a);
          const s = Math.sin(a);
          const nx = c * px - s * py;
          py = s * px + c * py;
          px = nx;
        }
      }
      const u = clamp(px, -half, half);
      const ax = px - u;
      const vert = Math.max(1e-3, cut.vert ?? 1);
      // FORK: radius variance along the length: taper toward the ends and a
      // periodic wobble, both multiplying the base radius.
      let r = cut.radius;
      const taper = cut.taper ?? 1;
      if (taper !== 1 && half > 0) r *= 1 + (taper - 1) * (Math.abs(u) / half);
      const wobble = cut.wobble ?? 0;
      if (wobble > 0) {
        const period = cut.wobbleLen ?? CUT_WOBBLE_LEN_DEFAULT;
        r *= 1 + wobble * Math.sin((u * Math.PI * 2) / Math.max(1e-3, period));
      }
      // Same squash as the tube: exact for inside/outside, smooth outside.
      return Math.hypot(ax, py / vert, pz) - r + warpAt(cut, x, y, z);
    }
    case 'tube': {
      const nodes = cut.nodes;
      if (!nodes || nodes.length === 0) return Number.POSITIVE_INFINITY;
      const bore = cut.bore === true;
      if (nodes.length === 1) {
        return tubeSegmentSdf(nodes[0], nodes[0], x, y, z, bore);
      }
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i + 1 < nodes.length; i++) {
        const d = tubeSegmentSdf(nodes[i], nodes[i + 1], x, y, z, bore);
        if (d < best) best = d;
      }
      return best;
    }
    case 'voxel':
      return voxelSdfAt(cut, x, y, z);
    default: {
      const dx = x - cut.x;
      const dy = y - cut.y;
      const dz = z - cut.z;
      return Math.hypot(dx, dy, dz) - cut.radius + warpAt(cut, x, y, z);
    }
  }
}

/**
 * Signed distance to the UNION of a cut list, smooth-blended by each cut's
 * own `blend` radius. Negative inside. An empty list is +Infinity (no cut
 * anywhere), which is what lets callers treat "no cuts" as the cheap path.
 */
export function cutsSdfAt(
  cuts: readonly TerrainCut[] | undefined,
  x: number,
  y: number,
  z: number,
): number {
  if (!cuts || cuts.length === 0) return Number.POSITIVE_INFINITY;
  let acc = Number.POSITIVE_INFINITY;
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const d = cutSdfAt(cut, x, y, z);
    acc = i === 0 ? d : smoothMin(acc, d, Math.max(0, cut.blend ?? 0));
  }
  return acc;
}

/**
 * The carve field: negative inside the CAVITY a cut union leaves in the
 * ground, positive in solid rock/air. Patches fill cavity back in (the
 * signed-distance spelling of "a patch beats every cut it overlaps"), so this
 * is the ONE field the sim's cavity floors, the chunk mesher's rim, and the
 * cavity interior mesh all sample. A cut the renderer honours and the sim
 * does not is an invisible wall; sharing this evaluator is what prevents it.
 */
export function carveFieldAt(
  cuts: readonly TerrainCut[] | undefined,
  patches: readonly TerrainCut[] | undefined,
  x: number,
  y: number,
  z: number,
): number {
  const d = cutsSdfAt(cuts, x, y, z);
  if (!patches || patches.length === 0) return d;
  return Math.max(d, -cutsSdfAt(patches, x, y, z));
}

/**
 * True when (x, z) lies inside the cut union, evaluated against the terrain
 * surface height at that point: the ground sheet is cut away there. A patch
 * cut (the Patch hole mode) wins over every cut: ground inside a patch is
 * restored even where cuts overlap it. Pure math shared by sim movement and
 * the mesher's dropped quads.
 *
 * This is the v1 `inTerrainHole` predicate, generalized. A document of
 * unblended spheres takes the same branch it always did.
 */
export function inTerrainCut(
  cuts: readonly TerrainCut[] | undefined,
  x: number,
  z: number,
  surfaceY: number,
  patches?: readonly TerrainCut[],
): boolean {
  if (!cuts || cuts.length === 0) return false;
  if (cutsSdfAt(cuts, x, surfaceY, z) >= 0) return false;
  if (!patches || patches.length === 0) return true;
  return cutsSdfAt(patches, x, surfaceY, z) >= 0;
}

/** Legacy name kept for v1 call sites and documents. */
export const inTerrainHole = inTerrainCut;

// ---------------------------------------------------------------------------
// Bounds. Conservative on purpose: they drive region rebuilds and chunk
// culling, where over-covering costs a little work and under-covering leaves
// a stale quad standing in mid air.
// ---------------------------------------------------------------------------

export interface CutBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Bounding rect of a cut's footprint (for render region rebuilds). */
export function cutBounds(cut: TerrainCut): CutBounds {
  if (cut.shape === 'voxel') {
    // The touched box, not the grid: the grid is a padded box that can be
    // many times the cave, and every reader (region rebuilds, the mesher's
    // tiles and cell budget, the walkable-floor near filter) wants the cave.
    const a = voxelAirBounds(cut);
    if (a) return { minX: a.minX, maxX: a.maxX, minZ: a.minZ, maxZ: a.maxZ };
    return { minX: cut.x, maxX: cut.x, minZ: cut.z, maxZ: cut.z };
  }
  if (cut.shape === 'tube' && cut.nodes && cut.nodes.length > 0) {
    let minX = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const n of cut.nodes) {
      minX = Math.min(minX, n.x - n.radius);
      maxX = Math.max(maxX, n.x + n.radius);
      minZ = Math.min(minZ, n.z - n.radius);
      maxZ = Math.max(maxZ, n.z + n.radius);
    }
    const pad = Math.max(0, cut.blend ?? 0);
    return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
  }
  // Sphere, box and capsule all fit inside a circle of this radius about the
  // centre, whatever their rotation, so one expression covers every case.
  let reach = cut.radius;
  if (cut.shape === 'box') {
    reach = Math.hypot(cut.halfX ?? cut.radius, cut.halfY ?? cut.radius, cut.halfZ ?? cut.radius);
  } else if (cut.shape === 'capsule') {
    reach = cut.radius * Math.max(1, cut.vert ?? 1) + Math.max(0, cut.len ?? 0);
  }
  reach += Math.max(0, cut.blend ?? 0) + shapeReach(cut);
  return {
    minX: cut.x - reach,
    maxX: cut.x + reach,
    minZ: cut.z - reach,
    maxZ: cut.z + reach,
  };
}

/** Legacy name kept for v1 call sites. */
export const holeBounds = cutBounds;

/** Vertical extent of a cut, for the mesher's per-chunk early reject. */
export function cutVerticalBounds(cut: TerrainCut): { minY: number; maxY: number } {
  if (cut.shape === 'voxel') {
    const a = voxelAirBounds(cut);
    return a ? { minY: a.minY, maxY: a.maxY } : { minY: cut.y, maxY: cut.y };
  }
  if (cut.shape === 'tube' && cut.nodes && cut.nodes.length > 0) {
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const n of cut.nodes) {
      const vy = n.vy ?? n.radius;
      minY = Math.min(minY, cut.bore === true ? n.y : n.y - vy);
      maxY = Math.max(maxY, n.y + vy);
    }
    const pad = Math.max(0, cut.blend ?? 0);
    return { minY: minY - pad, maxY: maxY + pad };
  }
  let reach = cut.radius;
  if (cut.shape === 'box') {
    reach = Math.hypot(cut.halfX ?? cut.radius, cut.halfY ?? cut.radius, cut.halfZ ?? cut.radius);
  } else if (cut.shape === 'capsule') {
    // The section's own reach, plus the vertical throw of a DIPPED axis
    // (rotX pitches a capsule's axis; see cutSdfAt).
    reach =
      cut.radius * Math.max(1, cut.vert ?? 1) +
      Math.max(0, cut.len ?? 0) *
        Math.min(1, Math.abs(Math.sin(cut.rotX ?? 0)) + Math.abs(cut.arch ?? 0));
  }
  reach += Math.max(0, cut.blend ?? 0) + shapeReach(cut);
  return { minY: cut.y - reach, maxY: cut.y + reach };
}

/**
 * Union of the vertical bounds of every cut whose FOOTPRINT reaches (x, z),
 * or null when none does. This is the y-range a cavity floor search has to
 * scan; a point outside every footprint has no cavity and costs one rect
 * test per cut.
 */
export function cutsVerticalRangeAt(
  cuts: readonly TerrainCut[] | undefined,
  x: number,
  z: number,
): { minY: number; maxY: number } | null {
  if (!cuts || cuts.length === 0) return null;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const cut of cuts) {
    const b = cutBounds(cut);
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    const v = cutVerticalBounds(cut);
    if (v.minY < minY) minY = v.minY;
    if (v.maxY > maxY) maxY = v.maxY;
  }
  return maxY >= minY ? { minY, maxY } : null;
}

/** True when a cut's footprint can touch the given XZ rect at all. */
export function cutTouchesRect(
  cut: TerrainCut,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): boolean {
  const b = cutBounds(cut);
  return b.maxX >= minX && b.minX <= maxX && b.maxZ >= minZ && b.minZ <= maxZ;
}

/** The subset of `cuts` whose footprint can touch the rect, or null when none
 *  do. Returning null (rather than an empty array) lets the mesher keep its
 *  existing "no cuts" fast path with one identity check. */
export function cutsInRect(
  cuts: readonly TerrainCut[] | undefined,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): TerrainCut[] | null {
  if (!cuts || cuts.length === 0) return null;
  const hit: TerrainCut[] = [];
  for (const cut of cuts) {
    if (cutTouchesRect(cut, minX, minZ, maxX, maxZ)) hit.push(cut);
  }
  return hit.length > 0 ? hit : null;
}

// ---------------------------------------------------------------------------
// Sanitizing. Authoring and map_doc share one body so a hand-written document
// and a maker's click can never author different bounds.
// ---------------------------------------------------------------------------

function sanitizeCutNode(v: unknown): TerrainCutNode | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const x = Number(o.x);
  const y = Number(o.y);
  const z = Number(o.z);
  const radius = Number(o.radius);
  if (!finite(x) || !finite(y) || !finite(z) || !finite(radius)) return null;
  const node: TerrainCutNode = {
    x,
    y: clamp(y, -500, 500),
    z,
    radius: clamp(radius, HOLE_MIN_RADIUS, HOLE_MAX_RADIUS),
  };
  const vy = Number(o.vy);
  if (finite(vy)) node.vy = clamp(vy, HOLE_MIN_RADIUS, HOLE_MAX_RADIUS);
  return node;
}

/**
 * Sanitize one cut off an untrusted map: finite centre, clamped radius, a
 * known shape (absent stays absent, which reads as a sphere), or null when
 * unusable. A `tube` whose node chain does not survive degrades to its
 * sphere, so a corrupt chain leaves a small opening rather than nothing.
 */
export function sanitizeTerrainCut(v: unknown): TerrainCut | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const x = Number(o.x);
  const y = Number(o.y);
  const z = Number(o.z);
  const radius = Number(o.radius);
  if (!finite(x) || !finite(y) || !finite(z) || !finite(radius)) return null;
  const out: TerrainCut = {
    x,
    y: clamp(y, -500, 500),
    z,
    radius: clamp(radius, HOLE_MIN_RADIUS, HOLE_MAX_RADIUS),
  };
  const shape = o.shape;
  if (typeof shape === 'string' && (TERRAIN_CUT_SHAPES as readonly string[]).includes(shape)) {
    if (shape !== 'sphere') out.shape = shape as TerrainCut['shape'];
  }
  if (finite(Number(o.rotY))) out.rotY = Number(o.rotY);
  if (finite(Number(o.rotX))) out.rotX = Number(o.rotX);
  if (finite(Number(o.blend))) out.blend = clamp(Number(o.blend), 0, CUT_MAX_BLEND);
  if (o.carve === true) out.carve = true;
  // Carve interior texture: an opaque set key (validated against the texture
  // library at render time) and its tiling period.
  if (typeof o.tex === 'string' && o.tex.length > 0 && o.tex.length <= 64) out.tex = o.tex;
  if (finite(Number(o.texTile))) out.texTile = clamp(Number(o.texTile), 1, 64);
  // FORK: organic shaping dials (absent = the exact primitive).
  const warp = Number(o.warp);
  if (finite(warp) && warp > 0) out.warp = clamp(warp, 0, CUT_MAX_WARP);
  const warpScale = Number(o.warpScale);
  if (finite(warpScale)) out.warpScale = clamp(warpScale, CUT_WARP_SCALE_MIN, CUT_WARP_SCALE_MAX);
  if (out.shape === 'box') {
    for (const key of ['halfX', 'halfY', 'halfZ'] as const) {
      const h = Number(o[key]);
      if (finite(h)) out[key] = clamp(h, CUT_MIN_HALF, CUT_MAX_HALF);
    }
  }
  if (out.shape === 'capsule') {
    const len = Number(o.len);
    if (finite(len)) out.len = clamp(len, 0, CUT_MAX_HALF);
    const vert = Number(o.vert);
    if (finite(vert)) out.vert = clamp(vert, 0.1, 8);
    const taper = Number(o.taper);
    if (finite(taper) && taper !== 1) out.taper = clamp(taper, CUT_TAPER_MIN, CUT_TAPER_MAX);
    const wobble = Number(o.wobble);
    if (finite(wobble) && wobble > 0) out.wobble = clamp(wobble, 0, CUT_MAX_WOBBLE);
    const wobbleLen = Number(o.wobbleLen);
    if (finite(wobbleLen)) out.wobbleLen = clamp(wobbleLen, CUT_WOBBLE_LEN_MIN, CUT_WOBBLE_LEN_MAX);
    const bend = Number(o.bend);
    if (finite(bend) && bend !== 0) out.bend = clamp(bend, -CUT_MAX_BEND, CUT_MAX_BEND);
    const arch = Number(o.arch);
    if (finite(arch) && arch !== 0) out.arch = clamp(arch, -CUT_MAX_ARCH, CUT_MAX_ARCH);
  }
  if (out.shape === 'voxel') {
    const cell = Number(o.cell);
    const nx = Number(o.nx);
    const ny = Number(o.ny);
    const nz = Number(o.nz);
    const vx0 = Number(o.vx0);
    const vy0 = Number(o.vy0);
    const vz0 = Number(o.vz0);
    const dimsOk = [nx, ny, nz].every((n) => Number.isInteger(n) && n >= 1 && n <= VOXEL_MAX_DIM);
    if (
      !finite(cell) ||
      !dimsOk ||
      nx * ny * nz > VOXEL_MAX_CELLS ||
      !finite(vx0) ||
      !finite(vy0) ||
      !finite(vz0) ||
      typeof o.vox !== 'string'
    ) {
      return null;
    }
    out.cell = clamp(cell, VOXEL_CELL_MIN, VOXEL_CELL_MAX);
    out.nx = nx;
    out.ny = ny;
    out.nz = nz;
    out.vx0 = vx0;
    out.vy0 = vy0;
    out.vz0 = vz0;
    out.vox = o.vox;
    out.carve = true;
    // Centre + half-diagonal, so radius-based rect readers still cover it.
    out.x = vx0 + (nx * out.cell) / 2;
    out.y = clamp(vy0 + (ny * out.cell) / 2, -500, 500);
    out.z = vz0 + (nz * out.cell) / 2;
    out.radius = clamp(
      Math.hypot(nx * out.cell, ny * out.cell, nz * out.cell) / 2,
      HOLE_MIN_RADIUS,
      HOLE_MAX_RADIUS * 8,
    );
    return out;
  }
  if (out.shape === 'tube') {
    const raw = Array.isArray(o.nodes) ? o.nodes.slice(0, MAX_CUT_NODES) : [];
    const nodes: TerrainCutNode[] = [];
    for (const n of raw) {
      const node = sanitizeCutNode(n);
      if (node) nodes.push(node);
    }
    if (nodes.length > 0) {
      out.nodes = nodes;
      if (o.bore === true) out.bore = true;
    } else {
      // No usable chain: fall back to the sphere the centre already describes.
      out.shape = undefined;
    }
  }
  return out;
}

/** Legacy name kept for v1 call sites. */
export const sanitizeTerrainHole = sanitizeTerrainCut;
