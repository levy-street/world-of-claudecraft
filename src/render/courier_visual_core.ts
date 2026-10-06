/** Read-only presentation subset of the authoritative courier snapshot. */
export interface CourierVisualInfo {
  phase: 'ready' | 'outbound' | 'returning' | 'waiting';
  x: number;
  z: number;
}

export interface CourierVisualPose {
  lift: number;
  wing: number;
  pitch: number;
}

/** Cosmetic motion never changes the courier's authoritative horizontal position. */
export function courierVisualPoseInto(
  out: CourierVisualPose,
  phase: CourierVisualInfo['phase'],
  elapsed: number,
  reducedMotion: boolean,
): void {
  if (reducedMotion) {
    out.lift = 2;
    out.wing = 0.2;
    out.pitch = 0;
    return;
  }
  const travelling = phase === 'outbound' || phase === 'returning';
  const cycle = elapsed * Math.PI * 2 * (travelling ? 1.8 : 1.2);
  out.lift = 2 + Math.sin(cycle) * 0.07;
  out.wing = 0.2 + Math.sin(cycle) * 0.5;
  out.pitch = travelling ? -0.08 : 0;
}

/** No route prediction: orient along the last observed authoritative movement. */
export function courierFacing(
  previousX: number,
  previousZ: number,
  x: number,
  z: number,
  yaw: number,
): number {
  return Math.hypot(x - previousX, z - previousZ) > 0.001
    ? Math.atan2(x - previousX, z - previousZ)
    : yaw;
}
