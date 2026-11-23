// Regression: the swept solver must collide a Collision Master PRISM against
// its EXACT convex outline, never its axis-aligned bounding box. A placement
// bakes its yaw into the poly, so a building rotated 45 degrees had a box
// sqrt(2) its size, the sweep stopped the body at a phantom axis-aligned
// wall yards before the drawn face ("invisible walls near the wireframe",
// only on rotated buildings), while depenetration and the debug wireframe
// both used the outline.
import { describe, expect, it } from 'vitest';
import type { PrismCollider } from '../src/sim/colliders';
import { overlapCollider, sweepCollider } from '../src/sim/physics/sweep';

// A unit square rotated 45 degrees: corners at (+-h, 0), (0, +-h).
function diamond(h: number): PrismCollider {
  return {
    type: 'prism',
    x: 0,
    z: 0,
    poly: [h, 0, 0, h, -h, 0, 0, -h],
    br: h,
    baseY: 0,
    moveTopY: 10,
    cameraTopY: 10,
  };
}

describe('exact prism sweep', () => {
  it('stops at the rotated face, not the bounding box', () => {
    const c = diamond(4); // AABB half-extent 4; the 45deg face is closer
    const r = 0.5;
    const out = { t: 0, nx: 0, nz: 0 };
    // Walk straight at the face centre from (-6, -6) toward the origin: the
    // face plane x+z = -4 (normal (-1,-1)/sqrt2) is hit at distance
    // |(-6,-6) to plane| - r along the diagonal.
    const hit = sweepCollider(c, -6, -6, 4, 4, r, out);
    expect(hit).toBe(true);
    const hx = -6 + 4 * out.t;
    const hz = -6 + 4 * out.t;
    // Distance from the hit point to the face plane must be the body radius.
    const planeDist = Math.abs(hx + hz + 4) / Math.SQRT2;
    expect(planeDist).toBeCloseTo(r, 3);
    // The old box version stopped at x = -4 - r = -4.5; the face is at
    // x+z=-4, i.e. x = -2 - r/sqrt2 ~ -2.35 on this diagonal. Assert we got
    // meaningfully PAST the box wall.
    expect(hx).toBeGreaterThan(-3.0);
    // Normal is the face normal, not an axis.
    expect(out.nx).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(out.nz).toBeCloseTo(-Math.SQRT1_2, 3);
  });

  it('does not block in the box-corner dead zone', () => {
    const c = diamond(4);
    const r = 0.5;
    const out = { t: 0, nx: 0, nz: 0 };
    // (-3.5, -3.5) is INSIDE the old bounding box (|x|,|z| < 4.5) but 0.95yd
    // outside the inflated outline. Sliding along the face direction must be
    // free motion, not a t=0 wall.
    const hit = sweepCollider(c, -3.5, -3.5, 0.7, -0.7, r, out);
    expect(hit === false || out.t > 0.99).toBe(true);
    const ov = { nx: 0, nz: 0, depth: 0 };
    expect(overlapCollider(c, -3.5, -3.5, r, ov)).toBe(false);
  });

  it('overlap escapes along the face normal with outline depth', () => {
    const c = diamond(4);
    const ov = { nx: 0, nz: 0, depth: 0 };
    // 0.2 inside the inflated face along the diagonal.
    const d = (4 / Math.SQRT2 - 0.2) / 1; // point at (-x, -x) with x = ...
    const px = -(d / Math.SQRT2 + 0);
    expect(overlapCollider(c, px, px, 0.5, ov)).toBe(true);
    expect(ov.nx).toBeCloseTo(-Math.SQRT1_2, 2);
    expect(ov.nz).toBeCloseTo(-Math.SQRT1_2, 2);
    // Pushing out by depth along the normal clears the surface.
    const cx = px + ov.nx * ov.depth;
    expect(overlapCollider(c, cx, px + ov.nz * ov.depth, 0.5, ov)).toBe(false);
  });

  it('vertex arcs round the corners', () => {
    const c = diamond(2);
    const r = 0.5;
    const out = { t: 0, nx: 0, nz: 0 };
    // Straight at the (2, 0) corner from the east.
    const hit = sweepCollider(c, 4, 0, -2, 0, r, out);
    expect(hit).toBe(true);
    const hx = 4 - 2 * out.t;
    expect(hx).toBeCloseTo(2 + r, 3);
    expect(out.nx).toBeCloseTo(1, 3);
  });
});
