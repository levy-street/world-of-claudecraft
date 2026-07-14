import { describe, expect, it } from 'vitest';
import {
  advanceSelfFacing,
  approachAngle,
  releaseSelfFacing,
  SELF_FACING_CONVERGE_EPS,
  SELF_TURN_MAX_RATE,
  stepSelfFacing,
  wrapAngle,
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

describe('advanceSelfFacing', () => {
  it('stays glued to a fast flick instead of trailing behind the camera (issue #1778)', () => {
    // Reproduces the bug: a brief but fast right-mouse flick rotates the camera
    // faster than SELF_TURN_MAX_RATE. A plain velocity cap makes the model fall
    // steadily behind, opening a gap that snaps shut on release. The camera's
    // ongoing rotation must instead be applied 1:1 so the body stays with it.
    const perFrame = 0.4; // rad/frame, well above the cap (10/60 = 0.167)
    let camYaw = 0;
    let model = 0; // glued to the camera at engage (no residual)
    let lastTarget = camYaw;
    let capped = 0; // a raw velocity cap, for contrast
    let cappedCam = 0;
    for (let f = 0; f < 6; f++) {
      camYaw += perFrame;
      model = advanceSelfFacing(model, camYaw, lastTarget, FRAME_60);
      lastTarget = camYaw;
      cappedCam += perFrame;
      capped = stepSelfFacing(capped, cappedCam, FRAME_60);
    }
    // decoupled: the model rides the camera exactly, no built-up lag
    expect(Math.abs(wrapAngle(model - camYaw))).toBeCloseTo(0, 6);
    // contrast: the old raw cap trails the same flick by well over half a radian
    expect(Math.abs(wrapAngle(capped - cappedCam))).toBeGreaterThan(0.5);
  });

  it('still eases the engage discontinuity instead of teleporting (orbit then engage)', () => {
    // Engaging mouselook after orbiting ~180deg away: the seed gap is residual
    // and must ease in under the cap, exactly like the old stepSelfFacing did.
    const seed = 0; // model showing the sim facing
    const camYaw = Math.PI - 0.01; // camera orbited almost fully behind
    const next = advanceSelfFacing(seed, camYaw, camYaw, FRAME_60);
    const moved = Math.abs(wrapAngle(next - seed));
    expect(moved).toBeLessThan(Math.PI); // not a teleport
    expect(moved).toBeCloseTo(SELF_TURN_MAX_RATE * FRAME_60, 5);
  });

  it('the first engage frame matches the old rate-limited step exactly', () => {
    // On first engage lastTarget === target, so the whole seed gap is residual
    // and the result is identical to a plain velocity cap toward the camera.
    const seed = 0.3;
    const camYaw = 2.0;
    expect(advanceSelfFacing(seed, camYaw, camYaw, FRAME_60)).toBeCloseTo(
      stepSelfFacing(seed, camYaw, FRAME_60),
      6,
    );
  });

  it('follows a sharp one-frame camera move once the residual has closed', () => {
    // Held long enough that the residual is zero; a single sharp flick (0.9 rad
    // in one frame, far over the cap) is followed exactly, where a raw cap would
    // clip it to the max step and lag.
    const next = advanceSelfFacing(1.0, 1.9, 1.0, FRAME_60);
    expect(next).toBeCloseTo(1.9, 6);
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

  it('clears the prior camera target before a release can be interrupted by re-engage', () => {
    const staleTarget = 1.8;
    const held = advanceSelfFacing(0, staleTarget, staleTarget, FRAME_60);
    const released = releaseSelfFacing(held + 0.8, 0, FRAME_60);
    expect(released.done).toBe(false);
    expect(released.lastTarget).toBeNull();

    // Orbit while the model is still converging from release, then re-engage.
    // The reset target makes this a fresh engage gap, so it stays under the cap.
    const reengageTarget = -2.4;
    const next = advanceSelfFacing(
      released.facing,
      reengageTarget,
      released.lastTarget ?? reengageTarget,
      FRAME_60,
    );
    expect(Math.abs(wrapAngle(next - released.facing))).toBeCloseTo(
      SELF_TURN_MAX_RATE * FRAME_60,
      5,
    );
  });
});
