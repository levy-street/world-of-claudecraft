import { courierFlightBlend } from '../sim/courier/motion';

/** Read-only presentation subset of the authoritative courier snapshot. */
export interface CourierVisualInfo {
  phase: 'ready' | 'outbound' | 'returning' | 'waiting';
  x: number;
  z: number;
  travelDistance?: number;
  remainingDistance?: number;
}

export interface CourierVisualPose {
  lift: number;
  flight: number;
  moving: boolean;
}

/** Ground runs bracket both legs. Reduced motion retains essential flight altitude. */
export function courierVisualPoseInto(
  out: CourierVisualPose,
  info: CourierVisualInfo,
  moved: boolean,
): void {
  const travelling = info.phase === 'outbound' || info.phase === 'returning';
  out.flight = travelling
    ? courierFlightBlend(info.travelDistance ?? 0, info.remainingDistance ?? 0)
    : 0;
  out.lift = 2 * out.flight;
  out.moving = moved || (travelling && (info.remainingDistance ?? 0) > 0);
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
