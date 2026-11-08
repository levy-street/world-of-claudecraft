// Which press target starts a window drag (the `isDragHandle` dep Hud hands to
// window_drag.ts). A window drags by its own .panel-title; the world map has no
// title bar, so it drags by its --window-pad band, the only surface where the
// press target is the window itself (both its panes inset by that pad, see the
// map block in src/styles/components.css). Controls, draggable items, the map
// canvas (which pans) and its zoom cluster never start a drag. Moved out of
// hud.ts.
//
// A window docked into a touch split (bags beside the vendor, bank, market,
// character sheet or trade window) never drags. Its dock geometry is
// !important in src/styles/hud.mobile.css so it wins over the inline spot a
// touch drag left on it, and that spot is what the window returns to once it
// is standalone again; dragging the docked window would overwrite it. The dock
// rules declare --window-docked: 1, read per press because the dock classes
// toggle at runtime.
const NEVER_DRAG_SELECTOR =
  'button, input, textarea, select, a, .x-btn, .ui-dd, [draggable="true"], #map-canvas, #map-zoom';

export function isWindowDragHandle(target: HTMLElement, win: HTMLElement): boolean {
  if (target.closest(NEVER_DRAG_SELECTOR)) return false;
  if (isDockedOnTouch(win)) return false;
  const title = target.closest('.panel-title');
  if (title && win.contains(title)) return true;
  return win.id === 'map-window' && target === win;
}

/** True while a touch split docks this window (the CSS marker above). Only
 *  read on the touch layout, so the desktop press path never pays for a
 *  computed-style read. */
function isDockedOnTouch(win: HTMLElement): boolean {
  const doc = win.ownerDocument;
  if (!doc?.body?.classList.contains('mobile-touch')) return false;
  const view = doc.defaultView;
  return view?.getComputedStyle(win).getPropertyValue('--window-docked').trim() === '1';
}
