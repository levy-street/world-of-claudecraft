// Pure placement + anchor math for the generic `.window.panel` reflow
// (window_reflow.ts is the DOM adapter: dataset persistence, the resize
// listener). Mirrors placeTargetFrame / placeMeterFrame / placeChatBox for
// the one movable-panel family that never got its own pure core, and reuses
// anchorAdjustedPos (the same anchorAxis rule MovableFrame and the chat box
// already ship) rather than a fourth copy: every field of TargetFramePos
// besides left/top is optional, so a plain {left, top, vw, vh} satisfies it
// structurally.

import { anchorAdjustedPos } from './target_frame_pos';

/** Keep-out band from every viewport edge, matching the target frame / chat
 *  box / meter panel margin. */
const WINDOW_MARGIN = 8;

export interface WindowPlacement {
  left: number;
  top: number;
}

export interface WindowPlacementResult {
  /** Clamped top-left in VISUAL (screen / pointer) space: remember THIS
   *  (rememberWindowPos), so a spot chosen at one UI Scale re-derives to the
   *  same visual place at another. */
  visual: WindowPlacement;
  /** Author-space left/top for the style write: `.window.panel` elements
   *  live inside #ui (`zoom: var(--ui-scale)`), which re-multiplies an
   *  author length back to its visual counterpart. */
  css: WindowPlacement;
}

/**
 * Clamp a desired top-left so the window (its measured `size`) stays fully
 * on screen. `left`/`top` arrive in VISUAL (zoomed) space, matching
 * getBoundingClientRect() and pointer clientX/clientY; style.left/top are
 * author lengths the browser re-multiplies by #ui's `zoom`, so the css write
 * divides by the live UI scale (a scale of 1, the default, is a no-op).
 */
export function placeWindow(
  left: number,
  top: number,
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  scale: number,
): WindowPlacementResult {
  const z = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const vw = viewport.w / z;
  const vh = viewport.h / z;
  const width = Math.min(size.w / z, vw - WINDOW_MARGIN * 2);
  const height = Math.min(size.h / z, vh - WINDOW_MARGIN * 2);
  const maxLeft = Math.max(WINDOW_MARGIN, vw - width - WINDOW_MARGIN);
  const maxTop = Math.max(WINDOW_MARGIN, vh - height - WINDOW_MARGIN);
  const css = {
    left: Math.max(WINDOW_MARGIN, Math.min(maxLeft, left / z)),
    top: Math.max(WINDOW_MARGIN, Math.min(maxTop, top / z)),
  };
  return { css, visual: { left: css.left * z, top: css.top * z } };
}

/** The requested spot (see window_reflow.ts's rememberWindowPos), re-anchored
 *  per axis to the CURRENT viewport exactly as MovableFrame / the chat box
 *  do: each axis keeps its distance to whichever of start / center / end it
 *  sat closest to when chosen. A spot with no viewport stamp (an older save,
 *  or a window never explicitly positioned) returns unchanged. */
export function anchoredRequestedPos(
  pos: { left: number; top: number; vw?: number; vh?: number },
  size: { w: number; h: number },
  viewport: { w: number; h: number },
): WindowPlacement {
  const anchored = anchorAdjustedPos(pos, size, viewport);
  return { left: anchored.left, top: anchored.top };
}
