// Stride audio accumulator: the distance-not-time trigger behind footsteps,
// swim strokes, and mount gait beats (renderer.ts's movement-audio arm). One
// shared accumulator per entity view rides `view.stepAccum`; a cue fires each
// time accumulated travel crosses the stride length, so cadence tracks real
// ground speed and pausing mid-stride never banks a phantom step.
//
// RENDER_PURE_CORES: host-agnostic and deterministic (no Three/DOM, no clock,
// no RNG), unit-tested directly (tests/stride_audio_core.test.ts). Not
// value-pure: it advances the accumulator on the view it is handed in place,
// which is the point (one number per entity, no per-frame allocation). The
// renderer stays the only caller and keeps sink dispatch; this core owns just
// the accumulate/threshold/reset arithmetic.

/** Advance the view's stride accumulator by this frame's travel and report
 *  whether a cue fires now (accumulator resets on fire). */
export function strideHit(
  view: { stepAccum: number },
  speed: number,
  dt: number,
  stride: number,
): boolean {
  view.stepAccum += speed * dt;
  if (view.stepAccum < stride) return false;
  view.stepAccum = 0;
  return true;
}
