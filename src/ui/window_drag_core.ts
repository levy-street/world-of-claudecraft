// Pure geometry for the shared desktop window drag controller. Pointer coordinates
// arrive in visual space, while the positioned HUD windows use author lengths under
// the live #ui zoom. Keeping this conversion here lets the DOM controller move a
// window without reading layout during pointermove.

export const WINDOW_DRAG_MARGIN = 8;

export interface WindowDragPointer {
  pointerX: number;
  pointerY: number;
  grabOffsetX: number;
  grabOffsetY: number;
}

export interface WindowDragBounds {
  scale: number;
  viewportWidth: number;
  viewportHeight: number;
  windowWidth: number;
  windowHeight: number;
  margin?: number;
}

export interface WindowDragPosition {
  left: number;
  top: number;
}

export function draggedWindowPosition(
  pointer: WindowDragPointer,
  bounds: WindowDragBounds,
): WindowDragPosition {
  const scale = Math.max(Number.EPSILON, bounds.scale);
  const margin = bounds.margin ?? WINDOW_DRAG_MARGIN;
  const width = Math.min(bounds.windowWidth, bounds.viewportWidth - margin * 2);
  const height = Math.min(bounds.windowHeight, bounds.viewportHeight - margin * 2);
  const maxLeft = Math.max(margin, bounds.viewportWidth - width - margin);
  const maxTop = Math.max(margin, bounds.viewportHeight - height - margin);
  const left = (pointer.pointerX - pointer.grabOffsetX) / scale;
  const top = (pointer.pointerY - pointer.grabOffsetY) / scale;
  return {
    left: Math.max(margin, Math.min(maxLeft, left)),
    top: Math.max(margin, Math.min(maxTop, top)),
  };
}
