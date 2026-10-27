// Pure plan for the Smith's Heart's mountain: one continuous faceted
// heightfield of rock round every floor, so each vein reads as a fissure cut
// into Stormcrag, the Ring as a gallery inside a crater, the Cornice as a
// summit and the Heart as a chamber deep in the mountain, open to the sky.
//
// Every grid point takes its height from its distance to the nearest walkable
// floor (heart_walls_core.ts heartFloorClearance): inside the clearance it is
// the chasm (no rock: the camera behind a player at a lip is never inside
// it), past it the rock rises from the chasm in a steep face and keeps
// climbing, its ridge line swelling slowly (heartRidgeNoise) with a finer jag
// on top. The open air the walls plan keeps (the chasm round the Seal Dais,
// the Wind Bridge's gulf, the great hearth's mouth, the Heart's chasm) stays
// chasm here too. Each room's own scale (heartWallScale) shapes it: the
// Cornice's rock stays low, the Heart's crown climbs tall and deep.
//
// A cell all of whose corners are chasm draws nothing, so the void stays
// bottomless; a cell with any rock corner draws its slope down into the
// chasm, so the mountain has no hole at any edge.
//
// Three-free, DOM-free, deterministic.

import { SMITH_HEART_FIELD } from '../../sim/content/smith_heart_layout';
import { hammerRockLift } from './heart_cliff_paint_core';
import {
  HEART_ROOM_WALL_BAND,
  HEART_WALL_BAND,
  HEART_WALL_CLEAR,
  HEART_WALL_PATH_CLEAR,
  heartFloorClearance,
  heartOpenAir,
  heartRidgeNoise,
  heartWallScale,
} from './heart_walls_core';

/** The chasm's depth under the rock (yards; under the field's void). */
export const HEART_MOUNTAIN_CHASM = SMITH_HEART_FIELD.voidHeight - 4;
/** How far inside the clearance the mountain's foot falls into the chasm
 *  (yards); it stays at least six yards under the floor it faces. */
export const HEART_MOUNTAIN_FOOT = 5;
/** How far back of its clearance line the mountain's slope begins to climb
 *  (yards; phase 2E). The rock kit's bands stand on contours of the
 *  clearance (heart_rock_plan_core.ts) with their faces leaning back as they
 *  rise: a slope climbing from the line itself buried the foot of every
 *  face, so the slope is pushed back by this much (a ledge behind the first
 *  band, every contour's slope lower under the band that skins it). */
export const HEART_MOUNTAIN_RECESS = 6;
/** How far under its floor the ledge in that recess lies (yards): under the
 *  walk's own lip, so the heightfield's foot never stands as a wall in
 *  front of the first band's faces. */
export const HEART_MOUNTAIN_LEDGE = 8;
/** How far past the field's bounds the mountain reaches (yards). */
const PAD = HEART_WALL_PATH_CLEAR + HEART_ROOM_WALL_BAND + 18;

export interface HeartMountainGrid {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  /** Height per grid point (row-major, z rows); HEART_MOUNTAIN_CHASM where
   *  there is no rock. */
  heights: Float32Array;
}

/** The rock's height over the floor `back` yards past its clearance. */
export function heartMountainRise(back: number, ridge: number, jag: number, band: number): number {
  const b =
    Math.min(back, HEART_WALL_BAND) +
    Math.max(0, Math.min(back, band) - HEART_WALL_BAND) * 0.6 +
    Math.max(0, back - band) * 0.25;
  return (3 + 0.035 * b * b + b * 0.75) * (0.6 + 0.8 * ridge) + jag * (2 + b * 0.3);
}

/** The Hammer vein's terrace step (yards back from the clearance) and the
 *  share of each step its sheer riser takes. */
export const HAMMER_TERRACE_STEP = 12;
export const HAMMER_TERRACE_RISER = 0.34;

/** Where `back` falls on the Hammer vein's stepped slope: the step's index
 *  and how far across it (0 at its ledge's outer lip, 1 at the top of its
 *  riser); the step's line wanders so no ledge runs ruled. */
export function heartHammerTerraceStep(
  back: number,
  x: number,
  z: number,
): { k: number; f: number } {
  const wander = (heartRidgeNoise(x * 2.3 - 57, z * 2.3 + 91) - 0.5) * HAMMER_TERRACE_STEP * 0.5;
  const b = Math.max(0, back) + wander + HAMMER_TERRACE_STEP;
  const k = Math.floor(b / HAMMER_TERRACE_STEP);
  return { k, f: b / HAMMER_TERRACE_STEP - k };
}

/** How far back a point of the Hammer vein's stepped slope climbs as: each
 *  step a flat ledge (the climb held at the step's foot) and then a sheer
 *  riser up to the next. Never more than `back` (the stepped slope stands
 *  under the smooth one). */
export function heartHammerTerrace(back: number, x: number, z: number): number {
  if (back <= 0) return Math.max(0, back);
  const { k, f } = heartHammerTerraceStep(back, x, z);
  const wander = (heartRidgeNoise(x * 2.3 - 57, z * 2.3 + 91) - 0.5) * HAMMER_TERRACE_STEP * 0.5;
  const r = HAMMER_TERRACE_RISER;
  const t = Math.max(0, Math.min(1, (f - (1 - r)) / r));
  const stepped = (k + t * t * (3 - 2 * t)) * HAMMER_TERRACE_STEP - wander - HAMMER_TERRACE_STEP;
  return Math.max(0, Math.min(back, stepped));
}

/** The mountain's height at (x, z), or HEART_MOUNTAIN_CHASM where none. */
export function heartMountainHeight(x: number, z: number): number {
  const c = heartFloorClearance(x, z);
  if (!Number.isFinite(c.d)) {
    // Far past every floor: the mountain's outer shoulders, at their cap.
    return HEART_MOUNTAIN_CHASM;
  }
  const clear = c.path ? HEART_WALL_PATH_CLEAR : HEART_WALL_CLEAR;
  const back = c.d - clear;
  if (back < -HEART_MOUNTAIN_FOOT) return HEART_MOUNTAIN_CHASM;
  if (heartOpenAir(x, z, 0)) return HEART_MOUNTAIN_CHASM;
  const scale = heartWallScale(x, z, c.floor);
  const ridge = heartRidgeNoise(x, z);
  const jag = heartRidgeNoise(x * 3.7 + 913, z * 3.7 - 271);
  // The Hammer vein's fissure climbs in bedded steps (phase 2D): flat
  // ledges and sheer risers instead of one smooth slope (blended in at the
  // vein's edge; never higher than the slope, so no clearance is touched).
  const lift = back > 0 ? hammerRockLift(x, z) : 0;
  const up = Math.max(0, back - HEART_MOUNTAIN_RECESS);
  const climb = lift > 0 ? up + (heartHammerTerrace(up, x, z) - up) * lift : up;
  const top = c.floor + heartMountainRise(climb, ridge, jag, scale.band) * scale.tall;
  if (back >= HEART_MOUNTAIN_RECESS) return top;
  if (back >= 0) return Math.min(top, c.floor - HEART_MOUNTAIN_LEDGE);
  // The foot: inside the clearance the face falls away into the chasm, well
  // under the floor (a camera above the floor never meets it), so the rock's
  // edge reads as one slanted face, never a saw of single cells.
  const k = (back + HEART_MOUNTAIN_FOOT) / HEART_MOUNTAIN_FOOT;
  const sink = Math.min(top, c.floor - HEART_MOUNTAIN_LEDGE);
  return HEART_MOUNTAIN_CHASM + (sink - HEART_MOUNTAIN_CHASM) * k * k;
}

/** The whole mountain on a grid of `cell` yards (the low tier passes a
 *  coarser cell: a cosmetic shed of facets, the same mountain). */
export function planHeartMountain(cell = 3): HeartMountainGrid {
  const b = SMITH_HEART_FIELD.bounds;
  const x0 = Math.floor((b.minX - PAD) / cell) * cell;
  const z0 = Math.floor((b.minZ - PAD) / cell) * cell;
  const nx = Math.ceil((b.maxX + PAD - x0) / cell) + 1;
  const nz = Math.ceil((b.maxZ + PAD - z0) / cell) + 1;
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      heights[j * nx + i] = heartMountainHeight(x0 + i * cell, z0 + j * cell);
    }
  }
  return { x0, z0, cell, nx, nz, heights };
}

const grids = new Map<number, HeartMountainGrid>();

/** The mountain's grid at `cell` yards, built once (the layout is static):
 *  the painter and the rock plan read the same heights. */
export function heartMountainGrid(cell = 3): HeartMountainGrid {
  let g = grids.get(cell);
  if (!g) {
    g = planHeartMountain(cell);
    grids.set(cell, g);
  }
  return g;
}

/** The drawn mountain at (x, z) on a grid: `mid` the bilinear height, `high`
 *  the highest corner of the cell round it (nothing drawn there stands
 *  above it), `low` the lowest. */
export function heartMountainSample(
  g: HeartMountainGrid,
  x: number,
  z: number,
): { mid: number; high: number; low: number } {
  const fx = Math.max(0, Math.min(g.nx - 1.001, (x - g.x0) / g.cell));
  const fz = Math.max(0, Math.min(g.nz - 1.001, (z - g.z0) / g.cell));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const k = j * g.nx + i;
  const a = g.heights[k];
  const b = g.heights[k + 1];
  const c = g.heights[k + g.nx];
  const d = g.heights[k + g.nx + 1];
  return {
    mid: a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v,
    high: Math.max(a, b, c, d),
    low: Math.min(a, b, c, d),
  };
}

/** Does the cell whose low corner is grid point (i, j) carry rock? */
export function heartMountainCellDrawn(g: HeartMountainGrid, i: number, j: number): boolean {
  const k = j * g.nx + i;
  return (
    g.heights[k] > HEART_MOUNTAIN_CHASM ||
    g.heights[k + 1] > HEART_MOUNTAIN_CHASM ||
    g.heights[k + g.nx] > HEART_MOUNTAIN_CHASM ||
    g.heights[k + g.nx + 1] > HEART_MOUNTAIN_CHASM
  );
}

/** Does the mountain stand between a and b (instance-local, y up)? Sampled
 *  every `step` yards along the line, its two ends excluded (the sightline
 *  pin: no eye on the main map sees into the Heart). */
export function heartMountainBlocks(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  step = 2,
): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const n = Math.max(2, Math.ceil(len / step));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (a.y + (b.y - a.y) * t < heartMountainHeight(x, z)) return true;
  }
  return false;
}
