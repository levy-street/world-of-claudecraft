// Whether a Crashing Tide lane FITS the floor it is laid on. A volley is laid
// round a player, wherever the fight has been dragged, and a lane is only fair
// if everyone standing in it can step out of it sideways. A lane that would fill
// a passage, or pin someone between its edge and a wall, is simply not laid.
// Pure geometry against the floor's own colliders, no rng: the arena test runs
// this same check over generated hoards.

import type { Collider } from '../colliders';
import { HOARD_TIDE_WAVE_HALF_DEPTH } from './hoard_boss_kits';

/** A player's body, and how finely a lane is walked when it is judged. */
export const TIDE_FIT_PLAYER_MARGIN = 0.6;
const ALONG_STEP = 1.5;
const LATERAL_STEP = 1.5;
const EXIT_STEP = 0.5;

export interface TideLane {
  facing: number;
  span: number;
  radius: number;
}

export function tideFloorBlocked(colliders: readonly Collider[], x: number, z: number): boolean {
  for (let i = 0; i < colliders.length; i++) {
    const collider = colliders[i];
    const dx = x - collider.x;
    const dz = z - collider.z;
    if (collider.type === 'circle') {
      if (Math.hypot(dx, dz) < collider.r + TIDE_FIT_PLAYER_MARGIN) return true;
      continue;
    }
    const cos = Math.cos(collider.rot);
    const sin = Math.sin(collider.rot);
    if (
      Math.abs(dx * cos - dz * sin) < collider.hw + TIDE_FIT_PLAYER_MARGIN &&
      Math.abs(dx * sin + dz * cos) < collider.hd + TIDE_FIT_PLAYER_MARGIN
    )
      return true;
  }
  return false;
}

/** A straight sideways walk from a point `lateral` off a lane's middle to just
 *  past its edge on `side`, clear of scenery all the way. */
export function tideExitClear(
  colliders: readonly Collider[],
  x: number,
  z: number,
  cos: number,
  sin: number,
  lateral: number,
  span: number,
  side: 1 | -1,
): boolean {
  const need = span - side * lateral + TIDE_FIT_PLAYER_MARGIN;
  for (let step = EXIT_STEP; step < need + EXIT_STEP; step += EXIT_STEP) {
    const d = Math.min(step, need) * side;
    if (tideFloorBlocked(colliders, x + d * cos, z - d * sin)) return false;
  }
  return true;
}

/** The scenery that could touch a lane or a walk out of it: a whole floor's
 *  colliders against every sample is far too much for one tick. */
export function tideLaneColliders(
  all: readonly Collider[],
  x: number,
  z: number,
  lane: TideLane,
): Collider[] {
  const extent = lane.radius / 2 + HOARD_TIDE_WAVE_HALF_DEPTH;
  const reach = Math.hypot(extent, lane.span * 2 + TIDE_FIT_PLAYER_MARGIN) + TIDE_FIT_PLAYER_MARGIN;
  const near: Collider[] = [];
  for (let i = 0; i < all.length; i++) {
    const collider = all[i];
    const size = collider.type === 'circle' ? collider.r : Math.hypot(collider.hw, collider.hd);
    if (Math.hypot(collider.x - x, collider.z - z) <= reach + size) near.push(collider);
  }
  return near;
}

/** Whether every standable point of the lane (its middle at `x`, `z`, in the
 *  colliders' own frame) has a clear way out to at least one side. */
export function tideLaneFits(
  all: readonly Collider[],
  x: number,
  z: number,
  lane: TideLane,
): boolean {
  const cos = Math.cos(lane.facing);
  const sin = Math.sin(lane.facing);
  const extent = lane.radius / 2 + HOARD_TIDE_WAVE_HALF_DEPTH;
  const colliders = tideLaneColliders(all, x, z, lane);
  for (let along = -extent; along <= extent; along += ALONG_STEP) {
    for (let lateral = -lane.span; lateral <= lane.span; lateral += LATERAL_STEP) {
      const px = x + lateral * cos + along * sin;
      const pz = z - lateral * sin + along * cos;
      // Only floor a player can stand on is judged.
      if (tideFloorBlocked(colliders, px, pz)) continue;
      if (
        !tideExitClear(colliders, px, pz, cos, sin, lateral, lane.span, 1) &&
        !tideExitClear(colliders, px, pz, cos, sin, lateral, lane.span, -1)
      )
        return false;
    }
  }
  return true;
}
