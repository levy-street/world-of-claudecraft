// Binding one element to the shared `#tooltip` box.
//
// Lifted out of hud.ts unchanged: this is a self-contained piece of pointer/focus/touch
// choreography (six listeners, three pieces of local state, and a documented workaround per
// browser quirk) that only ever needed five things from the coordinator, and the HUD is a
// named extraction target. Every behaviour and every comment below is the shipped one; the
// only edit is that the five reaches through `this` are now a host bag.
//
// There is exactly ONE tooltip box for the whole HUD, which is what most of the subtlety is
// about: several elements bind to it, so each has to know whether the content currently in
// the box is still its own (`owner`) before it takes the cheap reposition-only path.
//
// Owns browser state (listeners, timers, `window.setTimeout`); registered in
// tests/architecture.test.ts UI_DOM_MODULES.

import type { SharedTooltipOwner } from './tooltip_owner';
import { TOOLTIP_PEEK_MS } from './touch_peek';
import { getUiScale } from './ui_scale';

/** What binding an element to the shared box needs from the HUD that owns it. */
export interface SharedTooltipHost {
  /** The shared `#tooltip` element, resolved per use: the HUD re-seats it on some layouts. */
  box: () => HTMLElement;
  /**
   * True while a mobile hotbar drag owns the pointer. A tooltip appearing mid-drag would
   * sit under the finger that is dragging and cover the slot being aimed at.
   */
  dragActive: () => boolean;
  /**
   * The touch peek/press arbiter. On touch, showing a tooltip means the control is being
   * INSPECTED, so the release click has to peek instead of firing the action.
   */
  peekGuard: { tooltipShown(trigger: 'touch' | 'mouse' | 'focus'): void; press(): void };
  /** Who currently owns the shared box. */
  owner: SharedTooltipOwner<HTMLElement>;
  /** Paint content into the box at a screen point and report its measured size. */
  paintAt: (html: string, x: number, y: number) => { w: number; h: number };
}

export function attachSharedTooltip(
  el: HTMLElement,
  html: () => string,
  host: SharedTooltipHost,
): void {
  let touchTimer: number | undefined;
  // tooltip box size, measured once in showAt (right after the content is set)
  // and reused by every mousemove: the content cannot change between showAt
  // calls, so re-reading offsetWidth/Height per mousemove only forced a reflow
  let ttW = 0;
  let ttH = 0;
  const mobile = () => document.body.classList.contains('mobile-touch');
  const clearTouchTimer = () => {
    if (touchTimer !== undefined) window.clearTimeout(touchTimer);
    touchTimer = undefined;
  };
  const showAt = (x: number, y: number, trigger: 'touch' | 'mouse' | 'focus') => {
    if (host.dragActive()) return;
    // Touch-only path: showing the tooltip means the held control is being
    // inspected, so the release click should peek, not fire its action.
    host.peekGuard.tooltipShown(trigger);
    const size = host.paintAt(html(), x, y);
    // cache the measured box for the mousemove clamp below (no forced reflow)
    ttW = size.w;
    ttH = size.h;
    // This element now owns the shared box, so its own mousemove keeps the
    // cheap reposition-only path and a hover onto any other element re-resolves.
    host.owner.claim(el);
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
    if (mobile()) return;
    const rect = el.getBoundingClientRect();
    showAt(rect.right, rect.top + rect.height / 2, 'mouse');
  });
  el.addEventListener('mousemove', (e) => {
    if (mobile()) return;
    // The shared box may be showing another element's content: a drag-drop
    // that ended inside a slot fires no mouseenter, and Firefox re-enters the
    // drag SOURCE after a native drag, so the visible tooltip can belong to a
    // different (or no) element while the cursor sits over this one (#1626).
    // Repaint this element's own tooltip in that case; the common in-slot move
    // stays on the cheap reposition-only path below.
    if (host.owner.needsReshow(el)) {
      showAt(e.clientX, e.clientY, 'mouse');
      return;
    }
    const z = getUiScale();
    // reuse the box size measured in showAt: same content, no forced reflow
    const tw = ttW,
      th = ttH;
    host.box().style.left = `${Math.min(window.innerWidth / z - tw - 8, e.clientX / z + 14)}px`;
    host.box().style.top = `${Math.max(8, e.clientY / z - th - 10)}px`;
  });
  el.addEventListener('mouseleave', () => {
    clearTouchTimer();
    host.box().style.display = 'none';
    // Box hidden: no element owns it, so the next move over any slot re-resolves.
    host.owner.release();
  });
  el.addEventListener('focusout', () => {
    clearTouchTimer();
    host.box().style.display = 'none';
    host.owner.release();
  });
  el.addEventListener('pointerdown', (e) => {
    if (!mobile() || e.pointerType === 'mouse') return;
    clearTouchTimer();
    // A fresh press: drop any stale peek and dismiss a lingering tooltip.
    host.peekGuard.press();
    host.box().style.display = 'none';
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
