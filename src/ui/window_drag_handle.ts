// Which press target starts a window drag (the `isDragHandle` dep Hud hands to
// window_drag.ts). A window drags by its own .panel-title; the world map has no
// title bar, so it drags by its --window-pad band, the only surface where the
// press target is the window itself (both its panes inset by that pad, see the
// map block in src/styles/components.css). Controls, draggable items, the map
// canvas (which pans) and its zoom cluster never start a drag. Moved out of
// hud.ts unchanged.
const NEVER_DRAG_SELECTOR =
  'button, input, textarea, select, a, .x-btn, .ui-dd, [draggable="true"], #map-canvas, #map-zoom';

export function isWindowDragHandle(target: HTMLElement, win: HTMLElement): boolean {
  if (target.closest(NEVER_DRAG_SELECTOR)) return false;
  const title = target.closest('.panel-title');
  if (title && win.contains(title)) return true;
  return win.id === 'map-window' && target === win;
}
