import { describe, expect, it } from 'vitest';
import { type BiomeBrush, visitBiomeBrushCells } from '../src/editor/biome_brush_core';
import type { BiomePaint } from '../src/sim/types';

const grid = (): BiomePaint => ({
  cell: 1,
  cols: 8,
  rows: 8,
  originX: -4,
  originZ: -4,
  ids: Array(64).fill(255),
});
const brush: BiomeBrush = { x: 0, z: 0, radius: 2, hardness: 1 };
function hits(options: Partial<BiomeBrush> = {}, target = grid()): number[] {
  const indices: number[] = [];
  visitBiomeBrushCells(target, { ...brush, ...options }, 3, (i) => indices.push(i));
  return indices;
}

describe('biome brush footprint', () => {
  it('keeps the circular default and adds square corner cells with straight edges', () => {
    expect(hits()).toEqual([19, 20, 26, 27, 28, 29, 34, 35, 36, 37, 43, 44]);
    expect(hits({ shape: 'circle' })).toEqual(hits());
    expect(hits({ shape: 'square' })).toEqual([
      18, 19, 20, 21, 26, 27, 28, 29, 34, 35, 36, 37, 42, 43, 44, 45,
    ]);
  });

  it('clips square strokes to valid map cells, even far outside the map', () => {
    expect(hits({ shape: 'square', x: -4, z: -4 })).toEqual([0, 1, 8, 9]);
    expect(hits({ shape: 'square', x: -100, z: -100 })).toEqual([]);
  });

  it('keeps soft-square coverage deterministic and inside the hard square', () => {
    const soft = hits({ shape: 'square', hardness: 0 });
    expect(soft).toEqual(hits({ shape: 'square', hardness: 0 }));
    expect(soft.length).toBeGreaterThan(0);
    expect(soft.length).toBeLessThan(16);
    expect(soft.every((index) => hits({ shape: 'square' }).includes(index))).toBe(true);
  });

  it('applies alpha masks across square corners and supports erase without out-of-bounds writes', () => {
    const target = grid();
    visitBiomeBrushCells(
      target,
      { ...brush, shape: 'square', sampleAlpha: (u) => (u > 0 ? 1 : 0) },
      3,
      (index) => {
        target.ids[index] = 3;
      },
    );
    expect(target.ids.filter((id) => id === 3)).toHaveLength(8);
    expect(target.ids[45]).toBe(3);
    const previous = new Map<number, number>();
    visitBiomeBrushCells(target, { ...brush, shape: 'square' }, 255, (index) => {
      previous.set(index, target.ids[index]);
      target.ids[index] = 255;
    });
    expect(previous.size).toBe(8);
    expect(target.ids.every((id) => id === 255)).toBe(true);
    for (const [index, id] of previous) target.ids[index] = id;
    expect(target.ids.filter((id) => id === 3)).toHaveLength(8);
    expect(hits({ radius: 0 }, target)).toEqual([]);
  });
});
