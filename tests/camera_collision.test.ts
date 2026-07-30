import { describe, expect, it } from 'vitest';
import { type CameraOcclusionState, stepCameraOcclusion } from '../src/render/camera_collision';

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
