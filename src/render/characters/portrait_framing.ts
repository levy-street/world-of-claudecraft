// Pure camera-framing math for the character portrait factory (portrait.ts).
// Extracted so the fov/extent/target choice per PortraitFraming, and the
// head-first headshot aim a WOC body takes (headshotAimForHead), are unit
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

// ---------------------------------------------------------------------------
// Head-first headshot framing: a WOC body frames its headshot off the DRAWN
// modular head (woc_portrait_bounds.ts measureWocPortraitHead) instead of a
// fraction of the body height. Those bodies carry chibi proportions (the head
// sits at 0.8 to 0.98 of the height), so the height fractions above cropped
// them at the collar; and a head measure is the same whatever the body scale,
// the class kit or the head type, so every such portrait frames its face alike.
// ---------------------------------------------------------------------------

/** A WOC body's drawn head, as the capture measured it on the posed rig (world
 *  units; the model stands at the origin facing +Z, the camera looks down -Z). */
export interface PortraitHeadBounds {
  /** The head base piece's box (the always-drawn head: its neck stub to its crown). */
  readonly baseMinY: number;
  readonly baseMaxY: number;
  /** The horizontal centre of the face: the drawn eyes, else the head base. */
  readonly centerX: number;
  /** The depth the frame is sized at: the head base's centre. */
  readonly centerZ: number;
  /** The drawn eyes' centre height, or null when none were measured. */
  readonly eyeY: number | null;
  /** The top of everything drawn on the head (the hair, a helm, a hood). */
  readonly topY: number;
}

/** A portrait camera: where it sits, what it looks at, and the frame it shows. */
export interface PortraitCameraAim {
  /** Vertical field of view, degrees. */
  readonly fov: number;
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  /** The frame's height at the head's depth, world units (the square frame's width too). */
  readonly frameHeight: number;
  /** Where the eye line landed, as a fraction of the frame from its top edge. */
  readonly eyeFromTop: number;
}

/** The head-first headshot's tuning. Sizes are in NECK-TO-EYE heights (the eye
 *  line's height above the head base's neck stub): the crown is no ruler, since
 *  the bald crown and every hairstyle's scalp tuck move it (a bald head's base is
 *  9% shorter), while the eye line sits the same over the neck on both head types.
 *  Placements are fractions of the frame, so the whole frame is scale-free. */
export interface HeadPortraitTuning {
  /** The headshot lens, degrees (a gentle telephoto: faces keep their proportions). */
  readonly fov: number;
  /** Frame height in neck-to-eye heights: the whole head and the neck, the collar and
   *  the shoulder line along the bottom edge. */
  readonly frameInNeckToEye: number;
  /** The eye line's place, a fraction of the frame from its top (just above the middle:
   *  a close headshot, the hair clear of the top edge). */
  readonly eyeFromTop: number;
  /** How low the eye line may drop to keep tall hair in frame before the camera
   *  pulls back instead. */
  readonly eyeFromTopMax: number;
  /** Clear space kept above the top of the hair, a fraction of the frame. */
  readonly topMargin: number;
  /** The eye line inside the head base when no eyes were measured (0 = neck, 1 = crown). */
  readonly eyeFracFallback: number;
  /** The most a measured top may rise over the eye line, in neck-to-eye heights: a
   *  taller one is a bad measure, not a hat, and is clamped so it cannot shrink the
   *  face to a speck. */
  readonly maxTopRise: number;
}

/** Tuned on captures of every hairstyle and beard of both head types across the class
 *  kits (a 54 px unit-frame disc and the 46 to 120 px chips): the face reads at the
 *  smallest size and the shoulder armor still frames it. */
export const HEAD_PORTRAIT_FRAMING: HeadPortraitTuning = {
  fov: 26,
  // Tightened 3.3 -> 2.45 at the owner's call (2026-09-30: "more zoom in on the head,
  // less body"): the face fills the disc, the collar and shoulder line along the bottom.
  frameInNeckToEye: 2.45,
  eyeFromTop: 0.46,
  eyeFromTopMax: 0.5,
  topMargin: 0.05,
  eyeFracFallback: 0.555,
  maxTopRise: 3,
};

/**
 * The headshot camera for a measured head: the face centred horizontally, the
 * eye line about the upper third, the head, neck and shoulders in frame. Hair
 * taller than that allows (a topknot, a high ponytail, curls) first lowers the
 * eye line (to at most `eyeFromTopMax`) and only then pulls the camera back, so
 * the top of the hair always clears the frame by `topMargin`. Every length
 * follows the head, so the same face frames the same at any body scale, on any
 * class kit, bald or not. Null for a degenerate measure (the caller keeps its
 * box framing).
 */
export function headshotAimForHead(
  head: PortraitHeadBounds,
  f: HeadPortraitTuning = HEAD_PORTRAIT_FRAMING,
): PortraitCameraAim | null {
  const { baseMinY, baseMaxY, centerX, centerZ } = head;
  const headH = baseMaxY - baseMinY;
  if (![baseMinY, baseMaxY, centerX, centerZ].every(Number.isFinite) || !(headH > 0)) return null;
  const eyeY = head.eyeY;
  const eye =
    eyeY !== null && Number.isFinite(eyeY) && eyeY > baseMinY && eyeY < baseMaxY
      ? eyeY
      : baseMinY + f.eyeFracFallback * headH;
  const neckToEye = eye - baseMinY;
  // at least the crown, at most the runaway cap (itself never under the crown)
  const cap = Math.max(baseMaxY, eye + f.maxTopRise * neckToEye);
  const top = Number.isFinite(head.topY) ? Math.min(Math.max(head.topY, baseMaxY), cap) : baseMaxY;
  // how far the top of the hair rises above the eye line
  const rise = top - eye;
  let frameH = f.frameInNeckToEye * neckToEye;
  let eyeFromTop = f.eyeFromTop;
  if ((eyeFromTop - f.topMargin) * frameH < rise) {
    eyeFromTop = Math.min(f.eyeFromTopMax, rise / frameH + f.topMargin);
    if ((eyeFromTop - f.topMargin) * frameH < rise) frameH = rise / (eyeFromTop - f.topMargin);
  }
  // the frame's centre sits below the eye line by the eye's offset from mid-frame
  const centerY = eye + (eyeFromTop - 0.5) * frameH;
  const dist = frameH / 2 / Math.tan((f.fov * Math.PI) / 360);
  return {
    fov: f.fov,
    position: [centerX, centerY, centerZ + dist],
    target: [centerX, centerY, centerZ],
    frameHeight: frameH,
    eyeFromTop,
  };
}
