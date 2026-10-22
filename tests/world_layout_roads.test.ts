import { describe, expect, it } from 'vitest';
import { placeLayoutRoads } from '../src/sim/world_layout/roads';
import type { LayoutRoad, RoadLayout } from '../src/sim/world_layout/types';

const a: LayoutRoad = [
  { x: 0, z: 0 },
  { x: 1, z: 1 },
];
const b: LayoutRoad = [
  { x: 2, z: 2 },
  { x: 3, z: 3 },
];
const moved: LayoutRoad = [
  { x: 10, z: 10 },
  { x: 11, z: 11 },
];
const layout: RoadLayout = {
  edits: [{ source: a, points: moved }],
  additions: [{ id: 'new-path', points: b }],
};

describe('canonical road layout composition', () => {
  it('binds by geometry across reorder and preserves newer roads', () => {
    const newer = [
      { x: 40, z: 40 },
      { x: 50, z: 50 },
    ];
    const base = [newer, a];
    const result = placeLayoutRoads(base, layout);
    expect(result).toEqual([newer, moved, b]);
    expect(result[0]).toBe(newer);
    expect(base).toEqual([newer, a]);
    expect(placeLayoutRoads(base)).toBe(base);
  });

  it('rejects changed or ambiguous source geometry rather than falling back to index', () => {
    expect(() => placeLayoutRoads([b], layout)).toThrow('missing or ambiguous');
    expect(() => placeLayoutRoads([a, a], layout)).toThrow('missing or ambiguous');
    expect(() =>
      placeLayoutRoads([a], { ...layout, edits: [...layout.edits, ...layout.edits] }),
    ).toThrow('Duplicate');
  });

  it('removes only the explicitly named road and rejects malformed or duplicate additions', () => {
    expect(
      placeLayoutRoads([a, b], { edits: [{ source: a, points: null }], additions: [] }),
    ).toEqual([b]);
    expect(() =>
      placeLayoutRoads([a], { edits: [], additions: [...layout.additions, ...layout.additions] }),
    ).toThrow('duplicate');
    expect(() =>
      placeLayoutRoads([a], {
        edits: [
          {
            source: a,
            points: [
              { x: NaN, z: 1 },
              { x: 0, z: 0 },
            ],
          },
        ],
        additions: [],
      }),
    ).toThrow('Invalid');
  });
});
