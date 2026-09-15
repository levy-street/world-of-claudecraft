// Pure "grab the paper" pan for the world-map window: the world point under
// the cursor at pointerdown stays under it while the pointer moves. DOM-free
// (registered in UI_PURE_CORES); the HUD feeds it the drag start, the painted
// view's world span, and the canvas' client size.

/** The pointer and map-centre positions captured at pointerdown. */
export interface MapDragStart {
  px: number;
  py: number;
  cx: number;
  cz: number;
}

/**
 * The map centre after dragging from `drag` to (clientX, clientY). The map
 * projection draws +X to the left and +Z up (mx = (maxX - x) / span,
 * my = (maxZ - z) / span), so a cursor delta of (dx, dy) px shifts the centre
 * by (+dx, +dy) world units on each axis, scaled by world units per CSS pixel.
 */
export function mapDragPanCenter(
  drag: MapDragStart,
  span: { spanX: number; spanZ: number },
  canvas: { width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; z: number } {
  const wppx = span.spanX / canvas.width;
  const wppy = span.spanZ / canvas.height;
  return {
    x: drag.cx + (clientX - drag.px) * wppx,
    z: drag.cz + (clientY - drag.py) * wppy,
  };
}
