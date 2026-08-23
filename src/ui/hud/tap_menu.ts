// The three host-reaching halves of tap mode (settings.touchTapMenus): reading
// the setting live, the tap-outside dismissal every sticky menu shares, and the
// registry Hud's single Escape dispatcher asks. The RULES live in
// tap_menu_core.ts; this module holds only what needs a browser. Registered in
// tests/architecture.test.ts UI_DOM_MODULES.
//
// All three exist once rather than three times: the action radial, the
// consumables row and the menu strip must agree about what tap mode is, and a
// per-controller copy of any half is how they would stop agreeing.

import { SETTINGS_CHANGE_EVENT, Settings } from '../../game/settings';

/** The cached flag, or null while it has to be read back from the store. */
let tapMenus: boolean | null = null;
/** Whether the invalidation listener is armed (once per document, not per read). */
let watching = false;

/**
 * Whether tap mode is on, read at press time.
 *
 * CACHED, because this runs at the head of a combat-critical press on the ring,
 * the seat and the menu control: constructing a Settings rebuilds every numeric
 * and boolean setting from a localStorage read plus a JSON.parse, which is the
 * most expensive possible way to answer one boolean and can stall the first
 * frame of a swipe on a slow device. The options row must still take effect
 * without a reload, so the cache is dropped on every persisted settings write
 * (Settings.save broadcasts SETTINGS_CHANGE_EVENT) rather than trusted forever.
 * With no window to listen on (a Node test), nothing is cached and every call
 * reads fresh, which keeps the old semantics exactly where they were relied on.
 */
export function tapMenusEnabled(): boolean {
  if (typeof window === 'undefined') return new Settings().get('touchTapMenus');
  if (!watching) {
    watching = true;
    window.addEventListener(SETTINGS_CHANGE_EVENT, () => {
      tapMenus = null;
    });
  }
  if (tapMenus === null) tapMenus = new Settings().get('touchTapMenus');
  return tapMenus;
}

/**
 * Dismiss an open tap-mode menu when the next press lands outside it.
 *
 * CAPTURE phase on the document, which is what keeps this from swallowing the
 * very press that opened the menu: the listener is added while that press is
 * being dispatched at the control, by which point the document's capture step has
 * already passed, so the event cannot reach a listener registered here. The
 * `inside` check then covers every later press on the control or its own items.
 *
 * Returns the disarm function; call it when the menu closes, from any path.
 */
export function armTapMenuOutsideDismiss(
  inside: () => readonly (HTMLElement | null | undefined)[],
  onOutside: () => void,
): () => void {
  const onDown = (e: Event) => {
    const target = e.target as Node | null;
    if (target !== null && inside().some((el) => el?.contains(target))) return;
    onOutside();
  };
  document.addEventListener('pointerdown', onDown, true);
  return () => document.removeEventListener('pointerdown', onDown, true);
}

/** Every touch gesture menu that can be showing, in build order. */
const menus: (() => boolean)[] = [];

/**
 * Register a gesture menu's key-driven closer. Called once per menu at build.
 *
 * The registry exists so Escape stays with Hud's single `closeAll` dispatcher
 * (the a11y contract) without Hud knowing any of the three menus by name: a
 * keyboard or Switch Control user who opened a sticky row had no key-driven way
 * out at all before it.
 */
export function registerTouchMenu(close: () => boolean): void {
  menus.push(close);
}

/**
 * Close whichever registered touch menu is showing, reporting whether anything
 * closed. Every menu is asked rather than only the first: two cannot be open at
 * once today (each dismisses on an outside press, and a pick closes its own),
 * and a closed menu answers false, so asking all of them costs nothing and
 * cannot leave a second one stranded if that ever changes.
 */
export function closeOpenTouchMenu(): boolean {
  let closed = false;
  for (const close of menus) closed = close() || closed;
  return closed;
}
