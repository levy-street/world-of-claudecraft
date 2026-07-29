import { describe, expect, it } from 'vitest';
import type { AssetPlacement } from '../src/editor/custom_map';
import {
  erasePlacementIndex,
  eraseStampIndex,
  flattenStamp,
  pickPlacementIndex,
  placementPickRadius,
  smoothSamplePoints,
  smoothStamp,
  stampRegion,
  unionRegion,
} from '../src/editor/stamp_core';
import type { HeightStamp } from '../src/sim/types';

// Pure sculpt math: the Smooth/Flatten level-stamp builders (driven by an
// injected synthetic heightfield) and the Erase hit tests.

describe('smooth stamp', () => {
  it('samples five points: center plus four at half radius', () => {
    const pts = smoothSamplePoints(10, 20, 8);
    expect(pts).toEqual([
      { x: 10, z: 20 },
      { x: 14, z: 20 },
      { x: 6, z: 20 },
      { x: 10, z: 24 },
      { x: 10, z: 16 },
    ]);
  });

  it('is a level-mode smooth-falloff stamp pulling toward the local average', () => {
    // A tilted plane: height = x. Average around (10, 0) equals the center
    // height (10), so the target stays 10 regardless of strength.
    const s = smoothStamp(10, 0, 8, 15, (x) => x);
    expect(s.mode).toBe('level');
    expect(s.falloff).toBe('smooth');
    expect(s.radius).toBe(8);
    expect(s.delta).toBeCloseTo(10, 10);
  });

  it('moves the target only partway toward the average (modest strength scaling)', () => {
    // A spike at the center: center = 10, the four neighbors = 0 (avg = 2).
    const sample = (x: number, z: number): number => (x === 0 && z === 0 ? 10 : 0);
    const weak = smoothStamp(0, 0, 8, 1, sample);
    const strong = smoothStamp(0, 0, 8, 30, sample);
    // Both stay strictly between the current height and the average.
    expect(weak.delta).toBeLessThan(10);
    expect(weak.delta).toBeGreaterThan(2);
    expect(strong.delta).toBeLessThan(10);
    expect(strong.delta).toBeGreaterThan(2);
    // Higher strength pulls further toward the average.
    expect(strong.delta).toBeLessThan(weak.delta);
  });

  it('same input gives the same stamp (deterministic)', () => {
    const sample = (x: number, z: number): number => Math.sin(x) + Math.cos(z);
    expect(smoothStamp(3, 4, 12, 9, sample)).toEqual(smoothStamp(3, 4, 12, 9, sample));
  });
});

describe('flatten stamp', () => {
  it('levels to the drag-start height with the eased falloff by default', () => {
    const s = flattenStamp(5, 6, 10, 7.25, false);
    expect(s).toEqual({ x: 5, z: 6, radius: 10, delta: 7.25, falloff: 'smooth', mode: 'level' });
  });

  it('uses the flat falloff for a hard plateau edge', () => {
    expect(flattenStamp(0, 0, 10, 3, true).falloff).toBe('flat');
  });
});

describe('erase hit tests', () => {
  const stamps: HeightStamp[] = [
    { x: 0, z: 0, radius: 10, delta: 5, falloff: 'smooth' },
    { x: 3, z: 0, radius: 5, delta: 5, falloff: 'smooth' },
    { x: 100, z: 100, radius: 4, delta: 5, falloff: 'smooth' },
  ];

  it('picks the MOST RECENT stamp whose disc contains the point', () => {
    // (2, 0) is inside both stamp 0 and stamp 1: the later one wins.
    expect(eraseStampIndex(stamps, 2, 0)).toBe(1);
    // (-6, 0) is only inside stamp 0.
    expect(eraseStampIndex(stamps, -6, 0)).toBe(0);
    expect(eraseStampIndex(stamps, 50, 50)).toBe(-1);
  });

  it('boundary points count as hits (distance equal to radius)', () => {
    expect(eraseStampIndex(stamps, 104, 100)).toBe(2);
    expect(eraseStampIndex(stamps, 104.01, 100)).toBe(-1);
  });

  const placements: AssetPlacement[] = [
    { assetId: 'props/a', x: 0, z: 0, rotY: 0, scale: 1, collide: false },
    { assetId: 'props/b', x: 4, z: 0, rotY: 0, scale: 1, collide: false },
    { assetId: 'props/c', x: 40, z: 40, rotY: 0, scale: 1, collide: false },
  ];

  it('picks the NEAREST placement within the brush radius', () => {
    expect(erasePlacementIndex(placements, 3, 0, 6)).toBe(1);
    expect(erasePlacementIndex(placements, 1, 0, 6)).toBe(0);
    expect(erasePlacementIndex(placements, 20, 0, 6)).toBe(-1);
    expect(erasePlacementIndex([], 0, 0, 6)).toBe(-1);
  });
});

describe('placement pick (Select mode)', () => {
  const placements: AssetPlacement[] = [
    { assetId: 'props/a', x: 0, z: 0, rotY: 0, scale: 1, collide: false },
    { assetId: 'props/big', x: 20, z: 0, rotY: 0, scale: 4, collide: false },
  ];

  it('REGRESSION: a bigger placement gets a bigger pick radius, mirroring the 3D viewport', () => {
    // Bug: the 2D Select-mode fallback pick used a FIXED 2-yard radius,
    // ignoring both the placement's own scale and the current 2D zoom,
    // unlike the 3D viewport's scale-aware pickPlacement (which widens its
    // radius to `scale * 2`). At a middling zoom (4 px/yard), a click 3
    // yards from a scale-1 placement misses, but the same distance from a
    // scale-4 placement hits, because its own radius has grown to match.
    expect(pickPlacementIndex(placements, 3, 0, 4)).toBe(-1);
    expect(pickPlacementIndex(placements, 23, 0, 4)).toBe(1);
  });

  it('zooming out grows the world-space pick radius (constant on-screen forgiveness)', () => {
    // Same click, same small placement: at a comfortable zoom it misses, but
    // zoomed way out the fixed on-screen slop now spans more world yards.
    expect(pickPlacementIndex(placements, 3, 0, 4)).toBe(-1);
    expect(pickPlacementIndex(placements, 3, 0, 0.5)).toBe(0);
  });

  it('the nearest of several eligible placements wins', () => {
    const two: AssetPlacement[] = [
      { assetId: 'props/a', x: 0, z: 0, rotY: 0, scale: 1, collide: false },
      { assetId: 'props/b', x: 1, z: 0, rotY: 0, scale: 1, collide: false },
    ];
    expect(pickPlacementIndex(two, 0.6, 0, 4)).toBe(1);
  });

  it('returns -1 for an empty placement list or a genuine miss', () => {
    expect(pickPlacementIndex([], 0, 0, 4)).toBe(-1);
    expect(pickPlacementIndex(placements, 500, 500, 4)).toBe(-1);
  });

  it('never shrinks below the floor even at extreme zoom-in', () => {
    expect(placementPickRadius(1, 1000)).toBeGreaterThanOrEqual(1.5);
  });
});

describe('stroke regions', () => {
  it('stampRegion bounds the stamp influence disc', () => {
    expect(stampRegion({ x: 5, z: -3, radius: 10, delta: 1, falloff: 'smooth' })).toEqual({
      minX: -5,
      minZ: -13,
      maxX: 15,
      maxZ: 7,
    });
  });

  it('unionRegion accumulates stroke bounds and copies the first region', () => {
    const a = { minX: 0, minZ: 0, maxX: 10, maxZ: 10 };
    const first = unionRegion(null, a);
    expect(first).toEqual(a);
    expect(first).not.toBe(a); // defensive copy
    const merged = unionRegion(first, { minX: -5, minZ: 2, maxX: 8, maxZ: 20 });
    expect(merged).toEqual({ minX: -5, minZ: 0, maxX: 10, maxZ: 20 });
  });
});
