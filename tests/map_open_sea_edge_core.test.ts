// Behavior pins for the open-sea limit shaping (src/ui/map_open_sea_edge_core.ts).
//
// Driven with SYNTHETIC predicates rather than the real world, so each case
// states one geometric claim: a straight limit (the shape the sim's rect test
// actually produces, and the case that broke the first implementation), a
// corner, and water with no limit anywhere near it. The painter's use of these
// numbers, including that it draws no boundary of its own, is pinned separately
// in tests/map_terrain.test.ts.

import { describe, expect, it } from 'vitest';
import {
  NEARNESS_MAX_YD,
  NEARNESS_REFINE,
  NEARNESS_STEPS,
  type OpenSeaPredicate,
  openSeaNearness,
} from '../src/ui/map_open_sea_edge_core';

/** Lethal everywhere east of a straight line: the strip/moat inset's real shape. */
const straightLimit =
  (limitX: number): OpenSeaPredicate =>
  (x) =>
    x >= limitX;

/** Lethal in a quadrant, so both axes report at once. */
const cornerLimit =
  (limitX: number, limitZ: number): OpenSeaPredicate =>
  (x, z) =>
    x >= limitX && z >= limitZ;

const noLimit: OpenSeaPredicate = () => false;

describe('open-sea nearness', () => {
  it('is zero when nothing lethal is within reach, at any distance beyond it', () => {
    expect(openSeaNearness(0, 0, noLimit)).toBe(0);
    // One yard beyond the reach still reports nothing: the gate is the reach.
    expect(openSeaNearness(0, 0, straightLimit(NEARNESS_MAX_YD + 1))).toBe(0);
  });

  it('rises monotonically as a STRAIGHT limit closes, and nearly saturates at it', () => {
    // The regression this shape exists for: a measure built from the FRACTION of
    // lethal samples cannot exceed ~1/4 against a straight limit (only one side
    // can ever be lethal), so the shading it drove was invisible. A distance
    // ladder reports the same nearness whatever the limit's shape.
    const limit = straightLimit(100);
    const readings = [40, 20, 12, 6, 2, 0.5].map((gap) => openSeaNearness(100 - gap, 0, limit));
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i], `gap index ${i}`).toBeGreaterThanOrEqual(readings[i - 1]);
    }
    expect(readings[0]).toBe(0); // 40 yd out: beyond the reach
    expect(readings.at(-1)).toBeGreaterThan(0.9); // half a yard out: at the limit
  });

  it('sees a limit approached DIAGONALLY, which axis-only sampling cannot', () => {
    // The lethal regions are rectangles, so their corners are approached on the
    // diagonal. Standing off a corner, no axis-aligned sample is ever lethal:
    // an axis-only ring reports zero here and leaves every rect corner
    // unsoftened while its sides ease, which looks worse than the hard edge.
    const corner = cornerLimit(100, 100);
    expect(openSeaNearness(96, 96, corner)).toBeGreaterThan(0);
    // And it is still a DISTANCE: the diagonal gap is longer than the straight
    // one, so standing the same axis offset off a corner reads as further away.
    const straight = openSeaNearness(96, 0, straightLimit(100));
    expect(openSeaNearness(96, 96, corner)).toBeLessThan(straight);
  });

  it('resolves finer than a ladder rung, which is what stops the ramp banding', () => {
    // Two points inside the SAME rung must differ, or the rungs paint as stripes.
    const limit = straightLimit(100);
    const rung = NEARNESS_MAX_YD / NEARNESS_STEPS;
    const a = openSeaNearness(100 - (rung - 0.2), 0, limit);
    const b = openSeaNearness(100 - 0.2, 0, limit);
    expect(a).not.toBeCloseTo(b, 3);
    expect(NEARNESS_REFINE).toBeGreaterThan(0);
  });

  it('never exceeds its bounds', () => {
    const limit = straightLimit(100);
    for (const gap of [0.1, 1, 5, 12, 23, 24, 25, 100]) {
      const n = openSeaNearness(100 - gap, 0, limit);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });

  it('is a pure function of position, which is what keeps chunked renders identical', () => {
    const limit = straightLimit(100);
    const once = openSeaNearness(94, 17, limit);
    const twice = openSeaNearness(94, 17, limit);
    expect(twice).toBe(once);
  });
});
