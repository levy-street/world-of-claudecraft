import { describe, expect, it } from 'vitest';
import {
  type CameraOcclusionState,
  resolveCameraBaseFov,
  stepCameraOcclusion,
} from '../src/render/camera_collision';

const PULL_IN = 10;
const PULL_OUT = 6;
const SOFT_WEIGHT = 0.45;
const BASE_FOV = 60;
const MAX_FOV = 98;
const DT = 1 / 60;

function step(
  state: CameraOcclusionState,
  hard: number,
  soft: number,
  dt = DT,
): CameraOcclusionState {
  return stepCameraOcclusion(
    state,
    hard,
    soft,
    dt,
    PULL_IN,
    PULL_OUT,
    SOFT_WEIGHT,
    BASE_FOV,
    MAX_FOV,
  );
}

describe('camera collision smoothing', () => {
  it('pre-eases inward when the soft occlusion sweep sees a nearby wall', () => {
    const state: CameraOcclusionState = { pullT: 1, lensT: 1, fov: BASE_FOV };

    step(state, 1, 0.65);

    expect(state.pullT).toBeLessThan(1);
    expect(state.pullT).toBeGreaterThan(0.65);
  });

  it('never moves the physical camera past the hard collision limit', () => {
    const state: CameraOcclusionState = { pullT: 1, lensT: 1, fov: BASE_FOV };

    step(state, 0.42, 0.35);

    expect(state.pullT).toBeLessThanOrEqual(0.42);
  });

  it('smooths the perceived zoom when a sudden hard clamp is unavoidable', () => {
    const state: CameraOcclusionState = { pullT: 1, lensT: 1, fov: BASE_FOV };

    step(state, 0.42, 0.35);

    expect(state.lensT).toBeGreaterThan(state.pullT);
    expect(state.fov).toBeGreaterThan(BASE_FOV);
    expect(state.fov).toBeLessThanOrEqual(MAX_FOV);
  });

  it('does not keep pulling physically inward once the hard surface is reached', () => {
    const state: CameraOcclusionState = { pullT: 1, lensT: 1, fov: BASE_FOV };

    step(state, 0.42, 0.35);
    const firstPull = state.pullT;
    step(state, 0.42, 0.35);

    expect(firstPull).toBe(0.42);
    expect(state.pullT).toBe(0.42);
    expect(state.lensT).toBeGreaterThan(state.pullT);
  });

  it('eases back out instead of snapping when the path clears', () => {
    const state: CameraOcclusionState = { pullT: 0.42, lensT: 0.42, fov: BASE_FOV };

    step(state, 1, 1);

    expect(state.pullT).toBeGreaterThan(0.42);
    expect(state.pullT).toBeLessThan(1);
    expect(state.fov).toBe(BASE_FOV);
  });
});

// The player's Field of View comfort setting (Settings.cameraFov, 55..100). The
// renderer stores its resolved value and threads it through stepCameraOcclusion as
// the occlusion base every frame, so the slider changes the rendered FOV AND
// survives the per-frame camera update. These pin that contract (the renderer
// previously hardcoded the shipped 60 here, silently ignoring the setting).
describe('camera field-of-view setting', () => {
  it('resolves the players FOV within range and clamps out-of-range values', () => {
    expect(resolveCameraBaseFov(90)).toBe(90);
    expect(resolveCameraBaseFov(55)).toBe(55);
    expect(resolveCameraBaseFov(100)).toBe(100);
    expect(resolveCameraBaseFov(120)).toBe(100); // clamp high
    expect(resolveCameraBaseFov(40)).toBe(55); // clamp low
  });

  it('falls back to the shipped default for a non-finite stored value', () => {
    expect(resolveCameraBaseFov(Number.NaN)).toBe(60);
    expect(resolveCameraBaseFov(Number.POSITIVE_INFINITY)).toBe(60);
  });

  it('renders the players chosen base FOV, not the shipped default, when nothing occludes', () => {
    const userBase = resolveCameraBaseFov(90);
    const state: CameraOcclusionState = { pullT: 1, lensT: 1, fov: BASE_FOV };

    stepCameraOcclusion(
      state,
      1,
      1,
      DT,
      PULL_IN,
      PULL_OUT,
      SOFT_WEIGHT,
      userBase,
      Math.max(MAX_FOV, userBase),
    );

    expect(state.fov).toBe(90);
    expect(state.fov).not.toBe(BASE_FOV);
  });

  it('never narrows below a high base FOV while compensating for a hard clamp', () => {
    const userBase = resolveCameraBaseFov(100); // top of range, above the default comp ceiling
    const maxComp = Math.max(MAX_FOV, userBase);
    const state: CameraOcclusionState = { pullT: 1, lensT: 1, fov: userBase };

    stepCameraOcclusion(state, 0.42, 0.35, DT, PULL_IN, PULL_OUT, SOFT_WEIGHT, userBase, maxComp);

    expect(state.fov).toBeGreaterThanOrEqual(userBase);
    expect(state.fov).toBeLessThanOrEqual(maxComp);
  });
});
