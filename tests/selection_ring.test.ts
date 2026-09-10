import { describe, it, expect } from 'vitest';
import { drapeRingLocalY, selectionRingScale } from '../src/render/selection_ring';

// A small square ring footprint (unit radius) sampled at the four cardinal
// points, expressed as the flat [x0,z0, x1,z1, ...] layout the renderer caches.
const RING_XZ = new Float32Array([
  1, 0,   // +X
  -1, 0,  // -X
  0, 1,   // +Z
  0, -1,  // -Z
]);

describe('drapeRingLocalY', () => {
  it('on flat ground every vertex sits at exactly the lift height', () => {
    const out = new Float32Array(4);
    drapeRingLocalY(RING_XZ, 10, 20, 0, 1, 0.08, () => 0, out);
    for (const y of out) expect(y).toBeCloseTo(0.08, 6);
  });

  it('drapes over a slope: uphill vertices rise, downhill vertices drop', () => {
    // ground rises 1 unit per unit of world X.
    const sample = (x: number) => x;
    const out = new Float32Array(4);
    // center at world x=10, baseY = ground at center = 10.
    drapeRingLocalY(RING_XZ, 10, 0, 10, 1, 0, sample, out);
    // +X vertex is at world x=11 (ground 11) -> local y = 11 - 10 = +1.
    expect(out[0]).toBeCloseTo(1, 6);
    // -X vertex is at world x=9 (ground 9) -> local y = 9 - 10 = -1.
    expect(out[1]).toBeCloseTo(-1, 6);
    // vertices on the contour (z axis) stay at center height.
    expect(out[2]).toBeCloseTo(0, 6);
    expect(out[3]).toBeCloseTo(0, 6);
  });

  it('every vertex ends up on or above the terrain (never buried)', () => {
    const sample = (x: number, z: number) => Math.sin(x) + Math.cos(z) * 0.5;
    const cx = 3.2, cz = -1.7;
    const baseY = sample(cx, cz);
    const out = new Float32Array(4);
    const lift = 0.08;
    drapeRingLocalY(RING_XZ, cx, cz, baseY, 1, lift, sample, out);
    for (let i = 0; i < 4; i++) {
      const wx = cx + RING_XZ[i * 2];
      const wz = cz + RING_XZ[i * 2 + 1];
      const worldY = baseY + out[i]; // scale = 1
      // world Y of the vertex must clear the ground there by exactly `lift`.
      expect(worldY).toBeCloseTo(sample(wx, wz) + lift, 6);
    }
  });

  it('accounts for mesh scale when sampling and when emitting local Y', () => {
    const sample = (x: number) => x; // slope of 1 in X
    const cx = 0, cz = 0, baseY = 0, scale = 2, lift = 0;
    const out = new Float32Array(4);
    drapeRingLocalY(RING_XZ, cx, cz, baseY, scale, lift, sample, out);
    // +X vertex lands at world x = cx + scale*1 = 2 -> ground 2.
    // world Y must be 2, and world Y = baseY + scale*localY = 2*localY,
    // so localY = 1.
    expect(out[0]).toBeCloseTo(1, 6);
    expect(out[1]).toBeCloseTo(-1, 6);
  });
});

describe('selectionRingScale', () => {
  it('leaves an ordinary (reference-height-or-taller) target unchanged', () => {
    expect(selectionRingScale(1, 1.8)).toBeCloseTo(1, 6);
    expect(selectionRingScale(1, 2.6)).toBeCloseTo(1, 6); // HUMANOID_H, taller than the reference
    expect(selectionRingScale(2.25, 2.2)).toBeCloseTo(2.25, 6); // a scaled-up elite mob
  });

  it('shrinks the ring for a target authored shorter than the reference', () => {
    // A frog buddy: height 0.35, scale 0.9 (src/render/characters/manifest.ts,
    // src/sim/content/buddy_mobs.ts). Naive scale-only sizing (the pre-fix
    // behavior) would have handed this the full 0.9.
    const s = selectionRingScale(0.9, 0.35);
    expect(s).toBeLessThan(0.9);
    expect(s).toBeCloseTo(0.9 * (0.35 / 1.8), 6);
  });

  it('never grows the ring past the caller-supplied entity scale', () => {
    for (const height of [0, 0.1, 0.9, 1.8, 5]) {
      expect(selectionRingScale(1, height)).toBeLessThanOrEqual(1);
    }
  });

  it('the rarity-tier buddies (3x scale) still shrink well below their raw scale', () => {
    // cate_coin/alon/trollface/triple_t: scale 2.7, height <= 0.9 — the exact
    // case that read as a wildly oversized reticle before this fix.
    const s = selectionRingScale(2.7, 0.4);
    expect(s).toBeLessThan(1);
  });
});
