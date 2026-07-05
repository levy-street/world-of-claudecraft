// Unit tests for src/sim/geometry2d.ts: pure 2D polygon helpers, no DOM/rng deps.
import { describe, expect, it } from 'vitest';
import {
  polygonContainsPoint,
  polygonIsStarShaped,
  polygonSelfIntersects,
  polygonSignedArea,
  polygonXAtZ,
} from '../src/sim/geometry2d';

// A simple axis-aligned CCW square (x right, z "up" in signed-area terms).
const SQUARE_CCW = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
  { x: 0, z: 10 },
];

const SQUARE_CW = [...SQUARE_CCW].reverse();

const TRIANGLE_CCW = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 5, z: 10 },
];

// An L-shape: star-shaped from a pole deep in the "elbow", but NOT star-shaped
// from a pole placed in a spot that cannot see into the far arm of the L.
const L_SHAPE_CCW = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 4 },
  { x: 4, z: 4 },
  { x: 4, z: 10 },
  { x: 0, z: 10 },
];

// A bowtie: two triangles sharing a crossing at the middle. Self-intersecting.
const BOWTIE = [
  { x: 0, z: 0 },
  { x: 10, z: 10 },
  { x: 10, z: 0 },
  { x: 0, z: 10 },
];

describe('polygonSignedArea', () => {
  it('is positive for a CCW square', () => {
    expect(polygonSignedArea(SQUARE_CCW)).toBeGreaterThan(0);
    expect(polygonSignedArea(SQUARE_CCW)).toBeCloseTo(100, 5);
  });

  it('is negative for the same square wound CW', () => {
    expect(polygonSignedArea(SQUARE_CW)).toBeLessThan(0);
    expect(polygonSignedArea(SQUARE_CW)).toBeCloseTo(-100, 5);
  });

  it('is positive for a CCW triangle', () => {
    expect(polygonSignedArea(TRIANGLE_CCW)).toBeGreaterThan(0);
  });
});

describe('polygonContainsPoint', () => {
  it('contains its own centre', () => {
    expect(polygonContainsPoint(SQUARE_CCW, 5, 5)).toBe(true);
  });

  it('excludes a point well outside the bounds', () => {
    expect(polygonContainsPoint(SQUARE_CCW, 20, 20)).toBe(false);
    expect(polygonContainsPoint(SQUARE_CCW, -5, 5)).toBe(false);
  });

  it('works for a CW-wound polygon too (winding-independent)', () => {
    expect(polygonContainsPoint(SQUARE_CW, 5, 5)).toBe(true);
    expect(polygonContainsPoint(SQUARE_CW, 20, 20)).toBe(false);
  });

  it('contains the interior of a triangle but not points outside it', () => {
    expect(polygonContainsPoint(TRIANGLE_CCW, 5, 3)).toBe(true);
    expect(polygonContainsPoint(TRIANGLE_CCW, 9, 9)).toBe(false);
  });

  it('respects the L-shape notch (a point in the missing corner is outside)', () => {
    // The L covers [0,10]x[0,10] minus the [4,10]x[4,10] corner.
    expect(polygonContainsPoint(L_SHAPE_CCW, 2, 2)).toBe(true); // in the foot
    expect(polygonContainsPoint(L_SHAPE_CCW, 2, 8)).toBe(true); // in the tall arm
    expect(polygonContainsPoint(L_SHAPE_CCW, 8, 8)).toBe(false); // in the notched-out corner
  });
});

describe('polygonIsStarShaped', () => {
  it('a square is star-shaped from its centre', () => {
    expect(polygonIsStarShaped(SQUARE_CCW, { x: 5, z: 5 })).toBe(true);
  });

  it('a square is NOT star-shaped from a pole outside it', () => {
    expect(polygonIsStarShaped(SQUARE_CCW, { x: 50, z: 50 })).toBe(false);
  });

  it('a triangle is star-shaped from its centroid', () => {
    expect(polygonIsStarShaped(TRIANGLE_CCW, { x: 5, z: 3.3 })).toBe(true);
  });

  it('the L-shape is star-shaped from a pole in the elbow that sees both arms', () => {
    expect(polygonIsStarShaped(L_SHAPE_CCW, { x: 3, z: 3 })).toBe(true);
  });

  it('the L-shape is NOT star-shaped from a pole tucked in the tall arm tip', () => {
    // From deep in the tall thin arm (x=1,z=9) the far foot corner (x=9,z=1) is
    // occluded by the inner reflex corner at (4,4): that edge's line has the
    // pole on the wrong side, so the pole is outside the visibility kernel.
    expect(polygonIsStarShaped(L_SHAPE_CCW, { x: 1, z: 9 })).toBe(false);
  });
});

describe('polygonSelfIntersects', () => {
  it('is false for a simple square', () => {
    expect(polygonSelfIntersects(SQUARE_CCW)).toBe(false);
  });

  it('is false for a simple triangle', () => {
    expect(polygonSelfIntersects(TRIANGLE_CCW)).toBe(false);
  });

  it('is false for the simple (non-crossing) L-shape', () => {
    expect(polygonSelfIntersects(L_SHAPE_CCW)).toBe(false);
  });

  it('is true for a bowtie', () => {
    expect(polygonSelfIntersects(BOWTIE)).toBe(true);
  });
});

describe('polygonXAtZ', () => {
  it('finds the west (-1) and east (+1) boundary x of a square at a mid height', () => {
    expect(polygonXAtZ(SQUARE_CCW, 5, -1)).toBeCloseTo(0, 5);
    expect(polygonXAtZ(SQUARE_CCW, 5, 1)).toBeCloseTo(10, 5);
  });

  it('returns null outside the polygon z-range', () => {
    expect(polygonXAtZ(SQUARE_CCW, -5, -1)).toBeNull();
    expect(polygonXAtZ(SQUARE_CCW, 15, 1)).toBeNull();
  });

  it('finds the boundary x for a triangle apex-up at a low height', () => {
    // At z=0 the triangle spans the full base [0,10].
    expect(polygonXAtZ(TRIANGLE_CCW, 0, -1)).toBeCloseTo(0, 5);
    expect(polygonXAtZ(TRIANGLE_CCW, 0, 1)).toBeCloseTo(10, 5);
  });

  it('narrows toward the apex as z increases', () => {
    const westAt5 = polygonXAtZ(TRIANGLE_CCW, 5, -1);
    const eastAt5 = polygonXAtZ(TRIANGLE_CCW, 5, 1);
    expect(westAt5).not.toBeNull();
    expect(eastAt5).not.toBeNull();
    if (westAt5 === null || eastAt5 === null) return;
    expect(eastAt5 - westAt5).toBeLessThan(10);
    expect(eastAt5 - westAt5).toBeGreaterThan(0);
  });
});
