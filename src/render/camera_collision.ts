export interface CameraOcclusionState {
  /** Physical camera fraction along the player-eye -> desired-camera segment. */
  pullT: number;
  /** Apparent camera fraction used for temporary FOV compensation on forced clamps. */
  lensT: number;
  fov: number;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

function expEase(current: number, target: number, rate: number, dt: number): number {
  if (dt <= 0 || rate <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function compensatedFov(baseFov: number, maxFov: number, apparentT: number, pullT: number): number {
  const safePull = Math.max(1e-3, pullT);
  const ratio = Math.max(1, apparentT / safePull);
  if (ratio <= 1.001) return baseFov;
  const baseRad = baseFov * Math.PI / 180;
  const fov = 2 * Math.atan(Math.tan(baseRad / 2) * ratio) * 180 / Math.PI;
  return Math.min(maxFov, Math.max(baseFov, fov));
}

/**
 * Smooths third-person camera collision while preserving a hard safety limit.
 *
 * `hardLimit` is the closest legal camera fraction from the real collider sweep;
 * the returned physical `pullT` never exceeds it. When a new occluder appears so
 * suddenly that this forces an immediate clamp, `lensT` and `fov` ease the
 * perceived zoom for a few frames without moving the camera into geometry.
 */
export function stepCameraOcclusion(
  state: CameraOcclusionState,
  hardLimit: number,
  softLimit: number,
  dt: number,
  pullInRate: number,
  pullOutRate: number,
  softWeight: number,
  baseFov: number,
  maxFov: number,
): CameraOcclusionState {
  const hard = clamp01(hardLimit);
  const soft = clamp01(softLimit);
  const softTarget = hard >= 1 && soft < 1
    ? hard + (soft - hard) * Math.min(1, Math.max(0, softWeight))
    : hard;
  const target = Math.min(hard, softTarget);
  const rate = target < state.pullT ? pullInRate : pullOutRate;
  const easedPull = expEase(clamp01(state.pullT), target, rate, dt);
  const pullT = Math.min(easedPull, hard);

  let lensT = clamp01(state.lensT);
  if (lensT > pullT) lensT = expEase(lensT, pullT, pullInRate, dt);
  else lensT = pullT;
  lensT = Math.max(pullT, lensT);

  state.pullT = pullT;
  state.lensT = lensT;
  state.fov = compensatedFov(baseFov, maxFov, lensT, pullT);
  return state;
}
