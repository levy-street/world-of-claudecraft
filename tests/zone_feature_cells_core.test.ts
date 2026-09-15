import { describe, expect, it } from 'vitest';
import { cellIndex, partitionByCell } from '../src/render/zone_feature_cells_core';

// A deterministic scatter with negative coordinates (the fen sits at x < 0),
// spots exactly on cell boundaries, and duplicates.
function scatter(n: number): { x: number; z: number; id: number }[] {
  const spots: { x: number; z: number; id: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i * 7919) % 1000;
    spots.push({ x: -540 + (t % 360), z: 180 + Math.floor(t / 2), id: i });
  }
  spots.push({ x: -260, z: 260, id: n }); // on both boundaries at size 130
  spots.push({ x: -260, z: 260, id: n + 1 }); // duplicate position
  return spots;
}

describe('zone feature cell partition', () => {
  const spots = scatter(300);

  it('puts every placement in exactly one cell, by the floor rule', () => {
    const size = 130;
    const cells = partitionByCell(spots, size);
    let total = 0;
    for (const cell of cells) {
      total += cell.spots.length;
      for (const spot of cell.spots) {
        expect(cell.cx * size <= spot.x && spot.x < (cell.cx + 1) * size).toBe(true);
        expect(cell.cz * size <= spot.z && spot.z < (cell.cz + 1) * size).toBe(true);
        expect(cell.key).toBe(`${cell.cx},${cell.cz}`);
      }
    }
    expect(total).toBe(spots.length);
    expect(new Set(cells.map((c) => c.key)).size).toBe(cells.length);
  });

  it('is deterministic and keeps source order inside and across cells', () => {
    const a = partitionByCell(spots, 130);
    const b = partitionByCell(spots, 130);
    expect(a.map((c) => c.key)).toEqual(b.map((c) => c.key));
    for (const cell of a) {
      const ids = cell.spots.map((s) => s.id);
      expect(ids).toEqual([...ids].sort((p, q) => p - q));
    }
    // first-seen order: the cell of the first spot comes first
    expect(a[0].spots[0].id).toBe(0);
    const firstIds = a.map((c) => c.spots[0].id);
    expect(firstIds).toEqual([...firstIds].sort((p, q) => p - q));
  });

  it('keeps the original placement objects, never copies', () => {
    const cells = partitionByCell(spots, 130);
    for (const cell of cells) for (const spot of cell.spots) expect(spots).toContain(spot);
  });

  it('yields one cell holding everything for a non-positive size', () => {
    for (const size of [0, -1, Number.NaN]) {
      const cells = partitionByCell(spots, size);
      expect(cells).toHaveLength(1);
      expect(cells[0].key).toBe('0,0');
      expect(cells[0].spots).toEqual(spots);
    }
  });

  it('yields no cell for no placements', () => {
    expect(partitionByCell([], 130)).toEqual([]);
    expect(partitionByCell([], 0)).toEqual([]);
  });

  it('floors negative coordinates toward minus infinity', () => {
    expect(cellIndex(-0.5, 130)).toBe(-1);
    expect(cellIndex(-130, 130)).toBe(-1);
    expect(cellIndex(-130.5, 130)).toBe(-2);
    expect(cellIndex(0, 130)).toBe(0);
    expect(cellIndex(129.9, 130)).toBe(0);
  });

  it('coarser cells never split a finer cell', () => {
    const fine = partitionByCell(spots, 65);
    const coarse = partitionByCell(spots, 130);
    const coarseOf = new Map<number, string>();
    for (const cell of coarse) for (const spot of cell.spots) coarseOf.set(spot.id, cell.key);
    for (const cell of fine) {
      const parents = new Set(cell.spots.map((s) => coarseOf.get(s.id)));
      expect(parents.size).toBe(1);
    }
  });
});
