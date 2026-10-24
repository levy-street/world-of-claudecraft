// The terrain-wall standoff: ease a body's WIDTH off ground steeper than the
// climb limit (moved out of world.ts whole, then made body-aware).
//
// Given the body's feet, every height it samples is the BODY-AWARE floor
// (world.ts `groundHeightAtBody`), which skips a walkable deck or plane more
// than WALK_DECK_REACH over the feet, exactly like the movement kernel's own
// ground reads. A storey overhead is a ceiling, not a wall: sampled
// height-blind, a castle deck 3.6 yd over the floor of the room beneath it
// read as a sheer face at the deck's edge, so the standoff shoved every body
// back from the doorway under that edge. Without feet the read stays
// height-blind (the terrain-only callers and tests are unchanged).
import { groundHeight, groundHeightAtBody } from './world';

// Ring samples for the wall standoff below. 8 covers the body circle evenly
// without being a hot-loop cost (the caller only runs it for grounded overworld
// players).
const WALL_STANDOFF_SAMPLES = 8;

function floorAt(x: number, z: number, seed: number, feetY: number | undefined): number {
  return feetY === undefined ? groundHeight(x, z, seed) : groundHeightAtBody(x, z, seed, feetY);
}

// A single ring-sample-and-nudge pass, capped at one body radius of push (see
// `terrainWallStandoff` below for why it must be iterated rather than trusted
// to converge in one call, and why the caller must accept a push that only
// REDUCES steepness rather than requiring it clear `maxSlope` outright).
export function terrainWallStandoffPass(
  x: number,
  z: number,
  seed: number,
  radius: number,
  maxSlope: number,
  feetY?: number,
): { x: number; z: number } {
  const h0 = floorAt(x, z, seed, feetY);
  const wallRise = radius * maxSlope; // the most a climbable slope rises over `radius`
  let pushX = 0;
  let pushZ = 0;
  for (let k = 0; k < WALL_STANDOFF_SAMPLES; k++) {
    const a = (k / WALL_STANDOFF_SAMPLES) * Math.PI * 2;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    const rise = floorAt(x + sx * radius, z + sz * radius, seed, feetY) - h0;
    if (rise > wallRise) {
      // horizontal setback that would make this direction merely climbable,
      // capped at the body radius (a face closer than `radius` reads as a huge
      // rise; one exactly at `radius` contributes nothing)
      const setback = Math.min((rise - wallRise) / maxSlope, radius);
      pushX -= sx * setback;
      pushZ -= sz * setback;
    }
  }
  if (pushX === 0 && pushZ === 0) return { x, z };
  const mag = Math.hypot(pushX, pushZ);
  const scale = Math.min(mag, radius) / mag; // total nudge never exceeds one body radius
  return { x: x + pushX * scale, z: z + pushZ * scale };
}

// The most passes `terrainWallStandoff` will take to converge. Mirrors the
// 3-iteration prop/OBB push-out loop in `colliders.ts`'s `resolveAgainst`.
const WALL_STANDOFF_ITERATIONS = 3;

// Push a body of `radius` out of terrain steeper than `maxSlope` so the
// character model does not sink into a cliff face. Movement collision samples
// only the center point (the climb gate blocks the center from CLIMBING a wall,
// but nothing keeps the body's WIDTH clear of one), so standing at or strafing
// along the foot of a near-vertical wall buries the model's near side. This
// samples the heightfield on a ring at the body radius; any direction rising
// faster than a climbable slope is a wall within reach, and the center is nudged
// directly away from it, toward the lower walkable side. Pure and deterministic;
// returns the input unchanged on open or merely-sloped ground (no ring sample
// exceeds a climbable rise there), so it is a near-no-op away from the walls.
//
// A single pass can leave the pushed point still reading as a wall in a
// CONCAVE pocket (a ridge/rim corner or a coastline notch wrapping more than
// half the sample ring): one pass's push, capped at one body radius, is not
// always enough to clear it. The caller (`stepPlayerMotion`) only ever
// committed the result when it stopped reading as steep, so an unconverged
// single pass silently no-ops right where standoff is needed most, leaving
// the player permanently wedged. Iterating a few passes lets each subsequent
// ring sample, now centered on the partially-pushed point, see less of the
// wall, converging out of the pocket instead of stalling on it.
export function terrainWallStandoff(
  x: number,
  z: number,
  seed: number,
  radius: number,
  maxSlope: number,
  feetY?: number,
): { x: number; z: number } {
  let cx = x;
  let cz = z;
  for (let iter = 0; iter < WALL_STANDOFF_ITERATIONS; iter++) {
    const next = terrainWallStandoffPass(cx, cz, seed, radius, maxSlope, feetY);
    if (next.x === cx && next.z === cz) break;
    cx = next.x;
    cz = next.z;
  }
  return { x: cx, z: cz };
}
