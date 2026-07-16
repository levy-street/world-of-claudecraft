// Pure camera-framing math for the character portrait factory (portrait.ts).
// Extracted so the fov/extent/target choice per PortraitFraming is unit
// testable without a WebGL context.

/** Which slice of the model a portrait shows. `headshot` is the tight
 *  head-and-shoulders crop used for small chips (lists, the char-sheet
 *  title). `body` is a normal 3/4 framing (whole figure, a little headroom
 *  and footroom) used where the portrait is shown large, e.g. the Inspect
 *  window: a headshot crop blown up to that size reads as an over-zoomed
 *  helmet close-up instead of a character portrait. */
export type PortraitFraming = 'headshot' | 'body';

export interface PortraitFrameParams {
  /** Camera vertical FOV, in degrees. */
  fov: number;
  /** Fraction of the model height `h` to offset the look-at point up from
   *  the model's feet (min.y). */
  targetYFromFeetFrac: number;
  /** Vertical slice of the model height `h` the frame should show. */
  extentFrac: number;
}

const HEADSHOT: PortraitFrameParams = {
  fov: 26,
  // look lower so the head/shoulders sit higher in the frame
  targetYFromFeetFrac: 0.7,
  // tight vertical slice: head + shoulders (tighter = subject fills more)
  extentFrac: 0.44,
};

const BODY: PortraitFrameParams = {
  // normal lens, matches the live turntable's FOV in preview.ts
  fov: 45,
  // look at mid-height
  targetYFromFeetFrac: 0.5,
  // show the whole figure plus a little headroom/footroom
  extentFrac: 1.15,
};

/** Camera fov/target/extent for a given framing, as fractions of the
 *  model's own bounding-box height. Pure, no THREE/DOM dependency. */
export function portraitFrameParams(framing: PortraitFraming): PortraitFrameParams {
  return framing === 'body' ? BODY : HEADSHOT;
}
