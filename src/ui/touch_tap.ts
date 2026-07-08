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
