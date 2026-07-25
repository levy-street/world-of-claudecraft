import { describe, expect, it } from 'vitest';
import {
  PROP_FAR_CELL_SIZE,
  PROP_FAR_SWAP_DISTANCE,
  propCellBoxDistance,
  propCellKey,
  propCellMode,
} from '../src/render/prop_cell_core';

describe('propCellKey', () => {
  it('quantizes to the cell grid including negative coordinates', () => {
    expect(propCellKey(0, 0)).toBe('0:0');
    expect(propCellKey(119, 119)).toBe('0:0');
    expect(propCellKey(120, 0)).toBe('1:0');
    expect(propCellKey(-1, -1)).toBe('-1:-1');
    expect(propCellKey(-120, -121)).toBe('-1:-2');
    expect(propCellKey(50, 50, 100)).toBe('0:0');
  });

  it('pins the cell size and swap distance the props dual representation uses', () => {
    expect(PROP_FAR_CELL_SIZE).toBe(120);
    // Must stay comfortably above the ghost reach: one camera boom (~14u)
    // plus the largest footprint radius (~6u).
    expect(PROP_FAR_SWAP_DISTANCE).toBe(40);
  });
});

describe('propCellBoxDistance', () => {
  const bounds = { minX: 100, maxX: 220, minZ: -40, maxZ: 80 };

  it('is zero inside the box and axis distance outside', () => {
    expect(propCellBoxDistance(bounds, 150, 0)).toBe(0);
    expect(propCellBoxDistance(bounds, 90, 0)).toBe(10);
    expect(propCellBoxDistance(bounds, 150, 100)).toBe(20);
  });

  it('is the diagonal distance from a corner', () => {
    expect(propCellBoxDistance(bounds, 97, -44)).toBeCloseTo(5, 5);
  });
});

describe('propCellMode', () => {
  const bounds = { minX: 100, maxX: 220, minZ: -40, maxZ: 80 };

  it('keeps a near cell in individual mode with the merged bake color-hidden', () => {
    const near = propCellMode(bounds, 120, 0, 470);
    expect(near.farMode).toBe(false);
    expect(near.showMerged).toBe(false);
  });

  it('flips to merged mode at the swap distance', () => {
    const nearEdge = propCellMode(bounds, 100 - 39, 0, 470);
    expect(nearEdge.farMode).toBe(false);
    const atEdge = propCellMode(bounds, 100 - 40, 0, 470);
    expect(atEdge.farMode).toBe(true);
    expect(atEdge.showMerged).toBe(true);
  });

  it('hides the merged bake past the fog distance while staying in far mode', () => {
    const fogged = propCellMode(bounds, 100 - 500, 0, 470);
    expect(fogged.farMode).toBe(true);
    expect(fogged.showMerged).toBe(false);
  });

  it('honors a custom swap distance', () => {
    expect(propCellMode(bounds, 100 - 30, 0, 470, 30).farMode).toBe(true);
    expect(propCellMode(bounds, 100 - 29, 0, 470, 30).farMode).toBe(false);
  });
});
