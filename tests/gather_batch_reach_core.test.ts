// The gather-node per-batch reach hide's pure core (gather_batch_reach_core.ts):
// the hysteresis band, the nearest-node distance, the flip plan the frame
// writes `count` from, and the eased-reach case the renderer's
// Math.max(fogFar, lastRequestedFogFar) expression produces.
import { describe, expect, it } from 'vitest';
import {
  type BatchReachState,
  FOG_REACH_HYSTERESIS,
  fogReachVisibility,
  nearestDistanceSq,
  planBatchReach,
} from '../src/render/gather_batch_reach_core';

const sq = (d: number): number => d * d;

describe('gather batch reach core: fogReachVisibility', () => {
  it('pins the hysteresis literal', () => {
    expect(FOG_REACH_HYSTERESIS).toBe(1.1);
  });

  it('shows at or inside the reach whatever the previous state', () => {
    expect(fogReachVisibility(sq(99), 100, 1.1, false)).toBe(true);
    expect(fogReachVisibility(sq(100), 100, 1.1, false)).toBe(true);
    expect(fogReachVisibility(sq(100), 100, 1.1, true)).toBe(true);
  });

  it('hides past the reach times the hysteresis whatever the previous state', () => {
    expect(fogReachVisibility(sq(110.001), 100, 1.1, true)).toBe(false);
    expect(fogReachVisibility(sq(200), 100, 1.1, true)).toBe(false);
    expect(fogReachVisibility(sq(200), 100, 1.1, false)).toBe(false);
  });

  it('holds the previous state inside the band', () => {
    expect(fogReachVisibility(sq(105), 100, 1.1, true)).toBe(true);
    expect(fogReachVisibility(sq(105), 100, 1.1, false)).toBe(false);
    // The band's far edge is inclusive: exactly reach * hysteresis still holds.
    expect(fogReachVisibility(sq(100) * 1.1 * 1.1, 100, 1.1, true)).toBe(true);
  });
});

describe('gather batch reach core: nearestDistanceSq', () => {
  it('returns the smallest horizontal squared distance over the batch', () => {
    const xs = Float64Array.from([0, 30, -5]);
    const zs = Float64Array.from([100, 40, 7]);
    // Camera at (0, 10): (-5, 7) is 25 + 9 = 34 away squared.
    expect(nearestDistanceSq(xs, zs, 0, 10)).toBe(34);
    // Camera at (30, 400): (0, 100) at 30^2 + 300^2 beats (30, 40) at 360^2.
    expect(nearestDistanceSq(xs, zs, 30, 400)).toBe(90_900);
  });

  it('reads Infinity for an empty batch', () => {
    expect(nearestDistanceSq(new Float64Array(0), new Float64Array(0), 0, 0)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('gather batch reach core: planBatchReach', () => {
  const batch = (points: [number, number][], shown = true): BatchReachState => ({
    xs: Float64Array.from(points.map(([x]) => x)),
    zs: Float64Array.from(points.map(([, z]) => z)),
    shown,
  });

  it('flips exactly the batches whose state changed and updates them in place', () => {
    const near = batch([[0, 50]]);
    const far = batch([[0, 500]]);
    const spread = batch([
      [0, 900],
      [0, 80],
    ]);
    const batches = [near, far, spread];
    const flips: number[] = [];
    // Camera at the origin, reach 100: only the far batch hides.
    expect(planBatchReach(batches, 0, 0, 100, FOG_REACH_HYSTERESIS, flips)).toBe(1);
    expect(flips).toEqual([1]);
    expect(near.shown).toBe(true);
    expect(far.shown).toBe(false);
    expect(spread.shown).toBe(true);
    // Same frame again: nothing flips, the scratch is reset.
    expect(planBatchReach(batches, 0, 0, 100, FOG_REACH_HYSTERESIS, flips)).toBe(0);
    expect(flips).toEqual([]);
    // Camera to z = 500: the far batch returns, the other two go.
    expect(planBatchReach(batches, 0, 500, 100, FOG_REACH_HYSTERESIS, flips)).toBe(3);
    expect(flips).toEqual([0, 1, 2]);
    expect(near.shown).toBe(false);
    expect(far.shown).toBe(true);
    expect(spread.shown).toBe(false);
  });

  it('flips nothing while the reach only grows and no batch crosses the band', () => {
    const near = batch([[0, 50]]);
    const far = batch([[0, 500]]);
    const batches = [near, far];
    const flips: number[] = [];
    expect(planBatchReach(batches, 0, 0, 100, FOG_REACH_HYSTERESIS, flips)).toBe(1);
    expect(far.shown).toBe(false);
    for (const reach of [101, 120, 200, 300, 400, 450]) {
      expect(
        planBatchReach(batches, 0, 0, reach, FOG_REACH_HYSTERESIS, flips),
        `reach ${reach}`,
      ).toBe(0);
    }
    // 455 puts the far batch under 1.1 times the reach but not under the
    // reach: still no flip. 500 shows it: one flip.
    expect(planBatchReach(batches, 0, 0, 455, FOG_REACH_HYSTERESIS, flips)).toBe(0);
    expect(planBatchReach(batches, 0, 0, 500, FOG_REACH_HYSTERESIS, flips)).toBe(1);
    expect(flips).toEqual([1]);
    expect(far.shown).toBe(true);
  });

  it('measures a batch by its NEAREST node: one node inside the reach keeps the whole batch', () => {
    const spread = batch([
      [0, 2_000],
      [0, 1_500],
      [0, 90],
    ]);
    const flips: number[] = [];
    expect(planBatchReach([spread], 0, 0, 100, FOG_REACH_HYSTERESIS, flips)).toBe(0);
    expect(spread.shown).toBe(true);
    // Once the nearest node itself leaves the band the batch goes as a whole.
    expect(planBatchReach([spread], 0, -30, 100, FOG_REACH_HYSTERESIS, flips)).toBe(1);
    expect(spread.shown).toBe(false);
  });

  it('flips a node at 800 exactly once as a reach of 850 eases down to 700', () => {
    // The vista tiers: the renderer's reach is Math.max(easedFogFar,
    // lastRequestedFogFar), so after the detail horizon's target drops from
    // 850 to 700 the reach follows the easing down. The node hides the first
    // frame its distance exceeds reach * 1.1, i.e. once the reach passes
    // 800 / 1.1 = 727.27, and never flips again on the way to 700.
    const node = batch([[0, 800]]);
    const flips: number[] = [];
    expect(planBatchReach([node], 0, 0, 850, FOG_REACH_HYSTERESIS, flips)).toBe(0);
    expect(node.shown).toBe(true);
    const flippedAt: number[] = [];
    for (const reach of [840, 820, 800, 780, 760, 740, 728, 727, 720, 710, 700, 700]) {
      if (planBatchReach([node], 0, 0, reach, FOG_REACH_HYSTERESIS, flips) > 0) {
        flippedAt.push(reach);
      }
    }
    expect(flippedAt).toEqual([727]);
    expect(node.shown).toBe(false);
  });
});
