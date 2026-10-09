// Pure camera-framing constants for the shared CharacterPreview turntable.
//
// Kept out of preview.ts (which imports three) so a Node test can pin the exact
// framings without a WebGL context. The self character sheet frames the model
// close and face-on (the classic character-screen pose); the inspect window pulls
// the camera back and a touch higher so a tall silhouette (a pointed hat, a
// staff) stays inside the frame. CharacterPreview.setFraming() applies one of
// these; the numbers here are the single source of truth for both.

/** One camera framing: the eye height (y) and distance (z) on the view axis, and
 *  the height the camera aims at (lookY). x is fixed (the model is centered). */
export interface PreviewFraming {
  y: number;
  z: number;
  lookY: number;
}

export const PREVIEW_FRAMING = {
  // Self character sheet: the classic close, face-on framing.
  sheet: { y: 1.45, z: 5.1, lookY: 1.3 },
  // Inspect another player: pulled back / raised so tall silhouettes stay framed.
  inspect: { y: 1.5, z: 6.6, lookY: 1.3 },
  // Collections, buddy rows: the follower rigs stand 0.55 to 0.8 units tall, so
  // both player framings above leave them a speck in the middle of the pane.
  // Pulled in and dropped to the creature's own eye line instead.
  collectionBuddy: { y: 0.8, z: 3.4, lookY: 0.45 },
  // Collections, mount rows: the opposite problem. A rideable body is two to
  // four times a player's height, so it needs more room than the inspect stage.
  collectionMount: { y: 2.2, z: 9, lookY: 1.5 },
} as const satisfies Record<string, PreviewFraming>;

export type PreviewFramingName = keyof typeof PREVIEW_FRAMING;

// --- creation focus: the face close-up the appearance editor eases to ---------

/** A full camera pose: position (x, y, z) and the aim point (x, lookY, 0).
 *  The aim shares the camera's x, so a sideways shift slides the character
 *  across the frame instead of turning the camera. */
export interface PreviewCamPose {
  x: number;
  y: number;
  z: number;
  lookY: number;
}

/** What the creation camera frames: the whole character, or the face. */
export type PreviewFocus = 'body' | 'face';

/** The fallback head centre on the turntable (y, preview units) for a stage
 *  with no body to measure; the live preview measures the drawn head
 *  (CharacterPreview.focusHeadY) and passes it as `headY`. */
export const CREATION_HEAD_Y = 1.72;

/** Where the face close-up aims inside a head's bounds (0 = the neck base of
 *  the head mesh, 1 = the crown): about the eye line, so the frame centres the
 *  face rather than the neck the head mesh carries. */
export const CREATION_HEAD_AIM = 0.62;

/** How long a focus change eases, in seconds. */
export const FOCUS_EASE_SECONDS = 0.45;

/** A stage at least this wide (width / height) has the editor docked over its
 *  left edge, so the face close-up slides right to clear it. */
export const WIDE_STAGE_ASPECT = 1.3;

/** Vertical field of view of the preview camera, degrees (preview.ts). */
const FOV_DEG = 45;

/**
 * The camera pose for a creation focus at a canvas aspect (width / height).
 *
 * 'body' is the sheet framing, unchanged. 'face' is a head-and-shoulders
 * close-up: the frame is ~1.15 units tall with the head centre in the upper
 * third, shoulders and upper chest below it, and the character slid a little
 * right of centre so the left-docked editor does not cover the face. On a
 * portrait canvas (a phone, where the editor is a sheet under the stage) the
 * distance grows until the shoulders fit the narrow width, and the head rides
 * higher so it stays clear of the sheet. `headY` is the measured head centre
 * (see CREATION_HEAD_AIM) and `headH` the drawn head's height; without them
 * the close-up aims at CREATION_HEAD_Y with a fixed frame.
 */
/** A stage shorter than this (CSS px) is a phone's: its face close-up frames
 *  the head and neck tight, since head-and-shoulders there leaves a face only a
 *  few dozen pixels tall. */
export const SMALL_STAGE_PX = 420;

/** A stage at least this wide (CSS px) is the desktop creator's full-window
 *  stage, the only one the editor docks OVER (so the only one the face slides
 *  clear of); a phone's stage is its own box beside or above the editor. */
export const DOCKED_STAGE_MIN_WIDTH_PX = 900;

export function creationFocusPose(
  focus: PreviewFocus,
  aspect: number,
  headY: number = CREATION_HEAD_Y,
  headH?: number,
  /** The stage's CSS size, when known: a small (phone) stage frames the face
   *  tighter, and only a docked desktop stage slides the face sideways. */
  stage?: { readonly w: number; readonly h: number },
): PreviewCamPose {
  const sheet = PREVIEW_FRAMING.sheet;
  if (focus === 'body') return { x: 0, y: sheet.y, z: sheet.z, lookY: sheet.lookY };
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const tanV = Math.tan(((FOV_DEG / 2) * Math.PI) / 180);
  const portrait = a < 0.9;
  const small = stage !== undefined && stage.h > 0 && stage.h < SMALL_STAGE_PX;
  // frame height (units) the close-up wants, and the width the shoulders need:
  // sized off the measured head (about 2.75 heads tall, the head a third of the
  // frame with shoulders and upper chest below; on a phone's small stage about
  // 1.65 heads, the face filling it), else the fixed fallback
  const sized = headH !== undefined && Number.isFinite(headH) && headH > 0;
  const heads = small ? 1.65 : portrait ? 2.9 : 2.75;
  const frameH = sized ? headH * heads : portrait ? 1.2 : 1.15;
  const shoulderW = sized ? headH * (small ? 1.3 : 2.3) : 0.95;
  const distForH = frameH / (2 * tanV);
  const distForW = shoulderW / (2 * tanV * a);
  const dist = Math.max(distForH, distForW);
  const visibleH = 2 * dist * tanV;
  // head centre this far above the frame centre, as a fraction of the frame
  const headRise = small ? 0.1 : portrait ? 0.3 : sized ? 0.22 : 0.24;
  const head = Number.isFinite(headY) ? headY : CREATION_HEAD_Y;
  const lookY = head - headRise * visibleH;
  // Slide right of centre only on a wide stage the editor docks over (the
  // desktop creator): NDC +0.12 of the half-width. A phone's stage is its own
  // box (above the editor sheet, or beside it in landscape), so the face stays
  // centred there.
  const halfW = dist * tanV * a;
  const docked = stage === undefined || stage.w >= DOCKED_STAGE_MIN_WIDTH_PX;
  const x = a >= WIDE_STAGE_ASPECT && docked && !small ? -0.12 * halfW : 0;
  return { x, y: lookY + 0.04, z: dist, lookY };
}

/** Ease between two poses: `t` is the elapsed fraction of the ease (0..1),
 *  shaped by a smoothstep so the move starts and lands softly. Frame-rate
 *  independent because the caller advances `t` by dt / FOCUS_EASE_SECONDS. */
export function easeCamPose(from: PreviewCamPose, to: PreviewCamPose, t: number): PreviewCamPose {
  const u = Math.max(0, Math.min(1, t));
  const k = u * u * (3 - 2 * u);
  const mix = (p: number, q: number) => p + (q - p) * k;
  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    z: mix(from.z, to.z),
    lookY: mix(from.lookY, to.lookY),
  };
}
