// Pure plan for the Smith's Heart's mountain rock: jagged spires, crags and
// broken slabs rising out of the fissures' depth along the field's OUTER
// cliff edges, so each vein reads as an open crack inside Stormcrag, the Ring
// as a gallery round the seal's chasm, and the Heart as a vast chamber inside
// the mountain, open to the sky. Render only (no collider): the field's own
// cliff colliders already hold every lip.
//
// Rules the plan keeps (pinned by tests/smith_heart_render_core.test.ts):
//   - every block, its lean included, stands at least HEART_WALL_CLEAR yards
//     from any walkable floor (HEART_WALL_PATH_CLEAR beside a narrow path),
//     so a third-person camera behind a player at a lip is never inside rock;
//   - the rock starts LOW by the walks and climbs as it recedes (a slope of
//     scree and broken teeth below the mountain's real walls), so a camera
//     20 to 25 yd back sees over the near teeth;
//   - each block is irregular: one of three faceted shapes (heartRockShape),
//     squashed across, turned, and leaning OUT, away from the floor it faces;
//   - the chasm round the Seal Dais stays open: no block enters the disc
//     inside the Ring's inner edge, so the seal is in sight from every point
//     of the Ring; the Wind Bridge's gulf, the great hearth's mouth and the
//     Heart's chasm round the Anvil of the World stay open too;
//   - each room's rock has its own scale: the Storm Cornice is a summit, so
//     its crags stay low and the sky stays open round it; the Heart is a
//     chamber inside the mountain, so its crown is deeper and taller, and
//     no line of sight crosses from the main map into it.
//
// Three-free, DOM-free, deterministic (hashed jitter, no rng).

import {
  BREATH,
  GREAT_HEARTH,
  HEART_ROOM,
  HEART_ROOM_CHASM_R,
  inSmithHeartRoom,
  RING,
  SMITH_HEART_FIELD,
  WIND_BRIDGE,
} from '../../sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import { heartHash } from './heart_plan_core';

/** One rock block: shape `variant` (heartRockShape) scaled to `rx` x `rz`
 *  across at its foot (its unit radius), from `base` to `top`, turned by
 *  `yaw`, its top sheared by (`leanX`, `leanZ`) yards. Instance-local. */
export interface HeartWallBlock {
  x: number;
  z: number;
  base: number;
  top: number;
  rx: number;
  rz: number;
  yaw: number;
  leanX: number;
  leanZ: number;
  variant: number;
}

/** How far any block stays from walkable floor (yards). */
export const HEART_WALL_CLEAR = 8;
/** ... and beside a narrow path (a stair, a ramp, a bridge). */
export const HEART_WALL_PATH_CLEAR = 10.5;
/** How far past the clearance the rock reaches (yards of void covered). */
export const HEART_WALL_BAND = 30;
/** How far past the clearance the loose crags stand (the mountain beyond). */
export const HEART_WALL_TEETH = 14;
/** ... round the Heart, whose crown is deeper (a chamber in the mountain). */
export const HEART_ROOM_WALL_BAND = 44;
/** The Heart's crown climbs this much taller than the veins' rock. */
export const HEART_ROOM_WALL_SCALE = 1.25;
/** The Storm Cornice's crags stay this low (a summit open to the sky). */
export const CORNICE_WALL_SCALE = 0.42;
/** The largest foot radius. */
export const HEART_WALL_MAX_R = 11;
/** The number of rock shapes. */
export const HEART_ROCK_VARIANTS = 3;
const MIN_R = 1.4;
/** The distance field's cell (yards). */
const CELL = 2;
/** The Wind Bridge's chasm: no block within this of the arch's span. */
const BRIDGE_CLEAR = 22;
/** The great hearth's mouth: no block within this box (behind the forge's
 *  west wall, where the hearth stands in the rock). */
const HEARTH_BOX = {
  x0: GREAT_HEARTH.x - 16,
  x1: GREAT_HEARTH.x + 8,
  halfZ: GREAT_HEARTH.halfWidth + 6,
};

interface DistanceField {
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  /** Distance to the nearest walkable cell centre (yards). */
  dist: Float32Array;
  /** Index of that nearest walkable cell. */
  nearest: Int32Array;
  /** Floor height of the walkable cells (void elsewhere). */
  height: Float32Array;
  /** 1 where the walkable cell belongs to a path surface. */
  path: Uint8Array;
}

let cachedField: DistanceField | null = null;

/** Chamfer distance from every cell to the nearest walkable cell, carrying
 *  that cell's index along. Built once (the layout is static). */
function distanceField(): DistanceField {
  if (cachedField) return cachedField;
  const def = SMITH_HEART_FIELD;
  const pad = HEART_WALL_PATH_CLEAR + HEART_ROOM_WALL_BAND + HEART_WALL_MAX_R + 8;
  const x0 = def.bounds.minX - pad;
  const z0 = def.bounds.minZ - pad;
  const nx = Math.ceil((def.bounds.maxX + pad - x0) / CELL) + 1;
  const nz = Math.ceil((def.bounds.maxZ + pad - z0) / CELL) + 1;
  const dist = new Float32Array(nx * nz).fill(Number.POSITIVE_INFINITY);
  const nearest = new Int32Array(nx * nz).fill(-1);
  const height = new Float32Array(nx * nz).fill(def.voidHeight);
  const path = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * CELL;
      const z = z0 + j * CELL;
      const s = authoredFieldSurfaceAt(def, x, z);
      if (!s) continue;
      const k = j * nx + i;
      dist[k] = 0;
      nearest[k] = k;
      height[k] = authoredFieldHeight(def, x, z);
      path[k] = s.kind === 'path' ? 1 : 0;
    }
  }
  const diag = CELL * Math.SQRT2;
  const relax = (k: number, from: number, step: number) => {
    const d = dist[from] + step;
    if (d < dist[k]) {
      dist[k] = d;
      nearest[k] = nearest[from];
    }
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i > 0) relax(k, k - 1, CELL);
      if (j > 0) {
        relax(k, k - nx, CELL);
        if (i > 0) relax(k, k - nx - 1, diag);
        if (i < nx - 1) relax(k, k - nx + 1, diag);
      }
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (i < nx - 1) relax(k, k + 1, CELL);
      if (j < nz - 1) {
        relax(k, k + nx, CELL);
        if (i < nx - 1) relax(k, k + nx + 1, diag);
        if (i > 0) relax(k, k + nx - 1, diag);
      }
    }
  }
  cachedField = { x0, z0, nx, nz, dist, nearest, height, path };
  return cachedField;
}

export interface HeartClearance {
  /** Conservative distance to the nearest walkable floor (yards). */
  d: number;
  /** That floor's height. */
  floor: number;
  /** Is that floor a path (a stair, a ramp, a bridge)? */
  path: boolean;
  /** Unit direction from the point toward that floor (xz). */
  toX: number;
  toZ: number;
}

/** Distance from (x, z) to the nearest walkable floor, conservative: the
 *  straight distance to the field's nearest walkable cell centre (smooth as
 *  the point moves, so the mountain's slopes never step) less a cell's
 *  half-diagonal and a cell (the floor's own edge can lie that much nearer
 *  than its nearest cell centre). */
export function heartFloorClearance(x: number, z: number): HeartClearance {
  const f = distanceField();
  const i = Math.round((x - f.x0) / CELL);
  const j = Math.round((z - f.z0) / CELL);
  const none = {
    d: Number.POSITIVE_INFINITY,
    floor: SMITH_HEART_FIELD.voidHeight,
    path: false,
    toX: 0,
    toZ: 1,
  };
  if (i < 0 || j < 0 || i >= f.nx || j >= f.nz) return none;
  const k = j * f.nx + i;
  const n = f.nearest[k];
  if (n < 0) return none;
  const fx = f.x0 + (n % f.nx) * CELL;
  const fz = f.z0 + Math.floor(n / f.nx) * CELL;
  const straight = Math.hypot(fx - x, fz - z);
  const len = straight || 1;
  return {
    d: Math.max(0, Math.min(f.dist[k], straight) - CELL * 1.5),
    floor: f.height[n],
    path: f.path[n] === 1,
    toX: (fx - x) / len,
    toZ: (fz - z) / len,
  };
}

/** A slow swell in [0, 1] along the walls (bilinear over a 46 yd lattice of
 *  hashed heights): the crown's ridge line. */
export function heartRidgeNoise(x: number, z: number): number {
  const s = 46;
  const gx = Math.floor(x / s);
  const gz = Math.floor(z / s);
  const fx = x / s - gx;
  const fz = z / s - gz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = heartHash(gx, gz);
  const b = heartHash(gx + 1, gz);
  const c = heartHash(gx, gz + 1);
  const d = heartHash(gx + 1, gz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Distance from a point to a segment (2D). */
function segmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Is the disc at (x, z) of radius r inside an area that stays open air? */
export function heartOpenAir(x: number, z: number, r: number): boolean {
  // The chasm round the Seal Dais: inside the Ring's inner edge, all open.
  if (Math.hypot(x - RING.x, z - RING.z) - r < RING.innerR) return true;
  // The Wind Bridge's gulf.
  if (
    segmentDistance(x, z, WIND_BRIDGE.fromX, WIND_BRIDGE.fromZ, WIND_BRIDGE.toX, WIND_BRIDGE.toZ) -
      r <
    BRIDGE_CLEAR
  ) {
    return true;
  }
  // The great hearth's mouth.
  if (
    x + r > HEARTH_BOX.x0 &&
    x - r < HEARTH_BOX.x1 &&
    Math.abs(z - GREAT_HEARTH.z) - r < HEARTH_BOX.halfZ
  ) {
    return true;
  }
  // The Heart's chasm, down to the glowing heart under the platform.
  if (Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z) - r < HEART_ROOM_CHASM_R) return true;
  return false;
}

/** The rock's own scale round (x, z): how far it reaches past the clearance
 *  and how tall it climbs (the Cornice low, the Heart's crown tall). */
export function heartWallScale(
  x: number,
  z: number,
  floor: number,
): { band: number; tall: number } {
  if (inSmithHeartRoom(x, z)) return { band: HEART_ROOM_WALL_BAND, tall: HEART_ROOM_WALL_SCALE };
  if (floor >= BREATH.cornice.h - 0.5) return { band: HEART_WALL_BAND, tall: CORNICE_WALL_SCALE };
  return { band: HEART_WALL_BAND, tall: 1 };
}

/** The horizontal radius that bounds a whole block (its lean included). */
export function heartWallReach(b: HeartWallBlock): number {
  return Math.max(b.rx, b.rz) + Math.hypot(b.leanX, b.leanZ);
}

/**
 * Every rock block, on a jittered grid of `spacing` yards (the low tier
 * passes a wider spacing: a cosmetic shed; what stays open stays open on
 * every tier).
 */
export function planHeartWalls(spacing = 5): HeartWallBlock[] {
  const def = SMITH_HEART_FIELD;
  const out: HeartWallBlock[] = [];
  const pad = HEART_WALL_PATH_CLEAR + HEART_ROOM_WALL_BAND;
  const i0 = Math.floor((def.bounds.minX - pad) / spacing);
  const i1 = Math.ceil((def.bounds.maxX + pad) / spacing);
  const j0 = Math.floor((def.bounds.minZ - pad) / spacing);
  const j1 = Math.ceil((def.bounds.maxZ + pad) / spacing);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const jx = (heartHash(i, j) - 0.5) * spacing * 0.7;
      const jz = (heartHash(j + 7919, i - 104729) - 0.5) * spacing * 0.7;
      const x = i * spacing + jx;
      const z = j * spacing + jz;
      const c = heartFloorClearance(x, z);
      const clear = c.path ? HEART_WALL_PATH_CLEAR : HEART_WALL_CLEAR;
      const back = c.d - clear;
      const scale = heartWallScale(x, z, c.floor);
      if (back < 0 || back > scale.band) continue;
      const h1 = heartHash(i * 31 + 5, j * 17 - 3);
      const h2 = heartHash(i - 11, j + 13);
      const h3 = heartHash(i + 101, j * 7 + 1);
      // The blocks are the teeth and crags at the mountain's foot, by the
      // walks; the mountain itself (heart_mountain_core.ts) is the mass.
      if (back > HEART_WALL_TEETH) continue;
      // Small teeth by the walks, broad crags behind.
      const want = Math.min(HEART_WALL_MAX_R, 2.2 + back * 0.36 + h1 * 2);
      // Past the veins' band the climb turns linear (the Heart's deep crown).
      const b = Math.min(back, HEART_WALL_BAND) + Math.max(0, back - HEART_WALL_BAND) * 0.6;
      // The ridge line: a slow swell along the walls (so the crown reads as
      // one mountain, never a skyline of equal spires) and a small jag.
      const ridge = 0.62 + 0.76 * heartRidgeNoise(x, z);
      const height = ((2 + 0.04 * b * b + b * 0.6) * ridge + h2 * (2 + b * 0.25)) * scale.tall;
      // Lean: the top lies out, away from the floor it faces.
      const lean = Math.min(0.12, 0.04 + h3 * 0.08) * height;
      // The whole block (lean included) keeps its clearance.
      const r = Math.min(want, back - lean);
      if (r < MIN_R) continue;
      const reach = r + lean;
      if (heartOpenAir(x, z, reach)) continue;
      out.push({
        x,
        z,
        base: def.voidHeight - 2,
        top: c.floor + height,
        rx: r,
        rz: r * (0.72 + h2 * 0.28),
        yaw: h3 * Math.PI * 2,
        leanX: -c.toX * lean,
        leanZ: -c.toZ * lean,
        // The single-tip spire only as a tooth by the walks; behind, the
        // crowned crags and the split slabs (a mountain, not a skyline).
        variant:
          back < 10
            ? Math.floor(h1 * HEART_ROCK_VARIANTS) % HEART_ROCK_VARIANTS
            : 1 + (Math.floor(h1 * 2) % 2),
      });
    }
  }
  return out;
}

// ---- the rock shapes ------------------------------------------------------------------

/**
 * One rock shape as flat triangles (xyz, outward wound), in a unit frame:
 * y from 0 (its foot) to 1 (its highest tip), every vertex within radius 1
 * of the axis, the foot ring the widest. Variant 0 is a jagged spire with an
 * off-centre tip, 1 a crag with a broken, slanted crown of teeth, 2 a split
 * slab with an oblique top. Deterministic.
 */
export function heartRockShape(variant: number): number[] {
  const v = ((variant % HEART_ROCK_VARIANTS) + HEART_ROCK_VARIANTS) % HEART_ROCK_VARIANTS;
  const sides = v === 2 ? 4 : v === 1 ? 7 : 6;
  // Rings (height, radius scale) up the shape, then the crown. Phase 2D:
  // the upper body (the part that stands over the floors) steps in at a few
  // bedding ledges, each a shelf the low sun catches, instead of one smooth
  // taper (2C's crags read as tall flat card slabs beside the Gallery).
  const rings: [number, number][] =
    v === 0
      ? [
          [0, 1],
          [0.4, 0.9],
          [0.55, 0.82],
          [0.556, 0.72],
          [0.66, 0.67],
          [0.75, 0.58],
          [0.756, 0.48],
          [0.8, 0.45],
        ]
      : v === 1
        ? [
            [0, 1],
            [0.36, 0.93],
            [0.46, 0.88],
            [0.466, 0.79],
            [0.58, 0.76],
          ]
        : [
            [0, 1],
            [0.38, 0.95],
            [0.5, 0.92],
            [0.506, 0.84],
            [0.6, 0.8],
          ];
  const ringPts: [number, number, number][][] = rings.map(([y, s], ri) => {
    const pts: [number, number, number][] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + (v === 2 ? Math.PI / 4 : 0);
      const jr = 0.8 + heartHash(v * 97 + ri * 13, k) * 0.2;
      const rr = Math.min(1, s * (ri === 0 ? Math.max(0.86, jr) : jr));
      const jy = ri === 0 ? 0 : (heartHash(k + 7, v * 5 + ri) - 0.5) * 0.008;
      pts.push([Math.cos(a) * rr, y + jy, Math.sin(a) * rr]);
    }
    return pts;
  });
  const tris: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => tris.push(...a, ...b, ...c);
  for (let ri = 0; ri < ringPts.length - 1; ri++) {
    const lo = ringPts[ri];
    const hi = ringPts[ri + 1];
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      tri(lo[k], hi[k], lo[k1]);
      tri(lo[k1], hi[k], hi[k1]);
    }
  }
  const top = ringPts[ringPts.length - 1];
  if (v === 0) {
    // A single off-centre tip.
    const apex = [0.12, 1, -0.08];
    for (let k = 0; k < sides; k++) tri(top[k], apex, top[(k + 1) % sides]);
  } else if (v === 1) {
    // A crown of teeth: every other rim vertex thrust up, a low centre.
    const teeth = top.map((p, k) => {
      const tall = k % 2 === 0 ? 0.88 + heartHash(k, 3) * 0.12 : p[1] + 0.08;
      return [p[0] * 0.8, Math.min(1, tall), p[2] * 0.8];
    });
    const centre = [0.05, 0.62, 0.02];
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      tri(top[k], teeth[k], top[k1]);
      tri(top[k1], teeth[k], teeth[k1]);
      tri(teeth[k], centre, teeth[k1]);
    }
  } else {
    // An oblique break: the crown rises from one face to the opposite.
    const crown = top.map((p) => [p[0] * 0.85, Math.min(1, 0.68 + (p[0] + 1) * 0.16), p[2] * 0.85]);
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      tri(top[k], crown[k], top[k1]);
      tri(top[k1], crown[k], crown[k1]);
    }
    tri(crown[0], crown[2], crown[1]);
    tri(crown[0], crown[3], crown[2]);
  }
  return tris;
}
