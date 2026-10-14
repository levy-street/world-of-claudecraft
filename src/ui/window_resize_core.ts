// Pure geometry for the shared window-resize affordance (the south-east corner
// grip every movable .window.panel gets from src/ui/window_resize.ts, plus the
// north-west grip a bottom-anchored window opts into). DOM-free so Vitest drives
// it directly: the controller feeds it plain numbers.
//
// Space conventions mirror window_drag.ts and Hud.setWindowPixelPosition:
// pointer clientX/clientY and getBoundingClientRect() arrive in *visual* (zoomed)
// space, while style.width/height are author lengths the browser multiplies by
// the #ui `zoom`. Corner hit-testing happens in visual space (rect + pointer +
// band all visual); the size math happens in author space (the controller
// divides by the live UI scale before calling resizedWindowSize).

/** SE-corner hit band, author px (fine pointer). */
export const RESIZE_CORNER_BAND = 18;
/** SE-corner hit band, author px (coarse/touch pointer; WCAG 2.5.8 >=24px). */
export const RESIZE_CORNER_BAND_TOUCH = 28;
/** Smallest size a window can be dragged down to, author px. */
export const WINDOW_MIN_WIDTH = 220;
export const WINDOW_MIN_HEIGHT = 140;
/** Viewport edge margin a resize keeps clear, author px (matches the drag clamp). */
export const WINDOW_RESIZE_MARGIN = 8;
/** Pointer travel (visual px) before a corner press becomes a resize: a bare
 *  tap or click in the band must leave the window completely untouched. */
export const RESIZE_ENGAGE_SLOP = 4;
/** Touch engage travel (visual px). Finger tap wobble runs well past the mouse
 *  slop (browsers budget roughly 10px of internal tap slop for exactly this),
 *  and the value is visual space, so at uiScale 1.4 it is only ~7 author px; a
 *  plain corner tap must never freeze the window's CSS-managed size. */
export const RESIZE_ENGAGE_SLOP_TOUCH = 10;

/** Which corner a resize drags: the shared SE grip, or the NW grip a
 *  bottom-anchored window carries (it grows up and left, keeping its bottom-right
 *  corner where it is). */
export type ResizeCorner = 'se' | 'nw';

export interface CornerRect {
  right: number;
  bottom: number;
}

export interface TopLeftCornerRect {
  left: number;
  top: number;
}

/**
 * True when a pointer falls inside the window's SE resize corner. All inputs
 * share one coordinate space (the controller passes visual-space values, with
 * the band pre-multiplied by the UI scale). The OUTER-edge checks (x <= right,
 * y <= bottom) are load-bearing: the controller passes the CLIENT-box corner,
 * so a pointer between it and the border box (the classic scrollbar gutter)
 * must miss, or grabbing the scrollbar thumb near the bottom would start a
 * resize instead of a scroll. Do not simplify them away.
 */
export function isInResizeCorner(rect: CornerRect, x: number, y: number, band: number): boolean {
  return x >= rect.right - band && y >= rect.bottom - band && x <= rect.right && y <= rect.bottom;
}

/**
 * True when a pointer falls inside the window's NW resize corner, the mirror of
 * isInResizeCorner: the controller passes the CLIENT-box top-left, so the
 * border itself stays outside the band.
 */
export function isInTopLeftResizeCorner(
  rect: TopLeftCornerRect,
  x: number,
  y: number,
  band: number,
): boolean {
  return x >= rect.left && y >= rect.top && x <= rect.left + band && y <= rect.top + band;
}

export interface ResizeSessionStart {
  /** Window position + size at pointerdown, author px. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ResizeLimits {
  /** Viewport size, author px. */
  viewportWidth: number;
  viewportHeight: number;
  minWidth: number;
  minHeight: number;
  margin: number;
}

/**
 * New window size for a pointer drag of (dx, dy) author px from the session
 * start. Clamped to [min, viewport - position - margin]; when the window sits
 * so close to the edge that even the minimum would overflow, the minimum wins
 * (the shell CSS max-width/max-height still visually clamps the overflow).
 */
export function resizedWindowSize(
  start: ResizeSessionStart,
  dx: number,
  dy: number,
  limits: ResizeLimits,
): { width: number; height: number } {
  const maxWidth = Math.max(limits.minWidth, limits.viewportWidth - start.left - limits.margin);
  const maxHeight = Math.max(limits.minHeight, limits.viewportHeight - start.top - limits.margin);
  return {
    width: Math.round(Math.min(maxWidth, Math.max(limits.minWidth, start.width + dx))),
    height: Math.round(Math.min(maxHeight, Math.max(limits.minHeight, start.height + dy))),
  };
}

/**
 * New window box for a pointer drag of (dx, dy) author px on the given corner.
 * The SE corner keeps left/top and defers to resizedWindowSize. The NW corner
 * keeps the bottom-right corner fixed: dragging up or left grows the window,
 * clamped so the new top-left stays `margin` inside the viewport, and the same
 * minimum-size floor applies.
 */
export function resizedWindowRect(
  start: ResizeSessionStart,
  dx: number,
  dy: number,
  corner: ResizeCorner,
  limits: ResizeLimits,
): { left: number; top: number; width: number; height: number } {
  if (corner === 'se') {
    return { left: start.left, top: start.top, ...resizedWindowSize(start, dx, dy, limits) };
  }
  const right = start.left + start.width;
  const bottom = start.top + start.height;
  const maxWidth = Math.max(limits.minWidth, right - limits.margin);
  const maxHeight = Math.max(limits.minHeight, bottom - limits.margin);
  const width = Math.round(Math.min(maxWidth, Math.max(limits.minWidth, start.width - dx)));
  const height = Math.round(Math.min(maxHeight, Math.max(limits.minHeight, start.height - dy)));
  return { left: right - width, top: bottom - height, width, height };
}
