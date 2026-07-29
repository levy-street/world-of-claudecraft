// Terrain-aligned body tilt: the single cheapest cue that a character is
// standing ON the world rather than sliding over a texture of it.
//
// A body that stays bolt upright on a hillside is the classic tell of a game
// character; every shipped action game leans the body toward the surface
// normal instead. This core turns the terrain gradient under the feet into a
// damped pitch and roll in the BODY's local frame, so the lean is relative to
// the direction the character faces (walk across a slope and the body banks
// sideways; turn uphill and the same slope becomes a backward lean).
//
// Three deliberate limits, all of them about not overselling it:
//   - PARTIAL alignment. Fully matching a 56 degree walkable face would lay a
//     character flat; blending a fraction of it reads as weight without the
//     ragdoll look.
//   - CLAMPED, so no surface can produce a silly pose.
//   - DAMPED, so cresting a ridge or stepping onto a crate is a roll of the
//     body rather than a snap.
//
// Pure math, no Three, no DOM. The renderer samples the heights (it already
// holds the seed and the sampler) and calls this with the gradient.

/**
 * Fraction of the true surface angle the body actually takes.
 *
 * Tuned DOWN from a first pass that took over half the angle and capped at 17
 * degrees: on ordinary walkable ground that produced a 14 degree lean, which
 * reads as a character fighting a gale rather than one standing on a hill. The
 * cue works best when it is almost subliminal, so this takes under a third of
 * the angle and caps below 9 degrees. On a typical hillside that is 4 to 7
 * degrees: you feel the ground, you do not watch the pose.
 */
export const GROUND_TILT_BLEND = 0.3;
/** Hard cap on either axis (radians, about 8.6 degrees). */
export const GROUND_TILT_MAX = 0.15;
/** Damping rate toward the target lean (1/s). */
export const GROUND_TILT_RATE = 9;
const MAX_STEP_DT = 0.1;

export interface GroundTiltState {
  /** Local pitch (radians): positive tips the head forward, down the slope. */
  pitch: number;
  /** Local roll (radians): positive raises the body's right side. */
  roll: number;
  active: boolean;
}

export function createGroundTilt(): GroundTiltState {
  return { pitch: 0, roll: 0, active: false };
}

const clampTilt = (v: number): number => Math.min(GROUND_TILT_MAX, Math.max(-GROUND_TILT_MAX, v));

/**
 * Advance the lean. `gradX`/`gradZ` are the terrain height gradient at the
 * feet (dy per yard along world x and z); `facing` is the body's heading, in
 * the sim's convention where forward is (sin f, cos f) and screen-right is
 * (-cos f, sin f). `grounded` false (airborne, swimming, standing on a flat
 * prop top) eases the body back upright rather than freezing a stale lean.
 */
export function stepGroundTilt(
  s: GroundTiltState,
  gradX: number,
  gradZ: number,
  facing: number,
  grounded: boolean,
  dt: number,
): void {
  const sin = Math.sin(facing);
  const cos = Math.cos(facing);
  // Slope along the body's own axes.
  const forwardSlope = grounded ? gradX * sin + gradZ * cos : 0;
  const rightSlope = grounded ? gradX * -cos + gradZ * sin : 0;
  // Uphill ahead means the head tips BACK, hence the negative pitch: a
  // rotation about +X carries the model's forward axis downward.
  const targetPitch = clampTilt(-Math.atan(forwardSlope) * GROUND_TILT_BLEND);
  // Ground rising to the right lifts that side, which is a positive roll.
  const targetRoll = clampTilt(Math.atan(rightSlope) * GROUND_TILT_BLEND);
  if (!s.active) {
    s.active = true;
    s.pitch = targetPitch;
    s.roll = targetRoll;
    return;
  }
  const k = 1 - Math.exp(-GROUND_TILT_RATE * Math.min(Math.max(dt, 0), MAX_STEP_DT));
  s.pitch += (targetPitch - s.pitch) * k;
  s.roll += (targetRoll - s.roll) * k;
}

export function resetGroundTilt(s: GroundTiltState): void {
  s.active = false;
  s.pitch = 0;
  s.roll = 0;
}
