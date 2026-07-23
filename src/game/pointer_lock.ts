import { detectBrowserEngine } from './browser_env';

// Pure decision logic for engaging/releasing the pointer lock used by mouse
// camera rotation. Kept DOM-free so it unit-tests in isolation (the same
// pattern as click_move.ts / pointer_pick.ts).
//
// Why this exists: camera rotation integrates relative mouse deltas
// (movementX/movementY). Without pointer lock the OS cursor is free to leave
// the window, so it hits the monitor edge (movementX clamps to 0, the camera
// freezes) or slips onto a second display. Locking the pointer while a drag is
// active keeps every delta flowing and the cursor pinned to the canvas.

export interface PointerLockEngageInput {
  /** The "Lock cursor while rotating" setting (default on). */
  lockOnRotate: boolean;
  /**
   * Browser fullscreen. Kept in the input shape so callers/tests can assert
   * that fullscreen follows the same lock path as windowed play.
   */
  isFullscreen: boolean;
  /** Whether the canvas already holds the pointer lock. */
  alreadyLocked: boolean;
}

/**
 * True when a newly-active camera drag should request pointer lock. Applies to
 * both camera modes (classic right-drag and OSRS-style Mouse Camera): the only
 * reasons to skip are the setting being off or the canvas already holding lock.
 */
export function shouldEngagePointerLock(input: PointerLockEngageInput): boolean {
  return input.lockOnRotate && !input.alreadyLocked;
}

/**
 * Firefox denies `Element.requestPointerLock()` unless the call happens
 * synchronously inside the handler for the genuine user gesture itself
 * (mousedown), not a later `mousemove` once a drag threshold is crossed, even
 * though that `mousemove` still fires within the lingering "transient
 * activation" window a mousedown grants. Its own error message says so
 * verbatim: "was not called from inside a short running user-generated event
 * handler, and the document is not in full screen." Chromium is lenient here
 * (it happily consumes the lingering activation from the deferred call), so
 * only Firefox needs the synchronous-on-mousedown path.
 */
export function pointerLockNeedsSyncGesture(userAgent: string): boolean {
  return detectBrowserEngine(userAgent).engine === 'gecko';
}

export interface PointerLockMouseDownInput {
  /** The button that was just pressed. */
  button: number;
  /**
   * The button bound to click-to-move, or null if unbound. Camera drag can be
   * started by EITHER left (0) or right (2), in either camera mode (see
   * `input.ts`'s `onMouseMove`, which gates the drag threshold on
   * `leftDown || rightDown`, not a single button): the sync-engage decision
   * below must cover both, not just the active camera mode's "look" button.
   */
  clickMoveButton: 0 | 2 | null;
  /** From {@link pointerLockNeedsSyncGesture}. */
  needsSyncGesture: boolean;
  /** The "Lock cursor while rotating" setting (default on). */
  lockOnRotate: boolean;
  /** Whether the canvas already holds the pointer lock. */
  alreadyLocked: boolean;
}

/**
 * True when pointer lock should be requested synchronously from the mousedown
 * handler itself, ahead of any drag-threshold check. Only applies on browsers
 * that require the call to happen inside the original gesture handler
 * ({@link pointerLockNeedsSyncGesture}), and only for a button that can start
 * a camera drag (left or right; see {@link PointerLockMouseDownInput}).
 *
 * The click-to-move button is excluded outright, not just under the 280ms
 * click threshold (`DEFAULT_CLICK_PICK_MAX_MS`): at mousedown time we cannot
 * yet know whether the press will resolve as a plain click or a drag, and
 * requesting the lock on every press of that button reintroduces the #116
 * banner-flicker bug for its ordinary clicks (loot/target/interact, or
 * click-to-move itself). A genuine drag started on the click-to-move button
 * still falls back to the deferred `mousemove` request, which Firefox denies
 * outside fullscreen, so on Firefox that one drag start stays unfixed: an
 * accepted trade-off (see `input.ts`'s mousedown comment). A press that
 * turns out to be a plain click on a non-click-to-move button still releases
 * the lock on mouseup via {@link shouldReleasePointerLock}.
 */
export function shouldEngagePointerLockOnMouseDown(input: PointerLockMouseDownInput): boolean {
  return (
    input.needsSyncGesture &&
    (input.button === 0 || input.button === 2) &&
    input.button !== input.clickMoveButton &&
    input.lockOnRotate &&
    !input.alreadyLocked
  );
}

/**
 * Cooldown Firefox enforces after it force-unlocks the pointer through its own
 * default gesture (the Escape key, or the tab losing focus) rather than
 * through our own `exitPointerLock()` call: a `requestPointerLock()` made
 * during this window is denied outright, even with fresh transient
 * activation from the very mousedown that would otherwise satisfy
 * {@link pointerLockNeedsSyncGesture} (Mozilla bugzilla 1284785; the exact
 * duration is undocumented upstream, this is an empirically safe upper
 * bound). Chromium does not reproduce this denial in practice, so it is
 * gated on Gecko the same way the sync-gesture requirement is.
 */
export const POINTER_LOCK_FORCED_UNLOCK_COOLDOWN_MS = 1300;

export interface PointerLockForcedCooldownInput {
  /** From {@link pointerLockNeedsSyncGesture}: true only on Gecko. */
  needsSyncGesture: boolean;
  /**
   * Milliseconds since the pointer was last force-unlocked by the browser
   * itself (Escape / focus loss) while a drag button was still held, or null
   * if that has not happened yet this session.
   */
  msSinceForcedUnlock: number | null;
}

/**
 * True while a fresh `requestPointerLock()` call is known to be doomed. A
 * player who presses Escape mid-drag (to open the game menu, or just out of
 * confusion when the cursor feels stuck) force-unlocks the pointer while
 * still physically holding the mouse button; the very next drag attempt on
 * Firefox then lands inside this cooldown and is silently denied, leaving
 * `pointerLockRequestedForDrag` wrongly set with no lock actually granted and
 * the camera freezing again the moment the cursor reaches an edge. Callers
 * skip the doomed request during this window and let the drag continue
 * unlocked instead: rotation still works away from the screen edge, so this
 * only defers the anti-freeze guarantee rather than losing rotation outright.
 */
export function inForcedPointerLockCooldown(input: PointerLockForcedCooldownInput): boolean {
  return (
    input.needsSyncGesture &&
    input.msSinceForcedUnlock !== null &&
    input.msSinceForcedUnlock < POINTER_LOCK_FORCED_UNLOCK_COOLDOWN_MS
  );
}

export interface PointerLockReleaseInput {
  /** Any camera-rotation mouse button still held. */
  anyButtonDown: boolean;
  /** Whether the canvas currently holds the pointer lock. */
  hasLock: boolean;
}

/**
 * True when the pointer lock should be released: the drag has ended (no button
 * held) and we still hold the lock. Releasing here returns the OS cursor
 * between drags so target/loot/UI clicking is unaffected.
 */
export function shouldReleasePointerLock(input: PointerLockReleaseInput): boolean {
  return !input.anyButtonDown && input.hasLock;
}
