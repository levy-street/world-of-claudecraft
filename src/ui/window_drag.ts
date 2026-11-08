// Shared titlebar drag controller for `.window.panel` surfaces.
//
// The window is pinned once at pointerdown, then moved with one frame-batched
// compositor transform per animation frame. The final position is committed to
// left/top once at pointerup. This avoids the old getBoundingClientRect plus
// left/top layout cycle on every pointer event, which could expose the WebGL canvas
// while two large store windows overlapped on high-DPI Chromium displays.

import {
  draggedWindowPosition,
  WINDOW_DRAG_MARGIN,
  type WindowDragPosition,
} from './window_drag_core';
import { isCoarsePointerDefault, resizeGripAt } from './window_resize';
import { RESIZE_ENGAGE_SLOP, RESIZE_ENGAGE_SLOP_TOUCH } from './window_resize_core';

export interface WindowDragDeps {
  getScale(): number;
  isDragHandle(target: HTMLElement, win: HTMLElement): boolean;
  bringToFront(el: HTMLElement): void;
  hideTooltip(): void;
  /** Convert the initial centered window into fixed author-space left/top. */
  pinWindow(el: HTMLElement, rect: DOMRect): void;
  /** Commit visual-space coordinates to the shared clamped left/top writer. */
  commitWindow(el: HTMLElement, left: number, top: number, rect: DOMRect): void;
  requestFrame?(callback: FrameRequestCallback): number;
  cancelFrame?(id: number): void;
}

export interface WindowDragController {
  cancel(el?: HTMLElement): void;
  destroy(): void;
}

/**
 * Preview transforms are intentionally compositor-only. Hud observes managed
 * window style changes for visibility/placement, so recognizing these writes
 * prevents every drag frame from re-running computed-style visibility checks.
 */
export function isWindowDragPreviewMutation(
  attributeName: string | null,
  el: HTMLElement,
): boolean {
  return attributeName === 'style' && el.classList.contains('window-dragging');
}

interface DragSession {
  el: HTMLElement;
  pointerId: number;
  scale: number;
  start: WindowDragPosition;
  current: WindowDragPosition;
  rendered: WindowDragPosition;
  grabOffsetX: number;
  grabOffsetY: number;
  windowWidth: number;
  windowHeight: number;
  frameId: number | null;
  moved: boolean;
}

/**
 * A touch-layout title press that has not travelled the engage slop yet. On the
 * touch HUD nearly every window is an edge-pinned CSS sheet
 * (src/styles/hud.mobile.css), and the drag's pin writes inline left/top plus
 * right/bottom:auto, which unpins two of its edges. Pinning at pointerdown made
 * a plain title TAP shrink-wrap the window to its content: the Book of Deeds
 * blew out to 1152x8184 with its close button off-screen, the leaderboard
 * collapsed to 26px. So on touch the drag waits for real travel (the same slop
 * the resize grip uses), and when it engages it first locks the window's
 * current on-screen size inline, so the pin moves the window without resizing
 * it. A tap leaves the window untouched.
 */
interface PendingTouchDrag {
  el: HTMLElement;
  target: HTMLElement;
  pointerId: number;
  downX: number;
  downY: number;
  slop: number;
}

/** True while the touch HUD is up (body.mobile-touch toggles at runtime). */
function touchLayout(el: HTMLElement): boolean {
  return el.ownerDocument?.body?.classList.contains('mobile-touch') ?? false;
}

export function installWindowDrag(deps: WindowDragDeps): WindowDragController {
  const requestFrame =
    deps.requestFrame ??
    ((callback: FrameRequestCallback) => window.requestAnimationFrame(callback));
  const cancelFrame = deps.cancelFrame ?? ((id: number) => window.cancelAnimationFrame(id));
  let session: DragSession | null = null;
  let pending: PendingTouchDrag | null = null;

  const clearSession = (commit: boolean) => {
    const drag = session;
    if (!drag) return;
    session = null;
    if (drag.frameId !== null) cancelFrame(drag.frameId);
    if (commit && drag.moved) {
      // Store contents can finish an async refresh while the titlebar is held,
      // and docking DevTools can resize the viewport. Re-read once at the end
      // so the shared writer clamps the final position with current dimensions.
      const finalRect = drag.el.getBoundingClientRect();
      deps.commitWindow(
        drag.el,
        drag.current.left * drag.scale,
        drag.current.top * drag.scale,
        finalRect,
      );
    }
    drag.el.style.transform = 'none';
    drag.el.classList.remove('window-dragging');
    document.body.classList.remove('window-drag-active');
  };

  const paintPreview = (drag: DragSession) => {
    drag.frameId = null;
    if (session !== drag) return;
    if (drag.current.left === drag.rendered.left && drag.current.top === drag.rendered.top) return;
    drag.rendered = drag.current;
    const x = drag.current.left - drag.start.left;
    const y = drag.current.top - drag.start.top;
    drag.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    const el = target?.closest?.('.window.panel') as HTMLElement | null;
    // The confirm prompt stays in its fixed modal band and is never draggable.
    if (!el || el.id === 'confirm-dialog') return;
    deps.bringToFront(el);
    if (session || event.button !== 0 || !target || !deps.isDragHandle(target, el)) return;
    // Corner presses belong to window_resize.ts. The headerless map overlaps
    // its SE resize band with its padding drag handle; the bag window's NW grip
    // sits on its title bar.
    if (resizeGripAt(event, deps.getScale(), isCoarsePointerDefault())?.el === el) return;
    event.preventDefault();
    deps.hideTooltip();

    if (touchLayout(el)) {
      // Record the press only; engageDrag runs once it travels the slop.
      pending = {
        el,
        target,
        pointerId: event.pointerId,
        downX: event.clientX,
        downY: event.clientY,
        slop: event.pointerType === 'mouse' ? RESIZE_ENGAGE_SLOP : RESIZE_ENGAGE_SLOP_TOUCH,
      };
      return;
    }
    engageDrag(el, target, event.pointerId, event.clientX, event.clientY, false);
  };

  /** Pin the window and open the drag session. `lockSize` (the touch path)
   *  first writes the window's current on-screen size inline, so the pin's
   *  right/bottom:auto cannot resize an edge-pinned sheet. The grab offset is
   *  measured from the PRESS point, so the window follows the finger from
   *  where it was grabbed rather than jumping by the slop. */
  const engageDrag = (
    el: HTMLElement,
    target: HTMLElement,
    pointerId: number,
    downX: number,
    downY: number,
    lockSize: boolean,
  ) => {
    const initialRect = el.getBoundingClientRect();
    if (lockSize) {
      // Capped at the viewport less the drag margin on both sides: a sheet that
      // fills the screen (the inset-0 character sheet) would otherwise be held
      // at the margin by draggedWindowPosition and spill off the far edge.
      const z = Math.max(Number.EPSILON, deps.getScale());
      const maxW = window.innerWidth / z - WINDOW_DRAG_MARGIN * 2;
      const maxH = window.innerHeight / z - WINDOW_DRAG_MARGIN * 2;
      el.style.width = `${Math.min(initialRect.width / z, maxW)}px`;
      el.style.height = `${Math.min(initialRect.height / z, maxH)}px`;
    }
    deps.pinWindow(el, initialRect);
    // Pinning can clamp a previously centered or off-screen window. Measure the
    // resulting baseline once, then do no layout reads for the rest of the drag.
    const rect = el.getBoundingClientRect();
    const scale = Math.max(Number.EPSILON, deps.getScale());
    const start = { left: rect.left / scale, top: rect.top / scale };
    session = {
      el,
      pointerId,
      scale,
      start,
      current: start,
      rendered: start,
      grabOffsetX: downX - rect.left,
      grabOffsetY: downY - rect.top,
      windowWidth: rect.width / scale,
      windowHeight: rect.height / scale,
      frameId: null,
      moved: false,
    };
    el.classList.add('window-dragging');
    document.body.classList.add('window-drag-active');
    el.dataset.windowMoved = '1';
    try {
      target.setPointerCapture?.(pointerId);
    } catch {
      /* synthetic or legacy pointer without active capture */
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    const press = pending;
    if (press && press.pointerId === event.pointerId) {
      // A swallowed pointerup must not strand the pending press: no buttons
      // down means it already ended, so drop it instead of engaging.
      if (event.buttons === 0) {
        pending = null;
        return;
      }
      const travelled =
        Math.abs(event.clientX - press.downX) >= press.slop ||
        Math.abs(event.clientY - press.downY) >= press.slop;
      if (!travelled) return;
      pending = null;
      engageDrag(press.el, press.target, press.pointerId, press.downX, press.downY, true);
    }
    const drag = session;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    drag.current = draggedWindowPosition(
      {
        pointerX: event.clientX,
        pointerY: event.clientY,
        grabOffsetX: drag.grabOffsetX,
        grabOffsetY: drag.grabOffsetY,
      },
      {
        scale: drag.scale,
        viewportWidth: window.innerWidth / drag.scale,
        viewportHeight: window.innerHeight / drag.scale,
        windowWidth: drag.windowWidth,
        windowHeight: drag.windowHeight,
      },
    );
    drag.moved = drag.current.left !== drag.start.left || drag.current.top !== drag.start.top;
    if (drag.frameId === null) {
      drag.frameId = requestFrame(() => paintPreview(drag));
    }
  };

  const onPointerEnd = (event: PointerEvent) => {
    // A touch press that never travelled the slop was a tap: nothing to undo.
    if (pending?.pointerId === event.pointerId) pending = null;
    if (session?.pointerId === event.pointerId) clearSession(true);
  };

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerEnd);
  document.addEventListener('pointercancel', onPointerEnd);

  return {
    cancel(el) {
      if (pending && (!el || pending.el === el)) pending = null;
      if (!session || (el && session.el !== el)) return;
      clearSession(true);
    },
    destroy() {
      pending = null;
      clearSession(true);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerEnd);
      document.removeEventListener('pointercancel', onPointerEnd);
    },
  };
}
