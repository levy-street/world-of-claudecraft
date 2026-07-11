// Pure DOM predicate: is `target` a drag handle for the floating window `win`?
//
// Extracted from Hud so the recognition rule is unit-testable without a live Hud
// (it needs no Hud state: only the two elements). Two window grammars share one
// move system: the legacy floating windows carry a `.panel-title` header, and the
// AAA grammar-built windows (src/ui/window_frame.ts) carry a `.window-titlebar`.
// Both are drag handles, so every grammar-built window inherits the Market's
// draggability.
//
// An interactive control inside the header never starts a drag (so the close
// button, a titlebar dropdown, or a future titlebar input keeps its own click),
// and #map-window is the one headerless window: its whole body is the handle.

// Controls that keep their own pointer interaction: dragging one of these never
// starts a window move, even when it sits inside the titlebar.
const DRAG_HANDLE_EXCLUDE =
  'button, input, textarea, select, a, .x-btn, .ui-dd, [draggable="true"], #map-canvas, #map-zoom';

// The two header grammars that act as a move handle: the legacy `.panel-title`
// and the AAA `.window-titlebar` (window_frame.ts).
const DRAG_HANDLE_SELECTOR = '.panel-title, .window-titlebar';

// Static, centered, transient dialogs that share a header grammar with the
// movable windows but must never move: quest/gossip and confirm prompts are
// modal question-and-answer surfaces, the delve board / rite / lockpick popups
// are short-lived interaction sheets, the loot window is cursor-anchored, and
// the report dialog is a one-shot form. The deliberately movable windows
// (bags, character, vendor, market, the Codex, ...) stay off this list. The
// sibling per-window opt-out for resizing is NON_RESIZABLE_WINDOW_IDS
// (window_resize.ts); this is the drag twin. Exported because the Hud's
// placeNewWindow consumes the same ruling: a never-moves dialog must not be
// cascade-offset either (the 28px cascade bakes a session-sticky windowMoved
// position the player now has no drag to recover from).
export const STATIC_DIALOG_WINDOW_IDS = new Set([
  'quest-dialog',
  'confirm-dialog',
  'delve-board',
  'lockpick-panel',
  'delve-rite-panel',
  'loot-window',
  'report-window',
]);

/**
 * True when a pointerdown on `target` should begin dragging `win`.
 *
 * Returns false on the touch HUD (body.mobile-touch): every mobile window is
 * full-screen, edge-pinned, or docked by CSS (the vendor/bags 50/50 dock, the
 * bank pairing, the inset sheets in src/styles/hud.mobile.css), and a drag would
 * bake an inline position + windowMoved that beats those layouts for the rest of
 * the session; this is the same disease placeNewWindow's mobile bail guards
 * against (hud.ts, issue 1577), applied to the drag write.
 *
 * Also returns false for every STATIC_DIALOG_WINDOW_IDS window: a static,
 * centered, transient dialog shares its header grammar with the movable
 * windows but must never move (maintainer direction from the fix round).
 *
 * Otherwise returns false for any excluded interactive control (so the close
 * button never drags), true when the target is within a `.panel-title` /
 * `.window-titlebar` that belongs to `win`, and true for the headerless
 * #map-window body. #options-menu (the Warden's Codex) now drags by its
 * titlebar like every other grammar window (maintainer direction supersedes the
 * esc-menu-redesign spec section 2 fixed-window ruling).
 */
export function isWindowDragHandle(target: HTMLElement, win: HTMLElement): boolean {
  if (target.ownerDocument.body.classList.contains('mobile-touch')) return false;
  if (STATIC_DIALOG_WINDOW_IDS.has(win.id)) return false;
  if (target.closest(DRAG_HANDLE_EXCLUDE)) return false;
  const handle = target.closest(DRAG_HANDLE_SELECTOR);
  if (handle && win.contains(handle)) return true;
  return win.id === 'map-window' && target === win;
}
