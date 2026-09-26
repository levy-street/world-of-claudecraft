import { describe, expect, it } from 'vitest';
import {
  ACTION_CAM_BOB_X,
  ACTION_CAM_BOB_Y,
  ACTION_CAM_DROP,
  ACTION_CAM_FOV,
  ACTION_CAM_SIDE_BASE,
  ACTION_CAM_SIDE_MAX,
  ACTION_CAM_SIDE_PER_DIST,
  type ActionCamOffset,
  actionCamOffset,
  createActionCam,
  setActionCamTarget,
  stepActionCam,
  stepActionCamBob,
} from '../src/render/action_cam_core';
import { RUN_SPEED } from '../src/sim/types';

const out = (): ActionCamOffset => ({ x: 9, z: 9, drop: 9, fov: 9 });

// A primed state (the boot apply already happened with the cam off), so a
// later request glides the way a player's toggle does.
function primed() {
  const s = createActionCam();
  setActionCamTarget(s, false, 1);
  return s;
}

function step(
  s: ReturnType<typeof createActionCam>,
  enabled: boolean,
  side: number,
  dt = 1 / 60,
  snap = false,
) {
  setActionCamTarget(s, enabled, side);
  stepActionCam(s, dt, snap);
}

function settle(enabled: boolean, side: number, s = primed(), seconds = 3) {
  for (let t = 0; t < seconds; t += 1 / 60) step(s, enabled, side);
  return s;
}

describe('action_cam_core', () => {
  it('starts off: the classic chase camera passes through untouched', () => {
    const s = createActionCam();
    expect(actionCamOffset(s, 0.7, 12, out())).toEqual({ x: 0, z: 0, drop: 0, fov: 0 });
  });

  it('the first request (boot or renderer rebuild) lands instantly, no sweep', () => {
    const s = createActionCam();
    setActionCamTarget(s, true, -1);
    expect(s.weight).toBe(1);
    expect(s.side).toBe(-1);
  });

  it('blends in over time rather than snapping', () => {
    const s = primed();
    step(s, true, 1);
    expect(s.weight).toBeGreaterThan(0);
    expect(s.weight).toBeLessThan(0.2);
    settle(true, 1, s);
    expect(s.weight).toBe(1);
  });

  it('reduced motion snaps straight to the target mode and side', () => {
    const s = primed();
    step(s, true, -1, 1 / 60, true);
    expect(s.weight).toBe(1);
    expect(s.side).toBe(-1);
    step(s, false, -1, 1 / 60, true);
    expect(s.weight).toBe(0);
  });

  it('right shoulder shifts the pivot to screen-right, left to screen-left', () => {
    // yaw 0: the camera looks along +z, so screen-right is -x.
    const right = actionCamOffset(settle(true, 1), 0, 10, out());
    const expected = ACTION_CAM_SIDE_BASE + ACTION_CAM_SIDE_PER_DIST * 10;
    expect(right.x).toBeCloseTo(-expected);
    expect(right.z).toBeCloseTo(0);
    const left = actionCamOffset(settle(true, -1), 0, 10, out());
    expect(left.x).toBeCloseTo(expected);
    // yaw pi/2: looking along +x, screen-right is +z.
    const r90 = actionCamOffset(settle(true, 1), Math.PI / 2, 10, out());
    expect(r90.x).toBeCloseTo(0);
    expect(r90.z).toBeCloseTo(expected);
  });

  it('the shift is perpendicular to the view direction at any yaw', () => {
    const s = settle(true, 1);
    for (const yaw of [0.3, 1.9, -2.4, 3.1]) {
      const o = actionCamOffset(s, yaw, 8, out());
      expect(o.x * Math.sin(yaw) + o.z * Math.cos(yaw)).toBeCloseTo(0);
    }
  });

  it('caps the lateral shift at far zoom and applies the drop and FOV at full weight', () => {
    const o = actionCamOffset(settle(true, 1), 0, 100, out());
    expect(Math.abs(o.x)).toBeCloseTo(ACTION_CAM_SIDE_MAX);
    expect(o.drop).toBeCloseTo(ACTION_CAM_DROP);
    expect(o.fov).toBeCloseTo(ACTION_CAM_FOV);
  });

  it('the shoulder slider scales the offset: center sits right behind the avatar', () => {
    const full = actionCamOffset(settle(true, 1), 0, 3, out());
    const half = actionCamOffset(settle(true, 0.5), 0, 3, out());
    const center = actionCamOffset(settle(true, 0), 0, 3, out());
    expect(half.x).toBeCloseTo(full.x / 2);
    expect(center.x).toBeCloseTo(0);
    // Center still keeps the shoulder-height drop and the FOV widen.
    expect(center.drop).toBeCloseTo(ACTION_CAM_DROP);
    // Out-of-range input clamps to the full offset.
    const s = primed();
    setActionCamTarget(s, true, 5);
    expect(s.targetSide).toBe(1);
  });

  it('a shoulder swap glides through center instead of jumping', () => {
    const s = settle(true, 1);
    step(s, true, -1);
    expect(s.side).toBeLessThan(1);
    expect(s.side).toBeGreaterThan(0);
    settle(true, -1, s);
    expect(s.side).toBe(-1);
  });

  it('while off it tracks the chosen side, so re-enabling never sweeps across', () => {
    const s = settle(true, 1);
    settle(false, 1, s);
    expect(s.weight).toBe(0);
    step(s, false, -1);
    expect(s.side).toBe(-1);
  });

  it('clamps a huge frame step so a hitch cannot overshoot', () => {
    const s = primed();
    step(s, true, 1, 10);
    expect(s.weight).toBeLessThan(1);
    step(s, true, 1, -1);
    expect(Number.isFinite(s.weight)).toBe(true);
  });

  describe('stride bob', () => {
    // Run straight at `speed` for `seconds` on flat ground, sampling the offset.
    function run(speed: number, seconds: number, s = settle(true, 1), y = () => 0) {
      const samples: ActionCamOffset[] = [];
      for (let t = 0; t < seconds; t += 1 / 60) {
        stepActionCam(s, 1 / 60, false);
        stepActionCamBob(s, speed, y(), 1 / 60, false);
        samples.push({ ...actionCamOffset(s, 0, 3, out()) });
      }
      return { s, samples };
    }
    const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

    it('bobs while running: a dip and a sideways sway within their amplitudes', () => {
      const { samples } = run(RUN_SPEED, 3);
      const late = samples.slice(120);
      const drop = late.map((o) => o.drop);
      expect(range(drop)).toBeGreaterThan(ACTION_CAM_BOB_Y * 0.8);
      expect(range(drop)).toBeLessThanOrEqual(ACTION_CAM_BOB_Y + 1e-6);
      const x = late.map((o) => o.x);
      expect(range(x)).toBeGreaterThan(ACTION_CAM_BOB_X * 1.5);
      expect(range(x)).toBeLessThanOrEqual(2 * ACTION_CAM_BOB_X + 1e-6);
    });

    it('dips at step rate: about 2.5 footfalls a second at a run', () => {
      const { samples } = run(RUN_SPEED, 4);
      const drop = samples.slice(120).map((o) => o.drop);
      let peaks = 0;
      for (let i = 1; i < drop.length - 1; i++) {
        if (drop[i] > drop[i - 1] && drop[i] >= drop[i + 1]) peaks++;
      }
      const seconds = drop.length / 60;
      expect(peaks / seconds).toBeGreaterThan(2);
      expect(peaks / seconds).toBeLessThan(3);
    });

    it('standing still does not bob, and stopping eases out instead of snapping', () => {
      expect(range(run(0, 2).samples.map((o) => o.drop))).toBeLessThan(1e-9);
      const { s } = run(RUN_SPEED, 2);
      const before = s.bobAmp;
      stepActionCamBob(s, 0, 0, 1 / 60, false);
      expect(s.bobAmp).toBeLessThan(before);
      expect(s.bobAmp).toBeGreaterThan(before * 0.8);
    });

    it('fades out in the air, and is forced off by still (swim, dead, reduced motion)', () => {
      let y = 0;
      const { s } = run(RUN_SPEED, 2, settle(true, 1), () => (y += 0.1)); // 6 yd/s climb
      expect(s.bobAmp).toBeLessThan(0.01);
      const r = run(RUN_SPEED, 2).s;
      stepActionCamBob(r, RUN_SPEED, 0, 1 / 60, true);
      expect(r.bobAmp).toBe(0);
    });

    it('never bobs while Action Cam is off', () => {
      const off = settle(false, 1);
      const { samples } = run(RUN_SPEED, 2, off);
      for (const o of samples) expect(o).toEqual({ x: 0, z: 0, drop: 0, fov: 0 });
    });
  });
});
