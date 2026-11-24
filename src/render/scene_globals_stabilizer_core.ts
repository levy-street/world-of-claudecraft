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
// position and direction.
//
// A deadband keeps a COMMITTED copy of each value and only replaces it once
// the live value has moved further than the band, so the error is bounded by
// the band and the value holds still in between. Rounding to a grid would not
// do: a value hovering on a grid line flips every frame.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts).

/** Colour components (linear, 0 to 1 and above): far under an 8-bit step. */
export const COLOR_BAND = 1 / 4096;
/** Light intensities, relative to the committed value (absolute near zero). */
export const INTENSITY_BAND = 1 / 2048;
/** Direction vectors (unit length): about 0.011 degrees. The day sun turns
 *  about 2e-5 rad a frame, so a band this wide re-sends the key light's
 *  direction about one frame in nine; the shift is 2 mm at the tip of a
 *  10-yard shadow. */
export const DIRECTION_BAND = 2e-4;
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
