// Shared "requested spot" persistence + post-resize reflow for every managed
// `.window.panel` (bags, vendor, bank, quest log, and the rest): the same
// re-anchor discipline MovableFrame's rederiveFromSaved and the chat box's
// own resize handler already give the unit frames and the chat box (leaving
// fullscreen must never permanently strand a window at its shrink-time
// clamp). A generic window has no localStorage slot of its own (its position
// never survives a reload), so the requested spot rides the window's own
// `dataset.req*` attributes instead of a storage key: the viewport-stamped
// {left, top} the player last explicitly pinned/dragged/resized it to.
// hud.ts's setWindowPixelPosition stays a thin caller: placeWindow
// (window_reflow_core.ts) does the clamp, rememberWindowPos stamps on every
// explicit write, and installWindowReflow's resize listener re-derives from
// that stamp (never the last render) on a viewport change.

import { anchoredRequestedPos } from './window_reflow_core';

/** Delay for the trailing post-resize re-derive, long enough for a
 *  fullscreen transition's window metrics to settle (mirrors MovableFrame's
 *  / the chat box's own RESIZE_SETTLE_MS). */
const WINDOW_RESIZE_SETTLE_MS = 200;

/** Stamp the spot a window was just explicitly pinned/dragged/resized to
 *  (VISUAL space, matching MovableFrame / the chat box), with the viewport it
 *  was chosen under. The caller skips this for a passive reflow: that call
 *  must never overwrite what the player actually asked for. */
export function rememberWindowPos(el: HTMLElement, left: number, top: number): void {
  el.dataset.reqLeft = String(left);
  el.dataset.reqTop = String(top);
  el.dataset.reqVw = String(window.innerWidth);
  el.dataset.reqVh = String(window.innerHeight);
}

/** The requested spot (see rememberWindowPos), re-anchored to the CURRENT
 *  viewport (window_reflow_core.ts). Falls back to the window's current rect
 *  when no stamp exists yet (a window never explicitly positioned) or the
 *  stamped viewport is corrupt (zero or negative, which cannot re-anchor
 *  honestly). */
export function requestedWindowPos(
  el: HTMLElement,
  rect: { left: number; top: number; width: number; height: number },
): { left: number; top: number } {
  const left = Number.parseFloat(el.dataset.reqLeft ?? '');
  const top = Number.parseFloat(el.dataset.reqTop ?? '');
  const vw = Number.parseFloat(el.dataset.reqVw ?? '');
  const vh = Number.parseFloat(el.dataset.reqVh ?? '');
  if (![left, top].every(Number.isFinite) || !(vw > 0) || !(vh > 0)) {
    return { left: rect.left, top: rect.top };
  }
  return anchoredRequestedPos(
    { left, top, vw, vh },
    { w: rect.width, h: rect.height },
    { w: window.innerWidth, h: window.innerHeight },
  );
}

export interface WindowReflowDeps {
  /** Every currently visible, explicitly moved/resized `.window.panel`. */
  movedWindows(): HTMLElement[];
  /** Reposition one window to the given VISUAL-space spot, WITHOUT touching
   *  its requested-spot stamp (hud.ts wires this to
   *  `setWindowPixelPosition(el, left, top, rect, false)`). */
  reflow(el: HTMLElement, left: number, top: number, rect: DOMRect): void;
}

/**
 * Install the shared post-resize reflow. Sweeps every explicitly moved window
 * once immediately and once after the metrics settle: a resize event fired
 * mid-transition (an OS fullscreen exit, emulated viewports) can still
 * observe the OLD innerWidth/Height, making the re-anchor a silent no-op
 * with no follow-up event to correct it; the trailing pass is idempotent.
 * Returns a teardown (for tests).
 */
export function installWindowReflow(deps: WindowReflowDeps): () => void {
  const reflowAll = () => {
    for (const el of deps.movedWindows()) {
      // A resize firing mid-drag/mid-resize (window_drag.ts / window_resize.ts
      // stamp these classes for the gesture's duration) must leave the live
      // gesture alone: it owns the position until it commits, and reflowing
      // here would stomp the compositor preview transform and desync the
      // drag's baseline (mirrors MovableFrame's / MeterFrame's `this.gesture`
      // guard in their own rederiveFromSaved).
      if (el.classList.contains('window-dragging') || el.classList.contains('window-resizing')) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      const requested = requestedWindowPos(el, rect);
      deps.reflow(el, requested.left, requested.top, rect);
    }
  };
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    reflowAll();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(reflowAll, WINDOW_RESIZE_SETTLE_MS);
  };
  window.addEventListener('resize', onResize);
  return () => {
    clearTimeout(settleTimer);
    window.removeEventListener('resize', onResize);
  };
}
