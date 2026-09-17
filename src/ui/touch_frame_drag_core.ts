// Pure core for the touch-layout drag of the class engine indicators: the
// spell-proc overlay (the mage phoenix, and the warlock Soul Fragment bank and
// Ruin ritual painted on the same element), the paladin devotion medallion and
// the warlock doom meter. On desktop every governed frame moves through the
// "Unlock interface" editor, which every touch layout refuses (MovableFrame
// no-ops its gestures there, the options row is not offered and the stylesheet
// hides the editor chrome), so on a phone or tablet these three keep an
// always-on one-finger drag instead: the DOM attacher is touch_frame_drag.ts,
// this file holds the declarative table and the math (the clamp, the storage
// round-trip, the drag arithmetic, the inset parse). Registered in
// tests/architecture.test.ts UI_PURE_CORES; tests/touch_frame_drag_core.test.ts
// pins it.
//
// A saved spot is the element CENTER as viewport FRACTIONS, the pre-registry
// proc_overlay_drag shape: the stylesheet centres each frame on its left/top
// with its own translate, and the touch scale composes around that same point,
// so one anchor lands the same at any UI Scale, resolution or orientation.

import { HUD_FRAME_SPECS } from './interface_unlock_core';

/** A saved anchor: the element center as fractions of the viewport (0..1). */
export interface TouchFrameAnchor {
  fx: number;
  fy: number;
}

/** The viewport insets a placed frame must keep clear of (a notch, the home
 *  indicator), in CSS px. */
export interface TouchSafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_TOUCH_SAFE_AREA: TouchSafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

/** Stamped on a frame while a saved touch spot applies; the mobile stylesheet
 *  reads the two custom properties below only under this class. */
export const TOUCH_PLACED_CLASS = 'tf-touch-placed';
/** Stamped for the length of a live drag (the stylesheet dresses it). */
export const TOUCH_DRAGGING_CLASS = 'tf-touch-dragging';
/** The inline custom properties carrying the anchor (percent strings). */
export const TOUCH_ANCHOR_X_PROP = '--touch-fx';
export const TOUCH_ANCHOR_Y_PROP = '--touch-fy';

/** One frame the touch layout keeps draggable, resolved against the unlock
 *  registry so the element it moves is exactly the one the desktop editor
 *  moves. */
export interface TouchDragFrameSpec {
  /** The HUD_FRAME_SPECS row id. */
  frameId: string;
  /** That row's element id. */
  elementId: string;
  /** localStorage key the touch anchor persists under. Distinct from the
   *  registry row's key: the desktop spot and the touch spot never overwrite
   *  each other, and a device that plays both ways keeps one of each. */
  storageKey: string;
}

/** The rows, by registry id. The proc overlay and the medallion keep the keys
 *  their pre-registry grab-drag persisted under, so a phone that parked the
 *  phoenix before the frames unlock shipped finds it where it was left; the
 *  doom meter never had a touch drag, so its key is new. All three are FULL
 *  transfer-code keys (settings_transfer_core.ts) like the two always were. */
const TOUCH_DRAG_ROWS = [
  { frameId: 'procOverlay', storageKey: 'procOverlayAnchor' },
  { frameId: 'paladinDevotion', storageKey: 'paladinDevotionAnchor' },
  { frameId: 'doomMeter', storageKey: 'warlockDoomAnchor' },
] as const;

/** Every frame the touch layout keeps draggable, in attach order. A row whose
 *  registry id no longer resolves is dropped here and caught by the test pin
 *  (the table must always carry exactly the three engine indicators). */
export const TOUCH_DRAG_FRAMES: readonly TouchDragFrameSpec[] = TOUCH_DRAG_ROWS.flatMap((row) => {
  const spec = HUD_FRAME_SPECS.find((s) => s.id === row.frameId);
  return spec
    ? [{ frameId: row.frameId, elementId: spec.elementId, storageKey: row.storageKey }]
    : [];
});

/** Clamp a proposed anchor so the element (w x h px in a vw x vh viewport)
 *  always keeps its full VISUAL body inside the viewport safe area. Sizes are
 *  the live bounding rect (post-scale, post-zoom), so a scaled-down phoenix
 *  clamps by the box a thumb actually sees. An inset that does not parse, or
 *  one larger than the viewport, is capped rather than allowed to invert the
 *  bounds; an element wider or taller than the usable area sits centered in
 *  it. Pure. */
export function clampTouchFrameAnchor(
  fx: number,
  fy: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  safeArea: TouchSafeArea = NO_TOUCH_SAFE_AREA,
): TouchFrameAnchor {
  const inset = (value: number, limit: number) =>
    Number.isFinite(value) ? Math.min(limit, Math.max(0, value)) : 0;
  const left = inset(safeArea.left, vw);
  const right = inset(safeArea.right, vw);
  const top = inset(safeArea.top, vh);
  const bottom = inset(safeArea.bottom, vh);
  const minX = vw > 0 ? (left + w / 2) / vw : 0;
  const maxX = vw > 0 ? 1 - (right + w / 2) / vw : 1;
  const minY = vh > 0 ? (top + h / 2) / vh : 0;
  const maxY = vh > 0 ? 1 - (bottom + h / 2) / vh : 1;
  const cx = minX <= maxX ? Math.min(maxX, Math.max(minX, fx)) : (left + vw - right) / 2 / vw;
  const cy = minY <= maxY ? Math.min(maxY, Math.max(minY, fy)) : (top + vh - bottom) / 2 / vh;
  return { fx: Number.isFinite(cx) ? cx : 0.5, fy: Number.isFinite(cy) ? cy : 0.5 };
}

/** Parse a stored anchor; null on anything malformed (the frame then keeps
 *  its stylesheet seat). Pure. */
export function parseTouchFrameAnchor(raw: string | null): TouchFrameAnchor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { fx?: unknown; fy?: unknown };
    if (typeof v.fx !== 'number' || typeof v.fy !== 'number') return null;
    if (!Number.isFinite(v.fx) || !Number.isFinite(v.fy)) return null;
    return { fx: Math.min(1, Math.max(0, v.fx)), fy: Math.min(1, Math.max(0, v.fy)) };
  } catch {
    return null;
  }
}

export function serializeTouchFrameAnchor(a: TouchFrameAnchor): string {
  return JSON.stringify({ fx: a.fx, fy: a.fy });
}

/** Where a live drag puts the center: the pointer minus the offset it grabbed
 *  the frame at (so the frame never jumps under the thumb), as fractions of
 *  the viewport. A degenerate viewport yields the center rather than NaN;
 *  the caller clamps the result. Pure. */
export function draggedTouchFrameAnchor(
  pointerX: number,
  pointerY: number,
  grabDx: number,
  grabDy: number,
  vw: number,
  vh: number,
): TouchFrameAnchor {
  return {
    fx: vw > 0 ? (pointerX - grabDx) / vw : 0.5,
    fy: vh > 0 ? (pointerY - grabDy) / vh : 0.5,
  };
}

/** The two percent strings the attacher writes into the custom properties. */
export function touchFrameAnchorCss(a: TouchFrameAnchor): { x: string; y: string } {
  return { x: `${(a.fx * 100).toFixed(2)}%`, y: `${(a.fy * 100).toFixed(2)}%` };
}

/** The safe-area probe's four resolved paddings (a computed style's strings,
 *  each the px the browser gave env(safe-area-inset-*)) as px insets. A value
 *  that does not parse (a browser with no inset support leaves the env()
 *  unresolved) counts as no inset. Pure. */
export function safeAreaFromPadding(padding: {
  top: string;
  right: string;
  bottom: string;
  left: string;
}): TouchSafeArea {
  const px = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    top: px(padding.top),
    right: px(padding.right),
    bottom: px(padding.bottom),
    left: px(padding.left),
  };
}
