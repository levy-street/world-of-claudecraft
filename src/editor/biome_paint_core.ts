// Pure helpers for the biome-paint grid resolution: pick the finest cell size
// a map's extent can afford, and upsample an existing coarser grid so old maps
// gain the finer brush the moment they are painted on. No DOM/Three imports;
// Vitest imports this directly.

import { MAX_BIOME_PAINT_CELLS } from '../sim/map_doc';
import type { BiomePaint } from '../sim/types';

// The sanitizer drops grids over 4,200,000 cells (sim/map_doc.ts); stay under
// it so a resample can never trip that gate. localStorage saves survive the
// bigger grids because the store run-length-encodes the ids (persist.ts) ?
// paint is extremely run-heavy ? while exports/bundles zip them. The budget
// buys a 1000x1000yd map 0.5yd cells (2001^2 ~= 4.0M; the GPU paint field at
// 4 RGBA8 layers is ~64MB there, and 2001 stays under PAINT_TEX_MAX 4096).
export const MAX_PAINT_CELLS = 4_100_000;

// Finest first: small maps (interiors, arenas) paint at 0.25yd cells, medium
// and large maps at 0.5yd (up to ~1000x1000yd custom worlds), the very
// biggest bounds at 1-4yd. Each tier only kicks in where the grid stays under
// MAX_PAINT_CELLS, so gigantic open worlds degrade gracefully.
export const PAINT_CELL_CHOICES: readonly number[] = [0.25, 0.5, 1, 2, 4];

export function finestPaintCell(width: number, depth: number): number {
  for (const cell of PAINT_CELL_CHOICES) {
    const cols = Math.ceil(width / cell) + 1;
    const rows = Math.ceil(depth / cell) + 1;
    if (cols * rows <= MAX_PAINT_CELLS) return cell;
  }
  return PAINT_CELL_CHOICES[PAINT_CELL_CHOICES.length - 1];
}

/**
 * Nearest-neighbor RESAMPLE of a paint grid to a different cell size over the
 * same world rect (same origin, same coverage), sampling by new-cell CENTER so
 * painted regions keep their footprint. Works in BOTH directions: a FINER cell
 * (a smoother brush for legacy coarse grids) or a COARSER one (a map that grew
 * wider/deeper needs a bigger cell so the full-extent grid stays under the cell
 * cap, otherwise growBiomePaint refuses and the grid strands at its old edge,
 * leaving the flanks unpaintable). Returns a NEW grid sharing the custom swatch
 * list; null when the grid is already at the target cell or the result would
 * exceed the sanitizer's hard cap.
 */
/**
 * Grow a paint grid to cover a larger world rect at the SAME cell size: the
 * new origin snaps down from the old one in whole cells, so every existing
 * cell copies to an integer offset (painted footprint preserved bit-for-bit,
 * new cells unpainted). A map created small and later authored bigger keeps
 * painting seamlessly instead of clamping at the old grid's edge. Returns a
 * NEW grid sharing the custom swatch list; null when the grid already covers
 * the rect or growth would exceed the sanitizer's hard cap.
 */
export function growBiomePaint(
  bp: BiomePaint,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): BiomePaint | null {
  const cell = bp.cell;
  const padW = Math.max(0, Math.ceil((bp.originX - bounds.minX) / cell));
  const padS = Math.max(0, Math.ceil((bp.originZ - bounds.minZ) / cell));
  const originX = bp.originX - padW * cell;
  const originZ = bp.originZ - padS * cell;
  const cols = Math.max(bp.cols + padW, Math.ceil((bounds.maxX - originX) / cell) + 1);
  const rows = Math.max(bp.rows + padS, Math.ceil((bounds.maxZ - originZ) / cell) + 1);
  if (cols === bp.cols && rows === bp.rows && padW === 0 && padS === 0) return null;
  if (cols * rows > MAX_BIOME_PAINT_CELLS) return null; // keep the old grid
  const ids = new Array<number>(cols * rows).fill(255);
  for (let r = 0; r < bp.rows; r++) {
    const dst = (r + padS) * cols + padW;
    const src = r * bp.cols;
    for (let c = 0; c < bp.cols; c++) ids[dst + c] = bp.ids[src + c];
  }
  const out: BiomePaint = { cell, cols, rows, originX, originZ, ids };
  if (bp.custom) out.custom = bp.custom;
  return out;
}

export function resampleBiomePaint(bp: BiomePaint, targetCell: number): BiomePaint | null {
  if (targetCell <= 0 || bp.cell === targetCell) return null;
  const width = bp.cols * bp.cell;
  const depth = bp.rows * bp.cell;
  const cols = Math.ceil(width / targetCell);
  const rows = Math.ceil(depth / targetCell);
  if (cols * rows > MAX_BIOME_PAINT_CELLS) return null; // the sanitizer's hard cap
  const ids = new Array<number>(cols * rows);
  for (let r = 0; r < rows; r++) {
    const or = Math.min(bp.rows - 1, Math.floor(((r + 0.5) * targetCell) / bp.cell));
    for (let c = 0; c < cols; c++) {
      const oc = Math.min(bp.cols - 1, Math.floor(((c + 0.5) * targetCell) / bp.cell));
      ids[r * cols + c] = bp.ids[or * bp.cols + oc];
    }
  }
  const out: BiomePaint = {
    cell: targetCell,
    cols,
    rows,
    originX: bp.originX,
    originZ: bp.originZ,
    ids,
  };
  if (bp.custom) out.custom = bp.custom;
  return out;
}
