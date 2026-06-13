import { describe, expect, it } from 'vitest';
import {
  MOVE_HOLD_TIME, newLocoTrack, updateLocomotion,
} from '../src/render/locomotion';

const FPS = 1 / 60;

// steady forward walk: ~2.2 u/s gives ~0.0367u of travel per 60fps frame
function walkStep(t: ReturnType<typeof newLocoTrack>, dt = FPS, speed = 2.2) {
  return updateLocomotion(t, 0, speed * dt, 0, dt);
}

describe('locomotion hysteresis', () => {
  it('a steady walk reports moving', () => {
    const t = newLocoTrack();
    let s = walkStep(t);
    for (let i = 0; i < 30; i++) s = walkStep(t);
    expect(s.moving).toBe(true);
    expect(s.backwards).toBe(false);
    expect(s.speed).toBeGreaterThan(1.5); // smoothed toward ~2.2
  });

  it('a single stalled frame mid-walk does NOT drop the moving state', () => {
    const t = newLocoTrack();
    for (let i = 0; i < 20; i++) walkStep(t);
    // interpolation stall / terrain bob: one frame with zero horizontal travel
    const stalled = updateLocomotion(t, 0, 0, 0, FPS);
    expect(stalled.moving).toBe(true); // latched through the dip — no reset
  });

  it('several consecutive stalled frames within the grace window stay moving', () => {
    const t = newLocoTrack();
    for (let i = 0; i < 20; i++) walkStep(t);
    // ~0.15s of stall, under MOVE_HOLD_TIME (0.22s)
    let s = { moving: true } as ReturnType<typeof updateLocomotion>;
    for (let i = 0; i < 9; i++) s = updateLocomotion(t, 0, 0, 0, FPS);
    expect(9 * FPS).toBeLessThan(MOVE_HOLD_TIME);
    expect(s.moving).toBe(true);
  });

  it('a genuine stop transitions to idle after the grace window', () => {
    const t = newLocoTrack();
    for (let i = 0; i < 20; i++) walkStep(t);
    let s = updateLocomotion(t, 0, 0, 0, FPS);
    // run well past the hold window with no movement
    for (let i = 0; i < 30; i++) s = updateLocomotion(t, 0, 0, 0, FPS);
    expect(s.moving).toBe(false);
  });

  it('keeps the backpedal direction through a stalled frame', () => {
    const t = newLocoTrack();
    // facing +Z (0); travel toward -Z is backwards
    for (let i = 0; i < 10; i++) updateLocomotion(t, 0, -2.2 * FPS, 0, FPS);
    const moving = updateLocomotion(t, 0, -2.2 * FPS, 0, FPS);
    expect(moving.backwards).toBe(true);
    // a stalled frame must not flip walkBack -> walk
    const stalled = updateLocomotion(t, 0, 0, 0, FPS);
    expect(stalled.moving).toBe(true);
    expect(stalled.backwards).toBe(true);
  });

  it('treats a teleport snap as not moving', () => {
    const t = newLocoTrack();
    // 50u in one frame = 3000 u/s, far above the teleport cutoff
    const s = updateLocomotion(t, 50, 0, 0, FPS);
    expect(s.moving).toBe(false);
  });

  it('jitter scenario: alternating walk/stall frames never lose moving', () => {
    const t = newLocoTrack();
    walkStep(t);
    let everStopped = false;
    for (let i = 0; i < 60; i++) {
      // every other frame stalls (worst-case interp/terrain noise)
      const s = i % 2 === 0 ? updateLocomotion(t, 0, 0, 0, FPS) : walkStep(t);
      if (!s.moving) everStopped = true;
    }
    expect(everStopped).toBe(false);
  });
});
