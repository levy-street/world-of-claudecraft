// The Sledge Road as the Sledge Tusker's Trample reads it: how far a lane runs
// before the road ends, which ice outcrop it runs into, and whether a spot
// burns in a soulfire trail. Pure geometry over the Sanctum's authored field
// (instance-local yards), shared by the encounter (sledge_tusker.ts), the
// renderer's lane paint (render/gravewyrm_sanctum_fx/sanctum_fx_core.ts) and
// the HUD alert, so the lane a player reads is the lane the sim tests.
//
// Zero rng, no SimContext.

import { GRAVEWYRM_SANCTUM_FIELD } from '../../content/gravewyrm_sanctum_layout';
import { authoredFieldHeight } from '../../instances/authored_field';
import type { TuskerLane } from '../../types';
import { TUSKER_TUNING as T } from './ids';

/** The Tusker's drawn body radius (its template bodyRadius): a plain lane
 *  strikes this far past where its centre stops (its leading edge). */
export const TUSKER_BODY = 3.5;
/** A step along the Trample lane that drops (or climbs) more than this is the
 *  edge of the road: the lane stops short of it. */
const LANE_EDGE = 1.5;

/** How far the Trample lane runs from (x, z) along `yaw` before the road
 *  ends (a cliff or the crevasse), instance-local, at most `max` yards. */
export function trampleReach(x: number, z: number, yaw: number, max: number): number {
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  let prev = authoredFieldHeight(GRAVEWYRM_SANCTUM_FIELD, x, z);
  let len = 0;
  for (let d = 1; d <= max; d++) {
    const h = authoredFieldHeight(GRAVEWYRM_SANCTUM_FIELD, x + ax * d, z + az * d);
    if (Math.abs(h - prev) > LANE_EDGE) break;
    prev = h;
    len = d;
  }
  return len;
}

/** Is the Trample lane locked with `castRemaining` seconds left on its bar?
 *  Before the lock the lane follows its target (sledge_tusker.ts aims it each
 *  tick); from the lock to the charge it holds still. The renderer and the
 *  HUD read the same bar off the mirrored Tusker, so they lock with it. */
export function trampleAimLocked(castRemaining: number): boolean {
  return castRemaining <= T.trampleLock + 1e-9;
}

/** The yaw from (x, z) to (tx, tz), or `fallback` when the two stand on top
 *  of each other (no direction to read). */
export function trampleAimYaw(
  x: number,
  z: number,
  tx: number,
  tz: number,
  fallback: number,
): number {
  const dx = tx - x;
  const dz = tz - z;
  if (dx * dx + dz * dz < 0.25) return fallback;
  return Math.atan2(dx, dz);
}

/** A standing outcrop as the lane reads it: its object and where it stands
 *  (instance-local). */
export interface OutcropSpot {
  id: number;
  x: number;
  z: number;
}

/**
 * The Trample lane from (x, z) along `yaw` (instance-local), given the
 * outcrops still standing.
 *
 * A lane runs `trampleLength` yards or to the road's end. It RUNS INTO an
 * outcrop when its strip touches the outcrop's body (the outcrop's centre
 * within the strip's half width plus the outcrop's radius of the lane's line)
 * and the outcrop's face stands on the lane's own run of road, at least a
 * run-up past the tusk tips. Then the beast stops with its tusks in the ice:
 * its centre runs to `tuskReach` short of the face, and the charge strikes
 * only as far as the outcrop's middle (its near half is under the tusks;
 * nobody behind it is touched). The nearest such outcrop wins; ties to the
 * lower id. With none, the lane is today's: the centre runs its whole length
 * and the charge strikes a body radius further.
 */
export function planTrampleLane(
  x: number,
  z: number,
  yaw: number,
  outcrops: readonly OutcropSpot[],
  out?: TuskerLane,
): TuskerLane {
  const run = trampleReach(x, z, yaw, T.trampleLength);
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  let hit: OutcropSpot | null = null;
  let face = Number.POSITIVE_INFINITY;
  for (const o of outcrops) {
    const dx = o.x - x;
    const dz = o.z - z;
    const along = dx * ax + dz * az;
    const side = Math.abs(dx * az - dz * ax);
    if (side > T.trampleHalfWidth + T.outcropRadius) continue;
    const f = along - T.outcropRadius;
    // Its face must be ahead of the tusks by a run-up, and on this lane's
    // road (never across a crevasse the lane itself stops short of).
    if (f < T.tuskReach + T.baitMinRun || f > run) continue;
    if (f < face - 1e-9 || (Math.abs(f - face) <= 1e-9 && hit !== null && o.id < hit.id)) {
      hit = o;
      face = f;
    }
  }
  // `out` (a painter's reused lane) is filled in place: no allocation.
  const lane = out ?? { x, z, yaw, length: 0, reach: 0, outcropId: null };
  lane.x = x;
  lane.z = z;
  lane.yaw = yaw;
  if (hit) {
    lane.length = face - T.tuskReach;
    lane.reach = face + T.outcropRadius;
    lane.outcropId = hit.id;
  } else {
    lane.length = run;
    lane.reach = run + TUSKER_BODY;
    lane.outcropId = null;
  }
  return lane;
}

/** Is (px, pz) inside the strip a soulfire trail burns: `length` yards from
 *  (x, z) along `yaw`, `trailHalfWidth` either side? Any one frame of
 *  reference (the trail's and the point's must match). */
export function inTrail(
  x: number,
  z: number,
  yaw: number,
  length: number,
  px: number,
  pz: number,
): boolean {
  const dx = px - x;
  const dz = pz - z;
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  const along = dx * ax + dz * az;
  if (along < 0 || along > length) return false;
  return Math.abs(dx * az - dz * ax) <= T.trailHalfWidth;
}

/** Is an instance-local spot on the Sledge Road's own floor (the two legs and
 *  their bends, between the court's foot and the lower bend)? The heights are
 *  the road's: 47.5 at the court down to 42 at the lower bend. */
export function onSledgeRoad(x: number, z: number): boolean {
  if (z < -176 || z > -96 || x < -52 || x > 42) return false;
  const h = authoredFieldHeight(GRAVEWYRM_SANCTUM_FIELD, x, z);
  return h >= 41.5 && h <= 48;
}
