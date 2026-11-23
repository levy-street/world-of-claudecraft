import { describe, expect, it } from 'vitest';
import type { AssetPlacement } from '../src/editor/custom_map';
import {
  erasePlacementIndex,
  eraseStampIndex,
  flattenStamp,
  NOISE_HEIGHT_PER_SIZE,
  noiseStamp,
  pickPlacementIndex,
  placementPickRadius,
  smoothKernelSpread,
  smoothSamplePoints,
  smoothStamp,
  stampRegion,
  unionRegion,
} from '../src/editor/stamp_core';
import {
  NOISE_SIZE_MAX,
  NOISE_SIZE_MIN,
  NOISE_STROKE_OVERLAP,
} from '../src/sim/terrain_noise_brush';
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

  it('moves the ground only partway toward the smoothed height (modest strength scaling)', () => {
    // A spike at the center: center = 10, every neighbour 0 (smoothed = 2.5).
    // The target is the smoothed height at any strength; what strength changes
    // is how far the stamp pulls, which is what converges over strokes.
    const sample = (x: number, z: number): number => (x === 0 && z === 0 ? 10 : 0);
    const weak = smoothStamp(0, 0, 8, 1, sample);
    const strong = smoothStamp(0, 0, 8, 30, sample);
    const moved = (st: { delta: number; strength?: number }): number =>
      10 + (st.delta - 10) * (st.strength ?? 1);
    // Both stay strictly between the current height and the smoothed height.
    for (const st of [weak, strong]) {
      expect(moved(st)).toBeLessThan(10);
      expect(moved(st)).toBeGreaterThan(2.5);
    }
    // Higher strength pulls further.
    expect(moved(strong)).toBeLessThan(moved(weak));
  });

  it('applies the 5x gentleness scale to the blend (SCULPT_POWER_SCALE)', () => {
    // Spike: center 10, every neighbour 0. The kernel is the 3x3 binomial one
    // (centre 4, axes 2, diagonals 1, total 16), so the smoothed height is
    // 40/16 = 2.5, and THAT is the target now, with the pull carried on the
    // stamp. At max strength the pre-scale blend saturates at 0.65; scaled by
    // 1/5 it is 0.13, so the ground moves 7.5 * 0.13 = 0.975 at the centre.
    const sample = (x: number, z: number): number => (x === 0 && z === 0 ? 10 : 0);
    const st = smoothStamp(0, 0, 8, 50, sample);
    expect(st.delta).toBeCloseTo(2.5, 6);
    expect(st.strength).toBeCloseTo(0.13, 6);
    expect(10 + (st.delta - 10) * (st.strength ?? 1)).toBeCloseTo(9.025, 2);
  });

  it('never levels a cliff toward a plane the brush cannot see', () => {
    // A sea cliff: flat shelf, then a sheer drop. A least-squares fit across it
    // reports several yards per yard, and extrapolating that to the brush rim
    // is what tore the headland off. The target must stay inside the relief the
    // brush actually sampled.
    const sample = (x: number): number => (x < 0 ? 6 : -38);
    const radius = 12;
    const st = smoothStamp(0, 0, radius, 0.4, sample);
    const rise = Math.hypot(st.gx ?? 0, st.gz ?? 0) * radius;
    expect(rise).toBeLessThanOrEqual((6 - -38) / 2 + 1e-6);
    for (const d of [-radius, -radius / 2, radius / 2, radius]) {
      const target = st.delta + (st.gx ?? 0) * d;
      expect(target, `target at ${d}`).toBeGreaterThanOrEqual(-38);
      expect(target).toBeLessThanOrEqual(6);
    }
  });

  it('leaves a planar slope exactly alone, at every strength', () => {
    // The property the whole brush rests on (SPACEY: "keep the shape of the
    // land"). Ground = a tilted plane; the stamp's target plane must BE that
    // ground, so levelling toward it moves nothing anywhere in the brush.
    const sample = (x: number, z: number): number => 0.3 * x - 0.2 * z + 5;
    for (const strength of [0.2, 1, 5, 10]) {
      const st = smoothStamp(12, -7, 10, strength, sample);
      expect(st.gx ?? 0).toBeCloseTo(0.3, 9);
      expect(st.gz ?? 0).toBeCloseTo(-0.2, 9);
      for (const [dx, dz] of [
        [0, 0],
        [4, 0],
        [-9, 3],
        [2, -8],
      ]) {
        const target = st.delta + (st.gx ?? 0) * dx + (st.gz ?? 0) * dz;
        const ground = sample(12 + dx, -7 + dz);
        expect(target, `strength ${strength} at ${dx},${dz}`).toBeCloseTo(ground, 6);
        // ...so whatever the pull, the ground does not move.
        const moved = ground + (target - ground) * (st.strength ?? 1);
        expect(moved).toBeCloseTo(ground, 6);
      }
    }
  });

  it('looks narrower the gentler the stroke, so low strength only takes off fine detail', () => {
    expect(smoothKernelSpread(0.2)).toBeCloseTo(0.108, 3);
    expect(smoothKernelSpread(5)).toBeCloseTo(0.3, 3);
    expect(smoothKernelSpread(10)).toBeCloseTo(0.5, 3);
    // A ridge 2 yards wide on a 20-yard brush: a gentle stroke sees it (its
    // kernel is ~2 yards across) while it never reaches out to the headland.
    const radius = 20;
    expect(radius * smoothKernelSpread(0.2)).toBeLessThan(3);
    expect(radius * smoothKernelSpread(10)).toBe(10);
  });

  it('shaves a ridge off a slope without moving the slope (the reported bug)', () => {
    // A steep hillside running down to the sea, with a 1-yard sawtooth on it ,
    // SPACEY's screenshot. Applying the stamp the way world.ts applyStamp does,
    // the sawtooth must shrink while the hillside keeps its height.
    const slope = (x: number): number => -0.8 * x;
    const jag = (x: number): number => 0.5 * Math.cos(x * Math.PI); // a crest AT the cursor
    const sample = (x: number): number => slope(x) + jag(x);
    const radius = 12;
    const st = smoothStamp(0, 0, radius, 0.4, sample);
    const apply = (x: number, z: number, h: number): number => {
      const d = Math.hypot(x - st.x, z - st.z);
      if (d >= st.radius) return h;
      const t = d / st.radius;
      const w = 1 - t * t * (3 - 2 * t); // smoothstep taper, as world.ts
      const target = st.delta + (st.gx ?? 0) * (x - st.x) + (st.gz ?? 0) * (z - st.z);
      return h + (target - h) * w * (st.strength ?? 1);
    };
    // At the cursor the jag is pulled toward the local mean...
    const beforeJag = Math.abs(sample(0) - slope(0));
    const afterJag = Math.abs(apply(0, 0, sample(0)) - slope(0));
    expect(afterJag).toBeLessThan(beforeJag);
    // ...while the hillside itself is left where it was: sample the trend at
    // several radii and require the move to stay inside the jag's own amplitude.
    for (const x of [-8, -4, 4, 8]) {
      const moved = apply(x, 0, sample(x)) - sample(x);
      expect(Math.abs(moved), `hillside moved at ${x}`).toBeLessThan(0.6);
    }
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

  it('eases only partway toward the target when strength < 1 (5x-gentler brush)', () => {
    // Current surface at 0, target 10, strength 1/5 => the stamp targets a fifth
    // of the way (delta 2) instead of snapping straight to 10.
    expect(flattenStamp(0, 0, 10, 10, false, 0, 1 / 5).delta).toBeCloseTo(2, 10);
    // The default (no currentHeight/strength) still snaps fully to the target.
    expect(flattenStamp(0, 0, 10, 10, false).delta).toBe(10);
  });
});

describe('noise stamp', () => {
  it('covers the WHOLE brush and carries the stroke pattern (the reported bug)', () => {
    // The old builder shrank every dab to 0.3..0.65 of the brush and gave it a
    // random-sign dome at the cursor: "it just smooths the middle of the brush".
    const s = noiseStamp(10, -4, 25, 6, 8, 0.5, 12345);
    expect(s).toMatchObject({
      x: 10,
      z: -4,
      radius: 25,
      falloff: 'smooth',
      noiseSize: 8,
      noiseSeed: 12345,
      noiseRough: 0.5,
    });
    expect(s.mode).toBeUndefined(); // an add stamp: the runtime scales it by the field
  });

  it('stands a stroke as tall as bump size x strength, split across the overlapping dabs', () => {
    const s = noiseStamp(0, 0, 20, 6, 8, 0.5, 1);
    expect(s.delta).toBeCloseTo((8 * NOISE_HEIGHT_PER_SIZE * 6) / NOISE_STROKE_OVERLAP, 12);
    // Twice the bump size or twice the strength: twice as tall (same character).
    expect(noiseStamp(0, 0, 20, 6, 16, 0.5, 1).delta).toBeCloseTo(s.delta * 2, 12);
    expect(noiseStamp(0, 0, 20, 12, 8, 0.5, 1).delta).toBeCloseTo(s.delta * 2, 12);
  });

  it('keeps bump size and roughness inside the brush range', () => {
    expect(noiseStamp(0, 0, 20, 6, 0.1, -3, 1)).toMatchObject({
      noiseSize: NOISE_SIZE_MIN,
      noiseRough: 0,
    });
    expect(noiseStamp(0, 0, 20, 6, 500, 7, 1)).toMatchObject({
      noiseSize: NOISE_SIZE_MAX,
      noiseRough: 1,
    });
  });

  it('same input gives the same stamp (deterministic)', () => {
    expect(noiseStamp(3, 4, 12, 2, 6, 0.3, 99)).toEqual(noiseStamp(3, 4, 12, 2, 6, 0.3, 99));
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
