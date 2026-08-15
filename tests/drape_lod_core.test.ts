import { describe, expect, it } from 'vitest';
import {
  drapeFanLocalY,
  drapeStrideFor,
  fanVertexSpacing,
  MAX_DRAPE_STRIDE,
} from '../src/render/drape_lod_core';
import { drapeRingLocalY } from '../src/render/selection_ring';
import { groundHeight, terrainHeight } from '../src/sim/world';

// The small ground-VFX drape distance LOD. Three contracts matter beyond "it is
// cheaper": every sample it takes is one the exact drape would have taken too
// (so a mark's footprint never moves), a wide mark is refused thinning
// outright, and the interpolated heights stay within a measured bound of the
// exact drape on the real walkable overworld.

const SEED = 12345;
const AURA_SEGMENTS = 40; // ground_auras.ts
const DECAL_SEGMENTS = 24; // decals.ts

/** three's CircleGeometry layout: index 0 is the center, 1..segments+1 walk the
 *  rim, the last closing the seam on the first. */
function circleFanLocalXZ(segments: number): Float32Array {
  const out = new Float32Array((segments + 2) * 2);
  out[0] = 0;
  out[1] = 0;
  for (let s = 0; s <= segments; s++) {
    const theta = (s / segments) * Math.PI * 2;
    out[(s + 1) * 2] = Math.cos(theta);
    out[(s + 1) * 2 + 1] = Math.sin(theta);
  }
  return out;
}

/** A deterministic sampler that also records exactly where it was asked. */
function recordingSampler(inner: (x: number, z: number) => number) {
  const seen: [number, number][] = [];
  const sample = (x: number, z: number) => {
    seen.push([x, z]);
    return inner(x, z);
  };
  return { sample, seen, count: () => seen.length };
}

/** Local drape Y is expressed in mesh-local units; the visible error is in
 *  world yards, so scale it back up before comparing. */
function maxWorldDelta(a: Float32Array, b: Float32Array, scale: number): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]) * scale);
  return worst;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

/** Height spread of an 8-point ring around a spot: the cheap "is this a cliff
 *  or a hard step" filter, so the error sweep below measures the ground these
 *  marks actually land on rather than sheer rock nobody fights on. */
function localRelief(x: number, z: number, radius: number): number {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let a = 0; a < 8; a++) {
    const theta = (a / 8) * Math.PI * 2;
    const h = groundHeight(x + Math.cos(theta) * radius, z + Math.sin(theta) * radius, SEED);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return hi - lo;
}

describe('drapeStrideFor', () => {
  const auraSpacing = fanVertexSpacing(1.55, AURA_SEGMENTS);

  it('drapes exactly up close and steps down in bounded distance bands', () => {
    expect(drapeStrideFor(0, auraSpacing)).toBe(1);
    expect(drapeStrideFor(20 * 20, auraSpacing)).toBe(1);
    expect(drapeStrideFor(21 * 21, auraSpacing)).toBe(2);
    expect(drapeStrideFor(41 * 41, auraSpacing)).toBe(3);
    expect(drapeStrideFor(71 * 71, auraSpacing)).toBe(4);
    expect(drapeStrideFor(4000 * 4000, auraSpacing)).toBe(MAX_DRAPE_STRIDE);
  });

  it('never decreases as the mark gets further away', () => {
    let previous = 0;
    for (let d = 0; d <= 300; d++) {
      const stride = drapeStrideFor(d * d, auraSpacing);
      expect(stride).toBeGreaterThanOrEqual(previous);
      previous = stride;
    }
  });

  it('refuses to thin a mark whose vertices are already far apart', () => {
    // A 10 yard shockwave footprint, at any distance: the fill would span
    // yards of terrain, which is the case the measurement below rules out.
    const wide = fanVertexSpacing(10, DECAL_SEGMENTS);
    expect(wide).toBeGreaterThan(1);
    for (const d of [30, 60, 120, 400]) expect(drapeStrideFor(d * d, wide)).toBe(1);
    // and the cap bites before the distance band does for a mid-size mark
    const mid = fanVertexSpacing(2.5, DECAL_SEGMENTS);
    expect(drapeStrideFor(200 * 200, mid)).toBeLessThan(MAX_DRAPE_STRIDE);
  });

  it('bounds how much terrain any single fill spans, at every distance', () => {
    for (const segments of [DECAL_SEGMENTS, AURA_SEGMENTS]) {
      for (let radius = 0.25; radius <= 12; radius += 0.25) {
        const spacing = fanVertexSpacing(radius, segments);
        for (const d of [10, 25, 50, 90, 300]) {
          const stride = drapeStrideFor(d * d, spacing);
          // 1 yard is the loosest bound the policy allows itself
          if (stride > 1) expect(stride * spacing).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('drapes exactly for an unknown distance or a degenerate mark', () => {
    expect(drapeStrideFor(-1, auraSpacing)).toBe(1);
    expect(drapeStrideFor(Number.NaN, auraSpacing)).toBe(1);
    expect(drapeStrideFor(10000, 0)).toBe(1);
    expect(drapeStrideFor(10000, Number.NaN)).toBe(1);
  });

  it('reads nothing but distance and geometry (no tier, preset or governor)', () => {
    // A one-signature policy is the fairness guarantee: two players in the same
    // spot cannot get different drapes. Pinned as an arity so a settings input
    // cannot be threaded in without this failing.
    expect(drapeStrideFor.length).toBe(2);
  });
});

describe('drapeFanLocalY', () => {
  const localXZ = circleFanLocalXZ(AURA_SEGMENTS);
  const out = new Float32Array(AURA_SEGMENTS + 2);
  const exact = new Float32Array(AURA_SEGMENTS + 2);

  it('reproduces the exact drape byte for byte at stride 1', () => {
    const sampler = (x: number, z: number) => terrainHeight(x, z, SEED);
    drapeRingLocalY(localXZ, 120, -40, 2, 1.3, 0.08, sampler, exact);
    drapeFanLocalY(localXZ, 120, -40, 2, 1.3, 0.08, sampler, out, 1);
    expect(Array.from(out)).toEqual(Array.from(exact));
  });

  it('samples fewer points as the stride grows, always the center and the seam', () => {
    const counts: number[] = [];
    for (const stride of [1, 2, 3, 4]) {
      const rec = recordingSampler((x, z) => terrainHeight(x, z, SEED));
      drapeFanLocalY(localXZ, 120, 240, 5, 1.3, 0.08, rec.sample, out, stride);
      counts.push(rec.count());
      expect(rec.seen[0]).toEqual([120, 240]);
      const lastX = 120 + 1.3 * localXZ[(AURA_SEGMENTS + 1) * 2];
      const lastZ = 240 + 1.3 * localXZ[(AURA_SEGMENTS + 1) * 2 + 1];
      expect(rec.seen.some(([x, z]) => x === lastX && z === lastZ)).toBe(true);
    }
    expect(counts[0]).toBe(AURA_SEGMENTS + 2);
    expect(counts[1]).toBeLessThan(counts[0]);
    expect(counts[2]).toBeLessThan(counts[1]);
    expect(counts[3]).toBeLessThan(counts[2]);
    expect(counts[3]).toBeLessThan(counts[0] / 3);
  });

  it('samples only points the exact drape would also have sampled', () => {
    const all = recordingSampler((x, z) => terrainHeight(x, z, SEED));
    drapeRingLocalY(localXZ, 120, 240, 5, 1.3, 0.08, all.sample, exact);
    const exactSet = new Set(all.seen.map(([x, z]) => `${x}|${z}`));
    for (const stride of [2, 3, 4]) {
      const thinned = recordingSampler((x, z) => terrainHeight(x, z, SEED));
      drapeFanLocalY(localXZ, 120, 240, 5, 1.3, 0.08, thinned.sample, out, stride);
      for (const [x, z] of thinned.seen) expect(exactSet.has(`${x}|${z}`)).toBe(true);
    }
  });

  it('on a plane, errs by at most the chord sagitta times the slope', () => {
    // The closed-form bound the whole scheme rests on. A fill runs straight
    // between two rim samples while the rim itself bows out by the sagitta
    // r * (1 - cos(theta / 2)), so on a constant slope the worst a filled
    // vertex can be off is that bow times the gradient. Nothing about the real
    // terrain sweep below can be smaller than this.
    const slopeX = 0.3;
    const slopeZ = 0.2;
    const plane = (x: number, z: number) => slopeX * x + slopeZ * z;
    const radius = 1.55;
    const gradient = Math.hypot(slopeX, slopeZ);
    drapeRingLocalY(localXZ, 50, -20, 1, radius, 0.08, plane, exact);
    for (const stride of [2, 3, 4]) {
      drapeFanLocalY(localXZ, 50, -20, 1, radius, 0.08, plane, out, stride);
      const theta = (stride / AURA_SEGMENTS) * Math.PI * 2;
      const bound = radius * (1 - Math.cos(theta / 2)) * gradient;
      const worst = maxWorldDelta(out, exact, radius);
      expect(worst).toBeLessThanOrEqual(bound + 1e-6);
      expect(worst).toBeGreaterThan(0); // the fill really is doing something
    }
    // and that bound is millimetres at the aura's size
    expect(radius * (1 - Math.cos(Math.PI / AURA_SEGMENTS / 0.5)) * gradient).toBeLessThan(0.03);
  });

  it('stays within centimetres of the exact drape on the walkable overworld', () => {
    // A buff aura band (1.3 to 1.8 yd) at the widest stride, swept over the
    // open world minus cliffs and hard steps (localRelief filter): the ground
    // these actually land on. The numbers are the reason the wide shockwave
    // rings were left exact, so pin them as literals.
    const errors: number[] = [];
    const sampler = (x: number, z: number) => groundHeight(x, z, SEED);
    const scale = 1.55;
    for (let x = 60; x <= 900; x += 13) {
      for (let z = -400; z <= 400; z += 17) {
        if (localRelief(x, z, scale) > scale * 0.9) continue;
        const baseY = sampler(x, z);
        drapeRingLocalY(localXZ, x, z, baseY, scale, 0.08, sampler, exact);
        drapeFanLocalY(localXZ, x, z, baseY, scale, 0.08, sampler, out, MAX_DRAPE_STRIDE);
        errors.push(maxWorldDelta(out, exact, scale));
      }
    }
    expect(errors.length).toBeGreaterThan(1000);
    expect(percentile(errors, 0.5)).toBeLessThan(0.02);
    expect(percentile(errors, 0.95)).toBeLessThan(0.15);
    expect(percentile(errors, 0.99)).toBeLessThan(0.3);
    // and the widest stride only ever runs 70+ yards out
    expect(drapeStrideFor(70 * 70, fanVertexSpacing(scale, AURA_SEGMENTS))).toBeLessThan(
      MAX_DRAPE_STRIDE,
    );
  });

  it('refuses to decimate a rim that is already coarse', () => {
    const coarse = circleFanLocalXZ(8);
    const coarseOut = new Float32Array(10);
    const rec = recordingSampler((x, z) => terrainHeight(x, z, SEED));
    drapeFanLocalY(coarse, 100, 100, 0, 1, 0.08, rec.sample, coarseOut, MAX_DRAPE_STRIDE);
    // 9 rim points cannot lose samples without the fill outrunning the chord
    expect(rec.count()).toBe(10);
  });
});
