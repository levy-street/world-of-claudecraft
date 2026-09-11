// The water sheet must reach a cliff foot. A dry vertex on top of a sheer wall
// used to carry the wall's whole height as negative depth, and the linear
// interpolation of the shore fade across the cell then crossed zero out over
// the water: a band of bare seabed between the sheet's edge and the cliff.
import { describe, expect, it } from 'vitest';
import {
  shoreDepthAttribute,
  WATER_DRY_DEPTH_CLAMP_YARDS,
  WATER_TILE_KEEP_ABOVE,
} from '../src/render/water_core';

/** Where the sheet's fade crosses zero along a cell from a dry vertex (t=0)
 *  to a wet one (t=1), given their attribute depths. */
const zeroCrossing = (dry: number, wet: number): number => -dry / (wet - dry);

describe('shoreDepthAttribute', () => {
  it('leaves wet and gently dry vertices alone', () => {
    expect(shoreDepthAttribute(3.2)).toBe(3.2);
    expect(shoreDepthAttribute(0)).toBe(0);
    expect(shoreDepthAttribute(-0.1)).toBe(-0.1);
  });

  it('floors a cliff-top vertex so the sheet runs to the cliff foot', () => {
    // Tidehold fjord: ward at +30, water at -2, sea floor at -55.
    const rawDry = -2 - 30;
    const wet = 53;
    // Raw: the crossing sits ~38% of the way across the cell, over the water.
    expect(zeroCrossing(rawDry, wet)).toBeGreaterThan(0.3);
    // Clamped: within a couple of percent of the cliff vertex.
    expect(zeroCrossing(shoreDepthAttribute(rawDry), wet)).toBeLessThan(0.02);
    expect(shoreDepthAttribute(rawDry)).toBe(-WATER_DRY_DEPTH_CLAMP_YARDS);
  });

  it('matches the tile cull margin, so every kept vertex is still graded', () => {
    expect(-WATER_DRY_DEPTH_CLAMP_YARDS).toBe(WATER_TILE_KEEP_ABOVE);
  });
});
