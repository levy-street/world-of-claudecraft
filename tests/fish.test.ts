import { describe, expect, it } from 'vitest';
import { fishLeapPose, isLeapableWater } from '../src/render/fish';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } from '../src/sim/data';

describe('ambient leaping fish', () => {
  it('arcs from the surface to an apex and back', () => {
    const dur = 1.2;
    const h = 1.8;
    expect(fishLeapPose(0, dur, h).y).toBeCloseTo(0, 5); // breaks the surface
    expect(fishLeapPose(dur, dur, h).y).toBeCloseTo(0, 5); // re-enters
    expect(fishLeapPose(dur / 2, dur, h).y).toBeCloseTo(h, 5); // apex at midpoint
  });

  it('noses up on the way out and dives on the way back in', () => {
    const dur = 1.2;
    const h = 1.8;
    expect(fishLeapPose(0.1, dur, h).pitch).toBeGreaterThan(0); // rising
    expect(fishLeapPose(1.1, dur, h).pitch).toBeLessThan(0); // falling
    expect(fishLeapPose(dur / 2, dur, h).pitch).toBeCloseTo(0, 5); // level at apex
  });

  it('clamps the arc outside the leap window', () => {
    const dur = 1.2;
    const h = 1.8;
    expect(fishLeapPose(-1, dur, h).y).toBeCloseTo(0, 5);
    expect(fishLeapPose(99, dur, h).y).toBeCloseTo(0, 5);
  });

  it('only leaps over water deep enough to clear the foam line', () => {
    const deep = () => 3; // 3yd of water
    const shallow = () => 0.5; // a shoreline puddle
    const land = () => -2; // dry ground (above the waterline)
    expect(isLeapableWater(0, 0, deep)).toBe(true);
    expect(isLeapableWater(0, 0, shallow)).toBe(false);
    expect(isLeapableWater(0, 0, land)).toBe(false);
  });

  it('never leaps outside the world bounds', () => {
    const deep = () => 3;
    expect(isLeapableWater(WORLD_MAX_X + 50, 0, deep)).toBe(false);
    expect(isLeapableWater(0, WORLD_MIN_Z - 50, deep)).toBe(false);
    expect(isLeapableWater(0, WORLD_MAX_Z + 50, deep)).toBe(false);
  });
});
