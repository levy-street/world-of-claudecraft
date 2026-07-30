// Touch pick-up-and-drag for a bag stack: the finger equivalent of the desktop
// HTML5 drag from the bags grid onto a paperdoll socket (equip) or out onto the
// world (destroy). HTML5 drag-and-drop does not exist on touch, so the gesture is
// rebuilt from pointer events, reusing the shape already proven by the mobile
// hotbar swap in hud.ts (hold to arm, move-before-arm cancels, pointer capture,
// elementFromPoint hit test) instead of inventing a second idiom.
//
// The gesture, deliberately in this order:
//  - A hold of TOUCH_DRAG_HOLD_MS arms the drag. Moving more than
//    TOUCH_DRAG_MOVE_TOLERANCE_PX before that cancels it, so a flick still SCROLLS
//    the bag grid (the grid is the scroll container: an eager drag would kill it).
//  - Arming lands well before the 950 ms tooltip peek (TOOLTIP_PEEK_MS), and it
//    cancels that pending peek explicitly (see cancelPendingPeek), so a drag never
//    pops a tooltip under the finger mid-flight.
//  - The release runs the drop; the consumer suppresses the synthetic click that
//    follows, so a drag never also USES the item it just moved.
//
// Thin DOM consumer: every decision about what a drop DOES is the pure
// equip_drop_core; this module owns only the gesture and the floating ghost.

import type { BagItemDrag, ItemDragState } from './item_drag_state';

/** Hold (ms) before a touch press on a bag stack becomes a drag. Comfortably
 *  under the 950 ms tooltip peek, and above a tap. */
export const TOUCH_DRAG_HOLD_MS = 320;
/** Movement (px) that cancels an unarmed press, letting the bag grid scroll. */
export const TOUCH_DRAG_MOVE_TOLERANCE_PX = 9;

export interface TouchItemDragDeps {
  /** The shared in-flight drag handle every drop target reads. */
  state: ItemDragState;
  /** The stack this row carries; null makes the row undraggable. */
  payload(): BagItemDrag | null;
  /** Icon markup for the ghost that follows the finger (already escaped). */
  ghostHtml(): string;
  /** True only on the touch HUD; with a mouse the desktop HTML5 drag owns this. */
  isTouchHud(): boolean;
  /** The drag armed: hide the tooltip and mark the source row. */
  onStart(): void;
  /** The finger moved to (x, y) while dragging: repaint drop-target highlights. */
  onMove(x: number, y: number): void;
  /** The finger lifted at (x, y) while dragging: run the drop. */
  onDrop(x: number, y: number): void;
  /** The drag ended (dropped or cancelled): clear highlights and the ghost. */
  onEnd(): void;
}

interface ActiveDrag {
  pointerId: number;
  startX: number;
  startY: number;
  armed: boolean;
  timer: number;
  ghost: HTMLElement | null;
}

// The tooltip's long-press peek timer (Hud.attachTooltip) lives in a closure we
// cannot reach, but it clears itself on pointercancel. Once the drag arms, the
// real pointer stays down (we captured it), so synthesize that cancel to kill the
// pending peek. The synthetic event carries pointerId -1, which never matches a
// real pointer, so this module's own pointercancel handler ignores it.
function cancelPendingPeek(el: HTMLElement): void {
  el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: -1, bubbles: true }));
}

/** Bind the touch drag gesture to one bag row. Safe to call on every rebuild:
 *  the listeners die with the row. */
export function bindTouchItemDrag(el: HTMLElement, deps: TouchItemDragDeps): void {
  let drag: ActiveDrag | null = null;

  const teardown = (): void => {
    if (!drag) return;
    window.clearTimeout(drag.timer);
    drag.ghost?.remove();
    const wasArmed = drag.armed;
    drag = null;
    document.body.classList.remove('touch-item-dragging');
    el.classList.remove('touch-drag-source');
    deps.state.end();
    if (wasArmed) deps.onEnd();
  };

  el.addEventListener('pointerdown', (e) => {
    if (!deps.isTouchHud() || e.pointerType === 'mouse') return;
    const payload = deps.payload();
    if (!payload) return;
    teardown();
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    drag = {
      pointerId,
      startX,
      startY,
      armed: false,
      ghost: null,
      timer: window.setTimeout(() => {
        if (!drag || drag.pointerId !== pointerId) return;
        drag.armed = true;
        deps.state.begin(payload);
        cancelPendingPeek(el);
        document.body.classList.add('touch-item-dragging');
        el.classList.add('touch-drag-source');
        const ghost = document.createElement('div');
        ghost.className = 'touch-drag-ghost';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.innerHTML = deps.ghostHtml();
        ghost.style.setProperty('--touch-drag-x', `${startX}px`);
        ghost.style.setProperty('--touch-drag-y', `${startY}px`);
        document.body.appendChild(ghost);
        drag.ghost = ghost;
        try {
          el.setPointerCapture?.(pointerId);
        } catch {
          /* pointer already released */
        }
        deps.onStart();
        deps.onMove(startX, startY);
      }, TOUCH_DRAG_HOLD_MS),
    };
  });

  el.addEventListener('pointermove', (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (!drag.armed) {
      const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
      // A flick before the hold is a bag-grid SCROLL, not a drag: stand down.
      if (moved > TOUCH_DRAG_MOVE_TOLERANCE_PX) teardown();
      return;
    }
    // Armed: the finger owns the item, so the page must not scroll under it.
    e.preventDefault();
    drag.ghost?.style.setProperty('--touch-drag-x', `${e.clientX}px`);
    drag.ghost?.style.setProperty('--touch-drag-y', `${e.clientY}px`);
    deps.onMove(e.clientX, e.clientY);
  });

  // A lift RUNS the drop; a cancel does NOT. pointercancel means the touch was taken
  // away (the system claimed it for a gesture, the finger left the surface): treating
  // it as a release would destroy or equip a stack the player never dropped anywhere.
  el.addEventListener('pointerup', (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.armed) {
      e.preventDefault();
      deps.onDrop(e.clientX, e.clientY);
    }
    teardown();
  });
  el.addEventListener('pointercancel', (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    teardown();
  });
}
