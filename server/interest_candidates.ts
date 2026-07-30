import type { SpatialGrid } from '../src/sim/spatial';
import type { Entity } from '../src/sim/types';

// Shared per-cell interest gathering for the snapshot broadcast. The authoritative
// loop used to run ONE spatial-grid radius query per online viewer to find the
// entities in that viewer's interest range. This module replaces the per-viewer
// fan-out with one padded query per occupied grid cell, shared by every viewer
// whose anchor sits in that cell.
//
// Why a single cell-center query is a strict superset of every viewer-exact query
// in that cell: for a square cell of side `cellSize`, the farthest any point
// inside the cell can be from the cell center is the half-diagonal,
// `cellSize * sqrt(2) / 2`. By the triangle inequality, for any viewer point v
// inside the cell and any entity e within `baseRadius` of v:
//   dist(cellCenter, e) <= dist(cellCenter, v) + dist(v, e)
//                       <= (cellSize * sqrt(2) / 2) + baseRadius.
// So a query run FROM THE CELL CENTER with radius
// `baseRadius + cellSize*sqrt(2)/2` contains every entity any viewer in the cell
// would have found with its own exact `baseRadius` query. The superset follows
// solely from the triangle inequality plus the half-diagonal pad; the grid's
// internal +1 cell-window pad only tolerates stale buckets and adds no effective
// reach. What keeps a same-tick displaced (knockback/dash) entity inside the cell
// this query scans is the sim's end-of-tick grid.refresh, not any pad. Callers
// re-apply each viewer's exact `baseRadius` cutoff to this shared candidate list
// to recover the per-viewer set.

// Shifts negative cell coordinates into the positive range before packing, so a
// cell key is a single distinct number even for negative coordinates. This is our
// OWN offset; it need not match SpatialGrid's internal OFFSET, only be consistent
// within this module (two anchors in the same cell must hash together). The pack
// below is collision-free while cx, cz stay in [-32768, 32767] (|pos| < ~1.05M
// yards at cellSize 32), the SAME bound SpatialGrid's own key packing assumes and
// far outside any reachable world coordinate. A collision could only group two
// distant cells' candidates together, which the per-viewer d2 cutoff at the call
// site would still drop; it could never leak an out-of-range entity.
const CELL_KEY_OFFSET = 32768;

// One shared empty result for a session that was not part of the built pass.
// Returning this constant (never a fresh []) keeps forSession allocation-free.
const EMPTY: readonly Entity[] = [];

// pad = baseRadius + half the cell diagonal. See the derivation comment above.
export function sharedQueryRadius(baseRadius: number, cellSize: number): number {
  return baseRadius + (cellSize * Math.SQRT2) / 2;
}

// A consistent per-cell key for grouping anchors. Computes its own key from
// floor(x/cellSize), floor(z/cellSize); it does not need to match SpatialGrid's
// internal bucket id, only be consistent so two anchors in the same cell hash to
// the same key.
export function cellKeyForPosition(x: number, z: number, cellSize: number): number {
  const cx = Math.floor(x / cellSize);
  const cz = Math.floor(z / cellSize);
  return (cx + CELL_KEY_OFFSET) * 65536 + (cz + CELL_KEY_OFFSET);
}

export interface AnchorRef {
  sessionId: number;
  anchor: Entity;
}

export interface SharedInterestCandidates {
  // Candidate entities for the given session's anchor cell, in the shared query's
  // traversal order, or an empty array if the session was not part of the built
  // pass. O(1) lookup.
  forSession(sessionId: number): readonly Entity[];
  // Number of distinct occupied cells that were queried (one grid query each).
  readonly cellQueryCount: number;
}

// Groups the anchors by cell, runs exactly one
// grid.forEachInRadius(cellCenterX, cellCenterZ, sharedQueryRadius(baseRadius, grid.cellSize), cb)
// per DISTINCT occupied cell, and returns an O(1) lookup from sessionId to the
// candidate Entity list for that session's anchor cell. The candidate list for a
// cell is SHARED by reference across every session anchored in it.
export function buildSharedInterestCandidates(
  grid: SpatialGrid,
  anchors: Iterable<AnchorRef>,
  baseRadius: number,
): SharedInterestCandidates {
  const cellSize = grid.cellSize;
  const radius = sharedQueryRadius(baseRadius, cellSize);

  // First pass: bucket each session into its anchor cell and record the distinct
  // occupied cells (their integer cx/cz, so the center is recovered exactly).
  const sessionCell = new Map<number, number>();
  const distinctCells = new Map<number, { cx: number; cz: number }>();
  for (const { sessionId, anchor } of anchors) {
    const cx = Math.floor(anchor.pos.x / cellSize);
    const cz = Math.floor(anchor.pos.z / cellSize);
    const key = cellKeyForPosition(anchor.pos.x, anchor.pos.z, cellSize);
    sessionCell.set(sessionId, key);
    if (!distinctCells.has(key)) distinctCells.set(key, { cx, cz });
  }

  // Second pass: one grid query per distinct cell, from its center.
  const cellCandidates = new Map<number, readonly Entity[]>();
  let cellQueryCount = 0;
  for (const [key, { cx, cz }] of distinctCells) {
    const centerX = (cx + 0.5) * cellSize;
    const centerZ = (cz + 0.5) * cellSize;
    const list: Entity[] = [];
    // Deliberately ignore the d2 the callback receives: it is measured from the
    // CELL CENTER, not any viewer, so it must not leak into the returned list as
    // if it were a viewer distance. Callers re-apply their own anchor cutoff.
    grid.forEachInRadius(centerX, centerZ, radius, (e) => {
      list.push(e);
    });
    cellCandidates.set(key, list);
    cellQueryCount++;
  }

  return {
    forSession(sessionId: number): readonly Entity[] {
      const key = sessionCell.get(sessionId);
      if (key === undefined) return EMPTY;
      return cellCandidates.get(key) ?? EMPTY;
    },
    cellQueryCount,
  };
}
