import { describe, expect, it } from 'vitest';
import { makeRng, scatterHills, scatterPlacements } from '../src/editor/procgen';

const BOUNDS = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };

describe('makeRng', () => {
  it('is deterministic for a seed and varies across seeds', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seq = (r: () => number) => [r(), r(), r(), r()];
    expect(seq(a)).toEqual(seq(b));
    expect(seq(makeRng(42))).not.toEqual(seq(makeRng(43)));
  });

  it('stays within [0, 1)', () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('scatterPlacements', () => {
  it('is reproducible for the same seed', () => {
    const params = {
      assetIds: ['foliage/oak_1', 'foliage/pine_1'],
      count: 50,
      bounds: BOUNDS,
      seed: 123,
      minScale: 0.8,
      maxScale: 1.4,
    };
    expect(scatterPlacements(params)).toEqual(scatterPlacements(params));
  });

  it('places within bounds and uses only the given assets', () => {
    const ids = ['props/well', 'props/cart'];
    const out = scatterPlacements({
      assetIds: ids,
      count: 100,
      bounds: BOUNDS,
      seed: 1,
      minScale: 1,
      maxScale: 1,
    });
    expect(out).toHaveLength(100);
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(BOUNDS.minX);
      expect(p.x).toBeLessThanOrEqual(BOUNDS.maxX);
      expect(p.z).toBeGreaterThanOrEqual(BOUNDS.minZ);
      expect(p.z).toBeLessThanOrEqual(BOUNDS.maxZ);
      expect(ids).toContain(p.assetId);
      expect(p.rotY).toBeGreaterThanOrEqual(0);
      expect(p.rotY).toBeLessThan(Math.PI * 2);
    }
  });

  it('honours the avoid predicate', () => {
    // Reject the left half; everything must land on the right.
    const out = scatterPlacements({
      assetIds: ['props/well'],
      count: 40,
      bounds: BOUNDS,
      seed: 9,
      minScale: 1,
      maxScale: 1,
      avoid: (x) => x < 0,
    });
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) expect(p.x).toBeGreaterThanOrEqual(0);
  });

  it('returns nothing with no assets', () => {
    expect(
      scatterPlacements({
        assetIds: [],
        count: 10,
        bounds: BOUNDS,
        seed: 1,
        minScale: 1,
        maxScale: 1,
      }),
    ).toEqual([]);
  });
});

describe('scatterHills', () => {
  it('makes reproducible smooth raised stamps within bounds', () => {
    const params = {
      count: 20,
      bounds: BOUNDS,
      seed: 5,
      minRadius: 10,
      maxRadius: 30,
      minHeight: 5,
      maxHeight: 15,
    };
    const a = scatterHills(params);
    expect(a).toEqual(scatterHills(params));
    for (const s of a) {
      expect(s.falloff).toBe('smooth');
      expect(s.radius).toBeGreaterThanOrEqual(10);
      expect(s.delta).toBeGreaterThanOrEqual(5);
      expect(s.x).toBeGreaterThanOrEqual(BOUNDS.minX);
    }
  });
});
