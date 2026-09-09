// The closed-form bounding sphere that lets the draped ground marks (shock
// rings, dissolve decals, buff ground auras) go back to being frustum-culled.
// Each pin is the property the culling depends on: the sphere must CONTAIN the
// draped shape (never cull something on screen) and must stay tight enough to
// be worth having.

import { describe, expect, it } from 'vitest';
import { drapedBoundingSphere, drapeExtent } from '../src/render/draped_bounds_core';

/** Every vertex of a flat disc of `flatRadius` displaced by one of the drape
 *  values, checked against the sphere. */
function contains(
  flatRadius: number,
  drapes: number[],
  sphere: { center: number; radius: number },
): boolean {
  const rim = 24;
  for (const drape of drapes) {
    for (let i = 0; i < rim; i++) {
      const angle = (i / rim) * Math.PI * 2;
      const x = Math.cos(angle) * flatRadius;
      const z = Math.sin(angle) * flatRadius;
      const y = drape - sphere.center;
      if (Math.hypot(x, y, z) > sphere.radius + 1e-9) return false;
    }
  }
  return true;
}

describe('drapedBoundingSphere', () => {
  it('is the flat radius when nothing is draped', () => {
    const sphere = drapedBoundingSphere(1, 0, 0);
    expect(sphere.center).toBe(0);
    expect(sphere.radius).toBe(1);
  });

  it('centres on the drape midpoint rather than the flat plane', () => {
    // A disc draped entirely BELOW its anchor (a mark on a downhill slope) must
    // not carry the whole span as radius on the uphill side too.
    const sphere = drapedBoundingSphere(1, -0.6, -0.2);
    expect(sphere.center).toBeCloseTo(-0.4, 10);
    expect(sphere.radius).toBeCloseTo(Math.hypot(1, 0.2), 10);
    expect(sphere.radius).toBeLessThan(drapedBoundingSphere(1, -0.6, 0).radius);
  });

  it('contains every draped vertex, uphill and downhill', () => {
    for (const [low, high] of [
      [0, 0],
      [-0.05, 0.05],
      [-1.4, 0.9],
      [0.2, 3],
      [-3, -0.2],
    ]) {
      const sphere = drapedBoundingSphere(1, low, high);
      expect(contains(1, [low, high, (low + high) / 2], sphere)).toBe(true);
    }
  });

  it('grows with the drape span, so a steep slope is never clipped', () => {
    const gentle = drapedBoundingSphere(1, -0.05, 0.05);
    const steep = drapedBoundingSphere(1, -2, 2);
    expect(steep.radius).toBeGreaterThan(gentle.radius);
    expect(gentle.radius).toBeCloseTo(Math.hypot(1, 0.05), 10);
  });

  it('takes the endpoints in either order', () => {
    expect(drapedBoundingSphere(1, 0.8, -0.4)).toEqual(drapedBoundingSphere(1, -0.4, 0.8));
  });

  it('treats a negative flat radius as zero rather than folding it in', () => {
    expect(drapedBoundingSphere(-1, -1, 1).radius).toBeCloseTo(1, 10);
  });
});

describe('drapeExtent', () => {
  it('reads the min and max of the live prefix', () => {
    const [low, high] = drapeExtent(new Float32Array([0.2, -0.5, 1.4, 0.1]));
    expect(low).toBeCloseTo(-0.5, 6);
    expect(high).toBeCloseTo(1.4, 6);
  });

  it('honours an explicit count, so a partly filled buffer is not read past', () => {
    const [low, high] = drapeExtent(new Float32Array([0.2, -0.5, 99, 99]), 2);
    expect(low).toBeCloseTo(-0.5, 6);
    expect(high).toBeCloseTo(0.2, 6);
  });

  it('is flat for an empty range', () => {
    expect(drapeExtent(new Float32Array(0))).toEqual([0, 0]);
    expect(drapeExtent(new Float32Array([1, 2]), 0)).toEqual([0, 0]);
  });

  it('handles a constant drape', () => {
    const [low, high] = drapeExtent(new Float32Array([0.3, 0.3, 0.3]));
    expect(low).toBeCloseTo(0.3, 6);
    expect(high).toBeCloseTo(0.3, 6);
  });
});
