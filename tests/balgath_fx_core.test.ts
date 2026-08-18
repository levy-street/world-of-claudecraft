// Balgath's ground-effect planning math (src/render/balgath_fx_core.ts).
//
// The curves matter for a reason beyond looks: the shockwave ring is the visual
// confirmation of a mechanic players dodge, so it must always reach the blast radius,
// always be visible at the moment of impact, and always fade to nothing rather than
// popping out. Each of those is asserted here rather than eyeballed in a render.

import { describe, expect, it } from 'vitest';
import {
  BALGATH_CRATER_SECONDS,
  BALGATH_EYE_POOL_RADIUS,
  BALGATH_RING_SECONDS,
  balgathRingAlpha,
  balgathRingRadius,
  planBalgathRing,
} from '../src/render/balgath_fx_core';

describe('balgath ring plan', () => {
  it('covers at least the true blast radius by the end of the sweep', () => {
    for (const radius of [4, 8, 11, 14]) {
      const plan = planBalgathRing(radius, 1);
      expect(balgathRingRadius(plan, 1)).toBeGreaterThanOrEqual(radius);
    }
  });

  it('starts wide rather than at a point (his fists are not a pin)', () => {
    const plan = planBalgathRing(11, 1);
    expect(balgathRingRadius(plan, 0)).toBeGreaterThan(0.5);
    expect(balgathRingRadius(plan, 0)).toBeLessThan(11 * 0.4);
  });

  it('expands monotonically', () => {
    const plan = planBalgathRing(11, 1);
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const r = balgathRingRadius(plan, t);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it('scales its punch with power, so a footfall never reads like a smash', () => {
    const smash = planBalgathRing(11, 1);
    const step = planBalgathRing(2.2, 0.34);
    expect(balgathRingAlpha(smash, 0.2)).toBeGreaterThan(balgathRingAlpha(step, 0.2));
    expect(smash.maxRadius).toBeGreaterThan(step.maxRadius * 3);
  });
});

describe('balgath ring alpha', () => {
  it('is visible almost immediately at impact', () => {
    const plan = planBalgathRing(11, 1);
    expect(balgathRingAlpha(plan, 0)).toBe(0);
    expect(balgathRingAlpha(plan, 0.12)).toBeCloseTo(plan.peakAlpha, 5);
  });

  it('fades to nothing by the end of its life (no pop-out)', () => {
    const plan = planBalgathRing(11, 1);
    expect(balgathRingAlpha(plan, 1)).toBeCloseTo(0, 6);
  });

  it('never exceeds its peak or goes negative, including out-of-range input', () => {
    const plan = planBalgathRing(11, 1);
    for (const t of [-1, -0.01, 0, 0.3, 0.9, 1, 1.5, 12]) {
      const a = balgathRingAlpha(plan, t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(plan.peakAlpha + 1e-9);
    }
  });

  it('decays after the hold, so the ring reads as dust settling', () => {
    const plan = planBalgathRing(11, 1);
    expect(balgathRingAlpha(plan, 0.4)).toBeGreaterThan(balgathRingAlpha(plan, 0.8));
  });
});

describe('balgath timing constants', () => {
  it('keeps the ring shorter than the crater it leaves behind', () => {
    expect(BALGATH_RING_SECONDS).toBeLessThan(BALGATH_CRATER_SECONDS);
  });

  it('lights a ground pool big enough to read under a boss-scale body', () => {
    expect(BALGATH_EYE_POOL_RADIUS).toBeGreaterThan(3);
  });
});
