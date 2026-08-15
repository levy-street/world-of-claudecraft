// Pure per-frame visual plan for the rift boss death-zone telegraph (the red
// danger circle). Three-free and deterministic so the readability contract is
// Node-testable: the ring never fades below RING_MIN_OPACITY (the v0.36.0
// playtest complaint was a hairline ring pulsing to near-invisible), the timer
// sweep grows monotonically from the center to the rim as the fuse elapses,
// and the final URGENT_REMAINING_SEC of the fuse pulses faster and brighter.
// The Three half (geometry, materials) is src/render/rift_death_zone.ts.
//
// Fairness note: the death zone is an actionable cue, so every value here is
// tier-independent; no graphics preset or FPS-governor input may feed a plan.

export interface DeathZonePlan {
  /** Opacity of the rim band (pulses between RING_MIN_OPACITY and RING_MAX_OPACITY). */
  ringOpacity: number;
  /** Opacity of the interior danger wash (steady; the area must always read). */
  fillOpacity: number;
  /** Opacity of the timer sweep disc (brightens in the urgent window). */
  sweepOpacity: number;
  /** 0..1 radial fraction of the zone the timer sweep covers (elapsed / total). */
  sweepFraction: number;
}

export const RING_MAX_OPACITY = 0.95;
/** The pulse floor. The pre-v0.36.0 ring dipped to 0.34 opacity twice a second,
 * which is what made it unreadable; the telegraph must never fall below half. */
export const RING_MIN_OPACITY = 0.6;
export const FILL_OPACITY = 0.3;
export const SWEEP_BASE_OPACITY = 0.35;
export const SWEEP_URGENT_OPACITY = 0.6;
/** At or below this many seconds left on the fuse the telegraph turns urgent. */
export const URGENT_REMAINING_SEC = 1.5;
/** Pulse phase advance in radians per second (calm / final-window urgent). */
export const PULSE_SPEED_CALM = 4.0;
export const PULSE_SPEED_URGENT = 12.0;

/** Phase clock speed for the opacity pulse: the last URGENT_REMAINING_SEC of
 * the fuse strobes visibly faster so "about to detonate" reads at a glance. */
export function deathZonePulseSpeed(remaining: number): number {
  return remaining <= URGENT_REMAINING_SEC ? PULSE_SPEED_URGENT : PULSE_SPEED_CALM;
}

/** Elapsed fraction of the fuse, clamped to 0..1. A degenerate total (zero or
 * negative, which a well-formed zone never carries) reads as fully elapsed so
 * the visual fails toward MORE warning, never less. */
export function deathZoneSweepFraction(remaining: number, total: number): number {
  if (!(total > 0)) return 1;
  const fraction = 1 - remaining / total;
  return fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
}

/** Local-space scale triple for the sweep disc mesh. The disc is a
 * CircleGeometry in its LOCAL x/y plane, laid flat by a rotation.x of -PI/2
 * applied AFTER scale, so the radial axes are local x and y and local z must
 * stay 1. Getting this triple wrong squashes the sweep into an ellipse (the
 * bug this pin exists for); a floor keeps the matrix non-degenerate at 0. */
export function deathZoneSweepScale(fraction: number): [number, number, number] {
  const s = Math.max(fraction, 0.001);
  return [s, s, 1];
}

/** The full per-frame plan for one zone. `phase` is the caller-advanced pulse
 * clock (radians, advanced by deathZonePulseSpeed * dt). */
export function deathZonePlan(phase: number, remaining: number, total: number): DeathZonePlan {
  const wave = 0.5 + 0.5 * Math.sin(phase);
  const urgent = remaining <= URGENT_REMAINING_SEC;
  return {
    ringOpacity: RING_MIN_OPACITY + (RING_MAX_OPACITY - RING_MIN_OPACITY) * wave,
    fillOpacity: FILL_OPACITY,
    sweepOpacity: urgent ? SWEEP_URGENT_OPACITY : SWEEP_BASE_OPACITY,
    sweepFraction: deathZoneSweepFraction(remaining, total),
  };
}
