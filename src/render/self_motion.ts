// The renderer's non-predictive self pose: the smoothing rule and the snap
// thresholds `self_render_position_core.ts` falls back on when local movement
// prediction is off or gated. Pure ({x,y,z} in and out, no Three, no DOM), so
// the renderer is a thin consumer and a headless harness drives the same math.

import type { SimEvent } from '../sim/types';

// Same teleport rule the renderer's self smoother uses (6 yd).
export const SELF_MOTION_SNAP_DIST_SQ = 6 * 6;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export function hasAuthoritativeSelfPositionDiscontinuity(
  events: readonly SimEvent[],
  playerId: number,
): boolean {
  return events.some(
    (event) =>
      event.type === 'unstuck' &&
      event.phase === 'completed' &&
      (event.pid === undefined || event.pid === playerId),
  );
}

export const SELF_RENDER_SMOOTH_RATE = 30;

/**
 * Advance the renderer's non-predictive self pose. A completed authoritative
 * recovery is a semantic discontinuity even when it moves less than the usual
 * six-yard teleport threshold, so it always replaces the prior display pose.
 */
export function updateSelfRenderFallback(
  current: Vec3Like,
  targetX: number,
  targetY: number,
  targetZ: number,
  ready: boolean,
  dt: number,
  smooth: boolean,
  authoritativeDiscontinuity: boolean,
): void {
  const dx = targetX - current.x;
  const dy = targetY - current.y;
  const dz = targetZ - current.z;
  if (
    !smooth ||
    !ready ||
    authoritativeDiscontinuity ||
    dx * dx + dy * dy + dz * dz > SELF_MOTION_SNAP_DIST_SQ
  ) {
    current.x = targetX;
    current.y = targetY;
    current.z = targetZ;
    return;
  }
  const t = 1 - Math.exp(-SELF_RENDER_SMOOTH_RATE * Math.max(0, dt));
  current.x += dx * t;
  current.y += dy * t;
  current.z += dz * t;
}
