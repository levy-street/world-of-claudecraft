// The drawn hop of a body an encounter throws (src/render/thrown_hop_core.ts):
// Jose's playtest of 2026-11-07 read the Summit Roar's flat slide as a sled.
// The arc is render-only, starts on the throw's hold aura and runs once.

import { describe, expect, it } from 'vitest';
import { hopArc, newThrownHop, stepThrownHop, THROWN_HOPS } from '../src/render/thrown_hop_core';
import { BREATH_AURAS, BREATH_TUNING as T } from '../src/sim/encounters/smith_heart/breath_ids';

const thrown = [{ id: BREATH_AURAS.thrown }];

describe('the thrown hop', () => {
  it('the arc: off the floor fast, its peak before the middle, back down at its end', () => {
    expect(hopArc(0)).toBe(0);
    expect(hopArc(1)).toBe(0);
    let peakU = 0;
    let peak = 0;
    for (let u = 0; u <= 1; u += 0.01) {
      if (hopArc(u) > peak) {
        peak = hopArc(u);
        peakU = u;
      }
    }
    expect(peak).toBeCloseTo(1, 2);
    expect(peakU).toBeGreaterThan(0.3);
    expect(peakU).toBeLessThan(0.45);
    // Up faster than it comes down.
    expect(hopArc(0.1)).toBeGreaterThan(hopArc(0.9));
  });

  it('starts on the hold aura, lasts its slide, and runs whole once started', () => {
    const hop = THROWN_HOPS[BREATH_AURAS.thrown];
    expect(hop.seconds).toBe(T.roarSlide);
    expect(THROWN_HOPS[BREATH_AURAS.tossed].seconds).toBe(T.galeSlide);
    expect(THROWN_HOPS[BREATH_AURAS.tossed].height).toBeLessThan(hop.height);
    const st = newThrownHop();
    expect(stepThrownHop(st, [], 0)).toBe(0);
    expect(stepThrownHop(st, thrown, 10)).toBe(0);
    const mid = stepThrownHop(st, thrown, 10 + hop.seconds * 0.37);
    expect(mid).toBeGreaterThan(hop.height * 0.95);
    expect(mid).toBeLessThanOrEqual(hop.height);
    // The hold dropped early (a wall): the body still comes down softly.
    const late = stepThrownHop(st, [], 10 + hop.seconds * 0.8);
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(mid);
    expect(stepThrownHop(st, [], 10 + hop.seconds)).toBe(0);
    // Never again until a new throw.
    expect(stepThrownHop(st, [], 20)).toBe(0);
    expect(stepThrownHop(st, thrown, 30)).toBe(0);
    expect(stepThrownHop(st, thrown, 30 + hop.seconds / 2)).toBeGreaterThan(0);
  });

  it('a hold that outlives the arc never restarts it', () => {
    const st = newThrownHop();
    const s = THROWN_HOPS[BREATH_AURAS.thrown].seconds;
    stepThrownHop(st, thrown, 0);
    expect(stepThrownHop(st, thrown, s + 0.1)).toBe(0);
    expect(stepThrownHop(st, thrown, s + 0.3)).toBe(0);
    expect(stepThrownHop(st, [{ id: 'other' }], 5)).toBe(0);
  });
});
