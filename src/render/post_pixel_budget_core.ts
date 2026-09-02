// Where full-resolution SSAO stops paying for itself.
//
// N8AO's full-res Medium mode is the single most expensive item in the ultra
// post chain, and its cost is linear in drawing-buffer pixels. On the 1920x1080
// panel the tier was tuned against that is fine; on the 1440p and 4K panels
// Windows players render at DPR 1 (3.7 to 8.3 Mpx, where the DPR cap never
// binds) the same pass costs two to four times as much for the same look at a
// smaller angular size. So `aoFullRes` cannot be a tier constant alone: the
// tier states the REQUEST and this core resolves the effective value against
// the live pixel count, the same shape as the region governor (a renderer
// decision, never a HUD-visible graphics knob).
//
// Derivation. Both AO arms are counted in texture taps per OUTPUT pixel, read
// off the pinned n8ao 1.10.3 shaders rather than estimated:
//
//   full-res Medium (aoSamples 16, denoiseSamples 8, 2 denoise iterations)
//     evaluate    beauty + depth + computeNormal(9) + blue noise + 16 samples
//     denoise x2  AO + depth + blue noise + 2 taps per denoise sample
//     composite   beauty + depth + AO
//   half-res Low (aoSamples 16, denoiseSamples 4, halfRes + depthAwareUpsampling)
//     downsample  4 depth taps + computeNormal(9), at quarter pixel count
//     evaluate    beauty + depth + packed normal + blue noise + 16 samples,
//                 at quarter pixel count
//     denoise x2  as above with 4 denoise samples, at quarter pixel count
//     composite   beauty + depth + computeNormal(9) + a 3x3 depth-aware
//                 upsample window, 2 taps per neighbour, at FULL pixel count
//
// The half-res arm is not a quarter of the full-res arm: it moves the sampling
// down but buys back a full-res bilateral upsample in the composite. What it
// saves is the difference between the two per-pixel tap rates.
//
// The budget itself: the whole full-res chain at 1920x1080 is the cost the tier
// already accepts on the reference panel, so full-res AO stays selected while
// the UPGRADE it buys over the half-res arm stays within that one accepted
// chain. Above that point the upgrade alone costs more than the entire pass did
// on the panel it was tuned for, and the half-res arm takes over.
//
// The cut lands at about 5.45 Mpx: 1080p, 1440p and 3440x1440 ultrawide keep
// full-res AO, 4K and wider do not. (The audit that opened this work estimated
// the crossover at 1440p-class, 3.7 Mpx, from sample counts alone; counting
// every tap in the shipped shaders moves it up but leaves every common panel on
// the same side of the line.)

/** n8ao setQualityMode('Medium'): the ultra tier's full-res request. */
const AO_SAMPLES_MEDIUM = 16;
const DENOISE_SAMPLES_MEDIUM = 8;
/** n8ao setQualityMode('Low'): the half-res arm, as the high tier already runs it. */
const AO_SAMPLES_LOW = 16;
const DENOISE_SAMPLES_LOW = 4;
/** n8ao runs the poisson denoise twice on both arms. */
const DENOISE_ITERATIONS = 2;
/** computeNormal(): the 9 depth texelFetches that reconstruct a normal. */
const NORMAL_RECONSTRUCTION_TAPS = 9;
/** The 3x3 window the HALFRES composite walks, 2 taps per neighbour. */
const UPSAMPLE_WINDOW_TAPS = 9 * 2;
/** Half-res buffers hold a quarter of the output pixels. */
const HALF_RES_PIXEL_FRACTION = 0.25;

function denoiseTaps(samples: number): number {
  // AO + depth + blue noise, then an AO and a depth tap per denoise sample.
  return DENOISE_ITERATIONS * (3 + 2 * samples);
}

/** Texture taps per output pixel for the full-res Medium arm. */
export const AO_FULL_RES_TAPS_PER_PIXEL =
  // evaluate
  3 +
  NORMAL_RECONSTRUCTION_TAPS +
  AO_SAMPLES_MEDIUM +
  denoiseTaps(DENOISE_SAMPLES_MEDIUM) +
  // composite: beauty, depth, AO
  3;

/** Texture taps per output pixel for the half-res Low arm. */
export const AO_HALF_RES_TAPS_PER_PIXEL =
  HALF_RES_PIXEL_FRACTION *
    // depth + normal downsample, then evaluate and denoise on the half-res grid
    (4 + NORMAL_RECONSTRUCTION_TAPS + (4 + AO_SAMPLES_LOW) + denoiseTaps(DENOISE_SAMPLES_LOW)) +
  // composite: beauty, depth, a reconstructed normal, and the upsample window
  (2 + NORMAL_RECONSTRUCTION_TAPS + UPSAMPLE_WINDOW_TAPS);

/** The panel the ultra tier's AO cost was tuned against. */
export const AO_REFERENCE_PIXELS = 1920 * 1080;

/**
 * The largest drawing buffer that still gets full-res AO: the point where the
 * upgrade from the half-res arm costs more than the whole full-res chain does
 * at the 1920x1080 reference panel.
 */
export const AO_FULL_RES_MAX_PIXELS = Math.floor(
  (AO_FULL_RES_TAPS_PER_PIXEL * AO_REFERENCE_PIXELS) /
    (AO_FULL_RES_TAPS_PER_PIXEL - AO_HALF_RES_TAPS_PER_PIXEL),
);

/**
 * Resolve the tier's `aoFullRes` REQUEST against the live drawing-buffer pixel
 * count. A tier that never asked for full-res AO keeps its half-res arm; a tier
 * that did keeps it only while the buffer stays inside the budget above.
 * Gameplay-neutral by construction: AO resolution is shading richness, never
 * information a player reacts to.
 */
export function resolveAoFullRes(request: boolean, drawingBufferPixels: number): boolean {
  if (!request) return false;
  // A buffer that has not been measured yet (a zero-sized canvas during boot)
  // must not silently demote the tier: honour the request and let the first
  // real setSize re-resolve it.
  if (!Number.isFinite(drawingBufferPixels) || drawingBufferPixels <= 0) return true;
  return drawingBufferPixels <= AO_FULL_RES_MAX_PIXELS;
}
