// The Moonbridge forming (src/render/drowned_temple/temple_moonbridge_core.ts):
// the fallen Colossus's prism charges, fires its beam west, and each slab is
// laid as the beam's front passes it; the balustrades rise once the last
// slab has settled. The gate rig and the beam layer read this one timeline.

import { describe, expect, it } from 'vitest';
import {
  MOONBRIDGE_BEAT,
  MOONBRIDGE_MOMENT,
  MOONBRIDGE_MOMENT_SECONDS,
  MOONBRIDGE_PLANKS,
  moonbridgeBeamFront,
  moonbridgeBeamReaches,
  moonbridgeBeamStrength,
  moonbridgeBeatsBetween,
  moonbridgeLaid,
  moonbridgePlankAppears,
  moonbridgePlankFlash,
  moonbridgePlankRise,
  moonbridgePrismGlow,
} from '../src/render/drowned_temple/temple_moonbridge_core';
import { moonbridgeSpan } from '../src/render/drowned_temple/temple_rising_stair_core';
import { MOONBRIDGE, PRISM_PLINTH } from '../src/sim/content/drowned_temple_layout';

const M = MOONBRIDGE_MOMENT;
const { fromX, toX } = moonbridgeSpan();

describe('the Moonbridge forms along the prism beam', () => {
  it('the beam leaves the prism after its charge and reaches the landing after its run', () => {
    expect(moonbridgeBeamReaches(PRISM_PLINTH.x)).toBeCloseTo(M.charge, 9);
    expect(moonbridgeBeamReaches(MOONBRIDGE.toX)).toBeCloseTo(M.charge + M.travel, 9);
    expect(moonbridgeBeamFront(M.charge - 0.01)).toBe(0);
    expect(moonbridgeBeamFront(M.charge + M.travel / 2)).toBeCloseTo(0.5, 9);
    expect(moonbridgeBeamFront(M.charge + M.travel + 1)).toBe(1);
  });

  it('lays the slabs in order from the terrace, each as the front passes it', () => {
    let prev = -1;
    for (let i = 0; i < MOONBRIDGE_PLANKS; i++) {
      const t = moonbridgePlankAppears(i, fromX, toX);
      expect(t).toBeGreaterThan(prev);
      expect(t).toBeGreaterThan(M.charge);
      expect(t).toBeLessThanOrEqual(M.charge + M.travel);
      // Unmade just before, rising just after, laid a rise later, flashing as it appears.
      expect(moonbridgePlankRise(i, fromX, toX, t - 0.01)).toBe(0);
      expect(moonbridgePlankRise(i, fromX, toX, t + M.rise / 2)).toBeCloseTo(0.5, 6);
      expect(moonbridgePlankRise(i, fromX, toX, t + M.rise)).toBeCloseTo(1, 9);
      expect(moonbridgePlankFlash(i, fromX, toX, t)).toBe(1);
      expect(moonbridgePlankFlash(i, fromX, toX, t + M.flash)).toBeCloseTo(0, 9);
      prev = t;
    }
  });

  it('the balustrades wait for the last slab; the whole moment is a few seconds', () => {
    const laid = moonbridgeLaid(fromX, toX);
    expect(laid).toBeCloseTo(moonbridgePlankAppears(MOONBRIDGE_PLANKS - 1, fromX, toX) + M.rise, 9);
    expect(laid).toBeLessThan(2.5);
    expect(MOONBRIDGE_MOMENT_SECONDS).toBeGreaterThan(laid);
    expect(MOONBRIDGE_MOMENT_SECONDS).toBeLessThan(6);
  });

  it('the beam swells with the charge, holds, then fades to nothing', () => {
    expect(moonbridgeBeamStrength(-1)).toBe(0);
    expect(moonbridgeBeamStrength(M.charge / 2)).toBeGreaterThan(0);
    expect(moonbridgeBeamStrength(M.charge + M.travel)).toBe(1);
    expect(moonbridgeBeamStrength(MOONBRIDGE_MOMENT_SECONDS)).toBe(0);
    expect(moonbridgePrismGlow(M.charge)).toBe(1);
    expect(moonbridgePrismGlow(0)).toBe(0);
  });

  it('fires each beat exactly once as the clock crosses it', () => {
    const B = MOONBRIDGE_BEAT;
    const seen: number[] = [];
    let prev = -0.001;
    for (let t = 0; t <= MOONBRIDGE_MOMENT_SECONDS; t += 1 / 60) {
      const bits = moonbridgeBeatsBetween(prev, t, fromX, toX);
      for (const b of [B.fire, B.arrive, B.laid]) if (bits & b) seen.push(b);
      prev = t;
    }
    expect(seen).toEqual([B.fire, B.arrive, B.laid]);
    // A big frame step still fires every beat it crossed.
    expect(moonbridgeBeatsBetween(0, 10, fromX, toX)).toBe(B.fire | B.arrive | B.laid);
    expect(moonbridgeBeatsBetween(10, 11, fromX, toX)).toBe(0);
  });
});
