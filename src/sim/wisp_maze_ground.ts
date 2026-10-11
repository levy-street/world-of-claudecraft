// The wisp maze trial's ground (world quest wq_evergarden_wisp_maze): the
// footprint the private maze stands on, levelled and kept clear. The trial is
// drawn only for the player inside it, but it stands in the open Evergarden,
// so everything the world grows or builds there shows through its hedges.
// world.ts applies the level pad in its authored pad chain
// (applyWispMazePad); the render-only garden planting (road-edge hedges,
// ribbon flowers, lush grass in garden_parterre_core) reads
// inWispMazeFootprint to leave the lawn bare. Pure leaf: deterministic, no
// rng, no SimContext.
import { WISP_MAZE_GRID, WISP_MAZE_PITCH } from './content/wisp_maze_layouts';
import { WISP_MAZE_SITE } from './content/world_quest_wisp_maze';

const HALF_X = (WISP_MAZE_GRID[0].length * WISP_MAZE_PITCH) / 2;
const HALF_Z = (WISP_MAZE_GRID.length * WISP_MAZE_PITCH) / 2;

/** The maze's outer edge: the outer faces of its outer wall cells. */
export const WISP_MAZE_FOOTPRINT = Object.freeze({
  x0: WISP_MAZE_SITE.x - HALF_X,
  x1: WISP_MAZE_SITE.x + HALF_X,
  z0: WISP_MAZE_SITE.z - HALF_Z,
  z1: WISP_MAZE_SITE.z + HALF_Z,
});

export const WISP_MAZE_PAD = Object.freeze({
  // The natural lawn runs 2.8 to 5.8 across the footprint, with a 0.7yd step
  // under the west corridors: enough to bury one side of a waist-high hedge
  // and float the other. Level at the east flower-bed ensemble's terrace: the
  // pad takes that ensemble's ANCHOR (world.ts GARDEN_BED_PADS, 476,1010) and
  // its unpadded height, exactly as the bed pads do (4.79 on the shipped
  // seed). That bed's round satellite pad reaches into the maze's north-east
  // corner, so the two terraces meet flush instead of fighting.
  anchorX: 476,
  anchorZ: 1010,
  /** The skirt's reach back to the natural lawn, in yards, outside the rect. */
  skirt: 4,
});

/** Horizontal distance from the footprint rect (0 inside it). */
export function wispMazeFootprintDistance(x: number, z: number): number {
  const f = WISP_MAZE_FOOTPRINT;
  return Math.hypot(Math.max(f.x0 - x, 0, x - f.x1), Math.max(f.z0 - z, 0, z - f.z1));
}

/** Inside the footprint grown by `margin` yards. */
export function inWispMazeFootprint(x: number, z: number, margin = 0): boolean {
  const f = WISP_MAZE_FOOTPRINT;
  return x > f.x0 - margin && x < f.x1 + margin && z > f.z0 - margin && z < f.z1 + margin;
}

/**
 * The level pad over the finished height: flat inside, smoothstep skirt out.
 * `anchorHeight` answers the unpadded height at the pad's anchor (world.ts
 * owns that chain); it is asked only for points the pad actually reaches.
 */
export function applyWispMazePad(
  x: number,
  z: number,
  h: number,
  anchorHeight: (x: number, z: number) => number,
): number {
  if (!inWispMazeFootprint(x, z, WISP_MAZE_PAD.skirt)) return h;
  const d = wispMazeFootprintDistance(x, z);
  if (d >= WISP_MAZE_PAD.skirt) return h;
  const t = 1 - d / WISP_MAZE_PAD.skirt;
  const w = t * t * (3 - 2 * t);
  return h * (1 - w) + anchorHeight(WISP_MAZE_PAD.anchorX, WISP_MAZE_PAD.anchorZ) * w;
}
