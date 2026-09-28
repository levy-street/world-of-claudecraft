// Fire and Fly seat input. Movement is locked while seated, so the tank's heading
// follows the reticle instead of the camera, the turn keys orbit the view, and
// Escape with nothing left to close leaves the seat.
import { TURN_SPEED } from '../sim/types';
import type { IWorldVehicles } from '../world_api/vehicles';

interface FlatPoint {
  x: number;
  z: number;
}

/** Closer than this, the reticle sits on the tank and gives no heading. */
const FACING_EPSILON = 1e-3;
/** A stalled frame (a background tab) must not whip the view around. */
const MAX_LOOK_DT = 0.1;

export function turretSeated(world: { readonly turretSession?: unknown }): boolean {
  return (world.turretSession ?? null) !== null;
}

/** The yaw from `from` toward `to` (x += sin, z += cos); null when `to` sits on `from`. */
export function facingToward(from: FlatPoint, to: FlatPoint): number | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.hypot(dx, dz) < FACING_EPSILON ? null : Math.atan2(dx, dz);
}

/** The seated tank's heading: toward the reticle, else held. Null off the seat. */
export function turretRenderFacing(
  world: { readonly turretSession?: unknown; readonly player: { pos: FlatPoint; facing: number } },
  reticle: { point: FlatPoint } | null,
): number | null {
  if (!turretSeated(world)) return null;
  return (reticle && facingToward(world.player.pos, reticle.point)) ?? world.player.facing;
}

/** Escape's last step while seated: leave instead of opening the game menu. */
export function leaveTurretOnEscape(
  world: Pick<IWorldVehicles, 'leaveVehicle'> & { readonly turretSession?: unknown },
): boolean {
  if (!turretSeated(world)) return false;
  world.leaveVehicle();
  return true;
}

/** The camera yaw the held turn keys add this frame while seated (left turns up the yaw). */
export function turretKeyboardLookYaw(
  world: { readonly turretSession?: unknown },
  input: { heldTurnAxis(): number },
  frameDt: number,
): number {
  if (!turretSeated(world)) return 0;
  return input.heldTurnAxis() * TURN_SPEED * Math.min(MAX_LOOK_DT, Math.max(0, frameDt));
}
