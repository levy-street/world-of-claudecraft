// Shared titlebar drag controller for `.window.panel` surfaces.
//
// The window is pinned once at pointerdown, then moved with one frame-batched
// compositor transform per animation frame. The final position is committed to
// left/top once at pointerup. This avoids the old getBoundingClientRect plus
// left/top layout cycle on every pointer event, which could expose the WebGL canvas
// while two large store windows overlapped on high-DPI Chromium displays.

import { draggedWindowPosition, type WindowDragPosition } from './window_drag_core';

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

export function installWindowDrag(deps: WindowDragDeps): WindowDragController {
  const requestFrame =
    deps.requestFrame ??
    ((callback: FrameRequestCallback) => window.requestAnimationFrame(callback));
  const cancelFrame = deps.cancelFrame ?? ((id: number) => window.cancelAnimationFrame(id));
  let session: DragSession | null = null;

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
    event.preventDefault();
    deps.hideTooltip();

    const initialRect = el.getBoundingClientRect();
    deps.pinWindow(el, initialRect);
    // Pinning can clamp a previously centered or off-screen window. Measure the
    // resulting baseline once, then do no layout reads for the rest of the drag.
    const rect = el.getBoundingClientRect();
    const scale = Math.max(Number.EPSILON, deps.getScale());
    const start = { left: rect.left / scale, top: rect.top / scale };
    session = {
      el,
      pointerId: event.pointerId,
      scale,
      start,
      current: start,
      rendered: start,
      grabOffsetX: event.clientX - rect.left,
      grabOffsetY: event.clientY - rect.top,
      windowWidth: rect.width / scale,
      windowHeight: rect.height / scale,
      frameId: null,
      moved: false,
    };
    el.classList.add('window-dragging');
    document.body.classList.add('window-drag-active');
    el.dataset.windowMoved = '1';
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {
      /* synthetic or legacy pointer without active capture */
    }
  };

  const onPointerMove = (event: PointerEvent) => {
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
    if (session?.pointerId === event.pointerId) clearSession(true);
  };

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerEnd);
  document.addEventListener('pointercancel', onPointerEnd);

  return {
    cancel(el) {
      if (!session || (el && session.el !== el)) return;
      clearSession(true);
    },
    destroy() {
      clearSession(true);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerEnd);
      document.removeEventListener('pointercancel', onPointerEnd);
    },
  };
}
