// Deadband math for the scene-wide values every lit program re-uploads when
// they change (scene_globals_stabilizer.ts is the three.js half).
//
// three keeps a per-program cache of each uniform's last value and only calls
// gl.uniform* when the new value differs, so a value that drifts by a hair on
// every frame costs one upload per program per frame. Standing still in a
// town on the Galaxy Tab S10 Lite, that was about 300 of the frame's 960 WebGL
// calls: the day/night grade eases the light and fog colours by about 2e-5 a
// frame (an 8-bit step is 0.004), and the follow camera's matrix carries
// floating-point noise around 1e-12, which moves every camera-space light
// position and direction. The grade follows a real 45-minute day (the
// UTC-anchored cycle, sim/day_night.ts) through a 0.7 s response, so its
// per-frame step depends on the hour: online at dusk the colours moved about
// 1.4e-4 a frame and the sun 1e-4 rad, and fog near and far are damped toward
// the hour's haze the same way. The bands below are therefore sized to what a
// screen can show, not to the drift of one hour.
//
// A deadband keeps a COMMITTED copy of each value and only replaces it once
// the live value has moved further than the band, so the error is bounded by
// the band and the value holds still in between. Rounding to a grid would not
// do: a value hovering on a grid line flips every frame.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts).

/** Colour components (linear, 0 to 1 and above): half an 8-bit step (1/255),
 *  so a held colour is never a step a display can show away from the live one. */
export const COLOR_BAND = 1 / 512;
/** Light intensities, relative to the committed value (absolute near zero):
 *  the same half step of brightness. */
export const INTENSITY_BAND = 1 / 512;
/** Direction vectors (unit length) where a shadow map draws: about 0.011
 *  degrees, 2 mm at the tip of a 10-yard shadow, which stretches the error. */
export const DIRECTION_BAND = 2e-4;
/** Direction vectors where no shadow map draws (Low): about 0.11 degrees. The
 *  only reader is the diffuse term, whose change is at most the angle times
 *  the light's intensity, so the shading moves by under half an 8-bit step. */
export const DIRECTION_BAND_UNSHADOWED = 2e-3;
/** Fog near and far, relative: 1/512 of the distance moves the fog factor at
 *  any depth by about the shift over (far - near), well under half a step for
 *  every fog the world sets (far - near is tens of yards or more). Density
 *  (exponential fog) takes the same relative band. */
export const FOG_RANGE_BAND = 1 / 512;
/** Camera world matrix elements: rotation terms are unitless, translation in
 *  yards (1e-6 yd is a micrometre at the camera). */
export const CAMERA_BAND = 1e-6;

/**
 * Commit `live` into `committed` when any component moved further than `band`
 * (all of them, so the committed vector stays coherent); otherwise leave it.
 * Returns true when it committed. `committed` must be as long as `live`.
 */
export function deadbandCommit(
  committed: Float64Array | number[],
  live: ArrayLike<number>,
  band: number,
): boolean {
  let moved = false;
  for (let i = 0; i < live.length; i++) {
    const d = live[i] - committed[i];
    // NaN never commits and never sticks: a non-finite live value is copied
    // through so the stabilizer cannot hide a broken input.
    if (!(Math.abs(d) <= band)) {
      moved = true;
      break;
    }
  }
  if (moved) for (let i = 0; i < live.length; i++) committed[i] = live[i];
  return moved;
}

/** Scalar form with a relative band (absolute `band` below magnitude 1). */
export function deadbandScalar(committed: number, live: number, band: number): number {
  const scale = Math.max(1, Math.abs(committed));
  return Math.abs(live - committed) <= band * scale ? committed : live;
}

/** A fresh committed slot seeded with NaN, so the first value always commits. */
export function emptyCommitted(length: number): Float64Array {
  return new Float64Array(length).fill(Number.NaN);
}
