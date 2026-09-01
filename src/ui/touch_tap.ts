// Touch-safe tap binding for mobile HUD buttons.
//
// Browsers only synthesize compatibility mouse events (and the `click` that
// follows them) for the PRIMARY pointer. On a phone that means every button
// bound via `addEventListener('click', ...)` goes dead the moment another
// finger is down, and steering with the left thumb while tapping with the
// right is the DEFAULT way the game is played. This binds the touch path on
// raw pointer events instead: a tap is a touch pointerdown followed by a
// pointerup on the same element within TAP_SLOP_PX (touch pointers implicitly
// capture to their pointerdown target, so a finger that slides away still
// delivers the pointerup here; the slop check is what cancels those).
//
// The `click` listener stays as the mouse AND keyboard activation path
// (Enter/Space on a focused <button> fires click, which pointer events never
// cover), with a suppression window so the primary pointer's own synthesized
// click after a handled touch tap does not double-fire the action.

/** A touch pointerup farther than this from its pointerdown is a drag/slide
 *  off the button, not a tap; the action is cancelled like a native button. */
export const TAP_SLOP_PX = 12;
/** How long after a handled touch tap the synthesized click stays swallowed. */
export const CLICK_SUPPRESS_MS = 700;
/** Two touch taps within this window count as a double-tap (matches the camera
 *  recenter double-tap in mobile_controls.ts). */
export const DOUBLE_TAP_MS = 300;
/** How long a finger must rest on a frame before it counts as a long press,
 *  the touch stand-in for right-click. */
export const MOBILE_CONTEXT_LONG_PRESS_MS = 650;

interface TapTarget {
  addEventListener(type: string, listener: (e: PointerEvent & MouseEvent) => void): void;
}

/** Bind `onTap` so it fires for ANY touch pointer (primary or not), plus the
 *  regular click path for mouse and keyboard. Use this instead of a bare
 *  `addEventListener('click', ...)` for every touch-facing HUD button. */
export function bindTouchTap(el: TapTarget, onTap: (e: Event) => void): void {
  let downId: number | null = null;
  let downX = 0;
  let downY = 0;
  let suppressClick = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    downId = e.pointerId;
    downX = e.clientX;
    downY = e.clientY;
  });
  el.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch' || e.pointerId !== downId) return;
    downId = null;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > TAP_SLOP_PX) return;
    suppressClick = true;
    globalThis.setTimeout(() => {
      suppressClick = false;
    }, CLICK_SUPPRESS_MS);
    onTap(e);
  });
  el.addEventListener('pointercancel', (e) => {
    if (e.pointerId === downId) downId = null;
  });
  el.addEventListener('click', (e) => {
    if (suppressClick) {
      suppressClick = false;
      e.preventDefault();
      return;
    }
    onTap(e);
  });
}

/** Bind `onDoubleTap` so it fires when TWO touch taps land on `el` within
 *  `windowMs` of each other. Each tap must be a real tap (touch pointerdown then
 *  pointerup on the same pointer, within TAP_SLOP_PX), so a DRAG never counts:
 *  this is the touch-only counterpart to right-click on a `MovableFrame`, where a
 *  finger sliding the frame around must not be read as a double-tap. Touch-only
 *  by design (mouse/keyboard already have their own activation paths); the second
 *  tap's own PointerEvent is passed through so the caller can anchor a popup at
 *  the tap point, mirroring the desktop contextmenu's clientX/clientY. */
export function bindTouchDoubleTap(
  el: TapTarget,
  onDoubleTap: (e: Event) => void,
  windowMs = DOUBLE_TAP_MS,
): void {
  let downId: number | null = null;
  let downX = 0;
  let downY = 0;
  let lastTapAt = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    downId = e.pointerId;
    downX = e.clientX;
    downY = e.clientY;
  });
  el.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch' || e.pointerId !== downId) return;
    downId = null;
    // A finger that slid past the slop is a drag (a frame move), not a tap: it
    // neither fires the double-tap, nor primes one, nor keeps an earlier tap
    // primed (tap, drag, tap is two separate interactions, not a double-tap
    // sandwiching a drag).
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > TAP_SLOP_PX) {
      lastTapAt = 0;
      return;
    }
    const now = Date.now();
    if (lastTapAt > 0 && now - lastTapAt <= windowMs) {
      lastTapAt = 0;
      onDoubleTap(e);
    } else {
      lastTapAt = now;
    }
  });
  el.addEventListener('pointercancel', (e) => {
    if (e.pointerId === downId) downId = null;
  });
}

/**
 * Bind `onLongPress` so a resting finger opens what right-click opens on a
 * desktop: the unit menus behind the player, target and target-of-target
 * frames. Mobile-only by design (`isMobileLayout` is re-read per event, so a
 * live desktop-to-mobile flip is honoured), and the press point is passed
 * through so the caller can anchor its menu exactly where the finger sat.
 * `stopBubble` is for a frame nested inside another bound frame: it stops the
 * accepted touch pointerdown so the outer frame never arms a competing press.
 *
 * Extracted from the Hud coordinator on its third frame: it captures the
 * suppression window as well as the timer, and a copy per frame would drift.
 * Both suppressors are CAPTURE-phase and stopImmediatePropagation, because the
 * frames underneath already bind their own click / contextmenu handlers and a
 * long press must not also fire those.
 */
export function bindMobileFrameLongPress(
  el: HTMLElement,
  isMobileLayout: () => boolean,
  onLongPress: (x: number, y: number) => void,
  opts: { ignoreSelector?: string; stopBubble?: boolean } = {},
): void {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let downId: number | null = null;
  let downX = 0;
  let downY = 0;
  let suppressUntil = 0;
  const clear = () => {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    timer = undefined;
    downId = null;
  };
  el.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'touch' || !isMobileLayout()) return;
    const target = ev.target as HTMLElement | null;
    if (opts.ignoreSelector && target?.closest(opts.ignoreSelector)) return;
    // A NESTED frame (the target-of-target mini inside the target frame) must not
    // also arm its parent's press, or two menus open and the outer one wins.
    if (opts.stopBubble) ev.stopPropagation();
    clear();
    downId = ev.pointerId;
    downX = ev.clientX;
    downY = ev.clientY;
    timer = globalThis.setTimeout(() => {
      timer = undefined;
      suppressUntil = Date.now() + CLICK_SUPPRESS_MS;
      onLongPress(downX, downY);
    }, MOBILE_CONTEXT_LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'touch' || ev.pointerId !== downId) return;
    if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > TAP_SLOP_PX) clear();
  });
  el.addEventListener('pointerup', (ev) => {
    if (ev.pointerId === downId) clear();
  });
  el.addEventListener('pointercancel', (ev) => {
    if (ev.pointerId === downId) clear();
  });
  el.addEventListener(
    'click',
    (ev) => {
      if (Date.now() > suppressUntil) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    },
    true,
  );
  el.addEventListener(
    'contextmenu',
    (ev) => {
      if (!isMobileLayout() || Date.now() > suppressUntil) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    },
    true,
  );
}
