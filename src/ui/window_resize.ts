// Shared window-resize controller: gives every movable `.window.panel` a
// south-east corner grip, hit-tested on the window's own client box (no handle
// element, so it survives the innerHTML rebuilds every window does and never
// scrolls away with the content; the grip visual is a background layer on
// `.window.window-resizable`, see src/styles/layout.css).
//
// Event-driven chrome like window_drag.ts (not a per-frame painter):
// document-level pointer delegation, pointer capture on the window, and the
// same visual-vs-author space correction (see src/ui/ui_scale.ts). Owned state
// is one pending/active session; everything else is injected via deps (never Hud).
import {
  isInResizeCorner,
  RESIZE_CORNER_BAND,
  RESIZE_CORNER_BAND_TOUCH,
  RESIZE_ENGAGE_SLOP,
  RESIZE_ENGAGE_SLOP_TOUCH,
  resizedWindowSize,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  WINDOW_RESIZE_MARGIN,
} from './window_resize_core';

export interface WindowResizeDeps {
  /** Live UI zoom factor (divide visual coords by it for author lengths). */
  getScale(): number;
  /**
   * Convert the window's centering transform into pixel left/top before the
   * first size write, so growing the width extends the right edge instead of
   * both edges (Hud wires this to setWindowPixelPosition).
   */
  pinWindow(el: HTMLElement, rect: DOMRect): void;
  /** Coarse-pointer probe; defaults to a matchMedia check. */
  isCoarsePointer?(): boolean;
}

// Windows whose body is not reflowable content: fixed-size boards/popups and
// the modal prompts. Everything else gets the grip.
const NON_RESIZABLE_WINDOW_IDS = new Set([
  'map-window',
  'loot-window',
  'confirm-dialog',
  'mobile-extra-controls',
  'lockpick-panel',
  'emote-editor',
]);

export function isResizableWindow(el: HTMLElement): boolean {
  return !NON_RESIZABLE_WINDOW_IDS.has(el.id);
}

/**
 * Stamp the grip class on a window (no-op for the excluded ids). Every
 * resizable window is static in index.html, so installWindowResize stamps the
 * whole document once; Hud's existing window MutationObserver calls this for
 * any late-added window instead of this module running a second body-wide
 * observer over all combat-time DOM churn.
 */
export function markResizableWindow(el: HTMLElement): void {
  if (isResizableWindow(el)) el.classList.add('window-resizable');
}

interface ResizeSession {
  el: HTMLElement;
  pointerId: number;
  /** Visual-space pointer origin (pointerdown). */
  downX: number;
  downY: number;
  /** False until the pointer travels the engage slop: a bare tap or click in
   *  the corner band must not mutate the window (no pin, no flags, no capture). */
  engaged: boolean;
  /** Engage travel threshold, visual px (wider for touch: finger tap wobble). */
  slop: number;
  /** Author-space rect captured at engage time, after the pin clamped it. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Visual-space pointer origin of the engaged drag. */
  startX: number;
  startY: number;
}

/** Install the shared resize behavior. Returns a teardown (for tests). */
export function installWindowResize(deps: WindowResizeDeps): () => void {
  const coarse =
    deps.isCoarsePointer ?? (() => window.matchMedia?.('(pointer: coarse)').matches ?? false);

  document.querySelectorAll<HTMLElement>('.window.panel').forEach(markResizableWindow);

  let session: ResizeSession | null = null;
  let hotEl: HTMLElement | null = null;

  const bandVisual = () =>
    (coarse() ? RESIZE_CORNER_BAND_TOUCH : RESIZE_CORNER_BAND) * deps.getScale();

  // The window under the pointer when the pointer sits in its SE corner band
  // (and not on a control that must keep the corner click for itself). The band
  // is measured against the CLIENT box, not the border box, so the classic
  // scrollbar gutter stays grabbable as a scrollbar.
  const cornerHit = (ev: PointerEvent): HTMLElement | null => {
    const target = ev.target as HTMLElement | null;
    if (!target?.closest) return null;
    const el = target.closest<HTMLElement>('.window.panel');
    if (!el || !el.classList.contains('window-resizable')) return null;
    if (target.closest('button, input, textarea, select, a, [draggable="true"]')) return null;
    const rect = el.getBoundingClientRect();
    const z = deps.getScale();
    const corner = {
      right: rect.left + (el.clientLeft + el.clientWidth) * z,
      bottom: rect.top + (el.clientTop + el.clientHeight) * z,
    };
    return isInResizeCorner(corner, ev.clientX, ev.clientY, bandVisual()) ? el : null;
  };

  // Touch scrolling cannot be stopped from pointermove, and by the time the
  // slop is exceeded the browser has already claimed the gesture, so the
  // non-passive guard must attach while the touch is still pending in the
  // corner band; it comes off on pointerup/cancel either way.
  const touchGuard = (ev: TouchEvent) => ev.preventDefault();

  const endSession = () => {
    if (!session) return;
    if (session.engaged) session.el.classList.remove('window-resizing');
    document.removeEventListener('touchmove', touchGuard);
    session = null;
  };

  const onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0 || session) return;
    const el = cornerHit(ev);
    if (!el) return;
    // Record a PENDING session only: a tap/click that never travels the slop
    // must leave the window untouched (no pin, no windowMoved, no capture).
    session = {
      el,
      pointerId: ev.pointerId,
      downX: ev.clientX,
      downY: ev.clientY,
      engaged: false,
      slop: ev.pointerType === 'touch' ? RESIZE_ENGAGE_SLOP_TOUCH : RESIZE_ENGAGE_SLOP,
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      startX: 0,
      startY: 0,
    };
    if (ev.pointerType === 'touch') {
      document.addEventListener('touchmove', touchGuard, { passive: false });
    }
  };

  const engage = (ev: PointerEvent) => {
    if (!session) return;
    const el = session.el;
    // Pin first (converts the centering transform to pixel left/top and clamps
    // into the viewport), THEN capture the baseline from the clamped rect.
    deps.pinWindow(el, el.getBoundingClientRect());
    const rect = el.getBoundingClientRect();
    const z = deps.getScale();
    session.left = rect.left / z;
    session.top = rect.top / z;
    session.width = rect.width / z;
    session.height = rect.height / z;
    session.startX = ev.clientX;
    session.startY = ev.clientY;
    session.engaged = true;
    el.classList.add('window-resizing');
    // Opts the window into the viewport-resize re-clamp pass hud.ts runs.
    el.dataset.windowMoved = '1';
    try {
      el.setPointerCapture?.(ev.pointerId);
    } catch {
      /* synthetic/legacy pointer without active capture */
    }
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (session) {
      if (session.pointerId !== ev.pointerId) return;
      if (!session.engaged) {
        // A swallowed pointerup must not strand the pending session: no buttons
        // down means the press already ended, so drop it instead of engaging.
        if (ev.buttons === 0) {
          endSession();
          return;
        }
        const travelled =
          Math.abs(ev.clientX - session.downX) >= session.slop ||
          Math.abs(ev.clientY - session.downY) >= session.slop;
        if (!travelled) return;
        engage(ev);
      }
      ev.preventDefault();
      const z = deps.getScale();
      const { width, height } = resizedWindowSize(
        session,
        (ev.clientX - session.startX) / z,
        (ev.clientY - session.startY) / z,
        {
          viewportWidth: window.innerWidth / z,
          viewportHeight: window.innerHeight / z,
          minWidth: WINDOW_MIN_WIDTH,
          minHeight: WINDOW_MIN_HEIGHT,
          margin: WINDOW_RESIZE_MARGIN,
        },
      );
      session.el.style.width = `${width}px`;
      session.el.style.height = `${height}px`;
      return;
    }
    // Hover affordance: swap the resize cursor class as the pointer crosses the
    // corner band (event-driven, only while a hovering pointer is over a
    // window; touch has no hover, so skip the rect work entirely).
    if (ev.pointerType === 'touch') return;
    const el = cornerHit(ev);
    if (hotEl && hotEl !== el) hotEl.classList.remove('window-resize-hot');
    if (el && el !== hotEl) el.classList.add('window-resize-hot');
    hotEl = el;
  };

  const onPointerEnd = (ev: PointerEvent) => {
    if (session && session.pointerId === ev.pointerId) endSession();
  };

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerEnd);
  document.addEventListener('pointercancel', onPointerEnd);

  return () => {
    endSession();
    hotEl?.classList.remove('window-resize-hot');
    hotEl = null;
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerEnd);
    document.removeEventListener('pointercancel', onPointerEnd);
  };
}
