import { describe, expect, it } from 'vitest';
import { updateFollowCameraYaw, wrapAngle } from '../src/game/camera_follow';

describe('camera follow', () => {
  it('wraps angles to the shortest signed turn', () => {
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
  });

  it('follows character turn deltas one-to-one without destroying orbit offset', () => {
    const next = updateFollowCameraYaw({
      camYaw: 1.0,
      interpFacing: 0.4,
      lastInterpFacing: 0.2,
      frameDt: 1 / 60,
      mouselook: false,
      moving: false,
      orbiting: false,
    });
    expect(next.camYaw).toBeCloseTo(1.2);
    expect(next.lastInterpFacing).toBe(0.4);
  });

  it('tracks facing through mouselook without changing yaw', () => {
    const next = updateFollowCameraYaw({
      camYaw: 2.0,
      interpFacing: 0.6,
      lastInterpFacing: 0.1,
      frameDt: 1 / 60,
      mouselook: true,
      moving: true,
      orbiting: false,
    });
    expect(next.camYaw).toBe(2.0);
    expect(next.lastInterpFacing).toBe(0.6);
  });

  it('snaps large moving offsets behind the character instead of easing a 180 turn', () => {
    const next = updateFollowCameraYaw({
      camYaw: Math.PI,
      interpFacing: 0,
      lastInterpFacing: 0,
      frameDt: 1 / 60,
      mouselook: false,
      moving: true,
      orbiting: false,
    });
    expect(next.camYaw).toBe(0);
  });

  it('settles medium moving offsets quickly but not instantly', () => {
    const next = updateFollowCameraYaw({
      camYaw: 1.2,
      interpFacing: 0,
      lastInterpFacing: 0,
      frameDt: 1 / 60,
      mouselook: false,
      moving: true,
      orbiting: false,
    });
    expect(next.camYaw).toBeLessThan(1.2);
    expect(next.camYaw).toBeGreaterThan(0);
    expect(next.camYaw).toBeLessThan(1.02);
  });

  it('does not auto-settle while the player is actively orbit-dragging', () => {
    const next = updateFollowCameraYaw({
      camYaw: 1,
      interpFacing: 0,
      lastInterpFacing: 0,
      frameDt: 1 / 60,
      mouselook: false,
      moving: true,
      orbiting: true,
    });
    expect(next.camYaw).toBe(1);
  });
});
