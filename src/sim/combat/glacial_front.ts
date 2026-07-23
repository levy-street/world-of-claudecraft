export const GLACIAL_FRONT_ANGLE_DEG = 70;
export const GLACIAL_FRONT_MIN_RANGE = 7;
export const GLACIAL_FRONT_MAX_RANGE = 16;

export function empoweredStageForProgress(progress: number, stageCount: number): number {
  if (stageCount <= 1) return 1;
  const clamped = Math.max(0, Math.min(1, progress));
  return Math.min(stageCount, Math.floor(clamped * stageCount) + 1);
}

export function empoweredCastProgress(total: number, remaining: number): number {
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, (total - remaining) / total));
}

export function glacialFrontPresentationRange(progress: number): number {
  // The filled telegraph is a targeting promise, so it must snap to the same
  // four ranges gameplay uses instead of implying hits between thresholds.
  return [7, 10, 13, 16][empoweredStageForProgress(progress, 4) - 1];
}

export function glacialFrontContains(
  origin: { x: number; z: number },
  facing: number,
  point: { x: number; z: number },
  range: number,
  angleDeg = GLACIAL_FRONT_ANGLE_DEG,
): boolean {
  const dx = point.x - origin.x;
  const dz = point.z - origin.z;
  if (Math.hypot(dx, dz) > range) return false;
  const halfAngle = (angleDeg * Math.PI) / 360;
  const raw = Math.atan2(dx, dz) - facing;
  const delta = Math.atan2(Math.sin(raw), Math.cos(raw));
  return Math.abs(delta) <= halfAngle;
}
