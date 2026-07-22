// Target-acquisition presentation: the selection flourish and the camera's
// micro focus lean. Pure math, no Three/DOM; renderer.ts owns one state,
// steps it in updateCamera, and reads the pulse in the selection-ring pass.
//
//  - Flourish: acquiring a target starts a short pulse the ring pass renders
//    as a bloom-in (the ring lands from slightly oversized), a brightness
//    flash, and a reticle-lock whip on the tick spin that settles into the
//    normal slow rotation. Re-targeting re-pulses (tactile on tab cycling);
//    the same target never re-pulses on its own.
//  - Focus lean: while a target is held, the camera look pivot leans a few
//    tenths of a yard toward it, weighted by how far OFF screen center the
//    target sits (a centered target gets none), eased both ways. At chase
//    distance the full lean reads as roughly a degree of framing bias: felt,
//    not seen. Deselecting (or reduced motion) eases it home.

export interface TargetFocusState {
  lastTargetId: number | null;
  /** Seconds since the current target was acquired (capped at settle). */
  pulseT: number;
  focusX: number;
  focusZ: number;
}

/** Acquire-pulse length (seconds). */
export const TARGET_PULSE_DURATION = 0.22;
/** Ring lands from this much oversized at the instant of acquisition. */
export const TARGET_PULSE_SCALE = 0.45;
/** Extra reticle tick spin at the instant of acquisition (rad/s). */
export const TARGET_PULSE_SPIN = 9;
/** Max look-pivot lean toward the target (yards). */
export const FOCUS_LEAN_MAX = 0.28;
/** Lean ease rate, both in and out (1/s). */
export const FOCUS_LEAN_OMEGA = 5;
// Off-center falloff: lean weight is (1 - cos angle) * this, clamped to 1, so
// a dead-centered target gets nothing and a flanking one gets most of the cap.
const FOCUS_CENTER_FALLOFF = 0.9;
const MAX_STEP = 0.25;

export function createTargetFocus(): TargetFocusState {
  return { lastTargetId: null, pulseT: TARGET_PULSE_DURATION, focusX: 0, focusZ: 0 };
}

/**
 * Advance one frame. (toX, toZ) is the horizontal offset from the avatar to
 * the target (ignored when targetId is null); camYaw is the player camera yaw
 * (forward = (sin yaw, cos yaw)). `enabled` false (reduced motion) suppresses
 * the pulse and eases the lean home.
 */
export function stepTargetFocus(
  s: TargetFocusState,
  targetId: number | null,
  toX: number,
  toZ: number,
  camYaw: number,
  dt: number,
  enabled: boolean,
): void {
  const step = Math.min(Math.max(dt, 0), MAX_STEP);
  if (targetId !== s.lastTargetId) {
    s.lastTargetId = targetId;
    s.pulseT = targetId !== null && enabled ? 0 : TARGET_PULSE_DURATION;
  }
  // The pulse clock advances at most a 30 fps step per frame, so a hitch (or
  // a degraded frame rate) right at acquisition can never swallow the whole
  // flourish in one frame; it always renders for a handful of frames.
  s.pulseT = Math.min(TARGET_PULSE_DURATION, s.pulseT + Math.min(step, 1 / 30));

  let leanX = 0;
  let leanZ = 0;
  if (enabled && targetId !== null) {
    const d = Math.hypot(toX, toZ);
    if (d > 1e-3) {
      const ux = toX / d;
      const uz = toZ / d;
      const cosA = ux * Math.sin(camYaw) + uz * Math.cos(camYaw);
      const weight = Math.min(1, Math.max(0, (1 - cosA) * FOCUS_CENTER_FALLOFF));
      const lean = FOCUS_LEAN_MAX * weight;
      leanX = ux * lean;
      leanZ = uz * lean;
    }
  }
  const e = Math.exp(-FOCUS_LEAN_OMEGA * step);
  s.focusX = leanX + (s.focusX - leanX) * e;
  s.focusZ = leanZ + (s.focusZ - leanZ) * e;
}

/**
 * The acquire flourish this frame: `scale` multiplies the ring (blooms in
 * from oversized), `glow` (1..0) drives the brightness flash, `spin` is the
 * extra tick rotation rate. All settle to (1, 0, 0) within the pulse.
 */
export function selectionPulse(s: TargetFocusState): {
  scale: number;
  glow: number;
  spin: number;
} {
  const p = Math.min(1, s.pulseT / TARGET_PULSE_DURATION);
  const out = (1 - p) * (1 - p); // ease-out toward settled
  return {
    scale: 1 + TARGET_PULSE_SCALE * out,
    glow: out,
    spin: TARGET_PULSE_SPIN * out,
  };
}
