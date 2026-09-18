import { describe, expect, it } from 'vitest';
import { gliderApparatusPitch } from '../src/render/glider_flight_pose_core';

describe('glider apparatus flight pitch', () => {
  it('raises the +Z nose while climbing and lowers it while diving', () => {
    expect(gliderApparatusPitch(10, 10)).toBeCloseTo(-Math.PI / 4);
    expect(gliderApparatusPitch(-10, 10)).toBeCloseTo(Math.PI / 4);
    expect(gliderApparatusPitch(0, 10)).toBeCloseTo(0);
  });

  it('stays finite at a stall and fails closed for corrupt display inputs', () => {
    expect(Number.isFinite(gliderApparatusPitch(-5, 0))).toBe(true);
    expect(gliderApparatusPitch(Number.NaN, 10)).toBe(0);
    expect(gliderApparatusPitch(5, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
