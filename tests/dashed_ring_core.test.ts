// The dashed-ring geometry core (src/render/dashed_ring_core.ts): the broken
// annulus the battleground identity ring is built from, so it can never be
// mistaken for the solid pulsing target reticle. Pure arrays, driven directly.
import { describe, expect, it } from 'vitest';
import {
  type DashedRingSpec,
  dashedRingGeometry,
  paddedOutlineDuty,
} from '../src/render/dashed_ring_core';

const SPEC: DashedRingSpec = { inner: 0.65, outer: 0.74, dashes: 12, duty: 0.55, segments: 4 };

function radii(positions: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    out.push(Math.hypot(positions[i], positions[i + 1]));
  }
  return out;
}

function angles(positions: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    let a = Math.atan2(positions[i + 1], positions[i]);
    if (a < 0) a += Math.PI * 2;
    out.push(a);
  }
  return out;
}

describe('dashedRingGeometry', () => {
  it('emits one quad strip per dash, sized from dashes and segments', () => {
    const { positions, indices } = dashedRingGeometry(SPEC);
    // (segments + 1) angular samples, two radii each, per dash.
    expect(positions).toHaveLength(12 * 5 * 2 * 3);
    // Two triangles per segment per dash.
    expect(indices).toHaveLength(12 * 4 * 6);
    expect(Math.max(...indices)).toBe(positions.length / 3 - 1);
  });

  it('lies flat in the XY plane between the two radii, like RingGeometry', () => {
    const { positions } = dashedRingGeometry(SPEC);
    for (let i = 2; i < positions.length; i += 3) expect(positions[i]).toBe(0);
    for (const r of radii(positions)) {
      expect(r).toBeGreaterThan(SPEC.inner - 1e-6);
      expect(r).toBeLessThan(SPEC.outer + 1e-6);
    }
    // Both radii are actually present: this is an annulus, not a disc edge.
    expect(radii(positions).filter((r) => Math.abs(r - SPEC.inner) < 1e-6).length).toBe(60);
    expect(radii(positions).filter((r) => Math.abs(r - SPEC.outer) < 1e-6).length).toBe(60);
  });

  it('BREAKS the ring: real gaps between dashes, sized by the duty cycle', () => {
    const { positions } = dashedRingGeometry(SPEC);
    const cell = (Math.PI * 2) / SPEC.dashes;
    const inked = cell * SPEC.duty;
    // Per dash, first and last angular sample bound the inked arc.
    const a = angles(positions);
    for (let d = 0; d < SPEC.dashes; d++) {
      const first = a[d * 10];
      const last = a[d * 10 + 8];
      expect(last - first).toBeCloseTo(inked, 6);
      expect(first).toBeCloseTo(d * cell, 6);
    }
    // The gap is a real gap, not a hairline: over a third of every cell.
    expect(cell - inked).toBeGreaterThan(cell * 0.3);
  });

  it('winds counter-clockwise seen from +Z so the flat ring faces up', () => {
    const { positions, indices } = dashedRingGeometry(SPEC);
    for (let t = 0; t < indices.length; t += 3) {
      const [i0, i1, i2] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
      const ax = positions[i1] - positions[i0];
      const ay = positions[i1 + 1] - positions[i0 + 1];
      const bx = positions[i2] - positions[i0];
      const by = positions[i2 + 1] - positions[i0 + 1];
      expect(ax * by - ay * bx).toBeGreaterThan(0);
    }
  });

  it('is deterministic and honors the phase offset', () => {
    const a = dashedRingGeometry(SPEC);
    const b = dashedRingGeometry(SPEC);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    const shifted = dashedRingGeometry({ ...SPEC, phase: 0.25 });
    expect(angles(shifted.positions)[0]).toBeCloseTo(0.25, 6);
    expect(shifted.positions).toHaveLength(a.positions.length);
  });

  it('degenerates safely: duty 1 closes the gaps, bad counts clamp, inverted radii throw', () => {
    const solid = dashedRingGeometry({ ...SPEC, duty: 1 });
    const cell = (Math.PI * 2) / SPEC.dashes;
    const a = angles(solid.positions);
    // Dash 0 ends exactly where dash 1 begins: a closed annulus.
    expect(a[8]).toBeCloseTo(cell, 6);
    const clamped = dashedRingGeometry({ ...SPEC, dashes: 0, segments: 0 });
    expect(clamped.positions).toHaveLength(1 * 2 * 2 * 3);
    expect(clamped.indices).toHaveLength(6);
    expect(() => dashedRingGeometry({ ...SPEC, outer: SPEC.inner })).toThrow(RangeError);
  });
});

describe('paddedOutlineDuty', () => {
  it('widens the duty by the pad arc at the mid radius, on BOTH dash ends', () => {
    const pad = 0.035;
    const mid = (SPEC.inner + SPEC.outer) / 2;
    const cell = (Math.PI * 2) / SPEC.dashes;
    const padded = paddedOutlineDuty(SPEC, pad);
    expect(padded).toBeCloseTo(SPEC.duty + (2 * pad) / mid / cell, 9);
    expect(padded).toBeGreaterThan(SPEC.duty);
    // The underlay still has to leave a gap, or it draws the solid ring the
    // dashes exist to avoid.
    expect(padded).toBeLessThan(0.9);
  });

  it('clamps at 1 and returns the duty unchanged for a zero pad', () => {
    expect(paddedOutlineDuty(SPEC, 0)).toBe(SPEC.duty);
    expect(paddedOutlineDuty(SPEC, 10)).toBe(1);
  });
});
