// Cell index over a dungeon interior's collider list, so the interior arms of
// colliders.ts (resolvePosition, the sight sampler, the standable-top query)
// read the colliders near a point instead of scanning the whole list. The
// authored open fields (the Gravewyrm Sanctum, the Drowned Temple, the
// Wildheart Basin, the Hollow Crypt, the Sunken Bastion) carry
// thousands of cliff, wall and prop colliders, and a chain pull runs that full
// scan for every mob step: it was most of a Sanctum tick.
//
// EXACT by construction, never an approximation:
// - A collider can only push (or overlap) a point inside its footprint
//   inflated by the body radius r: a circle by r, an OBB by r along each LOCAL
//   axis, whose world AABB grows by r * (|cos| + |sin|) <= r * SQRT2. So a
//   collider whose AABB, grown by REACH(r), misses a cell can never touch a
//   point in that cell.
// - Each collider is filed into every cell its AABB grown by CELL_MARGIN
//   touches; a query whose reach exceeds the margin reads the ring of
//   neighbour cells the excess spans (cached per cell and ring). Every cell
//   list keeps the INPUT order, so the sequential push-out visits the
//   colliders the full list would, in the same order; the skipped ones would
//   all have returned null.
// - The point MOVES while it resolves, so the resolve is bounded to the query
//   cell (collider_pushout.ts resolveAgainst `within`): the moment a push
//   carries it out of the cell, the subset is no longer proven complete and
//   the call re-runs the full list from the start. Results are byte-identical
//   to the pre-index scan (tests/interior_collider_cells.test.ts pins it on
//   every authored interior, and the parity goldens stay unchanged).
//
// Built lazily per list identity (the shared per-dungeon set, and each slot's
// gate-filtered view from instances/dungeon_gate_state.ts, which is a new
// array whenever a gate opens), cached in a WeakMap. Pure module: no Sim
// state, no rng. CONTRACT: an interior list and its colliders are never
// mutated in place once published (they are concat and filter products); a
// list that grows re-indexes, but an in-place swap or a moved collider would
// leave a stale index. The ring read also assumes no collider appears twice
// in one list (checked by the test).

import { cellKey, colliderBounds } from './collider_cells';
import { type ResolveBox, resolveAgainst } from './collider_pushout';
import type { Collider, MoverHeight } from './colliders';

/** Cell edge, yards (interior-local frame). */
export const INTERIOR_CELL = 16;
/** Registration margin: covers the reach of every body up to r 0.88 (the
 *  player and mob BODY_RADIUS is 0.5) with a single-cell read. */
export const INTERIOR_CELL_MARGIN = 1.25;
/** Widest neighbour ring a query may read before it just scans the list. */
const MAX_RING = 2;

/** How far beyond a collider's AABB a body of radius r can still be touched
 *  (the OBB corner case, plus float slack for the rotated local test). */
export function interiorReach(r: number): number {
  return r * Math.SQRT2 + 1e-3;
}

interface InteriorCellIndex {
  /** The list length at build time: a list grown in place re-indexes. */
  len: number;
  cells: Map<number, Collider[]>;
  /** Ring reads, keyed cellKey * 4 + ring. */
  rings: Map<number, Collider[]>;
  order: Map<Collider, number>;
}

const EMPTY: Collider[] = [];
const indexes = new WeakMap<readonly Collider[], InteriorCellIndex>();
let indexEnabled = true;

/** Test seam: false makes every read return the full list (the pre-index
 *  scan), which is what the equivalence suite compares against. */
export function setInteriorCellIndexEnabled(on: boolean): void {
  indexEnabled = on;
}

function indexFor(list: readonly Collider[]): InteriorCellIndex {
  let index = indexes.get(list);
  if (index && index.len === list.length) return index;
  const cells = new Map<number, Collider[]>();
  const order = new Map<Collider, number>();
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    order.set(c, i);
    const b = colliderBounds(c);
    const x0 = Math.floor((b.minX - INTERIOR_CELL_MARGIN) / INTERIOR_CELL);
    const x1 = Math.floor((b.maxX + INTERIOR_CELL_MARGIN) / INTERIOR_CELL);
    const z0 = Math.floor((b.minZ - INTERIOR_CELL_MARGIN) / INTERIOR_CELL);
    const z1 = Math.floor((b.maxZ + INTERIOR_CELL_MARGIN) / INTERIOR_CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = cellKey(gx, gz);
        const cell = cells.get(key);
        if (cell) cell.push(c);
        else cells.set(key, [c]);
      }
    }
  }
  index = { len: list.length, cells, rings: new Map(), order };
  indexes.set(list, index);
  return index;
}

function ringRead(index: InteriorCellIndex, gx: number, gz: number, ring: number): Collider[] {
  const key = cellKey(gx, gz) * 4 + ring;
  const cached = index.rings.get(key);
  if (cached) return cached;
  const seen = new Set<Collider>();
  for (let dx = -ring; dx <= ring; dx++) {
    for (let dz = -ring; dz <= ring; dz++) {
      const cell = index.cells.get(cellKey(gx + dx, gz + dz));
      if (cell) for (const c of cell) seen.add(c);
    }
  }
  const merged = [...seen].sort((a, b) => (index.order.get(a) ?? 0) - (index.order.get(b) ?? 0));
  index.rings.set(key, merged);
  return merged;
}

/**
 * The colliders of `list` (in list order) that can touch ANY point of the
 * cell holding (x, z) within `reach` yards of their AABB, or null when the
 * index cannot answer (disabled, a non-finite point, or a reach past the
 * widest ring): the caller then uses the full list.
 */
export function interiorCellCandidates(
  list: readonly Collider[],
  x: number,
  z: number,
  reach: number,
): Collider[] | null {
  if (!indexEnabled || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  // A NaN or negative reach (a NaN or negative radius) has no AABB bound: a
  // circle with c.r + r < 0 still pushes, and NaN fails every comparison open.
  if (!(reach >= 0)) return null;
  const excess = reach - INTERIOR_CELL_MARGIN;
  const ring = excess <= 0 ? 0 : Math.ceil(excess / INTERIOR_CELL);
  if (!(ring <= MAX_RING)) return null;
  const index = indexFor(list);
  const gx = Math.floor(x / INTERIOR_CELL);
  const gz = Math.floor(z / INTERIOR_CELL);
  if (ring === 0) return index.cells.get(cellKey(gx, gz)) ?? EMPTY;
  return ringRead(index, gx, gz, ring);
}

/** The colliders a FIXED point (an overlap or support test, no push-out
 *  movement) must be tested against: the cell subset, or the whole list. */
export function interiorCollidersNear(
  list: Collider[],
  x: number,
  z: number,
  r: number,
): Collider[] {
  return interiorCellCandidates(list, x, z, interiorReach(r)) ?? list;
}

/**
 * resolveAgainst over an interior list through the cell index: the bounded
 * resolve over the cell subset, or the full list when the point leaves the
 * cell mid-resolve (or the index cannot answer). Identical to
 * resolveAgainst(list, ...) for every input.
 */
export function resolveInteriorAgainst(
  list: Collider[],
  x: number,
  z: number,
  r: number,
  ignoreFences = false,
  mover?: MoverHeight,
): { x: number; z: number } {
  const candidates = interiorCellCandidates(list, x, z, interiorReach(r));
  if (candidates) {
    const gx = Math.floor(x / INTERIOR_CELL);
    const gz = Math.floor(z / INTERIOR_CELL);
    const box: ResolveBox = {
      minX: gx * INTERIOR_CELL,
      maxX: (gx + 1) * INTERIOR_CELL,
      minZ: gz * INTERIOR_CELL,
      maxZ: (gz + 1) * INTERIOR_CELL,
    };
    const bounded = resolveAgainst(candidates, x, z, r, ignoreFences, mover, box);
    if (bounded) return bounded;
  }
  return resolveAgainst(list, x, z, r, ignoreFences, mover);
}
