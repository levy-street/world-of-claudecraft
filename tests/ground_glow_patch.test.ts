import { describe, expect, it } from 'vitest';
import {
  buildDrapedGlowGeometry,
  PATCH_LIFT,
  PATCH_RING_FRACTIONS,
  PATCH_SPOKES,
  PATCH_VERTS,
} from '../src/render/ground_glow_patch';

// ground_glow_patch: the terrain-draped replacement for the flat glow discs.
// The whole point is that a pool on a slope FOLLOWS the slope instead of the
// hillside slicing through it, so that is what gets pinned: every vertex sits
// on the caller's ground probe plus the lift, whatever shape the ground takes.

const SITES = [
  { x: 0, z: 0, radius: 3 },
  { x: 100, z: -40, radius: 7.5 },
];

/** A steep test hill: nothing about the drape may assume flat ground. */
const hill = (x: number, z: number): number => x * 0.4 - z * 0.25;

describe('buildDrapedGlowGeometry', () => {
  it('merges every site into one indexed draw with the documented vertex count', () => {
    const geo = buildDrapedGlowGeometry(SITES, hill);
    expect(geo.getAttribute('position').count).toBe(SITES.length * PATCH_VERTS);
    expect(geo.getIndex()).not.toBeNull();
    geo.dispose();
  });

  it('drapes every vertex onto the ground probe plus the lift', () => {
    const geo = buildDrapedGlowGeometry(SITES, hill);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // positions land in a Float32 attribute, so the tolerance is Float32's
      expect(pos.getY(i)).toBeCloseTo(hill(x, z) + PATCH_LIFT, 3);
    }
    geo.dispose();
  });

  it('keeps each patch inside its own radius, centred on its site', () => {
    const geo = buildDrapedGlowGeometry(SITES, hill);
    const pos = geo.getAttribute('position');
    for (let s = 0; s < SITES.length; s++) {
      const site = SITES[s];
      for (let v = 0; v < PATCH_VERTS; v++) {
        const i = s * PATCH_VERTS + v;
        const dx = pos.getX(i) - site.x;
        const dz = pos.getZ(i) - site.z;
        expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(site.radius + 1e-3);
      }
    }
    geo.dispose();
  });

  it('maps each patch onto the full radial sprite: centre at (0.5, 0.5), rim on the edge', () => {
    const geo = buildDrapedGlowGeometry(SITES, hill);
    const uv = geo.getAttribute('uv');
    for (let s = 0; s < SITES.length; s++) {
      const base = s * PATCH_VERTS;
      expect(uv.getX(base)).toBeCloseTo(0.5, 6);
      expect(uv.getY(base)).toBeCloseTo(0.5, 6);
      // the outer ring lands on the unit circle inscribed in the sprite
      const outerStart = base + 1 + (PATCH_RING_FRACTIONS.length - 1) * PATCH_SPOKES;
      for (let k = 0; k < PATCH_SPOKES; k++) {
        const du = uv.getX(outerStart + k) - 0.5;
        const dv = uv.getY(outerStart + k) - 0.5;
        expect(Math.hypot(du, dv)).toBeCloseTo(0.5, 6);
      }
    }
    geo.dispose();
  });

  it('faces the patches upward, so the additive material shows from above', () => {
    const geo = buildDrapedGlowGeometry([{ x: 0, z: 0, radius: 2 }], () => 0);
    geo.computeVertexNormals();
    const normal = geo.getAttribute('normal');
    // flat ground: every normal must be straight up, not down
    for (let i = 0; i < normal.count; i++) {
      expect(normal.getY(i)).toBeGreaterThan(0.99);
    }
    geo.dispose();
  });
});
