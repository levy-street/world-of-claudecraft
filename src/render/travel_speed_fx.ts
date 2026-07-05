// Travel-form speed-illusion VFX (pure core).
//
// Presentation-only cue that makes the druid's classic +40% Travel Form READ as
// fast without touching sim balance: when the LOCAL player is shifted into
// travel form AND actually moving, a screen-space layer paints radial speed
// streaks plus a soft motion vignette, both scaled by real movement speed.
//
// This module is DOM/GL-free on purpose: it owns only the geometry + easing
// math so a Vitest can drive it directly (tests/travel_speed_fx.test.ts). The
// renderer is the thin consumer that turns a `TravelSpeedFxState` into pixels.

import { RUN_SPEED } from '../sim/types';

// Speed at/below which there is no cue (normal run), and the speed at which the
// cue is fully saturated. Travel Form is RUN_SPEED * 1.4, so we ramp across the
// band between a normal run and the full travel-form sprint.
export const FX_SPEED_FLOOR = RUN_SPEED * 1.02; // a hair above run, avoids idle jitter
export const FX_SPEED_FULL = RUN_SPEED * 1.4; // classic +40% travel-form top speed

// A single render frame can report an implausible speed when the local player is
// displaced rather than running: a zone transition, knockback, or respawn moves
// the interpolated self position a large distance in one frame. Anything beyond a
// few multiples of run speed is not real travel, so we reject it and draw nothing
// (otherwise the cue flashes to full for that one frame). Travel Form tops out at
// RUN_SPEED * 1.4, so RUN_SPEED * 4 sits well above any legitimate movement.
export const FX_SPEED_MAX_PLAUSIBLE = RUN_SPEED * 4;

// How quickly the visible intensity follows the target (per second). Keeps the
// cue from popping on/off across single frames as speed crosses the floor.
export const FX_INTENSITY_LERP = 8;

export interface TravelSpeedFxInputs {
  /** Is the LOCAL player currently in travel form? */
  inTravelForm: boolean;
  /** Horizontal ground speed of the local player this frame, yards/sec. */
  speed: number;
  /** Honor prefers-reduced-motion: suppress the cue entirely when true. */
  reducedMotion: boolean;
}

/** One screen-space streak, in normalized [0,1] coordinates from screen center. */
export interface SpeedStreak {
  /** Angle of the streak, radians. */
  angle: number;
  /** Inner radius (fraction of half-diagonal) where the streak begins. */
  inner: number;
  /** Outer radius (fraction of half-diagonal) where the streak ends. */
  outer: number;
  /** Per-streak opacity multiplier, 0..1. */
  alpha: number;
}

/**
 * Map raw inputs to a target intensity in [0,1]. 0 means "draw nothing".
 * Gated strictly on: in travel form AND moving above the floor AND not
 * reduced-motion. Outside that band the target is 0 so the cue eases away.
 */
export function targetIntensity(i: TravelSpeedFxInputs): number {
  if (i.reducedMotion || !i.inTravelForm) return 0;
  if (i.speed <= FX_SPEED_FLOOR) return 0;
  // Reject teleport / displacement spikes rather than flashing the cue (see
  // FX_SPEED_MAX_PLAUSIBLE).
  if (i.speed > FX_SPEED_MAX_PLAUSIBLE) return 0;
  const t = (i.speed - FX_SPEED_FLOOR) / (FX_SPEED_FULL - FX_SPEED_FLOOR);
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  // ease-out so the cue swells quickly then plateaus near top speed.
  return clamped * (2 - clamped);
}

/**
 * Frame-rate-independent approach of `current` toward `target` at LERP/sec.
 * Returns the new intensity; callers persist it across frames.
 */
export function stepIntensity(current: number, target: number, dt: number): number {
  const k = 1 - Math.exp(-FX_INTENSITY_LERP * Math.max(0, dt));
  return current + (target - current) * k;
}

/**
 * Deterministic radial streak layout for a given intensity and animation phase.
 * `count` streaks are distributed around the ring; each one's reach and opacity
 * scale with intensity, and `phase` (seconds) animates a slow rotation + length
 * shimmer so the field feels alive without per-frame allocation churn in math.
 */
export function speedStreaks(intensity: number, phase: number, count = 28): SpeedStreak[] {
  return speedStreaksInto([], intensity, phase, count);
}

/**
 * Fill `out` with the streak layout for this frame, reusing the streak objects
 * already in `out` (and trimming it to `count`) so a per-frame caller allocates
 * nothing. Returns `out`. Output is identical to `speedStreaks` for the same
 * inputs; the renderer drives this with a persistent buffer.
 */
export function speedStreaksInto(
  out: SpeedStreak[], intensity: number, phase: number, count = 28,
): SpeedStreak[] {
  if (intensity <= 0) { out.length = 0; return out; }
  const reach = 0.18 + 0.32 * intensity; // longer streaks the faster you go
  for (let n = 0; n < count; n++) {
    // even spread plus a tiny deterministic jitter so streaks don't look combed.
    const base = (n / count) * Math.PI * 2;
    const jitter = Math.sin(n * 12.9898) * 0.12;
    const angle = base + jitter + phase * 0.15;
    const shimmer = 0.5 + 0.5 * Math.sin(phase * 3 + n * 1.7);
    const inner = 0.55 - 0.1 * intensity; // streaks start nearer center at speed
    const outer = Math.min(1, inner + reach * (0.7 + 0.3 * shimmer));
    const alpha = intensity * (0.45 + 0.55 * shimmer);
    const s = out[n];
    if (s) { s.angle = angle; s.inner = inner; s.outer = outer; s.alpha = alpha; }
    else out[n] = { angle, inner, outer, alpha };
  }
  out.length = count;
  return out;
}

/** Vignette darkness at the screen edge for a given intensity, 0..~0.4. */
export function vignetteAlpha(intensity: number): number {
  return 0.4 * intensity;
}
