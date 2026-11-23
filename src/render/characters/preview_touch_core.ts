// The launcher turntable's TOUCH stage (CharacterPreview on a phone): pinch to zoom, two
// fingers to slide the view, one finger to turn the character and tilt the camera, a double
// tap to put the camera back. Pure and three-free, so a Node test drives the gestures and the
// camera they produce directly; preview.ts only feeds it pointer positions and writes the
// pose it returns.
//
// The camera rides a path between two framings the stage hands in: NEAR (the head and
// shoulders, preview_framing.ts touchShouldersPose, the shot every launcher stage opens on,
// the creator and the roster's pick alike) and FAR (the whole body, the sheet framing). A
// pinch moves the distance along that path, and the aim point glides between the two
// framings' aims with it, so zooming out from the face settles on the whole body instead of
// the neck. The player's slide and tilt ride on top, clamped so the character can never be
// lost off the stage.
//
// The creator also offers a one-time gesture hint beside the model until the player first
// moves it (touchHintOffered, touchStepMoves; the DOM is src/ui/preview_touch_hint.ts).

import type { PreviewCamPose } from './preview_framing';

/** Where the player has put the camera, on top of the stage's own framing. */
export interface TouchView {
  /** Camera distance from the aim point (world units, along the line of sight); pinch moves it. */
  dist: number;
  /** Sideways and vertical slide of the aim point, world units (two-finger drag). */
  panX: number;
  panY: number;
  /** Extra camera elevation around the aim point, radians (one-finger vertical drag). */
  pitch: number;
}

/** One finger position on the stage, CSS pixels. */
export interface TouchPoint {
  readonly x: number;
  readonly y: number;
}

/** What the fingers did between two samples of the same touch: a one-finger drag, or a
 *  two-finger pinch and slide (both at once). Empty when the touch changed shape (a finger
 *  landed or lifted): that sample only sets the new baseline, so a finger joining a drag
 *  never jumps the camera. */
export interface TouchStep {
  /** One-finger drag, CSS pixels. */
  dragX: number;
  dragY: number;
  /** Two fingers: the spread now over the spread before (above 1 = spreading apart). */
  pinch: number;
  /** Two fingers: how far their midpoint moved, CSS pixels. */
  slideX: number;
  slideY: number;
}

/** Nearest the camera may come, as a share of the NEAR framing's distance (a face close-up). */
export const TOUCH_MIN_DIST_SHARE = 0.55;
/** Farthest it may go, as a share of the FAR framing's distance (a little past the whole body). */
export const TOUCH_MAX_DIST_SHARE = 1.25;
/** The slide keeps the aim point on the character, world units: this far either side of its
 *  centre line, no lower than its shins, and no higher than this above the higher of the two
 *  framings' aims (the near one aims at the face, so: just over the head). Relative, because
 *  a body's height is the stage's to know (a WOC body stands about three units tall). */
export const TOUCH_PAN_X_LIMIT = 0.9;
export const TOUCH_AIM_FLOOR_Y = 0.25;
export const TOUCH_AIM_HEADROOM = 0.35;
/** The tilt the player may add, radians: a little from below, more from above. */
export const TOUCH_PITCH_MIN = -0.3;
export const TOUCH_PITCH_MAX = 0.65;
/** Radians of character turn, and of camera tilt, per CSS pixel of one-finger drag. The turn
 *  matches the mouse drag's (preview.ts setupDragControls). */
export const TOUCH_TURN_PER_PX = 0.01;
export const TOUCH_TILT_PER_PX = 0.005;
/** Two taps this close together (ms) and this near each other (CSS px) put the camera back. */
export const TOUCH_DOUBLE_TAP_MS = 320;
export const TOUCH_DOUBLE_TAP_PX = 30;

const EMPTY_STEP: TouchStep = { dragX: 0, dragY: 0, pinch: 1, slideX: 0, slideY: 0 };

/** A framing's camera distance from its aim point, along the line of sight. */
export function framingDistance(p: PreviewCamPose): number {
  return Math.hypot(p.z, p.y - p.lookY);
}

/** The view at a framing, with no slide or tilt: a stage opens on its near framing. */
export function touchViewAt(framing: PreviewCamPose): TouchView {
  return { dist: framingDistance(framing), panX: 0, panY: 0, pitch: 0 };
}

/** Whether a step moved anything: a drag, a pinch or a slide. A finger landing or lifting
 *  sends the empty step, which is not the player moving the model. */
export function touchStepMoves(step: TouchStep): boolean {
  return (
    step.dragX !== 0 ||
    step.dragY !== 0 ||
    step.pinch !== 1 ||
    step.slideX !== 0 ||
    step.slideY !== 0
  );
}

/** What the stage knows each frame about offering the gesture hint. */
export interface TouchHintFacts {
  /** The stage is a touch stage now (the phone interface). */
  readonly touch: boolean;
  /** The stage shows the creator (the hint is the creator's; the roster's pick has none). */
  readonly creator: boolean;
  /** The stage is on screen with a size to draw in. */
  readonly visible: boolean;
  /** Its character draws (never beside the loading silhouette: the hint names the model). */
  readonly drawn: boolean;
}

/** Whether the stage offers the gesture hint this frame. Whether the player has already
 *  moved the model once (and so never sees it again) is the hint's own to remember. */
export function touchHintOffered(f: TouchHintFacts): boolean {
  return f.touch && f.creator && f.visible && f.drawn;
}

/**
 * The step between two samples of one touch, by pointer id. A step only exists while the
 * same fingers are down in both samples (one, or the first two); anything else is a change
 * of shape and returns the empty step.
 */
export function touchStepBetween(
  before: ReadonlyMap<number, TouchPoint>,
  after: ReadonlyMap<number, TouchPoint>,
): TouchStep {
  if (before.size !== after.size || after.size === 0) return EMPTY_STEP;
  const ids = [...after.keys()];
  if (!ids.every((id) => before.has(id))) return EMPTY_STEP;
  if (ids.length === 1) {
    const a = before.get(ids[0]) as TouchPoint;
    const b = after.get(ids[0]) as TouchPoint;
    return { ...EMPTY_STEP, dragX: b.x - a.x, dragY: b.y - a.y };
  }
  const [i, j] = ids;
  const a0 = before.get(i) as TouchPoint;
  const a1 = before.get(j) as TouchPoint;
  const b0 = after.get(i) as TouchPoint;
  const b1 = after.get(j) as TouchPoint;
  const spreadBefore = Math.hypot(a1.x - a0.x, a1.y - a0.y);
  const spreadAfter = Math.hypot(b1.x - b0.x, b1.y - b0.y);
  // two fingers on one spot carry no scale: never divide by it
  const pinch = spreadBefore > 1 && spreadAfter > 1 ? spreadAfter / spreadBefore : 1;
  return {
    ...EMPTY_STEP,
    pinch,
    slideX: (b0.x + b1.x - a0.x - a1.x) / 2,
    slideY: (b0.y + b1.y - a0.y - a1.y) / 2,
  };
}

/** The distance range a view may take between these framings. */
function distRange(near: PreviewCamPose, far: PreviewCamPose): { min: number; max: number } {
  return {
    min: framingDistance(near) * TOUCH_MIN_DIST_SHARE,
    max: framingDistance(far) * TOUCH_MAX_DIST_SHARE,
  };
}

/** Where `dist` sits on the path from the near framing (0) to the far one (1), on a log
 *  scale (a pinch is a ratio), clamped to the path's ends. */
function pathShare(dist: number, near: PreviewCamPose, far: PreviewCamPose): number {
  const nearDist = framingDistance(near);
  const lo = Math.log(Math.max(nearDist, 1e-3));
  const hi = Math.log(Math.max(framingDistance(far), nearDist + 1e-3));
  return Math.max(0, Math.min(1, (Math.log(Math.max(dist, 1e-3)) - lo) / (hi - lo)));
}

/** The view after a step's slide and pinch. `stageHeightPx` and `fovDeg` turn a finger's
 *  pixels into world units at the current distance, so the character follows the fingers. */
export function applyTouchStep(
  view: TouchView,
  step: TouchStep,
  near: PreviewCamPose,
  far: PreviewCamPose,
  stageHeightPx: number,
  fovDeg: number,
): TouchView {
  const range = distRange(near, far);
  const dist = Math.max(range.min, Math.min(range.max, view.dist / step.pinch));
  // a finger's pixel in world units on the aim plane, at the distance the camera had
  const unitsPerPx =
    stageHeightPx > 0 ? (2 * view.dist * Math.tan((fovDeg * Math.PI) / 360)) / stageHeightPx : 0;
  const pitch = Math.max(
    TOUCH_PITCH_MIN,
    Math.min(TOUCH_PITCH_MAX, view.pitch + step.dragY * TOUCH_TILT_PER_PX),
  );
  // the character follows the fingers: a slide right moves the aim left, a slide down
  // moves it up
  return clampTouchView(
    {
      dist,
      panX: view.panX - step.slideX * unitsPerPx,
      panY: view.panY + step.slideY * unitsPerPx,
      pitch,
    },
    near,
    far,
  );
}

/** Keep a view's slide inside the character's bounds at its distance (the aim point stays on
 *  the body). */
export function clampTouchView(
  view: TouchView,
  near: PreviewCamPose,
  far: PreviewCamPose,
): TouchView {
  const range = distRange(near, far);
  const dist = Math.max(range.min, Math.min(range.max, view.dist));
  const u = pathShare(dist, near, far);
  const baseX = near.x + (far.x - near.x) * u;
  const baseAim = near.lookY + (far.lookY - near.lookY) * u;
  const panX = Math.max(-TOUCH_PAN_X_LIMIT - baseX, Math.min(TOUCH_PAN_X_LIMIT - baseX, view.panX));
  const aimTop = Math.max(near.lookY, far.lookY) + TOUCH_AIM_HEADROOM;
  const panY = Math.max(TOUCH_AIM_FLOOR_Y - baseAim, Math.min(aimTop - baseAim, view.panY));
  const pitch = Math.max(TOUCH_PITCH_MIN, Math.min(TOUCH_PITCH_MAX, view.pitch));
  return { dist, panX, panY, pitch };
}

/**
 * The camera pose for a view: the aim glides from the near framing's to the far one's with
 * the distance, the player's slide rides on it, and the camera sits on an arc around the aim
 * at the framing's own elevation plus the player's tilt.
 */
export function touchViewPose(
  view: TouchView,
  near: PreviewCamPose,
  far: PreviewCamPose,
): PreviewCamPose {
  const v = clampTouchView(view, near, far);
  const u = pathShare(v.dist, near, far);
  const lookY = near.lookY + (far.lookY - near.lookY) * u + v.panY;
  const x = near.x + (far.x - near.x) * u + v.panX;
  // the framings' own camera lift above their aim, as an angle on the arc
  const nearLift = Math.atan2(near.y - near.lookY, near.z);
  const farLift = Math.atan2(far.y - far.lookY, far.z);
  const angle = nearLift + (farLift - nearLift) * u + v.pitch;
  return {
    x,
    y: lookY + v.dist * Math.sin(angle),
    z: v.dist * Math.cos(angle),
    lookY,
  };
}

/** Whether a tap at `at` (ms, CSS px) completes a double tap with the previous one. */
export function isDoubleTap(
  previous: { readonly t: number; readonly x: number; readonly y: number } | null,
  at: { readonly t: number; readonly x: number; readonly y: number },
): boolean {
  if (!previous) return false;
  return (
    at.t - previous.t <= TOUCH_DOUBLE_TAP_MS &&
    Math.hypot(at.x - previous.x, at.y - previous.y) <= TOUCH_DOUBLE_TAP_PX
  );
}
