// Vertical display smoothing for grounded bodies: the visual half of step-up.
//
// The physics solver climbs a kerb or a field stone by moving the feet to the
// new surface within a single 20 Hz tick. That is correct simulation and wrong
// presentation: the mesh teleports up to a step height in one frame while the
// camera boom, which is deliberately soft vertically, lags behind it. The body
// appears to pop out from under the camera. Every modern character controller
// solves this the same way, by letting the RENDERED height chase the physical
// height over a short window while collision keeps using the real one.
//
// The rule is deliberately narrow, because the cases it must NOT touch are the
// ones players read as responsiveness:
//   - GROUNDED only. A jump, a fall, and the landing itself are exact; damping
//     them would make gravity feel like syrup and hide the landing impact.
//   - LEASHED. The rendered height can never trail the physical one by more
//     than a step, so a body is never seen sunk into a surface.
//   - SNAPS on a teleport, so a graveyard release or a delve entry does not
//     glide the avatar across the discontinuity.
//
// Pure math, no Three, no DOM: one state per rendered body, stepped by the
// renderer with the display height it was about to draw.

/** Rendered height chases the physical one at this rate (1/s). About 80 ms to
 *  cover a step: fast enough to never read as lag, slow enough to read as a
 *  stride rather than a pop. */
export const STEP_SMOOTH_RATE = 26;
/** The visual never trails the physical height by more than this (yards). */
export const STEP_SMOOTH_MAX_LAG = 0.95;
/** Beyond this, the move is a teleport and the smoother re-seats (yards). */
export const STEP_SMOOTH_SNAP = 2;
const MAX_STEP_DT = 0.1;

export interface StepSmoothState {
  /** Current rendered height offset from the physical one (<= 0 while catching up). */
  offset: number;
  lastY: number;
  wasGrounded: boolean;
  active: boolean;
}

export function createStepSmooth(): StepSmoothState {
  return { offset: 0, lastY: 0, wasGrounded: true, active: false };
}

/**
 * Given the physical display height the renderer was about to draw, return the
 * height it should actually draw.
 *
 * Which discontinuities get absorbed is the whole design:
 *   - GROUNDED to grounded: absorb. This is a step up or down, or terrain.
 *   - AIRBORNE to grounded with the surface ABOVE the feet: absorb. Gravity
 *     only ever pulls a body DOWN, so an upward jolt on the landing frame is
 *     never a fall, it is the mantle catching a ledge. Left raw it reads as
 *     the body teleporting onto the rock, which is precisely the jank a jump
 *     onto a boulder used to show.
 *   - AIRBORNE to grounded with the surface BELOW: pass through exactly. That
 *     is a real landing and its impact is the point.
 *   - Still airborne: pass through exactly, so a jump's rise and a fall's
 *     acceleration are never damped.
 */
export function stepSmoothHeight(
  s: StepSmoothState,
  y: number,
  grounded: boolean,
  dt: number,
): number {
  if (!s.active) {
    s.active = true;
    s.lastY = y;
    s.wasGrounded = grounded;
    s.offset = 0;
    return y;
  }
  const step = Math.min(Math.max(dt, 0), MAX_STEP_DT);
  const dy = y - s.lastY;
  s.lastY = y;
  const wasGrounded = s.wasGrounded;
  s.wasGrounded = grounded;
  // The frame a flight ends. Which way the surface moved the feet decides
  // everything: UP is a mantle catch (absorb it), DOWN is a real landing
  // (draw it exactly, the impact is the point).
  const touchedDown = grounded && !wasGrounded;
  const caughtLedge = touchedDown && dy > 0;
  const teleported = Math.abs(dy) > STEP_SMOOTH_SNAP;
  const drawExactly = teleported || (!caughtLedge && (!grounded || touchedDown));

  if (drawExactly) {
    // Airborne, or a teleport: show the truth immediately. Drain fast rather
    // than jumping the offset to zero, so a body that steps up and then walks
    // straight off the ledge does not gain a second, upward pop.
    s.offset *= Math.exp(-STEP_SMOOTH_RATE * 2 * step);
    if (Math.abs(s.offset) < 1e-4) s.offset = 0;
    return y + s.offset;
  }

  // A surface change (a step, a mantle catch, or terrain). Absorb it into the
  // offset, then let the offset decay: the body rises onto the kerb or the
  // ledge over the window instead of inside one frame.
  s.offset -= dy;
  if (s.offset > STEP_SMOOTH_MAX_LAG) s.offset = STEP_SMOOTH_MAX_LAG;
  else if (s.offset < -STEP_SMOOTH_MAX_LAG) s.offset = -STEP_SMOOTH_MAX_LAG;
  s.offset *= Math.exp(-STEP_SMOOTH_RATE * step);
  if (Math.abs(s.offset) < 1e-4) s.offset = 0;
  return y + s.offset;
}

/** Forget the current body (view recycled, entity swapped, world reloaded). */
export function resetStepSmooth(s: StepSmoothState): void {
  s.active = false;
  s.offset = 0;
}
