// Where a camera ray first meets the floor, for a ground ping (src/ui/hud/pings/).
// The click-to-move pick (world_picking.ts groundPoint) meets a FLAT plane at
// the player's feet, cheap and fine a few yards out, but at ping distance on a
// slope the plane hit is nowhere near the terrain under the cursor: short of it
// where the land drops away, past it (behind a hill) where the land rises. This
// marches the ray against the real floor instead: coarse steps until the ray
// first goes under the floor, then a bisection between the last point above and
// the first point below. The first crossing wins, so a hill in front hides the
// valley behind it, the way the eye sees it.
//
// Pure: the floor is a callback (the sim's own floor query in production, a
// test heightfield in the tests). Three-, DOM- and i18n-free.

export interface RayPoint {
  x: number;
  y: number;
  z: number;
}

/** The floor height at (x, z) as seen from height `y` (a storey picker: the
 *  production callback returns the highest standable surface at or under it). */
export type FloorAt = (x: number, z: number, y: number) => number;

/** The coarse march step along the ray (yards). */
export const PING_RAY_STEP = 0.75;
/** How far over the ray's own height a surface still counts as the floor the
 *  ray is about to meet (yards). The production floor query only sees tops at
 *  or under its reference height, so a ray probing at exactly its own height
 *  would slip under a roof the instant it dips below the top; looking a step
 *  and a half up catches it on the way down. */
export const PING_RAY_FLOOR_REACH = 1.2;
/** Bisection rounds after the coarse crossing (0.75 / 2^12 is far under a hand). */
const BISECT_ROUNDS = 12;

/**
 * The first point along the ray `origin + t * dir` (dir need not be unit
 * length; it is normalized here) at which the ray reaches the floor, searched
 * up to `maxDist` yards along the ray. Null when it meets nothing that far
 * (a sky or horizon pick) or the direction is degenerate.
 */
export function marchRayToFloor(
  origin: RayPoint,
  dir: RayPoint,
  floorAt: FloorAt,
  maxDist: number,
  step = PING_RAY_STEP,
): RayPoint | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (!(len > 1e-9) || !(maxDist > 0) || !(step > 0)) return null;
  const dx = dir.x / len;
  const dy = dir.y / len;
  const dz = dir.z / len;
  const above = (t: number): boolean => {
    const y = origin.y + dy * t;
    return y > floorAt(origin.x + dx * t, origin.z + dz * t, y + PING_RAY_FLOOR_REACH);
  };
  // The camera already under the floor (a clamp miss): the floor is right here.
  if (!above(0))
    return {
      x: origin.x,
      y: floorAt(origin.x, origin.z, origin.y + PING_RAY_FLOOR_REACH),
      z: origin.z,
    };
  let lo = 0;
  let hi = -1;
  for (let t = step; ; t += step) {
    const at = Math.min(t, maxDist);
    if (!above(at)) {
      hi = at;
      break;
    }
    lo = at;
    if (at >= maxDist) return null;
  }
  for (let i = 0; i < BISECT_ROUNDS; i++) {
    const mid = (lo + hi) / 2;
    if (above(mid)) lo = mid;
    else hi = mid;
  }
  const x = origin.x + dx * hi;
  const z = origin.z + dz * hi;
  return { x, y: floorAt(x, z, origin.y + dy * hi + PING_RAY_FLOOR_REACH), z };
}
