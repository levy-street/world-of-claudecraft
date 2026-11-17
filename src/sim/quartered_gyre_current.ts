// The gale's velocity law, one tick of it: what the wind in a Gyre lane does to the ground velocity
// of a body riding it (quartered_gyre_wind.ts holds the constants and the road's frame, the per-
// player step quartered_gyre_wind_step.ts feeds this and writes the answer back).
//
// Along the road the wind pushes up the climb whatever the keys say (a body at rest is carried off,
// no key held), at a fixed acceleration up to a ceiling that eases away over the last stretch; a
// body above it is braked down, but never below the pace it would run or ride at on its own (a
// mounted rider is not slowed on the last stretch where the push has eased under a horse's
// pace). When the keys ask for the other way the push drops under the body's own grip, so holding
// back walks a body down against the gale instead of pinning it. Across the road the velocity is
// set in the road's frame to the strafe keys' wish plus a pull to the centre line, so the slide
// bends round every turn at any speed and the whole width of the road stays reachable, but a body
// cannot be thrown off it.
//
// Pure and deterministic: no Entity, no SimContext, no rng, no clock.

import {
  GALE_LANE_SPEED,
  GALE_WIND_ACCEL,
  GALE_WIND_BRAKE,
  GALE_WIND_CENTERING,
  GALE_WIND_OPPOSED_SHARE,
} from './quartered_gyre_wind';
import { DT, RUN_SPEED } from './types';

/** The road's frame under the body: unit tangent up the climb, unit normal out over the drop,
 *  and the body's offset outboard of the centre line (quartered_gyre_wind.ts GyreTrackFrame). */
export interface GaleFrame {
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  off: number;
}

/** What the held keys ask for, world yards a second at the run's pace, in the two parts the gale
 *  reads: the forward and back keys (which can oppose the wind) and the strafe keys (which drift the
 *  body across the road). The turn of the camera is the player's own: only the strafe keys steer
 *  across, so a body riding a bend is not shoved into the railing by a key held straight on. */
export interface GaleWish {
  fx: number;
  fz: number;
  sx: number;
  sz: number;
}

/**
 * The new ground velocity of a body riding a lane, after one tick of the wind.
 *
 * (vx, vz): the body's ground velocity after the motion kernel's own slide step this tick. wish:
 *   the held keys (zero when none). strength: the gale's share of its ceiling here (0..1). grip:
 *   the body's own grip, yards a second per second. ownPace: the pace the body would run or ride at
 *   with no gale, yards a second (the gale never brakes it below this). Writes the result into
 *   `out`.
 */
export function galeCurrentStep(
  vx: number,
  vz: number,
  wish: GaleWish,
  frame: GaleFrame,
  strength: number,
  grip: number,
  ownPace: number,
  out: { x: number; z: number },
): void {
  const fwdLen = Math.hypot(wish.fx, wish.fz);
  // 1 when the forward or back key asks straight down the climb, 0 for anything else
  const opposed =
    fwdLen > 1e-9
      ? Math.max(0, Math.min(1, -(wish.fx * frame.tx + wish.fz * frame.tz) / fwdLen))
      : 0;

  const ceiling = GALE_LANE_SPEED * RUN_SPEED * strength;
  // the gale pushes up to its ceiling, and brakes only what runs past both it and the body's own pace
  const floor = Math.max(ceiling, ownPace);
  let along = vx * frame.tx + vz * frame.tz;
  if (along > floor) {
    along = Math.max(floor, along - GALE_WIND_BRAKE * DT);
  } else if (along < ceiling) {
    const accel = GALE_WIND_ACCEL + (GALE_WIND_OPPOSED_SHARE * grip - GALE_WIND_ACCEL) * opposed;
    along = Math.min(ceiling, along + accel * DT);
  }

  // Across the road the velocity is set outright, in the road's own frame: the strafe keys' wish
  // plus the pull to the centre line. The frame is the road's where the body will be half way
  // through its next step, so the turn of the road is already in it and the body follows every bend.
  const steer = Math.max(-RUN_SPEED, Math.min(RUN_SPEED, wish.sx * frame.nx + wish.sz * frame.nz));
  const across = steer - GALE_WIND_CENTERING * frame.off;

  let x = along * frame.tx + across * frame.nx;
  let z = along * frame.tz + across * frame.nz;
  // never faster than the ride's top speed (or the body's own pace, were that ever faster)
  const speed = Math.hypot(x, z);
  const cap = Math.max(GALE_LANE_SPEED * RUN_SPEED, ownPace);
  if (speed > cap) {
    x *= cap / speed;
    z *= cap / speed;
  }
  out.x = x;
  out.z = z;
}

/**
 * The fastest a body wearing the lane's aura may go where no lane is blowing. The aura outlives the
 * lane for a moment (it carries a rider across the gap to the next lane), and with it a held key
 * would build speed the wind never gave: so out of a lane a body is held to the gale's own ceiling
 * at its place on the road (eased down the last stretch), or to the pace it would run or ride at on
 * its own (`ownPace`, yards a second) where that is faster, as it is off the road. `strength` is
 * the gale's share of its ceiling there (read only when `onRoad`).
 */
export function galeCoastLimit(onRoad: boolean, strength: number, ownPace: number): number {
  return onRoad ? Math.max(ownPace, GALE_LANE_SPEED * RUN_SPEED * strength) : ownPace;
}

/** Hold a ground velocity to `limit` (yards a second), keeping its heading. Writes the held
 *  velocity into `out` and returns true when it had to; false (and `out` untouched) when the body
 *  was already within the limit. */
export function galeCoastClamp(
  vx: number,
  vz: number,
  limit: number,
  out: { x: number; z: number },
): boolean {
  const speed = Math.hypot(vx, vz);
  if (speed <= limit || speed < 1e-9) return false;
  out.x = (vx * limit) / speed;
  out.z = (vz * limit) / speed;
  return true;
}
