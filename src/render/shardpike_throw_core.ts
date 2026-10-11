import { PROJECTILE_MAX_FLIGHT, PROJECTILE_SPEED } from '../sim/projectile_travel';

type Point = { x: number; y: number; z: number };
export const SHARDPIKE_TRAIL_INTERVAL = 1 / 30;
/** Horizontal travel matches the authority; height converges to the animated eye.
 * In-place output keeps the frame loop allocation-free and never overshoots. */
export function advanceShardpikeFlight(out: Point, target: Readonly<Point>, dt: number): void {
  const horizontal = Math.hypot(target.x - out.x, target.z - out.z);
  const fraction =
    horizontal > 0.001 ? Math.min(1, (PROJECTILE_SPEED * Math.max(0, dt)) / horizontal) : 1;
  out.x += (target.x - out.x) * fraction;
  out.y += (target.y - out.y) * fraction;
  out.z += (target.z - out.z) * fraction;
}
export function shardpikeFlightExpired(
  age: number,
  sourceAlive: boolean,
  targetAlive: boolean,
): boolean {
  return !sourceAlive || !targetAlive || age > PROJECTILE_MAX_FLIGHT + 0.3;
}
/** Carry belongs to the emission cadence; the last emitted point stays unchanged
 * on skipped frames so high refresh rates cannot tear holes in the wake. */
export function shardpikeTrailDue(carry: number): boolean {
  return carry + 1e-9 >= SHARDPIKE_TRAIL_INTERVAL;
}
