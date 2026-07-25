import { describe, expect, it } from 'vitest';
import {
  BOOM_LEASH_XZ,
  BOOM_LEASH_Y,
  type CameraBoomState,
  createCameraBoom,
  stepCameraBoom,
} from '../src/render/camera_boom_core';

// The spring-arm pivot: exact critically damped follow with a leash and a
// teleport snap. These pin the feel contract: adopt-on-activate, converge
// without overshoot at any frame rate, trail vertical softer than horizontal,
// never trail beyond the leash, snap on teleports.

const step = (s: CameraBoomState, x: number, y: number, z: number, dt: number, n: number) => {
  for (let i = 0; i < n; i++) stepCameraBoom(s, x, y, z, dt);
};

describe('camera boom (spring-arm lag)', () => {
  it('adopts the target exactly on first activation', () => {
    const s = createCameraBoom();
    stepCameraBoom(s, 5, 2, -3, 1 / 60);
    expect(s.x).toBe(5);
    expect(s.y).toBe(2);
    expect(s.z).toBe(-3);
    expect(s.vx).toBe(0);
  });

  it('converges to a stationary target with no overshoot', () => {
    const s = createCameraBoom();
    stepCameraBoom(s, 0, 0, 0, 1 / 60);
    // Target steps 1 yd forward; the pivot must approach monotonically.
    let lastErr = 1;
    for (let i = 0; i < 240; i++) {
      stepCameraBoom(s, 1, 0, 0, 1 / 60);
      const err = 1 - s.x;
      expect(err).toBeGreaterThanOrEqual(-1e-6); // never past the target
      expect(err).toBeLessThanOrEqual(lastErr + 1e-9); // never retreating
      lastErr = err;
    }
    expect(Math.abs(1 - s.x)).toBeLessThan(1e-3);
  });

  it('is frame-rate independent (60 fps vs 240 fps land together)', () => {
    const a = createCameraBoom();
    const b = createCameraBoom();
    stepCameraBoom(a, 0, 0, 0, 1 / 60);
    stepCameraBoom(b, 0, 0, 0, 1 / 240);
    step(a, 2, 1, -2, 1 / 60, 30); // 0.5 s
    step(b, 2, 1, -2, 1 / 240, 120); // 0.5 s
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.02);
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.02);
    expect(Math.abs(a.z - b.z)).toBeLessThan(0.02);
  });

  it('trails vertically softer than horizontally', () => {
    const s = createCameraBoom();
    stepCameraBoom(s, 0, 0, 0, 1 / 60);
    step(s, 1, 1, 0, 1 / 60, 6); // 0.1 s after a unit step on both axes
    expect(1 - s.y).toBeGreaterThan(1 - s.x); // more vertical error remains
  });

  it('never trails beyond the leash under fast sustained motion', () => {
    const s = createCameraBoom();
    stepCameraBoom(s, 0, 0, 0, 1 / 60);
    let tx = 0;
    let ty = 0;
    for (let i = 0; i < 120; i++) {
      tx += 30 / 60; // 30 yd/s sprint
      ty += 12 / 60; // fast rise
      stepCameraBoom(s, tx, ty, 0, 1 / 60);
      expect(Math.hypot(s.x - tx, s.z - 0)).toBeLessThanOrEqual(BOOM_LEASH_XZ + 1e-6);
      expect(Math.abs(s.y - ty)).toBeLessThanOrEqual(BOOM_LEASH_Y + 1e-6);
    }
  });

  it('snaps outright on a teleport and zeroes velocity', () => {
    const s = createCameraBoom();
    stepCameraBoom(s, 0, 0, 0, 1 / 60);
    step(s, 3, 0, 0, 1 / 60, 10); // build up some velocity
    stepCameraBoom(s, 100, 5, 100, 1 / 60);
    expect(s.x).toBe(100);
    expect(s.y).toBe(5);
    expect(s.z).toBe(100);
    expect(s.vx).toBe(0);
    expect(s.vz).toBe(0);
  });

  it('a higher stiffness follows tighter (the reduced-motion mode)', () => {
    const soft = createCameraBoom();
    const stiff = createCameraBoom();
    stepCameraBoom(soft, 0, 0, 0, 1 / 60);
    stepCameraBoom(stiff, 0, 0, 0, 1 / 60);
    for (let i = 0; i < 6; i++) {
      stepCameraBoom(soft, 1, 0, 0, 1 / 60, 1);
      stepCameraBoom(stiff, 1, 0, 0, 1 / 60, 4);
    }
    expect(1 - stiff.x).toBeLessThan((1 - soft.x) * 0.5);
  });
});
