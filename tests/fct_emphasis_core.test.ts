// The pure outgoing-FCT emphasis model (src/ui/fct_emphasis_core.ts): the big-hit flag
// against the player's own running average, and the alternating fan-out side.

import { describe, expect, it } from 'vitest';
import {
  FCT_BIG_HIT_EMA_ALPHA,
  FCT_BIG_HIT_RATIO,
  FCT_BIG_HIT_WARMUP,
  FctHitScale,
  fctDriftLane,
} from '../src/ui/fct_emphasis_core';

function warmed(amount: number): FctHitScale {
  const scale = new FctHitScale();
  for (let i = 0; i < FCT_BIG_HIT_WARMUP; i++) expect(scale.observe(amount)).toBe(false);
  return scale;
}

describe('FctHitScale: big hits are measured against your own running average', () => {
  it('never flags a hit during warm-up, however large', () => {
    const scale = new FctHitScale();
    expect(scale.observe(10)).toBe(false);
    for (let i = 1; i < FCT_BIG_HIT_WARMUP; i++) expect(scale.observe(100000)).toBe(false);
  });

  it('flags a hit at the ratio and not one just under it', () => {
    expect(warmed(100).observe(100 * FCT_BIG_HIT_RATIO)).toBe(true);
    expect(warmed(100).observe(100 * FCT_BIG_HIT_RATIO - 1)).toBe(false);
  });

  it('compares a hit with the average BEFORE it, then folds it in by the EMA weight', () => {
    const scale = warmed(100);
    expect(scale.average()).toBe(100);
    expect(scale.observe(300)).toBe(true);
    expect(scale.average()).toBeCloseTo(100 + FCT_BIG_HIT_EMA_ALPHA * 200);
  });

  it('re-baselines: a steady stream of bigger hits stops reading as big', () => {
    const scale = warmed(100);
    expect(scale.observe(250)).toBe(true);
    let flagged = true;
    for (let i = 0; i < 40; i++) flagged = scale.observe(250);
    expect(flagged).toBe(false);
  });

  it('ignores zero, negative and non-finite amounts (no flag, no baseline change)', () => {
    const scale = warmed(100);
    for (const bad of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(scale.observe(bad)).toBe(false);
    }
    expect(scale.average()).toBe(100);
  });

  it('reset forgets the baseline and restarts the warm-up', () => {
    const scale = warmed(100);
    scale.reset();
    expect(scale.average()).toBe(0);
    expect(scale.observe(1000)).toBe(false);
  });
});

describe('fctDriftLane: a burst fans out, and consecutive numbers never share a lane', () => {
  it('deals near-left, near-right, far-left, far-right, then round again', () => {
    expect([0, 1, 2, 3, 4, 5].map(fctDriftLane)).toEqual(['l', 'r', 'll', 'rr', 'l', 'r']);
  });

  it('alternates sides on every consecutive pair', () => {
    const side = (o: number) => fctDriftLane(o)[0];
    for (let o = 0; o < 16; o++) expect(side(o)).not.toBe(side(o + 1));
  });

  it('stays in range for a negative ordinal (never undefined)', () => {
    expect(fctDriftLane(-1)).toBe('rr');
  });
});
