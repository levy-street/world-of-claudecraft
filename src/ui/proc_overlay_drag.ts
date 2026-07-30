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

/** Clamp a proposed anchor so the element (w x h px in a vw x vh viewport)
 *  always keeps its full body on screen. Pure. */
export function clampOverlayAnchor(
  fx: number,
  fy: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
): OverlayAnchor {
  const halfW = vw > 0 ? w / 2 / vw : 0;
  const halfH = vh > 0 ? h / 2 / vh : 0;
  const cx = Math.min(1 - halfW, Math.max(halfW, fx));
  const cy = Math.min(1 - halfH, Math.max(halfH, fy));
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
  const apply = (a: OverlayAnchor) => {
    const c = clampOverlayAnchor(
      a.fx,
      a.fy,
      el.offsetWidth || 0,
      el.offsetHeight || 0,
      window.innerWidth,
      window.innerHeight,
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
}
