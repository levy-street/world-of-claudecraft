// Free-Fly wheel -> fly speed. Pure arithmetic so the wheel's feel is unit
// testable and identical to what the Camera tab's slider writes.
//
// In Free-Fly the wheel used to dolly the orbit distance, which moved the
// camera AND (because fly() scaled its speed by that distance) silently
// re-geared the flight. One gesture, two effects. The wheel now drives the
// speed alone, and EditorCamera.flyDistIndependent takes the distance term out
// of fly(), so the two concerns never ride the same input again.

/** The Camera tab's slider bounds, so wheel and slider stay one control. */
export const FLY_SPEED_MIN = 0.1;
export const FLY_SPEED_MAX = 4;
/** Slider granularity: the wheel lands on values the slider can show. */
export const FLY_SPEED_STEP = 0.1;
/** Wheel response. One 100px notch is about a 12% change, so a few notches
 *  cross a useful range without a single flick jumping min-to-max. */
const WHEEL_GAIN = 0.0012;
/** Guards a trackpad's 1000+px inertia flings from swallowing the range. */
const MAX_WHEEL_DELTA = 160;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The fly speed a wheel notch produces from the current one.
 *
 * Scrolling UP (negative deltaY, "toward the screen") speeds up, matching the
 * dolly-in direction the wheel used to have, so the gesture still reads as
 * "more" in the same direction. Exponential, so a step feels the same size at
 * 0.2x as at 3x; snapped to the slider's step and clamped to its range.
 */
export function flySpeedFromWheel(current: number, deltaY: number): number {
  if (!Number.isFinite(current)) return 1;
  if (!Number.isFinite(deltaY) || deltaY === 0) return clamp(current, FLY_SPEED_MIN, FLY_SPEED_MAX);
  const delta = clamp(deltaY, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA);
  const raw = current * Math.exp(-delta * WHEEL_GAIN);
  const snapped = Math.round(raw / FLY_SPEED_STEP) * FLY_SPEED_STEP;
  // A notch must always land somewhere: at the low end the snap can round back
  // onto the value we started from, which reads as a dead wheel.
  const stepped =
    snapped === current ? current + (delta < 0 ? FLY_SPEED_STEP : -FLY_SPEED_STEP) : snapped;
  return clamp(Number(stepped.toFixed(2)), FLY_SPEED_MIN, FLY_SPEED_MAX);
}
