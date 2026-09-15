// Per-entity cadence for the foot-height ground reference the renderer's
// entity loop reads for remote players (the airborne heuristic: online
// snapshots carry no onGround, so a player's jump pose is derived from feet
// height against the standing surface). Sampling the procedural terrain for
// every remote body on every frame cost 5 percent of the main thread with 51
// bodies on the iGPU campaign's profiles; a standing body's surface does not
// change, so the sample is cached per body and refreshed only when the core
// below says so. Pure: no three, no DOM, no world access.

/** The cached standing surface under one body and where it was taken. */
export interface EntityGroundSample {
  /** False until the first sample: a body that just appeared always samples. */
  valid: boolean;
  x: number;
  y: number;
  z: number;
  /** The cached reading taken at (x, y, z): for the airborne heuristic the
   *  standing surface (terrain, plus the rift lift and any standable prop top
   *  under the feet), for the terrain-lean stencil the mean of its four
   *  terrain points. */
  standY: number;
  /** Seconds since the sample was taken. */
  ageS: number;
}

/** Per-axis displacement that invalidates the sample, in yards. The stale
 *  reading is off by at most the horizontal travel times the slope: with the
 *  threshold on each axis a diagonal mover can be 0.15 * sqrt(2) = 0.21 yd
 *  stale, and the steepest walkable ground (PLAYER_MAX_CLIMB_SLOPE, 1.5 in
 *  src/sim/pathfind.ts) turns that into 0.32 yd of height, under the 0.4 yd
 *  airborne epsilon the heuristic applies (AIRBORNE_EPS in renderer.ts), so a
 *  running body never reads airborne from staleness. A standing body never
 *  moves this far and so never resamples on displacement. */
export const ENTITY_GROUND_RESAMPLE_YD = 0.15;

/** Age that invalidates the sample regardless of displacement, so a standing
 *  body still follows a standable prop appearing or leaving under its feet. */
export const ENTITY_GROUND_RESAMPLE_S = 0.5;

export function createEntityGroundSample(): EntityGroundSample {
  return { valid: false, x: 0, y: 0, z: 0, standY: Number.NEGATIVE_INFINITY, ageS: 0 };
}

/** Advances the sample's age by `dt` and says whether the body at (x, y, z)
 *  needs a fresh standing surface: it never had one, it moved by more than
 *  ENTITY_GROUND_RESAMPLE_YD on any axis, or the sample is older than
 *  ENTITY_GROUND_RESAMPLE_S. */
export function entityGroundSampleDue(
  sample: EntityGroundSample,
  x: number,
  y: number,
  z: number,
  dt: number,
): boolean {
  if (!sample.valid) return true;
  sample.ageS += Math.max(0, dt);
  if (sample.ageS >= ENTITY_GROUND_RESAMPLE_S) return true;
  return (
    Math.abs(x - sample.x) > ENTITY_GROUND_RESAMPLE_YD ||
    Math.abs(z - sample.z) > ENTITY_GROUND_RESAMPLE_YD ||
    Math.abs(y - sample.y) > ENTITY_GROUND_RESAMPLE_YD
  );
}

export function commitEntityGroundSample(
  sample: EntityGroundSample,
  x: number,
  y: number,
  z: number,
  standY: number,
): void {
  sample.valid = true;
  sample.x = x;
  sample.y = y;
  sample.z = z;
  sample.standY = standY;
  sample.ageS = 0;
}
