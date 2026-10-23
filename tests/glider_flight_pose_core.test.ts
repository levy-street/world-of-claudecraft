import { describe, expect, it } from 'vitest';
import {
  gliderApparatusPitch,
  gliderDisplayedMotionPitch,
} from '../src/render/glider_flight_pose_core';

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
  it('derives online pitch from displayed motion at every facing and frame duration', () => {
    for (const dt of [0.016, 0.05])
      for (const yaw of [0, Math.PI / 2, Math.PI]) {
        const dx = Math.sin(yaw) * 10 * dt;
        const dz = Math.cos(yaw) * 10 * dt;
        expect(gliderDisplayedMotionPitch(dx, -2 * dt, dz, dt)).toBeCloseTo(Math.atan(0.2));
        expect(gliderDisplayedMotionPitch(dx, 2 * dt, dz, dt)).toBeCloseTo(-Math.atan(0.2));
      }
    expect(gliderDisplayedMotionPitch(1, 1, 1, 0)).toBe(0);
    expect(gliderDisplayedMotionPitch(1, 1, 1, Number.NaN)).toBe(0);
    expect(gliderDisplayedMotionPitch(Number.NaN, 1, 1, 0.05)).toBe(0);
  });
  it('keeps the reward wing spread above the pilot during a vertical slow fall', () => {
    expect(gliderDisplayedMotionPitch(0, -0.125, 0, 0.05)).toBeCloseTo(Math.PI / 8);
    expect(gliderDisplayedMotionPitch(0, 0.125, 0, 0.05)).toBeCloseTo(-Math.PI / 8);
  });
});
