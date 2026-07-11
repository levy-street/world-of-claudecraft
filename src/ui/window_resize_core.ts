// Pure geometry for the shared window-resize affordance (the south-east corner
// grip every movable .window.panel gets from src/ui/window_resize.ts). DOM-free
// so Vitest drives it directly: the controller feeds it plain numbers.
//
// Space conventions mirror the drag logic in hud.ts (setWindowPixelPosition):
// pointer clientX/clientY and getBoundingClientRect() arrive in *visual* (zoomed)
// space, while style.width/height are author lengths the browser multiplies by
// the #ui `zoom`. Corner hit-testing happens in visual space (rect + pointer +
// band all visual); the size math happens in author space (the controller
// divides by the live UI scale before calling resizedWindowSize).

/** SE-corner hit band, author px (fine pointer). */
export const RESIZE_CORNER_BAND = 18;
/** SE-corner hit band, author px (coarse/touch pointer; WCAG 2.5.8 >=24px). */
export const RESIZE_CORNER_BAND_TOUCH = 28;
/** Smallest size a window can be dragged down to, author px. The floor leaves
 *  every resizable window's whole chrome reachable at the minimum: titlebar +
 *  any tab rail + at least one content row + its primary action (live PR #1736
 *  feedback: a framed window could be dragged so small its actions vanished).
 *  The delve board carries the tallest fixed chrome (name, marks, two
 *  requirement lines, and the DELVE/SHOP tab rail, ~200px) before its scrolling
 *  body, so 300px clears that plus a shop row + Buy; 260px keeps an item row
 *  (icon + truncated name + Buy) legible. Both stay below the narrowest default
 *  window width (the social panel, 348px), so the floor only bounds shrinking
 *  and never makes a window open or first-resize oddly. */
export const WINDOW_MIN_WIDTH = 260;
export const WINDOW_MIN_HEIGHT = 300;
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

export interface CornerRect {
  right: number;
  bottom: number;
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
