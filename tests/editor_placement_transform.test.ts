import { describe, expect, it } from 'vitest';
import {
  CommitCoalescer,
  NORTH_UP_YAW,
  NUDGE_STEP_BIG_YD,
  NUDGE_STEP_YD,
  nudgeDelta,
  PLACEMENT_SCALE_MAX,
  PLACEMENT_SCALE_MIN,
  ROTATE_STEP_RAD,
  rotateStep,
  scaleStep,
  wrapAngle,
} from '../src/editor/placement_transform_core';

// Pure Select-mode manipulation math: screen-relative arrow nudges vs the
// camera yaw, wheel rotation with wrap, wheel scaling with the inspector
// clamps, and the one-commit-per-burst coalescer.

describe('nudgeDelta (screen-relative, camera yaw)', () => {
  it('at the default yaw (PI, camera looking toward -z) arrows match the screen', () => {
    // Screen up = away from the camera = -z; screen right = +x.
    const up = nudgeDelta('ArrowUp', NORTH_UP_YAW, 1);
    expect(up.dx).toBeCloseTo(0, 10);
    expect(up.dz).toBeCloseTo(-1, 10);
    const right = nudgeDelta('ArrowRight', NORTH_UP_YAW, 1);
    expect(right.dx).toBeCloseTo(1, 10);
    expect(right.dz).toBeCloseTo(0, 10);
  });

  it('down and left are the exact opposites of up and right', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, Math.PI, 4.2]) {
      const up = nudgeDelta('ArrowUp', yaw, 1);
      const down = nudgeDelta('ArrowDown', yaw, 1);
      expect(down.dx).toBeCloseTo(-up.dx, 10);
      expect(down.dz).toBeCloseTo(-up.dz, 10);
      const right = nudgeDelta('ArrowRight', yaw, 1);
      const left = nudgeDelta('ArrowLeft', yaw, 1);
      expect(left.dx).toBeCloseTo(-right.dx, 10);
      expect(left.dz).toBeCloseTo(-right.dz, 10);
    }
  });

  it('rotates with the camera: yaw 0 looks toward +z, yaw PI/2 toward +x', () => {
    const upAt0 = nudgeDelta('ArrowUp', 0, 1);
    expect(upAt0.dx).toBeCloseTo(0, 10);
    expect(upAt0.dz).toBeCloseTo(1, 10);
    const rightAt0 = nudgeDelta('ArrowRight', 0, 1);
    expect(rightAt0.dx).toBeCloseTo(-1, 10);
    expect(rightAt0.dz).toBeCloseTo(0, 10);
    const upAt90 = nudgeDelta('ArrowUp', Math.PI / 2, 1);
    expect(upAt90.dx).toBeCloseTo(1, 10);
    expect(upAt90.dz).toBeCloseTo(0, 10);
    const rightAt90 = nudgeDelta('ArrowRight', Math.PI / 2, 1);
    expect(rightAt90.dx).toBeCloseTo(0, 10);
    expect(rightAt90.dz).toBeCloseTo(1, 10);
  });

  it('scales by the step (0.5 yd default, 2 yd with Shift)', () => {
    const small = nudgeDelta('ArrowUp', NORTH_UP_YAW, NUDGE_STEP_YD);
    expect(small.dz).toBeCloseTo(-0.5, 10);
    const big = nudgeDelta('ArrowUp', NORTH_UP_YAW, NUDGE_STEP_BIG_YD);
    expect(big.dz).toBeCloseTo(-2, 10);
  });
});

describe('rotateStep', () => {
  it('steps 15 degrees in the wheel direction', () => {
    expect(rotateStep(0, 100)).toBeCloseTo(ROTATE_STEP_RAD, 10);
    expect(rotateStep(Math.PI, -100)).toBeCloseTo(Math.PI - ROTATE_STEP_RAD, 10);
  });

  it('wraps into [0, 2*PI)', () => {
    const nearFull = Math.PI * 2 - ROTATE_STEP_RAD / 2;
    const wrapped = rotateStep(nearFull, 100);
    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(Math.PI * 2);
    expect(wrapped).toBeCloseTo(ROTATE_STEP_RAD / 2, 10);
    const under = rotateStep(ROTATE_STEP_RAD / 2, -100);
    expect(under).toBeGreaterThanOrEqual(0);
    expect(under).toBeCloseTo(Math.PI * 2 - ROTATE_STEP_RAD / 2, 10);
  });

  it('wrapAngle normalizes negatives', () => {
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 10);
    expect(wrapAngle(Math.PI * 4 + 0.25)).toBeCloseTo(0.25, 10);
  });
});

describe('scaleStep', () => {
  it('grows on wheel-up (negative deltaY) and shrinks on wheel-down', () => {
    expect(scaleStep(1, -100)).toBeCloseTo(1.1, 10);
    expect(scaleStep(1.1, 100)).toBeCloseTo(1, 10);
  });

  it('clamps to the inspector slider bounds', () => {
    expect(scaleStep(PLACEMENT_SCALE_MAX, -100)).toBe(PLACEMENT_SCALE_MAX);
    expect(scaleStep(4.9, -100)).toBe(PLACEMENT_SCALE_MAX);
    expect(scaleStep(PLACEMENT_SCALE_MIN, 100)).toBe(PLACEMENT_SCALE_MIN);
    expect(scaleStep(0.21, 100)).toBe(PLACEMENT_SCALE_MIN);
  });

  it('rounds to 2 decimals so repeated ticks stay tidy', () => {
    const v = scaleStep(scaleStep(1, -100), -100);
    expect(v).toBe(1.21);
  });
});

describe('CommitCoalescer (one undo commit per burst)', () => {
  it('is idle until a tick, then pending', () => {
    const c = new CommitCoalescer(400);
    expect(c.pending).toBe(false);
    expect(c.due(1_000)).toBe(false);
    c.tick(0);
    expect(c.pending).toBe(true);
  });

  it('is not due before the window lapses', () => {
    const c = new CommitCoalescer(400);
    c.tick(0);
    expect(c.due(399)).toBe(false);
    expect(c.pending).toBe(true);
  });

  it('each tick extends the deadline (a burst commits once, at the end)', () => {
    const c = new CommitCoalescer(400);
    c.tick(0);
    c.tick(300);
    expect(c.due(400)).toBe(false); // still inside the extended window
    expect(c.due(700)).toBe(true); // 300 + 400
    expect(c.due(701)).toBe(false); // fires exactly once
    expect(c.pending).toBe(false);
  });

  it('cancel drops the burst without committing', () => {
    const c = new CommitCoalescer(400);
    c.tick(0);
    c.cancel();
    expect(c.pending).toBe(false);
    expect(c.due(10_000)).toBe(false);
  });

  it('a new burst after a commit works again', () => {
    const c = new CommitCoalescer(400);
    c.tick(0);
    expect(c.due(500)).toBe(true);
    c.tick(600);
    expect(c.due(999)).toBe(false);
    expect(c.due(1_000)).toBe(true);
  });
});
