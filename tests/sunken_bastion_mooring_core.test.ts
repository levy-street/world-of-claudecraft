// The Mooring Post lamps' pure plan (src/render/sunken_bastion/
// bastion_mooring_core.ts) and the Hallowed Brine's wider swell
// (bastion_olen_fx_core.ts): a lit lamp burns and a dark one shows only its
// ember, the flare outshines both then dies, the re-ignite catches over the
// sim's kindling seconds, the safe ring shows only on a lit post for a hooked
// player at the sim's reach, the snapped chain bursts on time, and a wider
// brine throws a front as dense as the old one.

import { describe, expect, it } from 'vitest';
import {
  MOORING_FLARE_SECONDS,
  MOORING_KINDLE_SECONDS,
  MOORING_SAFE_RADIUS,
  MOORING_SNAP_SECONDS,
  type MooringLampLook,
  mooringLampLook,
  mooringRingPulse,
  mooringRingShown,
  mooringSnapHeat,
} from '../src/render/sunken_bastion/bastion_mooring_core';
import {
  BRINE_DRAWN_RADIUS,
  brineFrontSprays,
} from '../src/render/sunken_bastion/bastion_olen_fx_core';
import { OLEN_KIT, OSSICK_TUNING } from '../src/sim/encounters/sunken_bastion/ids';

const look = (): MooringLampLook => ({ flame: 0, halo: 0, ember: 0 });

describe('Mooring Post lamps', () => {
  it('a lit lamp burns, a dark one keeps only its ember', () => {
    const lit = mooringLampLook('lit', 99, -1, look());
    expect(lit.flame).toBe(1);
    expect(lit.halo).toBe(1);
    expect(lit.ember).toBe(0);
    const dark = mooringLampLook('dark', 3, -1, look());
    expect(dark.flame).toBe(0);
    expect(dark.halo).toBe(0);
    expect(dark.ember).toBeGreaterThan(0);
  });

  it('a relit lamp blooms, then settles', () => {
    expect(mooringLampLook('lit', 0.05, -1, look()).halo).toBeGreaterThan(1.4);
    expect(mooringLampLook('lit', 0.6, -1, look()).halo).toBe(1);
  });

  it('taking a chain: the lamp flares past full, then dies to its ember', () => {
    const peak = mooringLampLook('dark', 0, 0.12, look());
    expect(peak.halo).toBeGreaterThan(3);
    const mid = mooringLampLook('dark', 0, MOORING_FLARE_SECONDS * 0.5, look());
    expect(mid.halo).toBeLessThan(peak.halo);
    expect(mid.halo).toBeGreaterThan(0);
    const after = mooringLampLook('dark', 0, MOORING_FLARE_SECONDS + 0.1, look());
    expect(after.halo).toBe(0);
    expect(after.flame).toBe(0);
  });

  it('the re-ignite catches over the sim kindling seconds', () => {
    expect(MOORING_KINDLE_SECONDS).toBe(OSSICK_TUNING.postKindleSeconds);
    const early = mooringLampLook('kindling', 0.2, -1, look());
    const late = mooringLampLook('kindling', MOORING_KINDLE_SECONDS * 0.95, -1, look());
    expect(early.flame).toBeLessThan(0.05);
    expect(late.flame).toBeGreaterThan(0.85);
    expect(late.ember).toBeGreaterThan(early.ember);
  });

  it('the safe ring: a lit post only, a hooked player only, at the sim reach', () => {
    expect(MOORING_SAFE_RADIUS).toBe(OSSICK_TUNING.postReach);
    expect(mooringRingShown('lit', true)).toBe(true);
    expect(mooringRingShown('lit', false)).toBe(false);
    expect(mooringRingShown('dark', true)).toBe(false);
    expect(mooringRingShown('kindling', true)).toBe(false);
    for (const t of [0, 0.3, 1.1, 7.7]) {
      const p = mooringRingPulse(t, 0.5);
      expect(p).toBeGreaterThanOrEqual(0.55 - 1e-9);
      expect(p).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('the snapped chain holds white-hot, then bursts', () => {
    expect(mooringSnapHeat(-1)).toBe(-1);
    expect(mooringSnapHeat(0)).toBe(1);
    expect(mooringSnapHeat(MOORING_SNAP_SECONDS * 0.5)).toBeGreaterThan(0.5);
    expect(mooringSnapHeat(MOORING_SNAP_SECONDS)).toBe(-1);
  });
});

describe('Hallowed Brine: the wider swell', () => {
  it('throws a front as dense round a 9 yd rim as round the old 6 yd one', () => {
    const count = (radius: number): number => {
      let n = 0;
      let roll = 0.37;
      for (let t = 0; t < 1; t += 1 / 60) {
        n += brineFrontSprays(radius, 1 / 60, roll);
        roll = (roll * 9301 + 49297) % 1;
      }
      return n;
    };
    expect(BRINE_DRAWN_RADIUS).toBe(6);
    const old = count(BRINE_DRAWN_RADIUS);
    const wide = count(OLEN_KIT.brineRadius);
    expect(old).toBeGreaterThan(8);
    // Per yard of rim, about the same.
    expect(wide / OLEN_KIT.brineRadius).toBeCloseTo(old / BRINE_DRAWN_RADIUS, 0);
    expect(wide).toBeGreaterThan(old);
  });
});
