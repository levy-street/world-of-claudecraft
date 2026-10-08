// The world map canvas backing size for a resizable map window. DOM-free, so
// a Vitest drives it with plain numbers; map_canvas_size_controller.ts feeds it
// the content box a ResizeObserver reports for the map canvas.
//
// The map has always drawn 1:1 in author space: a 560 px display box over a
// 560 px backing store, with the #ui zoom (var(--ui-scale)) scaling both. A
// resized window keeps that contract, so the backing side is the displayed
// side in author px. ResizeObserver's content box is already in author px
// under an ancestor zoom (measured in Chromium: a 200 px box under zoom 1.5
// reports 200, while getBoundingClientRect reports 300), so no scale enters
// here. Painters take the side as a parameter (canvasSize) and hit-testing
// reads backing-per-client ratios, so neither needs to know the window was
// resized.

/** The shipped backing side (index.html / play.html). */
export const MAP_CANVAS_DEFAULT_SIDE = 560;
/** Smallest backing side: below it the zone title and labels crowd the face. */
export const MAP_CANVAS_MIN_SIDE = 240;
/** Largest backing side: bounds the per-repaint fill cost of a huge window. */
export const MAP_CANVAS_MAX_SIDE = 1600;

/**
 * Backing side for a map canvas whose displayed content box is `width` x
 * `height` author px. The canvas is square, so the smaller axis wins. A box
 * that has not been laid out (zero or not a number, e.g. the window is hidden)
 * returns null: keep the current backing instead of collapsing it.
 */
export function mapCanvasBackingSide(width: number, height: number): number | null {
  const side = Math.min(width, height);
  if (!Number.isFinite(side) || side <= 0) return null;
  return Math.round(Math.min(MAP_CANVAS_MAX_SIDE, Math.max(MAP_CANVAS_MIN_SIDE, side)));
}
