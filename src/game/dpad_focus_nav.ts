// The DOM half of d-pad UI navigation: find the controls of the window the player
// is actually in, move focus between them with the pure spatial core, and press
// the focused one. `gamepad.ts` stays the thin poller and owns none of this.
//
// Scope matters more than the geometry here. Navigating every focusable element in
// the document would wander out of the open window and into the side rail, so the
// search starts at the top-most open dialog/panel and only falls back to the whole
// document when none is open.

import { type NavDirection, type NavRect, nextFocusIndex } from '../ui/dpad_nav_core';
import { FOCUSABLE_SELECTOR } from '../ui/focus_manager';

// The roots a pad player can be navigating, most specific first.
const WINDOW_SELECTOR = '[role="dialog"], .window.panel';

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

// While arranging, navigation must reach BOTH the spellbook and the bar: the whole
// act is carrying something from one to the other, and a window-scoped walk traps
// the player in whichever one they are standing in.
let spanWindows = false;

/**
 * Follow focus the INTERFACE moved, not just focus the pad moved.
 *
 * A window that advances its own contents focuses the control it wants next: the
 * quest dialog puts focus straight on Accept when a quest is opened. The pad knew
 * nothing about it, so the highlight and the cursor stayed where they were and the
 * player, seeing nothing selected, pressed a direction until something lit up.
 * Every one of those presses moved focus, which is what made reaching Accept feel
 * like spamming a stick at it.
 *
 * Answers whether it moved the mark, and no-ops when the pad already agrees, which
 * is every frame it moved focus itself.
 */
export function followDomFocus(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === marked || active === document.body) return false;
  // Only something the navigation could have reached itself: a window that focuses
  // its own text field should not drag the pointer onto it.
  if (!focusables(activeRoot() ?? document).includes(active)) return false;
  markPadFocus(active);
  return true;
}

/** Whether the pad is holding a HUD selection right now. The d-pad reads this to
 *  decide between walking the interface and cycling targets: once the player is
 *  IN the HUD the arrows belong to it, and cancelling hands them back. */
export function hasPadFocus(): boolean {
  return marked !== null;
}

/**
 * Step the selection to the next HUD control, wrapping at the end. This is the
 * "cycle HUD components" button a console MMO gives its interface, and it is the
 * way IN now that the bare d-pad cycles targets instead.
 */
export function cycleHudFocus(): boolean {
  if (typeof document === 'undefined') return false;
  const els = focusables(activeRoot() ?? document);
  if (els.length === 0) return false;
  const at = marked ? els.indexOf(marked) : -1;
  const next = els[(at + 1) % els.length];
  next.focus();
  markPadFocus(next);
  return true;
}

/** Whether the d-pad currently walks the whole document rather than one window. */
export function setPadNavSpansWindows(on: boolean): void {
  spanWindows = on;
}

/** The open window the d-pad should navigate inside, or null for the document. */
function activeRoot(): HTMLElement | null {
  if (spanWindows) return null;
  const open = [...document.querySelectorAll<HTMLElement>(WINDOW_SELECTOR)].filter(isVisible);
  // Last in document order is the most recently mounted, which is the one on top.
  return open.length > 0 ? open[open.length - 1] : null;
}

function focusables(root: HTMLElement | Document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (el) => !el.hasAttribute('disabled') && isVisible(el),
  );
}

/**
 * The control a surface should land on: the first one that is not the dismiss X.
 *
 * The same rule FocusManager.focusFirst already follows for the keyboard, applied
 * here because the pad has its own focus-first path. Landing on the close button
 * is worse than landing nowhere: the quest dialog advancing to its accept page put
 * the selection on the X, so the player had to walk off it every single time and
 * a mistaken press dismissed the thing they were reading.
 *
 * Falls back to the X when it is genuinely the only thing there.
 */
function firstMeaningful(els: readonly HTMLElement[]): HTMLElement | null {
  if (els.length === 0) return null;
  return els.find((el) => !el.hasAttribute('data-close')) ?? els[0];
}

function toRect(el: HTMLElement): NavRect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** Where the virtual cursor should sit after a focus move: the centre of the
 *  control that now has focus. */
export interface DpadFocusResult {
  x: number;
  y: number;
}

/**
 * Move focus one step in `dir`, answering the new focus centre so the caller can
 * SNAP the virtual cursor onto it. Focus alone is invisible on a pad: the player
 * is watching the cursor, so the two must travel together (and it keeps a press
 * at the cursor and a press on the focused control the same act).
 *
 * Answers null when nothing moved, so the caller can fall back to the free cursor.
 */
export function moveDpadFocus(dir: NavDirection): DpadFocusResult | null {
  // No DOM (headless env server, unit tests): nothing to navigate.
  if (typeof document === 'undefined') return null;
  const root = activeRoot() ?? document;
  const els = focusables(root);
  if (els.length === 0) return null;
  const active = document.activeElement as HTMLElement | null;
  const current = active ? els.indexOf(active) : -1;
  const next = nextFocusIndex(els.map(toRect), current, dir);
  if (next < 0 || next === current) return null;
  const el = els[next];
  el.focus();
  markPadFocus(el);
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Programmatic focus() does NOT satisfy the browser's :focus-visible heuristic,
// which only fires for input it judges keyboard-like. A pad player therefore sees
// no ring at all, which is indistinguishable from the navigation being broken. So
// the highlight is an explicit class rather than a pseudo-class we do not control.
const PAD_FOCUS_CLASS = 'pad-focus';
const CURSOR_ID = 'pad-cursor';
// The shipped arrow's hotspot, matching CURSOR_HAND in cursors.ts: the tip sits
// 7px right and 2px down from the image's own top-left corner.
const CURSOR_HOTSPOT_X = 7;
const CURSOR_HOTSPOT_Y = 2;
// How far inside the corner the tip sits, so it reads as pointing AT the control
// rather than balanced on its edge.
const CURSOR_INSET = 6;
let marked: HTMLElement | null = null;
let cursorEl: HTMLElement | null = null;

// The pointer graphic that rides the selection. A console MMO still SHOWS a
// cursor under gamepad control (FFXIV anchors one to the selected element); what
// it does not do is make you steer it. So this is drawn by us, snapped to focus,
// and never free-moving. It is not the OS pointer, which a page cannot move.
function ensureCursor(): HTMLElement | null {
  if (cursorEl) return cursorEl;
  if (typeof document === 'undefined') return null;
  const el = document.createElement('div');
  el.id = CURSOR_ID;
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  cursorEl = el;
  return el;
}

// While the pad is driving the UI, the OS pointer is dead weight sitting wherever
// it was last left, so it is hidden. ANY real pointer movement brings it straight
// back (a mouse, or the Deck's trackpad, which emulates one) and stands the pad
// pointer down: whichever device the player just used is the one that shows.
const PAD_NAV_CLASS = 'pad-nav';
let padNavActive = false;
let pointerWatchAttached = false;

function watchForRealPointer(): void {
  if (pointerWatchAttached || typeof window === 'undefined') return;
  pointerWatchAttached = true;
  window.addEventListener(
    'mousemove',
    () => {
      if (padNavActive) setPadCursorMode(false);
    },
    { passive: true },
  );
}

function setPadCursorMode(on: boolean): void {
  if (padNavActive === on) return;
  padNavActive = on;
  try {
    document.body.classList.toggle(PAD_NAV_CLASS, on);
  } catch {
    /* no DOM */
  }
  if (!on && cursorEl) cursorEl.style.display = 'none';
}

function markPadFocus(el: HTMLElement): void {
  if (marked !== el) {
    marked?.classList.remove(PAD_FOCUS_CLASS);
    el.classList.add(PAD_FOCUS_CLASS);
    marked = el;
  }
  const cursor = ensureCursor();
  if (!cursor) return;
  watchForRealPointer();
  setPadCursorMode(true);
  // Park the arrow's TIP just inside the selection's bottom-right corner. The
  // art points up and left (hotspot 7,2 in cursors.ts), so sitting at the
  // bottom-right aims it back INTO the element; at the top-left it would point
  // away into empty space. Offsetting by the hotspot puts the tip, not the
  // image's corner, where we mean it.
  const r = el.getBoundingClientRect();
  cursor.style.left = `${r.right - CURSOR_HOTSPOT_X - CURSOR_INSET}px`;
  cursor.style.top = `${r.bottom - CURSOR_HOTSPOT_Y - CURSOR_INSET}px`;
  cursor.style.display = 'block';
}

/**
 * Put the highlight and the pointer back on whatever holds focus now, for the
 * moment a window closes. The element to return to is NOT tracked here: the HUD's
 * shared FocusManager already records each window's opener and refocuses it on
 * release, so this only has to follow the focus that restore produced. Keeping one
 * opener stack (and not a second pad-only one) is why closing a window lands the
 * cursor where the player left it rather than back in the middle.
 *
 * Answers false when there is nothing sensible to return to (the window was opened
 * from the world, or nothing restored focus), leaving the caller to clear instead.
 */
export function restorePadFocus(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return false;
  // Checked against the DOCUMENT, never activeRoot(): what focus came back to sits
  // OUTSIDE the window that just closed (that is what "the opener" means), so
  // scoping this to the top-most window would reject every legitimate return.
  if (!focusables(document).includes(active)) return false;
  markPadFocus(active);
  return true;
}

/**
 * Drop the highlight and park the pointer when the pad leaves UI navigation.
 *
 * BLURS as well as unmarks. Hiding the cursor alone left the element still
 * focused, so a confirm pressed afterwards opened whatever the cursor had been
 * sitting on: the selection looked gone and was not.
 */
export function clearPadFocus(): void {
  if (marked) {
    marked.classList?.remove(PAD_FOCUS_CLASS);
    marked.blur?.();
  }
  marked = null;
  setPadCursorMode(false);
}

/**
 * Land focus on the first control of a newly opened window, so a pad player does
 * not have to press a direction just to get in. Answers false when no window is
 * open or it holds nothing focusable, which leaves the pointer alone.
 *
 * Deliberately requires a real window rather than falling back to the document:
 * auto-focusing the whole page on any state change would yank focus around the
 * HUD instead of landing inside the thing that just opened.
 */
let lastRoot: HTMLElement | null = null;

export function focusFirstInWindow(): boolean {
  lastRoot = null; // force the next sync to treat this as a fresh surface
  return syncWindowFocus();
}

/**
 * Keep focus inside whatever surface is on top. Moves focus when the top-most
 * window CHANGES (a dialogue opening the quest window over itself: there is no
 * open/close edge to catch, the pad is already in a window) or when the focused
 * control has gone (the surface rebuilt its contents under us). Otherwise it
 * leaves the player's selection exactly where they put it.
 */
export function syncWindowFocus(): boolean {
  if (typeof document === 'undefined') return false;
  const root = activeRoot();
  const rootChanged = root !== lastRoot;
  lastRoot = root;
  if (!root) return false;
  const els = focusables(root);
  if (els.length === 0) return false;
  const active = document.activeElement as HTMLElement | null;
  const focusLost = !active || !els.includes(active);
  if (!rootChanged && !focusLost) return false;
  const landing = firstMeaningful(els);
  if (!landing) return false;
  landing.focus();
  markPadFocus(landing);
  return true;
}

/** Press whatever the d-pad has focused. Answers false when nothing is focused,
 *  so the caller can fall back to clicking at the free cursor instead. */
export function pressDpadFocus(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return false;
  const root = activeRoot() ?? document;
  // Only press something the navigation itself could have reached: an unrelated
  // element holding focus (a chat input) must not be clicked by the A button.
  if (!focusables(root).includes(active)) return false;
  active.click();
  return true;
}
