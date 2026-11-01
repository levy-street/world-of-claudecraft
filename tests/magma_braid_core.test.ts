import { describe, expect, it } from 'vitest';
import {
  BRAID_DRAIN_S,
  BRAID_FULL_QUALITY,
  BRAID_PTS,
  BRAID_RADIUS,
  BRAID_SAG,
  drainedFraction,
  FIRE_RING_S,
  fillStrand,
  flightLightScale,
  flightProgress,
  impactLightGain,
  MAGMA_STRANDS,
  magmaBurstPlan,
  ORB_SCALE_END,
  ORB_SCALE_START,
  orbScale,
  strandWidthScale,
} from '../src/render/ability_vfx/magma_braid_core';

function strand(phase: number, t = 0.3, to: [number, number, number] = [14, 1.2, 0]) {
  const out = new Float32Array(BRAID_PTS * 3);
  const n = fillStrand(out, 0, 1.5, 0, to[0], to[1], to[2], t, phase);
  return { out, n };
}
const pt = (out: Float32Array, i: number) => [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]];

describe('fillStrand: one strand of the braid', () => {
  it('leaves the hand and enters the orb exactly (the helix pinches at both ends)', () => {
    const { out, n } = strand(MAGMA_STRANDS[1].phase);
    expect(n).toBe(BRAID_PTS);
    const a = pt(out, 0);
    const b = pt(out, n - 1);
    expect(a[0]).toBeCloseTo(0, 4);
    expect(a[1]).toBeCloseTo(1.5, 4);
    expect(a[2]).toBeCloseTo(0, 4);
    expect(b[0]).toBeCloseTo(14, 3);
    expect(b[1]).toBeCloseTo(1.2, 3);
    expect(b[2]).toBeCloseTo(0, 3);
  });

  it('circles the channel within the helix radius, below a sagging centre line', () => {
    const { out, n } = strand(0);
    let maxOff = 0;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const [x, y, z] = pt(out, i);
      const cy = 1.5 + (1.2 - 1.5) * f - 4 * f * (1 - f) * BRAID_SAG;
      const off = Math.hypot(y - cy, z);
      maxOff = Math.max(maxOff, off);
      expect(Math.abs(x - 14 * f)).toBeLessThan(0.05);
    }
    expect(maxOff).toBeGreaterThan(BRAID_RADIUS * 0.5); // it really twists
    expect(maxOff).toBeLessThanOrEqual(BRAID_RADIUS + 1e-4);
  });

  it('the two strands sit on opposite sides of the twist, never on top of each other', () => {
    expect(MAGMA_STRANDS.length).toBe(2);
    const s = MAGMA_STRANDS.map((m) => strand(m.phase).out);
    const mid = Math.floor(BRAID_PTS / 2);
    for (let a = 0; a < s.length; a++) {
      for (let b = a + 1; b < s.length; b++) {
        const pa = pt(s[a], mid);
        const pb = pt(s[b], mid);
        expect(Math.hypot(pa[1] - pb[1], pa[2] - pb[2])).toBeGreaterThan(BRAID_RADIUS);
      }
    }
  });

  it('the twist rolls over time (it flows toward the orb)', () => {
    const a = strand(0, 0.1).out;
    const b = strand(0, 0.2).out;
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('writes nothing for a zero-length channel', () => {
    const out = new Float32Array(BRAID_PTS * 3);
    expect(fillStrand(out, 1, 1, 1, 1, 1, 1, 0, 0)).toBe(0);
  });

  it('works for a vertical channel too (a target above or below the caster)', () => {
    const out = new Float32Array(BRAID_PTS * 3);
    expect(fillStrand(out, 0, 0, 0, 0, 8, 0, 0.2, 0)).toBe(BRAID_PTS);
    expect(Number.isFinite(out[30])).toBe(true);
  });
});

describe('the impact envelopes', () => {
  it('the drain runs from nothing to the whole strand over BRAID_DRAIN_S, easing in', () => {
    expect(drainedFraction(0)).toBe(0);
    expect(drainedFraction(-1)).toBe(0);
    expect(drainedFraction(BRAID_DRAIN_S)).toBe(1);
    expect(drainedFraction(BRAID_DRAIN_S / 2)).toBeCloseTo(0.25);
  });

  it('the light peaks at the burst, falls fast, glows low for the ring, then ends', () => {
    expect(impactLightGain(0)).toBe(1);
    expect(impactLightGain(0.3)).toBeLessThan(0.6);
    expect(impactLightGain(0.9)).toBeGreaterThan(0);
    expect(impactLightGain(0.9)).toBeLessThan(0.25);
    expect(impactLightGain(FIRE_RING_S)).toBe(0);
    expect(impactLightGain(-0.1)).toBe(0);
  });
});

describe('magmaBurstPlan: what each budget tier and quality draws', () => {
  it('tier 0 is the full braid, tier 1 the braid alone, tier 2 the legacy bolt', () => {
    expect(magmaBurstPlan(0)).toEqual({ strands: 2, drips: true, fireRing: true });
    expect(magmaBurstPlan(1)).toEqual({ strands: 2, drips: false, fireRing: false });
    expect(magmaBurstPlan(2)).toBeNull();
  });

  it('low VFX quality sheds the drips, never a strand or the bolt', () => {
    expect(magmaBurstPlan(0, BRAID_FULL_QUALITY)).toMatchObject({ strands: 2, drips: true });
    expect(magmaBurstPlan(0, BRAID_FULL_QUALITY - 0.01)).toEqual({
      strands: 2,
      drips: false,
      fireRing: true,
    });
    expect(magmaBurstPlan(0, 0)).not.toBeNull();
  });
});

describe('the growing orb: one progress drives the orb, the strands and the light', () => {
  it('flight progress runs 0 at launch to 1 at arrival, clamped, and a degenerate launch is arrived', () => {
    expect(flightProgress(14, 14)).toBe(0);
    expect(flightProgress(14, 7)).toBeCloseTo(0.5);
    expect(flightProgress(14, 0)).toBe(1);
    expect(flightProgress(14, 20)).toBe(0);
    expect(flightProgress(0, 3)).toBe(1);
  });

  it('the orb swells from a bead to a full orb, the strands thin, the light grows', () => {
    expect(orbScale(0)).toBeCloseTo(ORB_SCALE_START);
    expect(orbScale(1)).toBeCloseTo(ORB_SCALE_END);
    expect(ORB_SCALE_END / ORB_SCALE_START).toBeGreaterThan(3);
    expect(strandWidthScale(1)).toBeLessThan(strandWidthScale(0));
    expect(flightLightScale(1)).toBeGreaterThan(flightLightScale(0) * 2);
    let prev = 0;
    for (let p = 0; p <= 1.0001; p += 0.1) {
      expect(orbScale(p)).toBeGreaterThan(prev);
      prev = orbScale(p);
    }
    expect(orbScale(5)).toBeCloseTo(ORB_SCALE_END);
  });
});
