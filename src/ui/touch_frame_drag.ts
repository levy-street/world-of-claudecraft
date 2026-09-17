// Always-on one-finger drag for the class engine indicators on the TOUCH
// layout (the proc overlay, the paladin devotion medallion, the warlock doom
// meter): the touch counterpart of the desktop "Unlock interface" editor,
// which every touch layout refuses (MovableFrame no-ops its gestures there and
// the options row is never offered). Event-driven only (pointer events, one
// resize listener), no per-frame cost, so this is a plain sibling module the
// Hud attaches once, not a painter. The table, the clamp and the storage
// round-trip are the pure core touch_frame_drag_core.ts; this file is the DOM
// consumer, registered in tests/architecture.test.ts UI_DOM_MODULES. Bare-named
// like the other drag binders (movable_frame.ts, touch_item_drag.ts): its only
// layout reads are the one rect at a grab and the rect on attach and resize,
// never per pointer event (see DragMetrics).
//
// It never writes left/top itself. A drag stamps the anchor into two custom
// properties plus a class, and the mobile stylesheet places the frame from
// those (hud.mobile.css, the engine indicator block), so the desktop mover's
// inline geometry and this drag never share a property. The one way the two
// could still meet is a desktop-saved spot the mover applied INLINE before a
// live Interface Mode flip into the touch layout (which fires no resize, so the
// mover's own mobile-layout strip has not run yet): inline left/top outrank any
// stylesheet rule, so the touch layout strips them here too, the same property
// list the mover clears.
//
// Pointer-only by design: this surface exists only on the touch layout, which
// has no keyboard, and the desktop layout keeps both keyboard paths (the
// registry frame's corner button and grip take arrow keys). The touch layout's
// other placement gestures (the floating move wheel, the radial) are
// pointer-only for the same reason.

import {
  clampTouchFrameAnchor,
  draggedTouchFrameAnchor,
  parseTouchFrameAnchor,
  safeAreaFromPadding,
  serializeTouchFrameAnchor,
  TOUCH_ANCHOR_X_PROP,
  TOUCH_ANCHOR_Y_PROP,
  TOUCH_DRAG_FRAMES,
  TOUCH_DRAGGING_CLASS,
  TOUCH_PLACED_CLASS,
  type TouchFrameAnchor,
  type TouchSafeArea,
  touchFrameAnchorCss,
} from './touch_frame_drag_core';

/** The frame surface the drag needs: enough of HTMLElement for the gesture,
 *  and small enough for a hand-rolled test fake. */
export interface TouchDragElement {
  classList: { add(name: string): void; remove(name: string): void };
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  addEventListener(type: string, listener: (ev: PointerEvent) => void): void;
  setPointerCapture?(pointerId: number): void;
}

/** The persisted-anchor store: localStorage, or nothing when it is unavailable. */
export interface TouchDragStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Everything the attacher reaches outside the element: the viewport, the
 *  safe-area insets, the resize signal and the store. The browser host below
 *  is the production one; tests pass a fake. */
export interface TouchDragHost {
  viewport(): { w: number; h: number };
  safeArea(): TouchSafeArea;
  onResize(listener: () => void): void;
  storage: TouchDragStorage | null;
}

export interface TouchFrameDragDeps {
  storageKey: string;
  /** True on the touch layout (body.mobile-touch), the only layout the
   *  gesture is live on; the desktop editor owns the frame otherwise. */
  isTouchLayout(): boolean;
  host?: TouchDragHost;
}

export interface TouchFrameDrag {
  /** Re-clamp and re-apply the SAVED spot (a viewport change): from storage
   *  rather than the last render, so leaving a smaller viewport restores the
   *  exact saved location instead of making the clamp permanent. */
  refresh(): void;
  /** Forget the saved spot and hand the frame back to its stylesheet seat. */
  reset(): void;
  /** The anchor currently applied; null while the frame sits on its seat. */
  readonly anchor: TouchFrameAnchor | null;
}

/** What one placement clamps against. A drag measures this ONCE at the grab
 *  and reuses it for every move: neither the frame's visual size nor the
 *  safe-area insets can change mid-gesture, and re-reading them per pointer
 *  event would put a layout read between two style writes at pointer rate.
 *  Attach and refresh measure fresh. */
interface DragMetrics {
  w: number;
  h: number;
  viewport: { w: number; h: number };
  safeArea: TouchSafeArea;
}

/** The inline geometry the desktop mover writes (MovableFrame.applyPos) and
 *  strips on the mobile layout; the touch layout strips the same set before
 *  placing, since an inline left/top would outrank the placement rules. */
const INLINE_GEOMETRY_PROPS = [
  'left',
  'top',
  'right',
  'bottom',
  'transform',
  'transform-origin',
  'width',
  'height',
] as const;

function targetIsControl(ev: PointerEvent): boolean {
  const target = ev.target as { closest?: (selector: string) => unknown } | null;
  return !!target?.closest?.('button');
}

/**
 * Make `el` draggable on the touch layout and persistent under `storageKey`.
 * Applies the stored anchor immediately (if any) and re-clamps on resize.
 * The frame is expected to be grabbable only while its indicator is showing:
 * the stylesheet hands pointer events back per lit state, so an unlit overlay
 * never eats a tap meant for the world behind it.
 */
export function attachTouchFrameDrag(
  el: TouchDragElement,
  deps: TouchFrameDragDeps,
): TouchFrameDrag {
  const host = deps.host ?? browserTouchDragHost();
  let anchor: TouchFrameAnchor | null = null;
  let dragId: number | null = null;
  let metrics: DragMetrics | null = null;
  // Pointer-to-center offset at grab (px), held for the whole drag so the
  // frame never jumps under the thumb.
  let grabDx = 0;
  let grabDy = 0;

  const measure = (): DragMetrics => {
    const rect = el.getBoundingClientRect();
    return { w: rect.width, h: rect.height, viewport: host.viewport(), safeArea: host.safeArea() };
  };
  const stripInlineGeometry = (): void => {
    if (!deps.isTouchLayout()) return;
    for (const prop of INLINE_GEOMETRY_PROPS) el.style.removeProperty(prop);
  };
  const place = (next: TouchFrameAnchor, m: DragMetrics): void => {
    anchor = clampTouchFrameAnchor(
      next.fx,
      next.fy,
      m.w,
      m.h,
      m.viewport.w,
      m.viewport.h,
      m.safeArea,
    );
    const css = touchFrameAnchorCss(anchor);
    el.style.setProperty(TOUCH_ANCHOR_X_PROP, css.x);
    el.style.setProperty(TOUCH_ANCHOR_Y_PROP, css.y);
    el.classList.add(TOUCH_PLACED_CLASS);
  };
  const readSaved = (): TouchFrameAnchor | null => {
    try {
      return parseTouchFrameAnchor(host.storage?.getItem(deps.storageKey) ?? null);
    } catch {
      return null;
    }
  };
  const persist = (): void => {
    if (!anchor) return;
    try {
      host.storage?.setItem(deps.storageKey, serializeTouchFrameAnchor(anchor));
    } catch {
      /* storage unavailable */
    }
  };

  // Applied on EVERY layout, not only the touch one: the placement rules are
  // scoped to body.mobile-touch, so on desktop this is an inert stamp, and a
  // device that flips Interface Mode mid-session finds its saved spot waiting
  // on the next viewport change instead of after a reload.
  const saved = readSaved();
  if (saved) {
    stripInlineGeometry();
    place(saved, measure());
  }

  el.addEventListener('pointerdown', (ev) => {
    if (dragId !== null || !deps.isTouchLayout() || !ev.isPrimary || ev.button !== 0) return;
    if (targetIsControl(ev)) return;
    stripInlineGeometry();
    const rect = el.getBoundingClientRect();
    metrics = {
      w: rect.width,
      h: rect.height,
      viewport: host.viewport(),
      safeArea: host.safeArea(),
    };
    dragId = ev.pointerId;
    grabDx = ev.clientX - (rect.left + rect.width / 2);
    grabDy = ev.clientY - (rect.top + rect.height / 2);
    el.setPointerCapture?.(ev.pointerId);
    el.classList.add(TOUCH_DRAGGING_CLASS);
    // preventDefault only: no compatibility mouse events, no text selection,
    // no image drag. Propagation is deliberately left alone: the touch
    // controls' document-level pointerdown listeners (the chrome-fade
    // keep-awake, the More tray's tap-outside-to-dismiss) must still see the
    // press; the pointer-id guard is what keeps the gesture ours.
    ev.preventDefault();
  });
  el.addEventListener('pointermove', (ev) => {
    if (dragId !== ev.pointerId || !metrics) return;
    const { w, h } = metrics.viewport;
    place(draggedTouchFrameAnchor(ev.clientX, ev.clientY, grabDx, grabDy, w, h), metrics);
  });
  const drop = (ev: PointerEvent): void => {
    if (dragId !== ev.pointerId) return;
    dragId = null;
    metrics = null;
    el.classList.remove(TOUCH_DRAGGING_CLASS);
    persist();
  };
  el.addEventListener('pointerup', drop);
  el.addEventListener('pointercancel', drop);

  const refresh = (): void => {
    // A mid-gesture resize is left alone: the live drag owns the spot and its
    // drop persists anyway.
    if (dragId !== null) return;
    const basis = readSaved() ?? anchor;
    if (!basis) return;
    stripInlineGeometry();
    place(basis, measure());
  };
  host.onResize(refresh);

  const reset = (): void => {
    anchor = null;
    dragId = null;
    metrics = null;
    el.classList.remove(TOUCH_DRAGGING_CLASS);
    el.classList.remove(TOUCH_PLACED_CLASS);
    el.style.removeProperty(TOUCH_ANCHOR_X_PROP);
    el.style.removeProperty(TOUCH_ANCHOR_Y_PROP);
    try {
      host.storage?.removeItem(deps.storageKey);
    } catch {
      /* storage unavailable */
    }
  };

  return {
    refresh,
    reset,
    get anchor(): TouchFrameAnchor | null {
      return anchor;
    },
  };
}

export interface TouchFrameDrags {
  /** The attached drags, in TOUCH_DRAG_FRAMES order (a frame missing from the
   *  document is skipped, like the unlock registry skips it). */
  readonly drags: readonly TouchFrameDrag[];
  /** Forget every saved touch spot: the layout reset's touch half. */
  resetAll(): void;
}

/** Attach the drag to every TOUCH_DRAG_FRAMES element in `doc`: the one call
 *  the Hud makes after registering the desktop movers. */
export function attachTouchFrameDrags(
  doc: Pick<Document, 'getElementById'>,
  isTouchLayout: () => boolean,
  host: TouchDragHost = browserTouchDragHost(),
): TouchFrameDrags {
  const drags = TOUCH_DRAG_FRAMES.flatMap((row) => {
    const el = doc.getElementById(row.elementId);
    return el
      ? [attachTouchFrameDrag(el, { storageKey: row.storageKey, isTouchLayout, host })]
      : [];
  });
  return {
    drags,
    resetAll: () => {
      for (const drag of drags) drag.reset();
    },
  };
}

// --- The browser host --------------------------------------------------------

/** The class the stylesheet dresses the inset probe with (hud.mobile.css): a
 *  hidden full-viewport box whose padding is the four safe-area insets. */
export const SAFE_AREA_PROBE_CLASS = 'touch-safe-area-probe';

/** One inset probe per document, minted on first use and kept (it is inert:
 *  hidden, pointer-inert, out of the accessibility tree). */
const SAFE_AREA_PROBES = new WeakMap<Document, HTMLElement>();

function safeAreaProbe(doc: Document): HTMLElement {
  const existing = SAFE_AREA_PROBES.get(doc);
  if (existing) return existing;
  const probe = doc.createElement('div');
  probe.className = SAFE_AREA_PROBE_CLASS;
  probe.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(probe);
  SAFE_AREA_PROBES.set(doc, probe);
  return probe;
}

function storageOf(win: Window): TouchDragStorage | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}

/** The production host: the window's viewport and resize, the document's
 *  safe-area probe, and localStorage (null when the browser refuses it). */
export function browserTouchDragHost(
  doc: Document = document,
  win: Window = window,
): TouchDragHost {
  return {
    viewport: () => ({ w: win.innerWidth, h: win.innerHeight }),
    safeArea: () => {
      const style = win.getComputedStyle(safeAreaProbe(doc));
      return safeAreaFromPadding({
        top: style.paddingTop,
        right: style.paddingRight,
        bottom: style.paddingBottom,
        left: style.paddingLeft,
      });
    },
    onResize: (listener) => win.addEventListener('resize', listener),
    storage: storageOf(win),
  };
}
