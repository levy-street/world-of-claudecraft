// Terrain-reactive suspension for a wheeled mount.
//
// A vehicle that stays bolt upright while it drives over a hillside is the same
// tell as a character who does (see ground_tilt_core.ts), but a vehicle can say
// more than a character can: it has four contact points, so the ground can pitch
// it, roll it, and compress individual springs independently.
//
// The split matters, and it is the thing to keep straight:
//   - PITCH and ROLL come from the PLANE through the four contact points. That
//     is the body following the ground, and it is most of the effect. Cresting a
//     rise pitches the nose down; traversing a slope rolls the body.
//   - PER-CORNER TRAVEL is what is LEFT OVER once that plane is removed: how far
//     each wheel sits above or below the plane its three siblings define. On
//     smooth ground it is zero. It only speaks when the terrain is uneven under
//     the car, which is exactly when a spring should.
//
// Both are damped, because terrain sampling is discrete and a raw read snaps.
// Both are clamped, because no piece of ground should be able to stand the car
// on its nose.
//
// Airborne, everything eases back to neutral and the wheels hang at droop,
// which is what a car does when it leaves the ground.
//
// Pure math, no Three, no DOM: the renderer owns the terrain sampler and the
// scene graph and calls this with four heights.

/** Fraction of the true ground angle the body actually takes. Under 1 on
 *  purpose: fully matching the surface reads as a toy glued to the terrain,
 *  and a real vehicle's springs absorb part of every slope. */
export const SUSPENSION_TILT_BLEND = 0.7;
/** Damping rate toward the target attitude (1/s). Faster than a character's
 *  lean: a car on springs settles quickly, it does not wallow. */
export const SUSPENSION_TILT_RATE = 11;
/** Damping rate for the individual springs (1/s), quicker still: a wheel over a
 *  rock reacts on the spot and the body catches up after. */
export const SUSPENSION_TRAVEL_RATE = 16;
/** Longest frame this integrates in one go, so an alt-tab does not teleport
 *  the attitude. */
const MAX_STEP_DT = 0.1;

/** Landing squat: a second-order spring that OWNS the whole touchdown, from
 *  the wheel hanging in the air to the gap under the arch closing and opening
 *  back out.
 *
 *  It has to own all of it. The first version left the airborne droop to the
 *  ordinary terrain damper and added a separate squat on top, and the two
 *  cancelled: at the moment the squat peaked the wheel was still most of the
 *  way down through its droop recovery, so the net travel never rose past a
 *  quarter of the arch gap and the landing did not read at all. Handing the
 *  spring the wheel's actual starting position is what turns it into one
 *  motion, hang to compressed to rest.
 *
 *  Radians per second. */
const LANDING_FREQ = 20;

/** Damping ratio. UNDER one, and this is the setting that decides whether any
 *  of this reads. The wheel starts a landing hanging a full droop below
 *  neutral, and on this model droop is over one and a half times the arch gap
 *  it then has to compress into. Damp it near one and the wheel merely creeps
 *  back up to neutral, which is what the first version did and why nothing was
 *  visible. Under-damping is what carries it THROUGH neutral and closes the
 *  gap. */
const LANDING_DAMPING = 0.4;

/** Upward kick per unit of impact, in bump travels per second. With the swing
 *  up off droop it puts the hardest landing at roughly four fifths of the arch
 *  gap about 100ms after contact, with a shallow rebound after and rest by
 *  about half a second. The bump clamp in `settle` is the bump stop, so a
 *  harder landing than the scale allows simply pins there rather than pushing
 *  the tire into the arch. */
const LANDING_KICK = 2;

export type SuspensionCorner = 'fl' | 'fr' | 'rl' | 'rr';

export interface SuspensionState {
  /** Body pitch, radians. Positive lifts the nose. */
  pitch: number;
  /** Body roll, radians. Positive lifts the vehicle's right side. */
  roll: number;
  /** Per-corner spring travel. Positive means the wheel rides UP into the arch
   *  (compression), negative means it hangs (droop). This is the OUTPUT: the
   *  terrain response plus the landing squat, clamped to what the corner has
   *  room for. Read this; the two parts below are working state. */
  travel: Record<SuspensionCorner, number>;
  /** The terrain half on its own, before the landing squat is added. Separate
   *  so the squat cannot feed back into the damping that produces it. */
  terrain: Record<SuspensionCorner, number>;
  /** Landing squat per corner, in the same units as travel, with its velocity.
   *  Per corner rather than shared because each corner starts a landing from
   *  wherever its own wheel was hanging and has its own room to compress. */
  squat: Record<SuspensionCorner, number>;
  squatVel: Record<SuspensionCorner, number>;
}

export interface SuspensionLimits {
  /** Most a spring may compress before the tire meets the arch above it. */
  bump: number;
  /** Most a spring may extend before the hub drops below the underbody. */
  droop: number;
}

/**
 * Everything the vehicle's own geometry says it is allowed to do.
 *
 * These are MEASUREMENTS, not taste: each one is a real part of the car meeting
 * either another part of the car or the ground. The caller measures them off
 * the mesh (see vehicle_suspension_fx), which is why they are per-corner and
 * why pitch is asymmetric: a car's approach and departure angles differ because
 * its front and rear overhangs do.
 */
export interface SuspensionEnvelope {
  corner: Record<SuspensionCorner, SuspensionLimits>;
  /** Max nose-UP radians: the tail swings down, so this is the departure angle,
   *  the rear overhang against the ground. */
  pitchUp: number;
  /** Max nose-DOWN radians: the approach angle, the front bumper against the
   *  ground. */
  pitchDown: number;
  /** Max roll radians before the underbody sill touches on the low side. */
  roll: number;
}

export function createSuspension(): SuspensionState {
  return {
    pitch: 0,
    roll: 0,
    travel: { fl: 0, fr: 0, rl: 0, rr: 0 },
    terrain: { fl: 0, fr: 0, rl: 0, rr: 0 },
    squat: { fl: 0, fr: 0, rl: 0, rr: 0 },
    squatVel: { fl: 0, fr: 0, rl: 0, rr: 0 },
  };
}

/**
 * Take a landing: hand each wheel to the spring so it compresses and rebounds.
 *
 * `impact` is 0 for a touchdown too gentle to feel and 1 for the hardest drop
 * worth answering; the caller scales the real fall speed into that range, which
 * keeps this side of the module free of world units entirely. Call once on the
 * airborne-to-grounded edge, not every frame.
 *
 * Two things happen, and the first matters more than the second. The wheel's
 * current offset, which after a flight is most of a droop below neutral, is
 * MOVED out of the terrain damper and into the spring, leaving travel exactly
 * where it was so nothing pops. From there one spring carries the wheel up
 * through neutral and into the arch rather than two systems each doing part of
 * it and cancelling. Only then does the impact add its kick, as a velocity:
 * setting the compression directly would snap the body down on the touchdown
 * frame, while shoving the spring and letting it find its own peak is what
 * reads as mass arriving.
 */
export function landSuspension(s: SuspensionState, impact: number, env: SuspensionEnvelope): void {
  const hit = clamp(impact, 0, 1);
  // Below the caller's soft-landing threshold, leave the ordinary damper to
  // ease the wheels back up. Stepping off a kerb should not rock the car, and
  // this is the same line the renderer already draws between a landing thud
  // and a footfall.
  if (hit <= 0) return;
  for (const c of ['fl', 'fr', 'rl', 'rr'] as const) {
    s.squat[c] += s.terrain[c];
    s.terrain[c] = 0;
    // Added, not assigned, so a second landing during the recovery of the first
    // compounds instead of cutting it off.
    s.squatVel[c] += hit * LANDING_KICK * env.corner[c].bump * LANDING_FREQ;
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Exponential approach, frame-rate independent. */
const damp = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

/**
 * Advance the suspension.
 *
 * `heights` are the terrain heights under the four wheels RELATIVE to the
 * vehicle's own ground reference, in world units, already sampled in the
 * vehicle's frame (front/rear and left/right as the vehicle sees them).
 * `wheelbase` and `track` are the distances between the contact points.
 * `grounded` false eases the body upright and hangs the wheels at droop.
 *
 * Heights, wheelbase, track and the envelope must all be in the SAME units.
 * The caller works in the model's own space rather than world space, so the
 * travel this produces can be written straight onto a mount node without a
 * conversion step (getting that wrong scales every spring by the mount's
 * normalization factor, which launches the wheels through the bodywork).
 */
export function stepSuspension(
  s: SuspensionState,
  heights: Record<SuspensionCorner, number>,
  wheelbase: number,
  track: number,
  env: SuspensionEnvelope,
  grounded: boolean,
  dt: number,
): void {
  const step = Math.min(Math.max(dt, 0), MAX_STEP_DT);
  if (step <= 0) return;

  // Landing squat, advanced every frame so a takeoff mid-recovery still eases
  // out instead of freezing the body mid-compression.
  advanceSquat(s, step);

  if (!grounded) {
    s.pitch = damp(s.pitch, 0, SUSPENSION_TILT_RATE, step);
    s.roll = damp(s.roll, 0, SUSPENSION_TILT_RATE, step);
    for (const c of ['fl', 'fr', 'rl', 'rr'] as const) {
      s.terrain[c] = damp(s.terrain[c], -env.corner[c].droop, SUSPENSION_TRAVEL_RATE, step);
      s.travel[c] = settle(s, c, env);
    }
    return;
  }

  const front = (heights.fl + heights.fr) / 2;
  const rear = (heights.rl + heights.rr) / 2;
  const right = (heights.fr + heights.rr) / 2;
  const left = (heights.fl + heights.rl) / 2;

  // Ground higher at the front lifts the nose; higher on the right lifts the
  // right side. Guard the divisors so a degenerate wheelbase cannot blow up.
  const pitchTarget = clamp(
    Math.atan2(front - rear, Math.max(wheelbase, 1e-3)) * SUSPENSION_TILT_BLEND,
    -env.pitchDown,
    env.pitchUp,
  );
  const rollTarget = clamp(
    Math.atan2(right - left, Math.max(track, 1e-3)) * SUSPENSION_TILT_BLEND,
    -env.roll,
    env.roll,
  );
  s.pitch = damp(s.pitch, pitchTarget, SUSPENSION_TILT_RATE, step);
  s.roll = damp(s.roll, rollTarget, SUSPENSION_TILT_RATE, step);

  // What the plane does NOT explain is the spring's job. Because the body only
  // takes SUSPENSION_TILT_BLEND of the slope, the residual keeps the part of
  // the slope the body declined to follow, which is what a real spring absorbs.
  const mean = (heights.fl + heights.fr + heights.rl + heights.rr) / 4;
  const planeAt: Record<SuspensionCorner, number> = {
    fl: mean + (front - mean) * SUSPENSION_TILT_BLEND + (left - mean) * SUSPENSION_TILT_BLEND,
    fr: mean + (front - mean) * SUSPENSION_TILT_BLEND + (right - mean) * SUSPENSION_TILT_BLEND,
    rl: mean + (rear - mean) * SUSPENSION_TILT_BLEND + (left - mean) * SUSPENSION_TILT_BLEND,
    rr: mean + (rear - mean) * SUSPENSION_TILT_BLEND + (right - mean) * SUSPENSION_TILT_BLEND,
  };
  for (const c of ['fl', 'fr', 'rl', 'rr'] as const) {
    const residual = heights[c] - planeAt[c];
    const target = clamp(residual, -env.corner[c].droop, env.corner[c].bump);
    s.terrain[c] = damp(s.terrain[c], target, SUSPENSION_TRAVEL_RATE, step);
    s.travel[c] = settle(s, c, env);
  }
}

/**
 * Advance the landing spring by `dt`, EXACTLY.
 *
 * The closed form rather than stepping the acceleration, for the same reason
 * `damp` above is an exponential rather than a lerp: the result must not depend
 * on the frame rate. Stepping this one explicitly is worse than inaccurate, it
 * is quietly wrong in a direction nobody would look at. The damping term is
 * large at these rates, so each step bleeds off amplitude, the landing arrives
 * at roughly half the compression it was asked for, and the shortfall grows as
 * the frame rate drops: the same jump would read weaker on a slower machine.
 *
 * For x'' = -w^2 x - 2*zeta*w x', damped frequency wd = w*sqrt(1 - zeta^2):
 *   x(t) = e^(-zeta*w*t) [ x cos(wd t) + ((v + zeta*w*x)/wd) sin(wd t) ]
 *   v(t) = e^(-zeta*w*t) [ v cos(wd t) - ((zeta*w*v + w^2 x)/wd) sin(wd t) ]
 */
function advanceSquat(s: SuspensionState, dt: number): void {
  const w = LANDING_FREQ;
  const sigma = LANDING_DAMPING * w;
  const wd = w * Math.sqrt(1 - LANDING_DAMPING * LANDING_DAMPING);
  const decay = Math.exp(-sigma * dt);
  const cos = Math.cos(wd * dt);
  const sin = Math.sin(wd * dt);
  for (const c of ['fl', 'fr', 'rl', 'rr'] as const) {
    const x = s.squat[c];
    const v = s.squatVel[c];
    if (x === 0 && v === 0) continue;
    s.squat[c] = decay * (x * cos + ((v + sigma * x) / wd) * sin);
    s.squatVel[c] = decay * (v * cos - ((sigma * v + w * w * x) / wd) * sin);
  }
}

/** Terrain response plus landing squat, clamped to the room this corner was
 *  measured to have. The clamp is here and nowhere else, so no combination of
 *  a rough surface and a hard landing can put the tire through the arch. */
function settle(s: SuspensionState, c: SuspensionCorner, env: SuspensionEnvelope): number {
  const limits = env.corner[c];
  return clamp(s.terrain[c] + s.squat[c], -limits.droop, limits.bump);
}
