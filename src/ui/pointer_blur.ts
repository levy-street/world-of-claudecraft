// Pointer-only blur for HUD chrome buttons, the fix for "Space reopens the last
// menu I clicked": a mouse click on a chrome button (micromenu, panel button,
// chat tab) leaves that button holding document focus indefinitely, because the
// game canvas is not focusable and never takes it back. The next Space keydown
// that escapes the game layer's preventDefault (any blocked-input state, see
// src/game/input.ts) then natively re-activates that stale button.
//
// The discriminator is UIEvent.detail: a click event with detail > 0 is
// pointer-driven (detail is the click count); keyboard activation (Space/Enter
// on a focused button) and programmatic el.click() dispatch with detail === 0.
// Blurring ONLY the pointer path keeps keyboard users' focus position intact,
// and keeps the focus-restore-to-trigger accessibility pattern working: a
// window opened by keyboard still records its opener (the focused trigger),
// while a window opened by mouse records no stale trigger (a rail click blurs
// to the body, so nothing is recorded; a click inside a dialog-rooted window
// records that window's root, see below), so closing it cannot re-plant stale
// focus on the trigger.
//
// WHERE the focus goes matters as much as dropping it. Inside a dialog-rooted
// window it is parked on the window's root, not dropped to the body:
// markDialogRoot (src/ui/dialog_root.ts) stamps tabindex="-1" on every root, so
// the root is programmatically focusable without ever being a Tab stop, and
// FocusManager's Tab trap (src/ui/focus_manager.ts) cycles only while focus is
// INSIDE the trapped root, so a blur to the body would silently disarm the trap
// on the mouse path and Tab would walk out of the window. A root is a DIV, so
// neither native Space activation nor the blocked-state guard in
// src/game/stale_chrome_focus.ts ever touches it. Chrome outside every dialog
// root (the micromenu rail, the trackers, the chat tabs) blurs to the body.
//
// Ordering for blurIfPointerClick callers: drop the focus BEFORE a select
// handler that rebuilds the strip (tab_strip_painter.ts): once the clicked node
// is detached, closest() can no longer find the root to park on and focus has
// already fallen to the body. An in-place restyle (the chat tabs) may go either
// way. The delegated bindPointerBlur form always runs first, in the capture
// phase. The older unconditional `btn.blur()` idiom on the hotbar (hud.ts)
// predates this module and also drops keyboard activations; this pointer-only
// form is the canonical one for new chrome.
//
// Host-agnostic on purpose (no browser globals, everything reached off the
// passed event/elements), so it stays in the default architecture bucket and
// unit-tests in plain Node against hand-rolled fakes.

/** A click event as far as this module needs it. */
export interface ClickLike {
  detail: number;
  target: unknown;
}

/** The slice of an element the focus-drop path touches. `closest` is optional so a
 *  minimal fake, or a node already detached by a rebuild, degrades to a plain blur. */
export interface BlurrableEl {
  blur(): void;
  closest?(selector: string): unknown;
}

/** A dialog root that can take the parked focus (the markDialogRoot contract). */
interface DialogRootEl {
  hasAttribute(name: string): boolean;
  focus(options?: { preventScroll?: boolean }): void;
}

/** The root selector pointer focus is parked on; kept to role=dialog, the shape
 *  markDialogRoot stamps together with the tabindex the park depends on. */
export const POINTER_FOCUS_PARK_SELECTOR = '[role="dialog"]';

function asDialogRoot(x: unknown): DialogRootEl | null {
  if (!x || typeof x !== 'object') return null;
  const root = x as Partial<DialogRootEl>;
  return typeof root.focus === 'function' && typeof root.hasAttribute === 'function'
    ? (root as DialogRootEl)
    : null;
}

function asBlurrable(x: unknown): BlurrableEl | null {
  return x && typeof (x as BlurrableEl).blur === 'function' ? (x as BlurrableEl) : null;
}

/** Drop pointer-driven focus from `el`: park it on the enclosing dialog root when
 *  that root is programmatically focusable (markDialogRoot's tabindex="-1"), which
 *  keeps a FocusManager trap on the window armed; otherwise blur to the body. */
export function dropPointerFocus(el: BlurrableEl): void {
  const root = asDialogRoot(el.closest?.(POINTER_FOCUS_PARK_SELECTOR));
  if (root && (root as unknown) !== el && root.hasAttribute('tabindex')) {
    root.focus({ preventScroll: true });
    return;
  }
  el.blur();
}

/** Drop focus from `el` when the click that activated it was pointer-driven (mouse,
 *  touch, pen); leave keyboard and programmatic activations focused. */
export function blurIfPointerClick(e: ClickLike, el: BlurrableEl | null | undefined): void {
  if (e.detail > 0 && el) dropPointerFocus(el);
}

/** The slice of a root element the delegated forms bind to. */
export interface ListenerHost {
  addEventListener(
    type: string,
    listener: (e: Event) => void,
    options?: boolean | { capture?: boolean },
  ): void;
}

/** Delegated pointer-only focus drop for every `selector` match inside `container`.
 *  Capture phase on purpose: the drop lands BEFORE the button's own click
 *  handler runs, so a toggle that opens a window and records the current
 *  focused element as its return-focus opener (FocusManager.activeFocusable)
 *  sees no stale button on the mouse path. Keyboard activation (detail 0) is
 *  untouched, so the opener capture and focus-restore still work for it. */
export function bindPointerBlur(container: ListenerHost, selector = 'button'): void {
  container.addEventListener(
    'click',
    (e) => {
      const click = e as unknown as ClickLike;
      if (click.detail <= 0) return;
      const target = click.target as { closest?(selector: string): unknown } | null;
      const hit = asBlurrable(target?.closest?.(selector));
      if (hit) dropPointerFocus(hit);
    },
    true,
  );
}

/** Keep Enter/Space activation of a focused chrome button native: stop the
 *  keydown from bubbling to the window-level game keybinds (Enter is Open
 *  Chat, Space is preventDefault-ed for jump), WITHOUT preventing the default,
 *  so the button's own activation still fires for keyboard users. This is the
 *  panel-guard contract that already protects the delve board, map, bank and
 *  bags panels in hud.ts, shared so the micromenu rail takes the same one. */
export function bindChromeButtonKeyGuard(container: ListenerHost): void {
  container.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    const target = ke.target as { tagName?: string } | null;
    if (target?.tagName !== 'BUTTON') return;
    if (ke.key === 'Enter' || ke.key === ' ' || ke.code === 'Space') ke.stopPropagation();
  });
}
