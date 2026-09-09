// Where full-resolution SSAO stops paying for itself.
//
// N8AO's full-res Medium mode is the single most expensive item in the ultra
// post chain, and its cost is linear in drawing-buffer pixels. On the 1920x1080
// panel the tier was tuned against that is fine; above it the same pass costs
// twice to four times as much for the same look at a smaller angular size,
// because Windows clients render at DPR 1 to 1.7 where the DPR cap rarely
// binds. So `aoFullRes` cannot be a tier constant alone: the tier states the
// REQUEST and this core resolves the effective value against the live pixel
// count, the same shape as the region governor (a renderer decision, never a
// HUD-visible graphics knob).
//
// The measurement. GPU timer queries per render call on a Windows 11 desktop
// (RTX 3060, ANGLE D3D11, 2005x1440 drawing buffer = 2.89 Mpx, ultra, vsync
// off), against a GPU frame of 9.3 to 11.3 ms:
//
//   full-res Medium   3.10 ms   evaluate 1.70, two denoise passes 0.63 each,
//                               composite 0.14
//   half-res Low      0.50 ms   the arm the high tier already runs, with the
//                               depth-aware upsample in its composite
//   rest of the post chain 1.20 ms
//
// So full-res AO is 27 to 33 percent of the whole GPU frame on that host, and
// the arm swap gives 2.6 ms of it back. The half-res arm is far cheaper than
// its shader work suggests: it moves evaluate and both denoise passes to a
// quarter of the pixels and buys back only a full-rate 3x3 depth-aware upsample
// in the composite, and the measurement prices that upsample near nothing. An
// earlier revision of this file placed the cut from a tap count instead, which
// put the half-res arm at 0.63 of the full-res one; the measurement puts it at
// 0.16, which is the whole reason the cut moves here. A tap is not a
// millisecond.
//
// The budget: full-res AO stays selected while the UPGRADE it buys over the
// half-res arm stays within what the whole full-res pass costs at the 1920x1080
// reference panel, which is the cost the tier already accepts there. Above that
// point the upgrade alone costs more than the entire pass did on the panel it
// was tuned for, and the half-res arm takes over.
//
// The cut lands at about 2.47 Mpx, the 1080p class: 1920x1080 (2.07 Mpx) and
// 1920x1200 (2.30 Mpx) keep full-res AO, and every panel above that class takes
// the half-res arm, including the ones Windows high-plus players actually sit
// at: 2560x1440 (3.69 Mpx), 3440x1440 (4.95 Mpx) and 3840x2160 (8.29 Mpx). Be
// plain about what that number is: a POLICY cut, placed from one measured host.
// The ratio between the two arms moves with the driver and the GPU, so the
// number says where this repo has decided full-res AO stops being worth its
// share of the frame, not where the two arms cost the same everywhere.
//
// Hysteresis. Crossing the cut makes n8ao rebuild and relink its evaluate,
// denoise and compositer materials, so the arm must not chatter at the boundary.
// The band is one render-scale slider step wide, measured in pixels: that slider
// is the finest-grained control a player has over the pixel count, so a band
// that wide means no single step of it can flip the arm and step back. Around
// the new cut the band reaches 2.74 Mpx, which still leaves every 1440p-class
// panel on the half-res arm even when it walks in from below.

/** One megapixel, the unit the measured per-pixel costs are quoted in. */
const MEGAPIXEL = 1_000_000;

/** The drawing buffer the arms were timed at (2005x1440 on the 3060 host). */
const AO_MEASURED_PIXELS = 2005 * 1440;

/** Full-res Medium: evaluate, two denoise passes, composite. */
const AO_FULL_RES_MEASURED_MS = 1.7 + 2 * 0.63 + 0.14;

/** Half-res Low, the arm the high tier already runs, on the same frames. */
const AO_HALF_RES_MEASURED_MS = 0.5;

/** Milliseconds per megapixel of output for the full-res Medium arm. */
export const AO_FULL_RES_MS_PER_MEGAPIXEL =
  AO_FULL_RES_MEASURED_MS / (AO_MEASURED_PIXELS / MEGAPIXEL);

/** Milliseconds per megapixel of output for the half-res Low arm. */
export const AO_HALF_RES_MS_PER_MEGAPIXEL =
  AO_HALF_RES_MEASURED_MS / (AO_MEASURED_PIXELS / MEGAPIXEL);

/** The panel the ultra tier's AO cost was tuned against. */
export const AO_REFERENCE_PIXELS = 1920 * 1080;

/** The render-scale slider's step (src/game/settings.ts range, options_view.ts). */
const RENDER_SCALE_STEP = 0.05;

/**
 * How far past the cut the buffer must travel before a full-res arm gives up,
 * and how far back before a half-res arm returns: one render-scale step, which
 * moves the pixel count by the square of the scale ratio.
 */
export const AO_ARM_HYSTERESIS = 1 / (1 - RENDER_SCALE_STEP) ** 2;

/**
 * The largest drawing buffer that still gets full-res AO: the point where the
 * upgrade from the half-res arm costs more than the whole full-res pass does at
 * the 1920x1080 reference panel.
 */
export const AO_FULL_RES_MAX_PIXELS = Math.floor(
  (AO_FULL_RES_MS_PER_MEGAPIXEL * AO_REFERENCE_PIXELS) /
    (AO_FULL_RES_MS_PER_MEGAPIXEL - AO_HALF_RES_MS_PER_MEGAPIXEL),
);

/** The buffer a full-res arm has to exceed before it gives up its arm. */
export const AO_FULL_RES_RELEASE_PIXELS = Math.floor(AO_FULL_RES_MAX_PIXELS * AO_ARM_HYSTERESIS);

/**
 * Resolve the tier's `aoFullRes` REQUEST against the live drawing-buffer pixel
 * count. A tier that never asked for full-res AO keeps its half-res arm; a tier
 * that did keeps it only while the buffer stays inside the budget above.
 * Gameplay-neutral by construction: AO resolution is shading richness, never
 * information a player reacts to.
 *
 * @param current the arm in force, when there is one. Omit it to choose an arm
 *   from scratch (the builder); pass it on a re-resolve so the hysteresis band
 *   can hold the current arm through a boundary wobble.
 */
export function resolveAoFullRes(
  request: boolean,
  drawingBufferPixels: number,
  current?: boolean,
): boolean {
  if (!request) return false;
  // A buffer that has not been measured yet (a zero-sized canvas during boot)
  // must not silently demote the tier: honour the request and let the first
  // real setSize re-resolve it.
  if (!Number.isFinite(drawingBufferPixels) || drawingBufferPixels <= 0) return true;
  // A full-res arm holds on through the band; every other case reads the cut.
  if (current === true) return drawingBufferPixels <= AO_FULL_RES_RELEASE_PIXELS;
  return drawingBufferPixels <= AO_FULL_RES_MAX_PIXELS;
}
