import { describe, it, expect } from 'vitest';
import {
  stepSelfFacing,
  approachAngle,
  releaseSelfFacing,
  SELF_TURN_MAX_RATE,
  SELF_FACING_CONVERGE_EPS,
} from '../src/render/facing_smooth';

const FRAME_60 = 1 / 60;

describe('approachAngle', () => {
  it('takes the shortest path across the +/-PI wrap', () => {
    // from 3.0 to -3.0 is +0.28 the short way, not -6.0 the long way
    const r = approachAngle(3.0, -3.0, 1);
    expect(r).toBeCloseTo(-3.0, 5); // within one big step, snaps to target
  });

  it('clamps a large change to maxStep along the shortest direction', () => {
    expect(approachAngle(0, Math.PI, 0.1)).toBeCloseTo(0.1, 6);
    expect(approachAngle(0, -Math.PI / 2, 0.1)).toBeCloseTo(-0.1, 6);
  });

  it('passes a small change straight through', () => {
    expect(approachAngle(0, 0.05, 0.2)).toBeCloseTo(0.05, 6);
  });
});

describe('stepSelfFacing', () => {
  it('NEVER teleports the model across a near-180deg camera-driven jump in one frame', () => {
    // Reproduces the bug: standing in mouse-camera mode the player orbits the
    // camera ~180deg away from the model facing, then starts moving so the
    // override engages. The old code did `facing = override` (instant snap).
    const from = 0;
    const target = Math.PI - 0.01; // camera orbited almost fully behind
    const next = stepSelfFacing(from, target, FRAME_60);
    const moved = Math.abs(next - from);
    expect(moved).toBeLessThan(Math.PI); // not a teleport
    // capped at the configured max angular velocity for one 60Hz frame
    expect(moved).toBeCloseTo(SELF_TURN_MAX_RATE * FRAME_60, 5);
  });

  it('reaches the target smoothly over several frames', () => {
    let f = 0;
    const target = Math.PI - 0.01;
    let frames = 0;
    while (Math.abs(f - target) > 1e-6 && frames < 1000) {
      f = stepSelfFacing(f, target, FRAME_60);
      frames++;
    }
    expect(frames).toBeGreaterThan(1); // took more than a single snap frame
    expect(frames).toBeLessThan(120); // but converges quickly (well under ~1s)
    expect(f).toBeCloseTo(target, 5);
  });

  it('does NOT rate-limit intentional input below the cap (keyboard TURN_SPEED = PI rad/s)', () => {
    // one 60Hz frame of keyboard turning is PI/60 rad, far under the cap, so it
    // must pass through unchanged - no lag added to normal turning.
    const perFrame = Math.PI / 60;
    const next = stepSelfFacing(0, perFrame, FRAME_60);
    expect(next).toBeCloseTo(perFrame, 6);
  });

  it('clamps an over-long frame so a hitch cannot over-rotate', () => {
    const moved = Math.abs(stepSelfFacing(0, Math.PI, 0.5) - 0);
    // 0.5s would be a huge step; it is clamped to the MAX_FRAME_DT budget
    expect(moved).toBeLessThanOrEqual(SELF_TURN_MAX_RATE * (1 / 30) + 1e-9);
  });
});

describe('releaseSelfFacing', () => {
  it('does NOT snap back to the sim facing in one frame when released mid-flick', () => {
    // Override held the model partway through a near-180deg flick toward the
    // camera; on release the sim facing is still the original heading, so a raw
    // assignment would snap the whole gap back in one frame. The rate limiter
    // must cap it instead.
    const heldOverride = 1.5; // model rotated partway toward camera
    const simFacing = -1.5; // sim heading still the other way (~PI gap)
    const r = releaseSelfFacing(heldOverride, simFacing, FRAME_60);
    const moved = Math.abs(r.facing - heldOverride);
    expect(moved).toBeLessThan(Math.PI); // not a teleport
    expect(moved).toBeCloseTo(SELF_TURN_MAX_RATE * FRAME_60, 5);
    expect(r.done).toBe(false); // still far from the sim facing, keep the override
  });

  it('converges back onto the sim facing over several frames, then reports done', () => {
    let f = 1.5;
    const simFacing = -1.5;
    let frames = 0;
    let done = false;
    while (!done && frames < 1000) {
      const r = releaseSelfFacing(f, simFacing, FRAME_60);
      f = r.facing;
      done = r.done;
      frames++;
    }
    expect(frames).toBeGreaterThan(1); // took more than a single snap frame
    expect(frames).toBeLessThan(120); // converges quickly (well under ~1s)
    expect(done).toBe(true);
    expect(f).toBe(simFacing); // snaps exactly onto sim facing on the converged frame
  });

  it('reports done immediately and matches the sim facing when already converged', () => {
    const simFacing = 0.7;
    const r = releaseSelfFacing(simFacing + SELF_FACING_CONVERGE_EPS / 2, simFacing, FRAME_60);
    expect(r.done).toBe(true);
    expect(r.facing).toBe(simFacing);
  });

  it('takes the shortest path back across the +/-PI wrap on release', () => {
    // override at 3.0, sim facing at -3.0: shortest path is +0.28, not -6.0.
    const r = releaseSelfFacing(3.0, -3.0, FRAME_60);
    // one small step toward -3.0 the short (positive-wrapping) way
    expect(r.facing).toBeGreaterThan(3.0);
  });
});
