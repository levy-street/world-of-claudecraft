// The Great Maze's modeled-hedge plan: pure placement logic mapping the
// sim's wall grid (sim/world.ts owns it, and movement blocking + the map
// painter read the same cells) to hedge-piece and arch transforms for
// garden_features.ts to draw. Piece kinds come from gardenMazeCellPieces,
// so the drawn hedges and the blocked ground can never disagree.
import {
  GARDEN_MAZE_GRID,
  gardenMazeCellPieces,
  MAZE_CELL,
  MAZE_COLS,
  MAZE_ROWS,
  MAZE_WALL_DEPTH,
  MAZE_X0,
  MAZE_Z1,
} from '../sim/world';

export interface MazePieceSpot {
  x: number;
  z: number;
  rot: number; // 0 or PI runs east-west; +-PI/2 runs north-south
}

// The source models' authored bounds (hedge 0.98 x 0.57 x 0.38, arch
// 0.98 x 0.84 x 0.38, both minY 0). Each hedge piece is scaled to reach
// MAZE_WALL_OVERLAP past both ends of its cell, so the leafy ends of
// neighboring pieces interlock instead of butting edge to edge: runs read
// as one continuous grown hedge with no seams. The same uniform scale
// lands the hedge depth just inside MAZE_WALL_DEPTH, so the collide box
// sits a hair proud of the leaves instead of inside them.
export const MAZE_WALL_OVERLAP = 0.75; // yd each piece reaches into its neighbor
export const MAZE_WALL_SCALE = (MAZE_CELL + 2 * MAZE_WALL_OVERLAP) / 0.98; // 10.5 long, 6.1 high, 4.1 deep
export const MAZE_ARCH_SCALE = MAZE_CELL / 0.98; // spans the opening, 7.7 high at the crown

export interface GardenMazePlan {
  walls: MazePieceSpot[];
  arches: MazePieceSpot[];
}

/** All hedge pieces plus an arch over every perimeter opening. */
export function planGardenMazePieces(): GardenMazePlan {
  const walls: MazePieceSpot[] = [];
  const arches: MazePieceSpot[] = [];
  const cx = (c: number) => MAZE_X0 + (c + 0.5) * MAZE_CELL;
  const cz = (r: number) => MAZE_Z1 - (r + 0.5) * MAZE_CELL;
  for (let r = 0; r < MAZE_ROWS; r++) {
    for (let c = 0; c < MAZE_COLS; c++) {
      const p = gardenMazeCellPieces(c, r);
      if (p) {
        // alternate each piece's long-axis direction by grid parity: the
        // model's two ends differ, so flipping every other piece breaks
        // the repeat at the joints and the overlapped ends read grown
        // together rather than tiled
        const flip = (c + r) % 2 === 1;
        if (p.h) walls.push({ x: cx(c), z: cz(r), rot: flip ? Math.PI : 0 });
        if (p.v) walls.push({ x: cx(c), z: cz(r), rot: flip ? -Math.PI / 2 : Math.PI / 2 });
        continue;
      }
      // a perimeter opening gets the hedge arch, its passage along the
      // axis of travel through the maze edge
      const north = r === 0;
      const south = r === MAZE_ROWS - 1;
      const west = c === 0;
      const east = c === MAZE_COLS - 1;
      if (north || south) arches.push({ x: cx(c), z: cz(r), rot: 0 });
      else if (west || east) arches.push({ x: cx(c), z: cz(r), rot: Math.PI / 2 });
    }
  }
  return { walls, arches };
}

// The hedges' visual top, for the camera to ride over.
export const MAZE_WALL_HEIGHT = 0.57 * MAZE_WALL_SCALE; // 6.1yd at the current scale

const CAM_LIFT_RAMP = 2.2; // yd of smooth rise approaching a hedge face

/**
 * How far the chase camera must ride above the lawn at (x, z) so it clears
 * the modeled hedges instead of sitting inside their leaves: the terrain
 * walls used to push it up via the ground clamp, and this restores that
 * behavior for the modeled maze. Full hedge height inside a wall piece,
 * easing smoothly to zero within CAM_LIFT_RAMP of the nearest face so the
 * camera glides over walls rather than popping.
 */
export function gardenMazeCameraLift(x: number, z: number): number {
  const w = MAZE_COLS * MAZE_CELL;
  const m = CAM_LIFT_RAMP + 1;
  if (x < MAZE_X0 - m || x > MAZE_X0 + w + m) return 0;
  if (z < MAZE_Z1 - MAZE_ROWS * MAZE_CELL - m || z > MAZE_Z1 + m) return 0;
  const ci = Math.floor((x - MAZE_X0) / MAZE_CELL);
  const ri = Math.floor((MAZE_Z1 - z) / MAZE_CELL);
  const half = MAZE_CELL / 2;
  const d = MAZE_WALL_DEPTH / 2;
  let dist = Number.POSITIVE_INFINITY;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const p = gardenMazeCellPieces(ci + dc, ri + dr);
      if (!p) continue;
      const cx = MAZE_X0 + (ci + dc + 0.5) * MAZE_CELL;
      const cz = MAZE_Z1 - (ri + dr + 0.5) * MAZE_CELL;
      // distance outside each piece's 2D box (0 inside)
      if (p.h) {
        const dx = Math.max(0, Math.abs(x - cx) - half);
        const dz = Math.max(0, Math.abs(z - cz) - d);
        dist = Math.min(dist, Math.hypot(dx, dz));
      }
      if (p.v) {
        const dx = Math.max(0, Math.abs(x - cx) - d);
        const dz = Math.max(0, Math.abs(z - cz) - half);
        dist = Math.min(dist, Math.hypot(dx, dz));
      }
    }
  }
  if (dist >= CAM_LIFT_RAMP) return 0;
  const u = 1 - dist / CAM_LIFT_RAMP;
  return MAZE_WALL_HEIGHT * u * u * (3 - 2 * u); // smoothstep ease
}

// re-exported so the painter and its test share the exact cell math
export { GARDEN_MAZE_GRID, MAZE_CELL, MAZE_COLS, MAZE_ROWS, MAZE_WALL_DEPTH, MAZE_X0, MAZE_Z1 };
