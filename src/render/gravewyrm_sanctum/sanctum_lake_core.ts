// Pure plan for the Wyrm's Hollow (design sections 4 and 6.3): the frozen
// lake's nineteen plates as the Voronoi cells of LAKE_PLATES clipped to the
// lake's circle (a point belongs to the nearest plate centre, so every seam
// lies exactly on a bisector and phase B's plate floor owns what is drawn),
// the pressure ridges along those seams, the render-only apron of old lake
// ice that runs north from the shelf to the foot of the Calving Face, the
// calved blocks frozen into it, and the ripple's timing.
//
// Three-free, DOM-free, deterministic (hash jitter, never Math.random).

import { LAKE_PLATES, WYRMS_HOLLOW } from '../../sim/content/gravewyrm_sanctum_layout';
import { sanctumFloorAt, sanctumHash, sanctumNoise } from './sanctum_plan_core';

export type Pt = readonly [number, number];

/** Segments of the lake circle the clipping starts from (a fine polygon, so
 *  the outer plates' rims read round). */
export const LAKE_CIRCLE_SEGMENTS = 128;

export interface LakeCell {
  /** Index into LAKE_PLATES. */
  index: number;
  id: string;
  cx: number;
  cz: number;
  /** The cell's outline (counter-clockwise in x, z), instance-local. */
  poly: Pt[];
}

/** Clip a convex polygon to the half-plane `nx * x + nz * z <= c`. */
function clipHalfPlane(poly: readonly Pt[], nx: number, nz: number, c: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = a[0] * nx + a[1] * nz - c;
    const db = b[0] * nx + b[1] * nz - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

let cells: LakeCell[] | null = null;

/** The nineteen plate cells (cached; the layout is constant). */
export function planLakeCells(): readonly LakeCell[] {
  if (cells) return cells;
  const { x: lx, z: lz, lakeR } = WYRMS_HOLLOW;
  const circle: Pt[] = [];
  for (let i = 0; i < LAKE_CIRCLE_SEGMENTS; i++) {
    const a = (i / LAKE_CIRCLE_SEGMENTS) * Math.PI * 2;
    circle.push([lx + Math.cos(a) * lakeR, lz + Math.sin(a) * lakeR]);
  }
  cells = LAKE_PLATES.map((p, index) => {
    let poly: Pt[] = circle;
    for (const [j, q] of LAKE_PLATES.entries()) {
      if (j === index) continue;
      // Nearer to p than to q: (q - p) . x <= (|q|^2 - |p|^2) / 2.
      const nx = q.x - p.x;
      const nz = q.z - p.z;
      const c = (q.x * q.x + q.z * q.z - p.x * p.x - p.z * p.z) / 2;
      poly = clipHalfPlane(poly, nx, nz, c);
    }
    return { index, id: p.id, cx: p.x, cz: p.z, poly };
  });
  return cells;
}

/** The index of the plate that owns (x, z) (the nearest centre). */
export function lakePlateAt(x: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (const [i, p] of LAKE_PLATES.entries()) {
    const d = (x - p.x) ** 2 + (z - p.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** True when (x, z) lies inside a polygon (even-odd). */
export function pointInPoly(x: number, z: number, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export interface LakeSeam {
  /** The two plates the seam parts (a < b). */
  a: number;
  b: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/** Every seam between two plates: the shared edge of two cells (the outer
 *  rim on the lake's circle is not a seam). */
export function planLakeSeams(): LakeSeam[] {
  const out: LakeSeam[] = [];
  const list = planLakeCells();
  const { x: lx, z: lz, lakeR } = WYRMS_HOLLOW;
  for (const cell of list) {
    const n = cell.poly.length;
    for (let i = 0; i < n; i++) {
      const p = cell.poly[i];
      const q = cell.poly[(i + 1) % n];
      const mx = (p[0] + q[0]) / 2;
      const mz = (p[1] + q[1]) / 2;
      if (Math.hypot(mx - lx, mz - lz) > lakeR - 0.05) continue;
      // The neighbour across: the nearest other centre to the edge's middle.
      let other = -1;
      let bestD = Infinity;
      for (const [j, c] of LAKE_PLATES.entries()) {
        if (j === cell.index) continue;
        const d = Math.hypot(mx - c.x, mz - c.z);
        if (d < bestD) {
          bestD = d;
          other = j;
        }
      }
      if (other < 0 || other < cell.index) continue;
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.05) continue;
      out.push({ a: cell.index, b: other, ax: p[0], az: p[1], bx: q[0], bz: q[1] });
    }
  }
  return out;
}

/** Distance from (x, z) to the edge of its own plate (the nearest seam or the
 *  lake's rim), yards. The plate shader computes the same in GLSL. */
export function lakeEdgeDistance(x: number, z: number): number {
  const own = LAKE_PLATES[lakePlateAt(x, z)];
  const { x: lx, z: lz, lakeR } = WYRMS_HOLLOW;
  let d = lakeR - Math.hypot(x - lx, z - lz);
  const po = (x - own.x) ** 2 + (z - own.z) ** 2;
  for (const q of LAKE_PLATES) {
    if (q === own) continue;
    const len = Math.hypot(q.x - own.x, q.z - own.z);
    const qo = (x - q.x) ** 2 + (z - q.z) ** 2;
    d = Math.min(d, (qo - po) / (2 * len));
  }
  return d;
}

// ---- the pressure ridges ------------------------------------------------------------

/** The kit module's own length along x (Kit_PressureRidge, 18 yd). */
export const PRESSURE_RIDGE_MODULE = 18;
/** The ridges' drawn height scale: the kit module is 0.8 tall; the plates'
 *  ridges stay under a knee (about half a yard). */
export const PRESSURE_RIDGE_SCALE_Y = 0.65;

export interface RidgeSpot {
  x: number;
  z: number;
  /** Yaw so the module's x runs along the seam. */
  rot: number;
  /** Stretch along x (seam length over the module). */
  stretch: number;
  scaleY: number;
}

/** One ridge module per seam (and a sparse heave along the rim), centred on
 *  the seam, turned along it. The plates' height ladder stands them on 0. */
export function planPressureRidges(): RidgeSpot[] {
  const out: RidgeSpot[] = [];
  for (const [i, s] of planLakeSeams().entries()) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    if (len < 2) continue;
    out.push({
      x: (s.ax + s.bx) / 2,
      z: (s.az + s.bz) / 2,
      // The module's +x along (dx, dz): three's yaw turns +x to (cos, -sin).
      rot: Math.atan2(-(s.bz - s.az), s.bx - s.ax),
      stretch: Math.max(0.25, len / PRESSURE_RIDGE_MODULE),
      scaleY: PRESSURE_RIDGE_SCALE_Y * (0.8 + 0.4 * sanctumHash(i, 5)),
    });
  }
  return out;
}

// ---- the apron north to the Calving Face ---------------------------------------------

/** The Calving Face's front base (kit face frame origin, instance-local) and
 *  the half width of its arc: the face's foot is z = FACE_Z - 22 (x / 80)^2. */
export const FACE_FOOT_Z = 256;
export const FACE_HALF_WIDTH = 80;

/** The face's foot (instance-local z) at x. */
export function faceFootZ(x: number): number {
  const t = Math.min(1, Math.abs(x) / FACE_HALF_WIDTH);
  return FACE_FOOT_Z - 22 * t * t;
}

/** The apron's top (a little under the lake's top, never an arena). */
export const APRON_Y = -0.3;
/** How deep the apron's broken ice-shelf edge drops into the crevasse. */
export const APRON_SKIRT_DEPTH = 42;
/** The apron's grid cell (yards). */
export const APRON_CELL = 1.5;
/** The apron keeps this far from the shelf's walkable rim. */
const APRON_SHELF_CLEAR = WYRMS_HOLLOW.shelfR + 0.35;
const APRON_MIN_Z = WYRMS_HOLLOW.z - 6;

/** True when the apron covers (x, z): north of the lake's middle, outside
 *  the shelf, south of (and a little under) the face's foot, its ragged
 *  outer edge broken by noise. */
export function apronCovers(x: number, z: number): boolean {
  const { x: lx, z: lz } = WYRMS_HOLLOW;
  const wob = (sanctumNoise(x * 0.06, z * 0.06, 41, 2) - 0.5) * 9;
  if (Math.abs(x) > FACE_HALF_WIDTH + 4 + wob) return false;
  if (z < APRON_MIN_Z + wob * 0.8) return false;
  if (z > faceFootZ(x) + 3) return false;
  if (Math.hypot(x - lx, z - lz) < APRON_SHELF_CLEAR) return false;
  // Never over a walkable top (the lake and the shelf are clear of it above).
  return sanctumFloorAt(x, z) === null;
}

/** The apron's surface height at (x, z): the old lake ice, settled and
 *  heaved, rising a little into the debris at the face's foot. */
export function apronHeight(x: number, z: number): number {
  const heave = (sanctumNoise(x * 0.12, z * 0.12, 43, 3) - 0.5) * 0.5;
  const foot = Math.max(0, 1 - (faceFootZ(x) - z) / 10);
  return APRON_Y - 0.2 + heave + foot * foot * 1.2;
}

export interface ApronBlock {
  piece: 'Kit_IceChunkA' | 'Kit_IceChunkB' | 'Kit_IceChunkC';
  x: number;
  z: number;
  rot: number;
  scale: number;
}

/** Old calvings frozen into the apron: thicker toward the face's foot, sparse
 *  near the shelf, none on the stage-1 scar's foot (the plate that falls
 *  there lies flat in the lake: x near -46). */
export function planApronBlocks(lowGfx: boolean): ApronBlock[] {
  const out: ApronBlock[] = [];
  const n = lowGfx ? 70 : 150;
  const pieces = ['Kit_IceChunkA', 'Kit_IceChunkB', 'Kit_IceChunkC'] as const;
  for (let i = 0; out.length < n && i < n * 10; i++) {
    const x = (sanctumHash(i, 51) - 0.5) * 2 * (FACE_HALF_WIDTH + 2);
    const foot = faceFootZ(x);
    // Bunched toward the foot: a power of the hash.
    const back = sanctumHash(i, 53) ** 1.8 * 60;
    const z = foot - 1 - back;
    if (!apronCovers(x, z)) continue;
    if (Math.abs(x + 46) < 16 && foot - z < 22) continue;
    out.push({
      piece: pieces[Math.floor(sanctumHash(i, 55) * 3) % 3],
      x,
      z,
      rot: sanctumHash(i, 57) * Math.PI * 2,
      scale: 0.6 + sanctumHash(i, 59) * (back < 14 ? 1.0 : 0.5),
    });
  }
  return out;
}

// ---- the ripple ---------------------------------------------------------------------

/** The ripple: a ring of frost powder and glint racing across the lake ice. */
export const RIPPLE = {
  /** Seconds it lives. */
  life: 4.2,
  /** How far it runs (yards). */
  reach: 125,
} as const;

/** The ring's radius and strength `age` seconds after a trigger (0 when gone). */
export function rippleAt(age: number): { radius: number; strength: number } {
  if (age < 0 || age >= RIPPLE.life) return { radius: 0, strength: 0 };
  const t = age / RIPPLE.life;
  // Fast at first, slowing as it spreads (an ease out), fading to nothing.
  const radius = RIPPLE.reach * (1 - (1 - t) ** 1.8);
  const strength = (1 - t) ** 1.4 * Math.min(1, age / 0.15);
  return { radius, strength };
}
