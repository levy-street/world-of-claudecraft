// Drag-to-move for the proc overlay (the Rising Phoenix, owner request
// 2026-07-11): grab the phoenix while it is visible and park it anywhere on
// screen; the spot persists to localStorage as viewport FRACTIONS so it
// survives window resizes and resolution changes. Event-driven only (pointer
// events), no per-frame cost, so this is a plain sibling module, not a painter.
//
// The pure half (clamp + serialize round-trip) is Node-testable; the DOM
// attacher below is the thin consumer.

/** A saved overlay anchor: the element CENTER as fractions of the viewport. */
export interface OverlayAnchor {
  /** 0..1, fraction of viewport width. */
  fx: number;
  /** 0..1, fraction of viewport height. */
  fy: number;
}

export interface OverlaySafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_SAFE_AREA: OverlaySafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

/** Clamp a proposed anchor so the element (w x h px in a vw x vh viewport)
 *  always keeps its full body inside the viewport safe area. Pure. */
export function clampOverlayAnchor(
  fx: number,
  fy: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  safeArea: OverlaySafeArea = NO_SAFE_AREA,
): OverlayAnchor {
  const inset = (value: number, limit: number) =>
    Number.isFinite(value) ? Math.min(limit, Math.max(0, value)) : 0;
  const left = inset(safeArea.left, vw);
  const right = inset(safeArea.right, vw);
  const top = inset(safeArea.top, vh);
  const bottom = inset(safeArea.bottom, vh);
  const minX = vw > 0 ? (left + w / 2) / vw : 0;
  const maxX = vw > 0 ? 1 - (right + w / 2) / vw : 1;
  const minY = vh > 0 ? (top + h / 2) / vh : 0;
  const maxY = vh > 0 ? 1 - (bottom + h / 2) / vh : 1;
  const cx = minX <= maxX ? Math.min(maxX, Math.max(minX, fx)) : (left + vw - right) / 2 / vw;
  const cy = minY <= maxY ? Math.min(maxY, Math.max(minY, fy)) : (top + vh - bottom) / 2 / vh;
  return { fx: Number.isFinite(cx) ? cx : 0.5, fy: Number.isFinite(cy) ? cy : 0.5 };
}

/** Parse a stored anchor; null on anything malformed (falls back to default). Pure. */
export function parseOverlayAnchor(raw: string | null): OverlayAnchor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { fx?: unknown; fy?: unknown };
    if (typeof v.fx !== 'number' || typeof v.fy !== 'number') return null;
    if (!Number.isFinite(v.fx) || !Number.isFinite(v.fy)) return null;
    return { fx: Math.min(1, Math.max(0, v.fx)), fy: Math.min(1, Math.max(0, v.fy)) };
  } catch {
    return null;
  }
}

export function serializeOverlayAnchor(a: OverlayAnchor): string {
  return JSON.stringify({ fx: a.fx, fy: a.fy });
}

/** Move an anchor by a keyboard arrow step and keep the whole overlay clear of
 *  the viewport safe area. `safeArea` defaults like clampOverlayAnchor's own
 *  NO_SAFE_AREA so this stays plain-argument testable; the DOM attacher below
 *  passes the same safeArea() the pointer-drop path clamps against. */
export function nudgeOverlayAnchor(
  anchor: OverlayAnchor,
  key: string,
  stepPx: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  safeArea: OverlaySafeArea = NO_SAFE_AREA,
): OverlayAnchor | null {
  let dx = 0;
  let dy = 0;
  if (key === 'ArrowLeft') dx = -stepPx;
  else if (key === 'ArrowRight') dx = stepPx;
  else if (key === 'ArrowUp') dy = -stepPx;
  else if (key === 'ArrowDown') dy = stepPx;
  else return null;
  return clampOverlayAnchor(anchor.fx + dx / vw, anchor.fy + dy / vh, w, h, vw, vh, safeArea);
}

/**
 * Make `el` (a fixed-position element centered via left/top) draggable and
 * persistent. The element is expected to be visible only while its proc is
 * up; dragging is naturally scoped to those moments. Applies the stored (or
 * default) anchor immediately and re-clamps on viewport resize.
 */
export function attachOverlayDrag(
  el: HTMLElement,
  storageKey: string,
  defaults: OverlayAnchor,
): void {
  const safeAreaProbe = document.createElement('div');
  Object.assign(safeAreaProbe.style, {
    position: 'fixed',
    inset: '0',
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingRight: 'env(safe-area-inset-right, 0px)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    paddingLeft: 'env(safe-area-inset-left, 0px)',
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  safeAreaProbe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(safeAreaProbe);
  const safeArea = (): OverlaySafeArea => {
    const style = getComputedStyle(safeAreaProbe);
    const pixels = (value: string) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return {
      top: pixels(style.paddingTop),
      right: pixels(style.paddingRight),
      bottom: pixels(style.paddingBottom),
      left: pixels(style.paddingLeft),
    };
  };
  const apply = (a: OverlayAnchor) => {
    const c = clampOverlayAnchor(
      a.fx,
      a.fy,
      el.offsetWidth || 0,
      el.offsetHeight || 0,
      window.innerWidth,
      window.innerHeight,
      safeArea(),
    );
    el.style.left = `${(c.fx * 100).toFixed(2)}%`;
    el.style.top = `${(c.fy * 100).toFixed(2)}%`;
  };
  let anchor = parseOverlayAnchor(localStorage.getItem(storageKey)) ?? defaults;
  apply(anchor);
  window.addEventListener('resize', () => apply(anchor));

  let dragId: number | null = null;
  let grabDx = 0; // pointer-to-center offset at grab, in px, kept while dragging
  let grabDy = 0;
  el.addEventListener('pointerdown', (ev) => {
    if (dragId !== null) return;
    dragId = ev.pointerId;
    const r = el.getBoundingClientRect();
    grabDx = ev.clientX - (r.left + r.width / 2);
    grabDy = ev.clientY - (r.top + r.height / 2);
    el.setPointerCapture(ev.pointerId);
    el.classList.add('dragging');
    if (el.tabIndex >= 0) el.focus({ preventScroll: true });
    ev.preventDefault();
    ev.stopPropagation();
  });
  el.addEventListener('pointermove', (ev) => {
    if (dragId !== ev.pointerId) return;
    anchor = {
      fx: (ev.clientX - grabDx) / window.innerWidth,
      fy: (ev.clientY - grabDy) / window.innerHeight,
    };
    apply(anchor);
  });
  const drop = (ev: PointerEvent) => {
    if (dragId !== ev.pointerId) return;
    dragId = null;
    el.classList.remove('dragging');
    localStorage.setItem(storageKey, serializeOverlayAnchor(anchor));
  };
  el.addEventListener('pointerup', drop);
  el.addEventListener('pointercancel', drop);
  el.addEventListener('keydown', (ev) => {
    const moved = nudgeOverlayAnchor(
      anchor,
      ev.key,
      ev.shiftKey ? 1 : 10,
      el.offsetWidth || 0,
      el.offsetHeight || 0,
      window.innerWidth,
      window.innerHeight,
      safeArea(),
    );
    if (!moved) return;
    anchor = moved;
    apply(anchor);
    localStorage.setItem(storageKey, serializeOverlayAnchor(anchor));
    ev.preventDefault();
    ev.stopPropagation();
  });
}
