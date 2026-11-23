import { describe, expect, it } from 'vitest';
import {
  finestPaintCell,
  growBiomePaint,
  MAX_PAINT_CELLS,
  resampleBiomePaint,
} from '../src/editor/biome_paint_core';
import type { BiomePaint } from '../src/sim/types';

function grid(cell: number, cols: number, rows: number, fill = 255): BiomePaint {
  return {
    cell,
    cols,
    rows,
    originX: -10,
    originZ: -20,
    ids: new Array(cols * rows).fill(fill),
  };
}

describe('finestPaintCell', () => {
  it('gives small maps (interiors, arenas, squares to ~500yd) 0.25yd cells', () => {
    expect(finestPaintCell(60, 60)).toBe(0.25);
    expect(finestPaintCell(100, 100)).toBe(0.25);
    expect(finestPaintCell(400, 400)).toBe(0.25);
  });

  it('gives large maps 0.5yd cells', () => {
    // A full-size custom world (the editor's Open World preset area).
    expect(finestPaintCell(360, 1080)).toBe(0.5);
    // The big-square case the budget is sized for.
    expect(finestPaintCell(1000, 1000)).toBe(0.5);
  });

  it('gives the biggest worlds 1yd cells', () => {
    // 900 wide, ~1920 deep: 0.5yd would be ~6.9M cells, over the budget.
    expect(finestPaintCell(900, 1920)).toBe(1);
  });

  it('never exceeds the cell budget', () => {
    for (const [w, d] of [
      [100, 100],
      [600, 600],
      [900, 1920],
      [4000, 4000],
    ]) {
      const cell = finestPaintCell(w, d);
      const cols = Math.ceil(w / cell) + 1;
      const rows = Math.ceil(d / cell) + 1;
      if (cell < 4) expect(cols * rows).toBeLessThanOrEqual(MAX_PAINT_CELLS);
    }
  });
});

describe('resampleBiomePaint', () => {
  it('returns null only when already at the target cell', () => {
    expect(resampleBiomePaint(grid(2, 10, 10), 2)).toBeNull();
  });

  it('coarsens a finer grid to a bigger cell preserving the footprint', () => {
    // A map that grew wider needs its over-fine grid coarsened to fit the cell
    // cap; the previous upsample-only guard refused this and stranded the grid.
    const bp = grid(1, 8, 8);
    // Paint the 2x2 old-cell block cols 4..5 x rows 2..3 (world 4..6 x 2..4).
    for (let r = 2; r <= 3; r++) for (let c = 4; c <= 5; c++) bp.ids[r * 8 + c] = 5;
    const coarse = resampleBiomePaint(bp, 2);
    expect(coarse).not.toBeNull();
    if (!coarse) return;
    expect(coarse.cell).toBe(2);
    expect(coarse.cols).toBe(4);
    expect(coarse.rows).toBe(4);
    expect(coarse.originX).toBe(bp.originX);
    expect(coarse.originZ).toBe(bp.originZ);
    // New cell (col 2, row 1) samples world center (5, 3) -> the painted block.
    expect(coarse.ids[1 * 4 + 2]).toBe(5);
    // A cell well clear of the block stays unpainted.
    expect(coarse.ids[0]).toBe(255);
  });

  it('upsamples 4yd to 2yd preserving the painted footprint', () => {
    const bp = grid(4, 4, 4);
    // Paint old cell (col 1, row 2) with biome 3.
    bp.ids[2 * 4 + 1] = 3;
    const fine = resampleBiomePaint(bp, 2);
    expect(fine).not.toBeNull();
    if (!fine) return;
    expect(fine.cell).toBe(2);
    expect(fine.cols).toBe(8);
    expect(fine.rows).toBe(8);
    expect(fine.originX).toBe(bp.originX);
    expect(fine.originZ).toBe(bp.originZ);
    // The old painted cell covered world cols [4yd..8yd) x rows [8yd..12yd)
    // from the origin: exactly new cols 2..3 x rows 4..5.
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const painted = c >= 2 && c <= 3 && r >= 4 && r <= 5;
        expect(fine.ids[r * 8 + c]).toBe(painted ? 3 : 255);
      }
    }
  });

  it('keeps the custom swatch list by reference', () => {
    const bp = grid(4, 2, 2);
    bp.custom = [{ id: 200, color: 0xff00ff }];
    const fine = resampleBiomePaint(bp, 1);
    expect(fine?.custom).toBe(bp.custom);
  });

  it('refuses a resample that would exceed the sanitizer cap', () => {
    // 4000x4000 world at 4yd = 1000x1000 cells; 1yd would be 16M cells.
    expect(resampleBiomePaint(grid(4, 1000, 1000), 1)).toBeNull();
  });
});

describe('growBiomePaint', () => {
  it('returns null when the grid already covers the bounds', () => {
    // grid(): origin (-10, -20); 4yd cells, 10x12 -> covers x -10..30, z -20..28.
    const bp = grid(4, 10, 12);
    expect(growBiomePaint(bp, { minX: -10, maxX: 26, minZ: -20, maxZ: 24 })).toBeNull();
  });

  it('grows east/north keeping origin and painted cells in place', () => {
    const bp = grid(4, 4, 4);
    bp.ids[1 * 4 + 2] = 7;
    const grown = growBiomePaint(bp, { minX: -10, maxX: 30, minZ: -20, maxZ: 20 });
    expect(grown).not.toBeNull();
    if (!grown) return;
    expect(grown.originX).toBe(bp.originX);
    expect(grown.originZ).toBe(bp.originZ);
    expect(grown.cols).toBeGreaterThan(bp.cols);
    expect(grown.rows).toBeGreaterThan(bp.rows);
    expect(grown.ids[1 * grown.cols + 2]).toBe(7);
  });

  it('grows west/south snapping the origin down in whole cells', () => {
    const bp = grid(4, 4, 4);
    bp.ids[0] = 9; // cell at world (-10..-6, -20..-16)
    const grown = growBiomePaint(bp, { minX: -21, maxX: 6, minZ: -33, maxZ: -4 });
    expect(grown).not.toBeNull();
    if (!grown) return;
    // Origin moved down by an integer number of cells.
    expect((bp.originX - grown.originX) % bp.cell).toBe(0);
    expect((bp.originZ - grown.originZ) % bp.cell).toBe(0);
    expect(grown.originX).toBeLessThanOrEqual(-21);
    expect(grown.originZ).toBeLessThanOrEqual(-33);
    const padW = (bp.originX - grown.originX) / bp.cell;
    const padS = (bp.originZ - grown.originZ) / bp.cell;
    expect(grown.ids[padS * grown.cols + padW]).toBe(9);
    // New cells are unpainted.
    expect(grown.ids[0]).toBe(255);
  });

  it('keeps the custom swatch list by reference and refuses the cap', () => {
    const bp = grid(4, 2, 2);
    bp.custom = [{ id: 200, color: 0xff00ff }];
    const grown = growBiomePaint(bp, { minX: -30, maxX: 30, minZ: -40, maxZ: 40 });
    expect(grown?.custom).toBe(bp.custom);
    // 0.25yd cells over a huge rect would blow the sanitizer cap: keep old.
    const fine = grid(0.25, 100, 100);
    expect(growBiomePaint(fine, { minX: -600, maxX: 600, minZ: -600, maxZ: 600 })).toBeNull();
  });
});

// Regression for the "middle strip paints, the flanks don't" bug on wide maps:
// a paint grid created for a NARROW but DEEP map is too fine to grow to the
// map's full width without blowing the cell cap, so the fixed-cell grow refuses
// and strands the grid, flank clicks then land off-grid and paint nothing. The
// editor now coarsens to the finest cell the full extent affords, THEN grows.
describe('coarsen-then-grow keeps wide maps paintable (flank paint fix)', () => {
  it('reaches the full extent where a fixed-cell grow strands the grid', () => {
    // Grid for x -180..180 (360 wide) at 0.5yd over a deep world (z -300..2420).
    const cell = 0.5;
    const cols = Math.ceil(360 / cell) + 1; // 721
    const rows = Math.ceil(2720 / cell) + 1; // 5441
    const narrow: BiomePaint = {
      cell,
      cols,
      rows,
      originX: -180,
      originZ: -300,
      ids: new Array(cols * rows).fill(255),
    };
    // Paint a 4x4 block near the origin (survives a 2:1 coarsen regardless of phase).
    for (let r = 10; r < 14; r++) for (let c = 10; c < 14; c++) narrow.ids[r * cols + c] = 7;
    expect(narrow.cols * narrow.rows).toBeLessThanOrEqual(MAX_PAINT_CELLS);

    const full = { minX: -540, maxX: 540, minZ: -300, maxZ: 2420 };

    // OLD path: growing at the fine cell blows the cap -> stranded (null).
    expect(growBiomePaint(narrow, full)).toBeNull();

    // NEW path (mirrors growBiomeGridForPainting): coarsen, then grow.
    const targetCell = finestPaintCell(full.maxX - full.minX, full.maxZ - full.minZ);
    expect(targetCell).toBeGreaterThan(cell); // a coarsen is required
    const coarsened = resampleBiomePaint(narrow, targetCell);
    expect(coarsened).not.toBeNull();
    if (!coarsened) return;
    const grown = growBiomePaint(coarsened, full);
    expect(grown).not.toBeNull();
    if (!grown) return;

    // The grid now spans the whole map and stays under the sanitizer cap...
    expect(grown.originX).toBeLessThanOrEqual(full.minX);
    expect(grown.originZ).toBeLessThanOrEqual(full.minZ);
    expect(grown.originX + grown.cols * grown.cell).toBeGreaterThanOrEqual(full.maxX);
    expect(grown.originZ + grown.rows * grown.cell).toBeGreaterThanOrEqual(full.maxZ);
    expect(grown.cols * grown.rows).toBeLessThanOrEqual(4_200_000);
    // ...a flank cell (x = 400, well past the old ±180 edge) is now in-grid...
    const flankCol = Math.floor((400 - grown.originX) / grown.cell);
    expect(flankCol).toBeGreaterThanOrEqual(0);
    expect(flankCol).toBeLessThan(grown.cols);
    // ...and the original paint survived the coarsen.
    expect(grown.ids.some((id) => id === 7)).toBe(true);
  });
});
