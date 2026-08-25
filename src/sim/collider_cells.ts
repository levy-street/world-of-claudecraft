// Shared collider cell-index math. The open-world grid (colliders.ts gridFor)
// and the per-rift-floor region indexes both file colliders into GRID_CELL
// sized cells, inflated by MAX_BODY_RADIUS, so a SINGLE-cell read at a sample
// point is complete for any resolve radius up to MAX_BODY_RADIUS: a collider
// whose surface could touch the body is guaranteed to be in the point's cell.
// That registration margin is the whole contract; every consumer that widens a
// read radius past MAX_BODY_RADIUS must switch to a cell-range read instead.
//
// Pure module: no Sim state, no side effects, deterministic for a given input
// list (cell lists preserve the input list's order, so sequential push-out
// resolution over a cell subset visits colliders in exactly the order the full
// list would).

import type { Collider } from './colliders';

export const GRID_CELL = 16;

/** Largest mover we resolve for. Doubles as the cell registration margin:
 *  every collider is inserted into all cells its bounds inflated by this
 *  touch, which is what makes single-cell support, glue, and sight reads
 *  complete (their reach beyond a collider's bounds never exceeds it). */
export const MAX_BODY_RADIUS = 0.8;

// Cells are keyed by a packed integer rather than a `gx,gz` template string.
// The key is built on every lookup in the movement and line-of-sight hot
// paths, and a string key allocated there was the single largest source of
// per-tick garbage in the physics solver. The bias keeps negative cells
// positive; the span covers any world the editor can author (cell 16 yd, so
// +/- 32768 cells is +/- 524288 yd).
const CELL_KEY_BIAS = 32768;
const CELL_KEY_SPAN = 65536;

export function cellKey(gx: number, gz: number): number {
  return (gx + CELL_KEY_BIAS) * CELL_KEY_SPAN + (gz + CELL_KEY_BIAS);
}

/** The cell key covering a WORLD position, for reads that start from one
 *  (the battleground band's sight test) rather than from a cell range. */
export function cellKeyAt(x: number, z: number): number {
  return cellKey(Math.floor(x / GRID_CELL), Math.floor(z / GRID_CELL));
}

export function colliderBounds(c: Collider): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  if (c.type === 'circle') {
    return { minX: c.x - c.r, maxX: c.x + c.r, minZ: c.z - c.r, maxZ: c.z + c.r };
  }
  // Exact AABB of the rotated OBB. The old circumscribed hypot(hw, hd) bound
  // filed a long thin wall (half-length ~75) into every cell of its floor,
  // defeating the cell separation for exactly the collider class rift floors
  // have most of. Tightening is behavior-safe: bounds only ever ADD colliders
  // to cells, and an over-included collider is a push-out no-op, so shrinking
  // to the true extent cannot change any resolution result.
  const cos = Math.abs(Math.cos(c.rot));
  const sin = Math.abs(Math.sin(c.rot));
  const ex = c.hw * cos + c.hd * sin;
  const ez = c.hw * sin + c.hd * cos;
  return { minX: c.x - ex, maxX: c.x + ex, minZ: c.z - ez, maxZ: c.z + ez };
}

/** A cell index over one fixed collider list (a generated rift floor). Built
 *  once when the list is published; queries are a single Map read. */
export interface ColliderCellIndex {
  cellSize: number;
  cells: Map<number, Collider[]>;
}

/**
 * Index a collider list into cells, filing each collider into every cell its
 * bounds inflated by MAX_BODY_RADIUS touch (the same margin gridFor uses).
 * Iterating the input in order and appending keeps each cell's list in the
 * input list's relative order, which sequential push-out resolution depends
 * on for exact equivalence with a full-list scan.
 *
 * `cellSize` is a test seam: the equivalence suite publishes a reference
 * region with cellSize Infinity, collapsing the index to ONE cell that holds
 * the whole list in order (the pre-index full-list scan). It must be Infinity,
 * not merely huge: a finite size splits at the local origin into quadrant
 * cells, and rift local coordinates straddle 0 on both axes.
 */
export function buildColliderCellIndex(
  colliders: readonly Collider[],
  cellSize = GRID_CELL,
): ColliderCellIndex {
  const cells = new Map<number, Collider[]>();
  for (const c of colliders) {
    const b = colliderBounds(c);
    const x0 = Math.floor((b.minX - MAX_BODY_RADIUS) / cellSize);
    const x1 = Math.floor((b.maxX + MAX_BODY_RADIUS) / cellSize);
    const z0 = Math.floor((b.minZ - MAX_BODY_RADIUS) / cellSize);
    const z1 = Math.floor((b.maxZ + MAX_BODY_RADIUS) / cellSize);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = cellKey(gx, gz);
        const list = cells.get(key);
        if (list) list.push(c);
        else cells.set(key, [c]);
      }
    }
  }
  return { cellSize, cells };
}

/** The colliders whose inflated bounds touch the cell covering (x, z), in the
 *  original list order. Undefined when the cell is empty (no collider within
 *  MAX_BODY_RADIUS reach of any point in the cell). */
export function colliderCellAt(
  index: ColliderCellIndex,
  x: number,
  z: number,
): Collider[] | undefined {
  return index.cells.get(cellKey(Math.floor(x / index.cellSize), Math.floor(z / index.cellSize)));
}
