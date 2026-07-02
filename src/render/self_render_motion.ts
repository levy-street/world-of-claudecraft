export interface SelfRenderPoint {
  x: number;
  y: number;
  z: number;
}

export const SELF_RENDER_SMOOTH_RATE = 64;
export const SELF_RENDER_SNAP_DIST_SQ = 6 * 6;

export function selfSnapshotAlpha(alpha: number, lead: number): number {
  return Math.min(1.25, alpha + Math.max(0, lead));
}

export function selfSnapshotPositionInto<T extends SelfRenderPoint>(
  prev: SelfRenderPoint,
  current: SelfRenderPoint,
  alpha: number,
  lead: number,
  out: T,
): T {
  const a = selfSnapshotAlpha(alpha, lead);
  out.x = prev.x + (current.x - prev.x) * a;
  out.y = prev.y + (current.y - prev.y) * a;
  out.z = prev.z + (current.z - prev.z) * a;
  return out;
}
export function selfRenderBlend(dt: number, smoothRate = SELF_RENDER_SMOOTH_RATE): number {
  return 1 - Math.exp(-smoothRate * Math.max(0, dt));
}

export function stepSelfRenderPositionInto(
  current: SelfRenderPoint,
  targetX: number,
  targetY: number,
  targetZ: number,
  ready: boolean,
  dt: number,
  out: SelfRenderPoint,
  smoothRate = SELF_RENDER_SMOOTH_RATE,
  snapDistSq = SELF_RENDER_SNAP_DIST_SQ,
): SelfRenderPoint {
  const dx = targetX - current.x;
  const dy = targetY - current.y;
  const dz = targetZ - current.z;
  if (!ready || dx * dx + dy * dy + dz * dz > snapDistSq) {
    out.x = targetX;
    out.y = targetY;
    out.z = targetZ;
    return out;
  }

  const t = selfRenderBlend(dt, smoothRate);
  out.x = current.x + dx * t;
  out.y = current.y + dy * t;
  out.z = current.z + dz * t;
  return out;
}
