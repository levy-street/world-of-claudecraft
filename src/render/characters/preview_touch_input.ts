// The finger tracking of the launcher turntable's TOUCH stage (CharacterPreview on a phone):
// pointer events on the canvas in, gesture steps and a double tap out. The gestures' meaning
// and the camera they move are the pure preview_touch_core.ts; this is the DOM half only, so
// preview.ts stays a thin consumer of both.
//
// Only touch pointers are taken, and only while the host says the stage is a touch stage
// (read live: the phone interface can be switched on and off at runtime, and a gesture under
// way stops steering the moment it is). The launcher's CSS takes the browser's own pan and
// pinch-zoom off the canvas there (touch-action: none, beside the `.char-preview-container
// canvas` rule of src/styles/shell.css), so every finger reaches these handlers. A pointer is
// captured on its first touch, so a drag that leaves the canvas keeps turning the character.

import {
  isDoubleTap,
  type TouchPoint,
  type TouchStep,
  touchStepBetween,
} from './preview_touch_core';

/** A touch that travels further than this (CSS px) is a drag, not a tap. */
const TAP_SLOP_PX = 10;
/** A touch held longer than this (ms) is a press, not a tap. */
const TAP_MAX_MS = 260;

export interface PreviewTouchInputHost {
  readonly canvas: HTMLCanvasElement;
  /** Read live: whether the stage takes touch gestures now. */
  active(): boolean;
  /** What the fingers did since the last sample (a finger landing or lifting sends nothing,
   *  preview_touch_core.ts touchStepBetween). */
  step(step: TouchStep): void;
  /** Two quick taps on one spot: put the camera back. */
  doubleTap(): void;
}

export interface PreviewTouchInput {
  /** Forget every finger and the last tap (the stage changed hands). */
  reset(): void;
  dispose(): void;
}

export function attachPreviewTouchInput(host: PreviewTouchInputHost): PreviewTouchInput {
  const points = new Map<number, TouchPoint>();
  const before = new Map<number, TouchPoint>();
  let tapStart: { t: number; x: number; y: number; moved: boolean } | null = null;
  let lastTap: { t: number; x: number; y: number } | null = null;

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || !host.active()) return;
    host.canvas.setPointerCapture?.(e.pointerId);
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tapStart =
      points.size === 1 ? { t: e.timeStamp, x: e.clientX, y: e.clientY, moved: false } : null;
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || !points.has(e.pointerId)) return;
    if (!host.active()) {
      // the stage stopped being a touch stage mid-gesture: let go of every finger
      points.clear();
      tapStart = null;
      return;
    }
    before.clear();
    for (const [id, p] of points) before.set(id, p);
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > TAP_SLOP_PX)
      tapStart.moved = true;
    host.step(touchStepBetween(before, points));
  };
  const onEnd = (e: PointerEvent): void => {
    if (!points.delete(e.pointerId)) return;
    const tap = tapStart;
    tapStart = null;
    if (e.type !== 'pointerup' || !tap || tap.moved || e.timeStamp - tap.t > TAP_MAX_MS) return;
    const at = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    if (isDoubleTap(lastTap, at)) {
      lastTap = null;
      host.doubleTap();
      return;
    }
    lastTap = at;
  };

  const canvas = host.canvas;
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onEnd);
  canvas.addEventListener('pointercancel', onEnd);
  return {
    reset(): void {
      points.clear();
      before.clear();
      tapStart = null;
      lastTap = null;
    },
    dispose(): void {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onEnd);
      canvas.removeEventListener('pointercancel', onEnd);
    },
  };
}
