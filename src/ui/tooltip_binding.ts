// Shared tooltip input wiring. Mouse hover can be disabled independently of
// keyboard focus and touch inspection; content and slot kinds resolve live.
import { type TooltipViewport, tooltipPlacementAt } from './tooltip_clamp_core';
import type { SharedTooltipOwner } from './tooltip_owner';
import { TOOLTIP_PEEK_MS, type TouchPeekGuard } from './touch_peek';

export interface TooltipBindingDeps {
  peekGuard: TouchPeekGuard;
  tooltipOwner: SharedTooltipOwner<HTMLElement>;
  tooltipEl: HTMLElement;
  paintTooltipAt(html: string, x: number, y: number): { w: number; h: number };
  tooltipViewport(): TooltipViewport;
  hoverAllowed(): boolean;
  /** Told which repaint closure owns the visible box (null once hidden), so a
   *  modifier-key change (Shift for ability details) can re-resolve the live
   *  content in place without waiting for the pointer to move. */
  setActiveRepaint?(repaint: (() => void) | null): void;
}

export function bindTooltip(el: HTMLElement, html: () => string, deps: TooltipBindingDeps): void {
  let touchTimer: number | undefined;
  // tooltip box size, measured once in showAt (right after the content is set)
  // and reused by every mousemove: the content cannot change between showAt
  // calls, so re-reading offsetWidth/Height per mousemove only forced a reflow
  let ttW = 0;
  let ttH = 0;
  // Last paint anchor, kept current by mousemove so an in-place repaint lands
  // where the box already is.
  let lastX = 0;
  let lastY = 0;
  // What this element last painted: the HTML string, and the first node it
  // produced in the shared box. A foreign paint (the mob card, a map marker)
  // replaces the box's children without going through this binding, so a
  // changed first child means the box is no longer ours.
  let lastHtml = '';
  let paintedFirst: ChildNode | null = null;
  const paint = () => {
    lastHtml = html();
    const size = deps.paintTooltipAt(lastHtml, lastX, lastY);
    paintedFirst = deps.tooltipEl.firstChild;
    ttW = size.w;
    ttH = size.h;
  };
  // The external in-place repaint (a modifier-key flip). It only repaints
  // when this element still owns the visible box AND its content changed, so
  // a Shift press never paints over another surface's card and never
  // re-measures a tooltip whose HTML does not depend on the modifier.
  const repaintIfOwned = () => {
    if (deps.tooltipOwner.current() !== el) return;
    if (deps.tooltipEl.style.display === 'none') return;
    if (deps.tooltipEl.firstChild !== paintedFirst) return;
    if (html() === lastHtml) return;
    paint();
  };
  const mobile = () => document.body.classList.contains('mobile-touch');
  const clearTouchTimer = () => {
    if (touchTimer !== undefined) window.clearTimeout(touchTimer);
    touchTimer = undefined;
  };
  const showAt = (x: number, y: number, trigger: 'touch' | 'mouse' | 'focus') => {
    // Touch-only path: showing the tooltip means the held control is being
    // inspected, so the release click should peek, not fire its action.
    deps.peekGuard.tooltipShown(trigger);
    lastX = x;
    lastY = y;
    // cache the measured box for the mousemove clamp below (no forced reflow)
    paint();
    // This element now owns the shared box, so its own mousemove keeps the
    // cheap reposition-only path and a hover onto any other element re-resolves.
    deps.tooltipOwner.claim(el);
    deps.setActiveRepaint?.(repaintIfOwned);
  };
  const showNearElement = () => {
    const rect = el.getBoundingClientRect();
    showAt(rect.right, rect.top + rect.height / 2, 'focus');
  };
  // A mouse click or a tap focuses the button as a side effect (the browser
  // moves focus to whatever was pressed), which used to fire showNearElement
  // on EVERY action-bar press, not just real keyboard (Tab) navigation. Flag
  // the pointer press so the very next focusin it causes is skipped; Tab
  // never fires pointerdown first, so keyboard users still get the tooltip.
  let pointerFocusPending = false;
  el.addEventListener('pointerdown', () => {
    pointerFocusPending = true;
  });
  el.addEventListener('focusin', () => {
    if (el.dataset.suppressFocusTooltip === 'true') {
      delete el.dataset.suppressFocusTooltip;
      return;
    }
    if (pointerFocusPending) {
      pointerFocusPending = false;
      return;
    }
    showNearElement();
  });
  el.addEventListener('mouseenter', () => {
    if (mobile() || !deps.hoverAllowed()) return;
    const rect = el.getBoundingClientRect();
    showAt(rect.right, rect.top + rect.height / 2, 'mouse');
  });
  el.addEventListener('mousemove', (e) => {
    if (mobile() || !deps.hoverAllowed()) return;
    // The shared box may be showing another element's content: a drag-drop
    // that ended inside a slot fires no mouseenter, and Firefox re-enters the
    // drag SOURCE after a native drag, so the visible tooltip can belong to a
    // different (or no) element while the cursor sits over this one (#1626).
    // Repaint this element's own tooltip in that case; the common in-slot move
    // stays on the cheap reposition-only path below.
    if (deps.tooltipOwner.needsReshow(el)) {
      showAt(e.clientX, e.clientY, 'mouse');
      return;
    }
    lastX = e.clientX;
    lastY = e.clientY;
    // reuse the box size measured in showAt: same content, no forced reflow
    const at = tooltipPlacementAt(e.clientX, e.clientY, { w: ttW, h: ttH }, deps.tooltipViewport());
    deps.tooltipEl.style.left = `${at.left}px`;
    deps.tooltipEl.style.top = `${at.top}px`;
  });
  el.addEventListener('mouseleave', () => {
    clearTouchTimer();
    deps.tooltipEl.style.display = 'none';
    // Box hidden: no element owns it, so the next move over any slot re-resolves.
    deps.tooltipOwner.release();
    deps.setActiveRepaint?.(null);
  });
  el.addEventListener('focusout', () => {
    clearTouchTimer();
    deps.tooltipEl.style.display = 'none';
    deps.tooltipOwner.release();
    deps.setActiveRepaint?.(null);
  });
  el.addEventListener('pointerdown', (e) => {
    if (!mobile() || e.pointerType === 'mouse') return;
    clearTouchTimer();
    // A fresh press: drop any stale peek and dismiss a lingering tooltip.
    deps.peekGuard.press();
    deps.tooltipEl.style.display = 'none';
    const x = e.clientX,
      y = e.clientY;
    touchTimer = window.setTimeout(() => showAt(x, y, 'touch'), TOOLTIP_PEEK_MS);
  });
  el.addEventListener('pointerup', () => {
    clearTouchTimer();
    // Safari desktop never focuses a button on click, so pointerdown's flag
    // above would otherwise never get consumed by a focusin and could wrongly
    // swallow a later, real keyboard-focus tooltip; drop it once the press ends.
    pointerFocusPending = false;
  });
  el.addEventListener('pointercancel', () => {
    clearTouchTimer();
    pointerFocusPending = false;
  });
}
