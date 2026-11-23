import { describe, expect, it } from 'vitest';
import { addGrassClearStamp, grassClearedAt } from '../src/sim/grass_clear';

describe('grassClearedAt', () => {
  it('is false with no regions', () => {
    expect(grassClearedAt(undefined, 0, 0)).toBe(false);
    expect(grassClearedAt([], 5, 5)).toBe(false);
  });

  it('tests point-in-disc, inclusive of the edge', () => {
    const regions = [{ x: 100, z: 50, r: 10 }];
    expect(grassClearedAt(regions, 100, 50)).toBe(true); // center
    expect(grassClearedAt(regions, 108, 50)).toBe(true); // inside
    expect(grassClearedAt(regions, 110, 50)).toBe(true); // exactly on the edge
    expect(grassClearedAt(regions, 111, 50)).toBe(false); // just outside
    expect(grassClearedAt(regions, 100, 61)).toBe(false); // outside along z
  });

  it('resolves across bucket boundaries (a big disc spans many index cells)', () => {
    // r=200 >> the 32yd bucket size: the query must find it far from center.
    const regions = [{ x: 0, z: 0, r: 200 }];
    expect(grassClearedAt(regions, 150, 120)).toBe(true);
    expect(grassClearedAt(regions, -180, 40)).toBe(true);
    expect(grassClearedAt(regions, 300, 0)).toBe(false);
  });

  it('handles many discs via the spatial index', () => {
    const regions = Array.from({ length: 500 }, (_, i) => ({ x: i * 40, z: 0, r: 5 }));
    expect(grassClearedAt(regions, 40 * 250, 0)).toBe(true); // a middle disc's center
    expect(grassClearedAt(regions, 40 * 250 + 20, 0)).toBe(false); // between discs
  });
});

describe('addGrassClearStamp', () => {
  it('adds a new disc', () => {
    const out = addGrassClearStamp([], { x: 1, z: 2, r: 3 });
    expect(out).toEqual([{ x: 1, z: 2, r: 3 }]);
  });

  it('drops a stamp already fully contained by an existing disc', () => {
    const base = [{ x: 0, z: 0, r: 10 }];
    // A smaller disc well inside the big one adds nothing (same array back).
    const out = addGrassClearStamp(base, { x: 1, z: 1, r: 2 });
    expect(out).toBe(base);
  });

  it('keeps a stamp that pokes outside an existing disc', () => {
    const base = [{ x: 0, z: 0, r: 10 }];
    const out = addGrassClearStamp(base, { x: 8, z: 0, r: 5 }); // reaches to x=13 > 10
    expect(out).toHaveLength(2);
  });
});
