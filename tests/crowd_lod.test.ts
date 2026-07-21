// Crowd-adaptive character LOD policy. Ordinary scenes must be bit-for-bit
// untouched (scale exactly 1, cadence exactly 2); only a genuine crowd degrades.
import { describe, expect, it } from 'vitest';
import { animatesEveryFrame, crowdLodScaleSq, midAnimCadence } from '../src/render/crowd_lod';

describe('crowdLodScaleSq', () => {
  it('leaves ordinary scenes at full range', () => {
    for (const rigs of [0, 1, 5, 13, 14]) expect(crowdLodScaleSq(rigs)).toBe(1);
  });

  it('floors at the minimum scale once the crowd is dense', () => {
    const floor = 0.6 * 0.6;
    expect(crowdLodScaleSq(48)).toBeCloseTo(floor, 9);
    expect(crowdLodScaleSq(200)).toBeCloseTo(floor, 9);
  });

  it('decreases monotonically between the knees and never leaves (floor, 1]', () => {
    let prev = crowdLodScaleSq(14);
    for (let rigs = 15; rigs <= 48; rigs++) {
      const s = crowdLodScaleSq(rigs);
      expect(s).toBeLessThan(prev);
      expect(s).toBeGreaterThanOrEqual(0.6 * 0.6 - 1e-9);
      expect(s).toBeLessThanOrEqual(1);
      prev = s;
    }
  });

  it('pulls the 25yd shadow band in to 15yd at full crowd', () => {
    // ranges compare squared, so the linear range is sqrt(scaleSq) * base
    const band = 25 * Math.sqrt(crowdLodScaleSq(48));
    expect(band).toBeCloseTo(15, 6);
  });
});

describe('midAnimCadence', () => {
  it('animates mid-band rigs every 2nd frame in ordinary scenes', () => {
    for (const rigs of [0, 1, 13, 14]) expect(midAnimCadence(rigs)).toBe(2);
  });

  it('stretches to every 4th frame in a dense crowd', () => {
    expect(midAnimCadence(48)).toBe(4);
    expect(midAnimCadence(500)).toBe(4);
  });

  it('never skips more than 3 frames and never animates less often than every 4th', () => {
    for (let rigs = 0; rigs <= 300; rigs++) {
      const c = midAnimCadence(rigs);
      expect(c).toBeGreaterThanOrEqual(2);
      expect(c).toBeLessThanOrEqual(4);
      expect(Number.isInteger(c)).toBe(true);
    }
  });

  it('is monotonically non-decreasing in crowd size', () => {
    let prev = midAnimCadence(0);
    for (let rigs = 1; rigs <= 300; rigs++) {
      const c = midAnimCadence(rigs);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
});

// The gameplay-fairness carve-out. The repo invariant is that a performance knob
// may shed cosmetic richness but must NEVER hide or delay actionable information,
// and a cast windup is a telegraph the player reacts to. Each arm of the
// predicate is pinned separately: an arm silently lost in a refactor would throttle
// a real telegraph to a quarter of its frame rate in exactly the dense scene where
// reading it matters most, and no other test would notice.
describe('animatesEveryFrame', () => {
  const SELF = 1;
  const TARGET = 2;
  const STRANGER = 3;

  it('exempts the local player', () => {
    expect(animatesEveryFrame(SELF, SELF, TARGET, null)).toBe(true);
  });

  it('exempts the current target', () => {
    expect(animatesEveryFrame(TARGET, SELF, TARGET, null)).toBe(true);
  });

  it('exempts anything mid-cast, even an untargeted stranger', () => {
    expect(animatesEveryFrame(STRANGER, SELF, TARGET, 'fireball')).toBe(true);
  });

  it('does not exempt an idle, untargeted stranger', () => {
    // the only case the crowd cadence is allowed to throttle
    expect(animatesEveryFrame(STRANGER, SELF, TARGET, null)).toBe(false);
  });

  it('does not exempt a stranger just because the player has no target', () => {
    expect(animatesEveryFrame(STRANGER, SELF, null, null)).toBe(false);
  });
});
