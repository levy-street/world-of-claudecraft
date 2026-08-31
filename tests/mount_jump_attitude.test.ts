import { describe, expect, it } from 'vitest';

import { mountRiderPivot, stepMountJumpPitch } from '../src/render/mount_jump_attitude';

/** Run to steady state so damping is not what the assertions measure. */
const settle = (airborne: boolean, vy: number, from = 0, frames = 200): number => {
  let pitch = from;
  for (let i = 0; i < frames; i++) pitch = stepMountJumpPitch(pitch, airborne, vy, 1 / 60);
  return pitch;
};
const deg = (rad: number) => (rad * 180) / Math.PI;

describe('mount jump attitude', () => {
  it('sits flat on the ground', () => {
    expect(settle(false, 0)).toBe(0);
  });

  it('tips NOSE UP once airborne', () => {
    expect(deg(settle(true, 0))).toBeCloseTo(12, 1);
  });

  it('tips further the harder it is climbing', () => {
    const slow = settle(true, 1);
    const fast = settle(true, 20);
    expect(deg(fast)).toBeGreaterThan(deg(slow));
    expect(deg(fast)).toBeCloseTo(22, 1);
  });

  it('rights itself, and past level, while falling hard', () => {
    // The whole point: by touchdown the cart must read as coming back down,
    // not still pointing at the sky.
    const falling = settle(true, -20);
    expect(deg(falling)).toBeLessThan(0);
    expect(deg(falling)).toBeCloseTo(-4, 1);
  });

  it('snaps level faster on the ground than it tips in the air', () => {
    const airborneStep = stepMountJumpPitch(0, true, 0, 1 / 60);
    const landed = stepMountJumpPitch(0.2, false, 0, 1 / 60);
    // Grounded damping is quicker, so a landing settles rather than wallowing.
    expect(Math.abs(0.2 - landed)).toBeGreaterThan(Math.abs(airborneStep));
  });

  it('survives a garbage frame time or velocity', () => {
    expect(stepMountJumpPitch(0.1, true, Number.NaN, 1 / 60)).toBeGreaterThan(0);
    expect(stepMountJumpPitch(0.1, true, 5, Number.NaN)).toBe(0.1);
    // An alt-tab must not teleport the pose.
    expect(stepMountJumpPitch(0, true, 0, 30)).toBeLessThan((13 * Math.PI) / 180);
  });

  it('carries the rider around the vehicle origin, not with it', () => {
    // Distance from the pivot is preserved: the rider swings, never drifts off
    // the seat.
    const seatY = 2.24;
    const seatFwd = -0.3;
    const flat = mountRiderPivot(seatY, seatFwd, 0);
    expect(flat).toEqual({ y: seatY, z: seatFwd });
    const tipped = mountRiderPivot(seatY, seatFwd, 0.3);
    expect(Math.hypot(tipped.y, tipped.z)).toBeCloseTo(Math.hypot(seatY, seatFwd), 9);
    expect(tipped.y).not.toBeCloseTo(seatY, 3);
  });
});
