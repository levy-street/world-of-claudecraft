import { describe, expect, it } from 'vitest';
import { FLY_SPEED_MAX, FLY_SPEED_MIN, flySpeedFromWheel } from '../src/editor/camera_speed_core';

// The Free-Fly wheel is a throttle: it writes the Camera tab's move-speed value
// and never touches the orbit distance (viewport.onWheel), so these are the
// whole contract of the gesture.
describe('flySpeedFromWheel', () => {
  it('scrolling up (negative deltaY) speeds up, down slows down', () => {
    expect(flySpeedFromWheel(1, -100)).toBeGreaterThan(1);
    expect(flySpeedFromWheel(1, 100)).toBeLessThan(1);
  });

  it('stays inside the slider range however hard the wheel is spun', () => {
    let fast = 1;
    for (let i = 0; i < 200; i++) fast = flySpeedFromWheel(fast, -1000);
    expect(fast).toBe(FLY_SPEED_MAX);
    let slow = 1;
    for (let i = 0; i < 200; i++) slow = flySpeedFromWheel(slow, 1000);
    expect(slow).toBe(FLY_SPEED_MIN);
  });

  it('lands on slider steps, so the wheel and the slider show the same value', () => {
    for (let i = 0, v = 1; i < 12; i++) {
      v = flySpeedFromWheel(v, -60);
      expect(Math.round(v * 10) / 10).toBeCloseTo(v, 6);
    }
  });

  it('always moves off the current value, even where the snap would round back', () => {
    expect(flySpeedFromWheel(0.2, -1)).toBeGreaterThan(0.2);
    expect(flySpeedFromWheel(0.2, 1)).toBeLessThan(0.2);
  });

  it('is a no-op on a zero or non-finite delta, and repairs a broken current', () => {
    expect(flySpeedFromWheel(1.5, 0)).toBe(1.5);
    expect(flySpeedFromWheel(1.5, Number.NaN)).toBe(1.5);
    expect(flySpeedFromWheel(Number.NaN, -100)).toBe(1);
  });

  it('clamps a wild trackpad fling to one notch-sized step', () => {
    expect(flySpeedFromWheel(1, -100_000)).toBe(flySpeedFromWheel(1, -160));
  });
});
