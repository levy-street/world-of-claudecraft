// Lofted prisms: a tapered Collision Master volume must collide as the taper
// the maker drew, not as a stack of flat-walled hulls. The slicer emits
// matched bottom/top outlines per band (CollisionPrism.polyLo/polyHi), and
// every height-aware consumer interpolates between them at the mover's own
// feet height (prismPolyAt).
import { describe, expect, it } from 'vitest';
import { type PrismCollider, prismPolyAt } from '../src/sim/colliders';
import { meshToPrisms, polyArea } from '../src/sim/mesh_prisms';
import { sweepCollider } from '../src/sim/physics/sweep';

/** Square frustum: base half-extent b at y=0, top half-extent t at y=h. */
function frustum(b: number, t: number, h: number): { verts: number[]; tris: number[] } {
  const verts = [-b, 0, -b, b, 0, -b, b, 0, b, -b, 0, b, -t, h, -t, t, h, -t, t, h, t, -t, h, t];
  const tris = [
    0,
    2,
    1,
    0,
    3,
    2, // bottom
    4,
    5,
    6,
    4,
    6,
    7, // top
    0,
    1,
    5,
    0,
    5,
    4,
    1,
    2,
    6,
    1,
    6,
    5,
    2,
    3,
    7,
    2,
    7,
    6,
    3,
    0,
    4,
    3,
    4,
    7,
  ];
  return { verts, tris };
}

describe('lofted prisms', () => {
  it('a linear taper is ONE band whose loft matches both ends', () => {
    const prisms = meshToPrisms(frustum(2, 1, 2), 24, 1);
    expect(prisms.length).toBe(1);
    const p = prisms[0];
    expect(p.polyLo).toBeDefined();
    expect(p.polyHi).toBeDefined();
    expect(p.polyLo!.length).toBe(p.poly.length);
    // Bottom section ~ the 4x4 base, top ~ the 2x2 cap.
    expect(polyArea(p.polyLo!)).toBeGreaterThan(14.5);
    expect(polyArea(p.polyLo!)).toBeLessThanOrEqual(16.05);
    expect(polyArea(p.polyHi!)).toBeGreaterThan(3.4);
    expect(polyArea(p.polyHi!)).toBeLessThanOrEqual(4.05);
  });

  it('prismPolyAt interpolates the outline at the feet height', () => {
    const [m] = meshToPrisms(frustum(2, 1, 2), 24, 1);
    const c: PrismCollider = {
      type: 'prism',
      x: 0,
      z: 0,
      poly: m.poly,
      polyLo: m.polyLo,
      polyHi: m.polyHi,
      br: 3,
      baseY: 0,
      moveTopY: 2,
      cameraTopY: 2,
    };
    const at = (y: number): number => {
      const o = prismPolyAt(c, y);
      let maxX = 0;
      for (let i = 0; i < o.length; i += 2) maxX = Math.max(maxX, Math.abs(o[i]));
      return maxX;
    };
    expect(at(0)).toBeCloseTo(2, 1);
    expect(at(2)).toBeCloseTo(1, 1);
    expect(at(1)).toBeCloseTo(1.5, 1);
    // No feet height: the union hull (coverage-complete, base-sized).
    const hull = prismPolyAt(c, undefined);
    let maxX = 0;
    for (let i = 0; i < hull.length; i += 2) maxX = Math.max(maxX, Math.abs(hull[i]));
    expect(maxX).toBeCloseTo(2, 1);
  });

  it('the swept body stops at the taper, not the base hull', () => {
    const [m] = meshToPrisms(frustum(2, 1, 2), 24, 1);
    const c: PrismCollider = {
      type: 'prism',
      x: 0,
      z: 0,
      poly: m.poly,
      polyLo: m.polyLo,
      polyHi: m.polyHi,
      br: 3,
      baseY: 0,
      moveTopY: 2,
      cameraTopY: 2,
    };
    const r = 0.5;
    const out = { t: 0, nx: 0, nz: 0 };
    // Feet at the base: face at x=2, stop at 2 + r.
    expect(sweepCollider(c, 5, 0, -4, 0, r, out, 0)).toBe(true);
    expect(5 - 4 * out.t).toBeCloseTo(2 + r, 1);
    // Feet near the top: face at x~1, the body gets a full yard closer.
    expect(sweepCollider(c, 5, 0, -4, 0, r, out, 1.9)).toBe(true);
    expect(5 - 4 * out.t).toBeLessThan(1.75);
  });
});
