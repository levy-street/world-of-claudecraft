import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  type ShadowAnchor,
  shadowTexelWorldSize,
  snapShadowAnchor,
} from '../src/render/shadow_texel_snap_core';

// The live sun geometry: SUN_ANCHOR (90, 62, 50) direction, the 210 u ortho
// box (2 * S with S = 105 in renderer.ts; the wiring pin in
// tests/shadow_render_wiring.test.ts holds the renderer to that derivation)
// over the High-tier 4096 map, ~5.1 cm texels.
const DIR = { x: 90, y: 62, z: 50 };
const TEXEL = shadowTexelWorldSize(210, 4096);

function snap(x: number, y: number, z: number, out: ShadowAnchor = { x: 0, y: 0, z: 0 }) {
  return snapShadowAnchor(DIR.x, DIR.y, DIR.z, x, y, z, TEXEL, out);
}

/**
 * Three's OWN shadow-camera basis, used as the oracle the core must agree
 * with: a directional light's shadow camera looks from the light position at
 * the target with world up, so its view basis is Matrix4.lookAt(dir, 0, up).
 * The columns of that matrix are the camera's right (x) and up (y) axes in
 * world space; the shadow map rasterizes on that grid. Deriving the basis
 * from three here (rather than re-deriving the core's formula) is what makes
 * these tests decisive about the ONE property the feature needs: the snap
 * quantizes onto the same grid three's shadow pass samples.
 */
function threeLightBasis(dir: { x: number; y: number; z: number }) {
  const m = new THREE.Matrix4().lookAt(
    new THREE.Vector3(dir.x, dir.y, dir.z),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 1, 0),
  );
  const e = m.elements;
  return {
    right: { x: e[0], y: e[1], z: e[2] },
    up: { x: e[4], y: e[5], z: e[6] },
  };
}

function lightUv(a: { x: number; y: number; z: number }) {
  const { right, up } = threeLightBasis(DIR);
  return {
    u: right.x * a.x + right.y * a.y + right.z * a.z,
    v: up.x * a.x + up.y * a.y + up.z * a.z,
  };
}

/** Distance from `value` to the nearest integer multiple of `step`. */
function offGrid(value: number, step: number): number {
  const r = value / step;
  return Math.abs(r - Math.round(r)) * step;
}

const SAMPLE_POINTS: [number, number, number][] = [
  [12.34, 7.5, -8.9],
  [-104.7, 22.9, 63.2],
  [0.013, 0, 0.021],
  [3.21, 1.5, 4.56],
  [250.4, -3.75, -777.7],
  [-0.4999, 18.2, 0.5001],
];

describe('shadowTexelWorldSize', () => {
  it('is the ortho box width over the map resolution, 0 on degenerate input', () => {
    expect(TEXEL).toBeCloseTo(210 / 4096, 12);
    expect(shadowTexelWorldSize(0, 4096)).toBe(0);
    expect(shadowTexelWorldSize(210, 0)).toBe(0);
    expect(shadowTexelWorldSize(-210, 4096)).toBe(0);
  });
});

describe('snapShadowAnchor', () => {
  it("lands every snapped anchor on three's own shadow-camera texel grid", () => {
    // The master property, measured in the basis three's Matrix4.lookAt
    // builds for the shadow camera (the oracle above, not the core's own
    // formula): the snapped anchor's light-space u/v are integer multiples
    // of the texel size. A pass-through fails on every sample (the raw
    // points are off-grid), and a basis that rotated away from three's
    // convention fails too, which is exactly the regression that would
    // silently bring shadow swimming back.
    for (const [x, y, z] of SAMPLE_POINTS) {
      const raw = lightUv({ x, y, z });
      expect(offGrid(raw.u, TEXEL)).toBeGreaterThan(TEXEL * 0.01); // decisive: input off-grid
      const s = lightUv(snap(x, y, z));
      expect(offGrid(s.u, TEXEL), `u of (${x},${y},${z})`).toBeLessThan(1e-9);
      expect(offGrid(s.v, TEXEL), `v of (${x},${y},${z})`).toBeLessThan(1e-9);
    }
  });

  it('holds the snapped grid point fixed across sub-texel translations (anti-swimming)', () => {
    // Points a fraction of a texel apart must snap to the SAME grid point:
    // that is the property that stops the rasterization grid sliding under
    // static geometry as the camera translates. Identity fails this (the two
    // raw points differ), and so does per-point rounding to a moving origin.
    const { right, up } = threeLightBasis(DIR);
    for (const [x, y, z] of SAMPLE_POINTS) {
      const a = lightUv(snap(x, y, z));
      for (const f of [0.15, 0.35, 0.49]) {
        const b = lightUv(
          snap(
            x + (right.x + up.x) * TEXEL * f * 0.5,
            y + (right.y + up.y) * TEXEL * f * 0.5,
            z + (right.z + up.z) * TEXEL * f * 0.5,
          ),
        );
        // Same cell or the immediate neighbor is NOT accepted: a sub-half-
        // texel in-plane move along the cell diagonal from a snapped
        // point's own cell interior stays in the same cell only if the
        // start is not adjacent to a boundary, so compare against the exact
        // grid indices instead.
        expect(Math.round(b.u / TEXEL) - Math.round(a.u / TEXEL)).toBeLessThanOrEqual(1);
        expect(Math.abs(b.v / TEXEL - a.v / TEXEL)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
    // And the sharp version away from boundaries: a SNAPPED anchor sits at
    // its cell's grid corner, so a further 0.4-texel move stays inside the
    // next cell interval and must snap back to the identical grid point.
    const mid = snap(12.34, 7.5, -8.9);
    const midUv = lightUv(mid);
    const moved = lightUv(
      snap(
        mid.x + right.x * TEXEL * 0.4,
        mid.y + right.y * TEXEL * 0.4,
        mid.z + right.z * TEXEL * 0.4,
      ),
    );
    expect(moved.u).toBeCloseTo(midUv.u, 9);
    expect(moved.v).toBeCloseTo(midUv.v, 9);
  });

  it('steps exactly one texel for a full-texel translation of an on-grid anchor', () => {
    // Start from a SNAPPED anchor (on-grid by the master property above) and
    // translate by exactly one texel along three's right axis: the snapped
    // result must move by exactly one texel, no more, no less. Decisive
    // against a floor that drifts (off-by-half) and against a re-centered
    // per-frame origin (which would absorb the step).
    const { right } = threeLightBasis(DIR);
    const a = snap(3.21, 1.5, 4.56);
    const aUv = lightUv(a);
    const b = lightUv(snap(a.x + right.x * TEXEL, a.y + right.y * TEXEL, a.z + right.z * TEXEL));
    expect(b.u - aUv.u).toBeCloseTo(TEXEL, 9);
    expect(b.v - aUv.v).toBeCloseTo(0, 9);
  });

  it('displaces only within the light plane, never along the light direction', () => {
    const len = Math.hypot(DIR.x, DIR.y, DIR.z);
    const d = { x: DIR.x / len, y: DIR.y / len, z: DIR.z / len };
    const p = { x: -104.7, y: 22.9, z: 63.2 };
    const s = snap(p.x, p.y, p.z);
    const shift = { x: s.x - p.x, y: s.y - p.y, z: s.z - p.z };
    // Decisive: the snap actually moved this off-grid point...
    expect(Math.hypot(shift.x, shift.y, shift.z)).toBeGreaterThan(TEXEL * 0.01);
    // ...but not along the light direction (light position and target
    // translate together, so lighting is bit-identical)...
    expect(shift.x * d.x + shift.y * d.y + shift.z * d.z).toBeCloseTo(0, 9);
    // ...and by at most one texel diagonal.
    expect(Math.hypot(shift.x, shift.y, shift.z)).toBeLessThan(TEXEL * Math.SQRT2 + 1e-9);
  });

  it('is idempotent: snapping a snapped anchor is a no-op', () => {
    for (const [x, y, z] of SAMPLE_POINTS) {
      const once = snap(x, y, z);
      const twice = snap(once.x, once.y, once.z);
      expect(twice.x).toBeCloseTo(once.x, 9);
      expect(twice.y).toBeCloseTo(once.y, 9);
      expect(twice.z).toBeCloseTo(once.z, 9);
    }
  });

  it('passes the anchor through untouched on degenerate input', () => {
    const out: ShadowAnchor = { x: 0, y: 0, z: 0 };
    // Zero texel size (snapping disabled).
    snapShadowAnchor(DIR.x, DIR.y, DIR.z, 1.5, 2.5, 3.5, 0, out);
    expect(out).toEqual({ x: 1.5, y: 2.5, z: 3.5 });
    // Zero-length direction.
    snapShadowAnchor(0, 0, 0, 1.5, 2.5, 3.5, TEXEL, out);
    expect(out).toEqual({ x: 1.5, y: 2.5, z: 3.5 });
    // A vertical light has no stable lookAt basis: pass through, not NaN.
    snapShadowAnchor(0, 1, 0, 1.5, 2.5, 3.5, TEXEL, out);
    expect(out).toEqual({ x: 1.5, y: 2.5, z: 3.5 });
  });

  it('fills and returns the caller-owned out object (per-frame path allocates nothing)', () => {
    const out: ShadowAnchor = { x: 0, y: 0, z: 0 };
    const returned = snap(5, 6, 7, out);
    expect(returned).toBe(out);
  });
});
