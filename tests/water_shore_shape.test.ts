import { describe, expect, it } from 'vitest';
import {
  shoreDepthAt,
  shoreSlopeAt,
  WATER_FOAM_WIDTH_YARDS,
  WATER_SEABED_CLAMP_YARDS,
} from '../src/render/water_core';
import { waterLevel } from '../src/sim/world';

// The water surface look is tuned against real coastline geometry, so the
// geometry it assumes is pinned here. A terrain change that breaks one of these
// invalidates the tuning, and this is the test that says so.
//
// Surveyed across 30 shoreline samples spanning every coastal zone: the seabed
// is hard clamped at 6 yards below the water line, and shelf steepness ranges
// over an order of magnitude, from reaching 3.2 yards of depth in 4 yards of
// run to sitting at 0.2 yards deep for 40 yards.

const SEED = 20061;
// Two surveyed shorelines at opposite ends of the measured steepness range.
const STEEP = { x: 204, z: 2372 }; // drakelands: 3.2 yd deep within 4 yd of run
const FLAT = { x: -212, z: 1060 }; // palmreach: 0.2 yd deep sustained for 40 yd

function seawardDir(p: { x: number; z: number }): { dx: number; dz: number } {
  const h = 3;
  const gx = shoreDepthAt(p.x + h, p.z, SEED) - shoreDepthAt(p.x - h, p.z, SEED);
  const gz = shoreDepthAt(p.x, p.z + h, SEED) - shoreDepthAt(p.x, p.z - h, SEED);
  const len = Math.hypot(gx, gz) || 1;
  return { dx: gx / len, dz: gz / len };
}

/** Horizontal run from the waterline until `stop` first reports true. */
function runUntil(p: { x: number; z: number }, stop: (x: number, z: number) => boolean): number {
  const { dx, dz } = seawardDir(p);
  for (let d = 0; d <= 400; d += 1) {
    if (stop(p.x + dx * d, p.z + dz * d)) return d;
  }
  return Number.POSITIVE_INFINITY;
}

describe('coastline geometry the water surface is tuned against', () => {
  it('never puts the seabed deeper than the clamp the colour ramp assumes', () => {
    let deepest = 0;
    for (let x = -600; x <= 600; x += 37) {
      for (let z = -600; z <= 2400; z += 53) {
        deepest = Math.max(deepest, shoreDepthAt(x, z, SEED));
      }
    }
    expect(deepest).toBeLessThanOrEqual(WATER_SEABED_CLAMP_YARDS + 0.05);
    // And it does reach the clamp, so the constant is not slack.
    expect(deepest).toBeGreaterThan(WATER_SEABED_CLAMP_YARDS - 0.5);
  });

  it('reports a far steeper seabed gradient on a steep shelf than a flat one', () => {
    const steep = shoreSlopeAt(STEEP.x, STEEP.z, SEED);
    const flat = shoreSlopeAt(FLAT.x, FLAT.z, SEED);
    expect(steep).toBeGreaterThan(flat * 3);
  });

  it('never returns a zero slope, which would divide the shore distance by zero', () => {
    // A dead flat inland pond centre is the degenerate case.
    for (let x = -600; x <= 600; x += 149) {
      for (let z = -600; z <= 2400; z += 211) {
        expect(shoreSlopeAt(x, z, SEED)).toBeGreaterThan(0);
      }
    }
  });
});

describe('surf band width is a ground distance, not a depth', () => {
  // The point of keying foam on depth/slope: the band must cover roughly the
  // same run of ground whatever the shelf does. Depth alone cannot, which is
  // why a flat bay used to foam over completely.
  const foamEnds = (p: { x: number; z: number }) =>
    runUntil(
      p,
      (x, z) => shoreDepthAt(x, z, SEED) / shoreSlopeAt(x, z, SEED) > WATER_FOAM_WIDTH_YARDS,
    );
  const oldFoamEnds = (p: { x: number; z: number }) =>
    runUntil(p, (x, z) => shoreDepthAt(x, z, SEED) > 3.2);

  it('covers a comparable ground run on a steep and a flat shelf', () => {
    const steepRun = foamEnds(STEEP);
    const flatRun = foamEnds(FLAT);
    expect(Number.isFinite(steepRun)).toBe(true);
    expect(Number.isFinite(flatRun)).toBe(true);
    // Both land in the same order of magnitude as the configured width.
    expect(steepRun).toBeLessThan(WATER_FOAM_WIDTH_YARDS * 6);
    expect(flatRun).toBeLessThan(WATER_FOAM_WIDTH_YARDS * 6);
  });

  it('is far more consistent across shelf types than the depth threshold it replaced', () => {
    const newSpread = Math.abs(foamEnds(STEEP) - foamEnds(FLAT));
    const oldSpread = Math.abs(oldFoamEnds(STEEP) - oldFoamEnds(FLAT));
    // The old rule put the band edge tens of yards apart between these two.
    expect(oldSpread).toBeGreaterThan(30);
    expect(newSpread).toBeLessThan(oldSpread / 2);
  });
});
