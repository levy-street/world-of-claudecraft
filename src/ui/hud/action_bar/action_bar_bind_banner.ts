// The on-bar action-bar key-binding mode's banner (issue #1238): the hint, the
// status line and the Reset / Done buttons shown while the mode is active. A
// HUD-ROOT element (mounted on #ui, never in #actionbar-stack: a bar moved with
// Interface Unlock is reparented to #ui and painted over a stack-anchored
// banner, eating its Done click), placed against the LIVE bars through the
// DOM-free actionBarBindBannerPlacement core so it clears every visible bar,
// and draggable by its plate so the player can move it off anything it still
// covers. Owns only that DOM; the mode's state machine is the pure
// action_bar_bind_core.ts and action_bar_bind_controller.ts owns the slot
// clicks, the key capture and the confirm dialogs. Registered in
// tests/architecture.test.ts UI_DOM_MODULES.

import { audio } from '../../../game/audio';
import { t } from '../../i18n';
import { getUiScale } from '../../ui_scale';
import { draggedWindowPosition, type WindowDragBounds } from '../../window_drag_core';
import {
  type ActionBarBindBox,
  type ActionBarBindState,
  actionBarBindBannerPlacement,
  actionBarBindStatus,
} from './action_bar_bind_core';

const ACTION_BAR_BIND_BANNER_ID = 'actionbar-bind-banner';

/** The bars the banner must clear, primary first (the placement centres on it).
 *  Looked up by id so a bar Interface Unlock reparented to #ui still counts. */
export const ACTION_BAR_BIND_BANNER_ANCHORS: readonly string[] = [
  '#actionbar',
  '#actionbar2',
  '#actionbar3',
  '#cross-hotbar',
  '#stancebar',
  '#petbar',
  // The cast and swing bars sit directly above the stack: actionable signals
  // the banner must not hide either.
  '#castbar',
  '#swingbar',
  '#swingbar-offhand',
];

/** Build the banner, append it to `parent` (the HUD root), place it clear of
 *  the live bars and make it draggable. Returns the banner root. */
export function mountActionBarBindBanner(
  parent: HTMLElement | null,
  handlers: { onReset: () => void; onDone: () => void },
): HTMLElement {
  const el = document.createElement('div');
  el.id = ACTION_BAR_BIND_BANNER_ID;
  // The banner is a plated surface (the library's strong panel), like every
  // other chrome plate the redesign put under the bar.
  el.className = 'ui-panel-strong';
  el.setAttribute('role', 'status');
  const hint = document.createElement('div');
  hint.className = 'actionbar-bind-hint';
  hint.textContent = t('hudChrome.actionBar.bannerHint');
  const status = document.createElement('div');
  status.className = 'actionbar-bind-status';
  const actions = document.createElement('div');
  actions.className = 'actionbar-bind-actions';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn ui-btn';
  resetBtn.textContent = t('hudChrome.actionBar.reset');
  resetBtn.addEventListener('click', () => {
    audio.click();
    handlers.onReset();
  });
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'btn ui-btn';
  doneBtn.textContent = t('hudChrome.actionBar.done');
  doneBtn.addEventListener('click', () => {
    audio.click();
    handlers.onDone();
  });
  actions.append(resetBtn, doneBtn);
  el.append(hint, status, actions);
  if (!parent) return el;
  parent.appendChild(el);
  placeActionBarBindBanner(el, parent);
  bindActionBarBindBannerDrag(el, parent);
  return el;
}

/** The live box of one anchor in HUD author px, or null when it has no box
 *  (display:none, or hidden under the cross hotbar). getBoundingClientRect
 *  reports VISUAL px (the #ui zoom applied), so it is divided by the scale. */
function anchorBox(root: HTMLElement, selector: string, scale: number): ActionBarBindBox | null {
  const r = root.ownerDocument.querySelector(selector)?.getBoundingClientRect();
  if (!r || r.width <= 0 || r.height <= 0) return null;
  return {
    left: r.left / scale,
    top: r.top / scale,
    width: r.width / scale,
    height: r.height / scale,
  };
}

function liveScale(): number {
  const s = getUiScale();
  return s > 0 ? s : 1;
}

/** The VISIBLE HUD region in author px: the window box divided by the UI
 *  scale. Not the #ui client box, which keeps its full author width under a
 *  scale above 1 and is clipped by the viewport (overflow hidden), so a clamp
 *  against it could park the banner off screen. */
function visibleViewport(uiRoot: HTMLElement, scale: number): { width: number; height: number } {
  const w = uiRoot.ownerDocument.defaultView;
  return {
    width: (w?.innerWidth || uiRoot.clientWidth) / scale,
    height: (w?.innerHeight || uiRoot.clientHeight) / scale,
  };
}

/** Position a connected banner against the live bars (inline left/top in HUD
 *  author px, the same space the banner's own offset size is already in). */
export function placeActionBarBindBanner(el: HTMLElement, uiRoot: HTMLElement): void {
  const scale = liveScale();
  const bars: ActionBarBindBox[] = [];
  for (const sel of ACTION_BAR_BIND_BANNER_ANCHORS) {
    const box = anchorBox(uiRoot, sel, scale);
    if (box) bars.push(box);
  }
  const placed = actionBarBindBannerPlacement({
    bars,
    banner: { width: el.offsetWidth, height: el.offsetHeight },
    viewport: visibleViewport(uiRoot, scale),
  });
  el.style.left = `${placed.left}px`;
  el.style.top = `${placed.top}px`;
}

/** How far one arrow press nudges the banner, in author px (Shift: four times). */
export const ACTION_BAR_BIND_BANNER_NUDGE = 8;

/**
 * Drag the banner by its plate (never by its buttons), so the player can move
 * it off any slot it still covers; a keyboard player nudges it with the arrow
 * keys while Reset or Done has focus. The drag session measures ONCE at
 * pointerdown (size, scale, viewport) and writes one left/top per animation
 * frame, so pointermove never reads layout. Pointer coordinates are visual px;
 * the shared window-drag geometry converts them to author px and keeps the
 * banner inside the visible region. Only the pointer that started the drag can
 * move or end it. The banner also re-places itself against the bars when the
 * window resizes, until the player has moved it by hand.
 */
export function bindActionBarBindBannerDrag(el: HTMLElement, uiRoot: HTMLElement): void {
  type Session = {
    pointerId: number;
    grabX: number;
    grabY: number;
    bounds: WindowDragBounds;
    frame: number;
    pointer: { x: number; y: number } | null;
  };
  let session: Session | null = null;
  let moved = false;
  const bounds = (): WindowDragBounds => {
    const scale = liveScale();
    const vp = visibleViewport(uiRoot, scale);
    return {
      scale,
      viewportWidth: vp.width,
      viewportHeight: vp.height,
      windowWidth: el.offsetWidth,
      windowHeight: el.offsetHeight,
    };
  };
  const write = (pos: { left: number; top: number }) => {
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
    moved = true;
  };
  const flush = () => {
    if (!session) return;
    session.frame = 0;
    if (!session.pointer) return;
    write(
      draggedWindowPosition(
        {
          pointerX: session.pointer.x,
          pointerY: session.pointer.y,
          grabOffsetX: session.grabX,
          grabOffsetY: session.grabY,
        },
        session.bounds,
      ),
    );
  };
  el.addEventListener('pointerdown', (e) => {
    if (session || e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest('button')) return;
    const r = el.getBoundingClientRect();
    session = {
      pointerId: e.pointerId,
      grabX: e.clientX - r.left,
      grabY: e.clientY - r.top,
      bounds: bounds(),
      frame: 0,
      pointer: null,
    };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic or legacy pointer with no capture: the drag still follows
      // moves over the plate itself.
    }
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!session || e.pointerId !== session.pointerId) return;
    session.pointer = { x: e.clientX, y: e.clientY };
    const raf = uiRoot.ownerDocument.defaultView?.requestAnimationFrame;
    if (!raf) {
      flush();
      return;
    }
    if (!session.frame) session.frame = raf(flush);
  });
  const drop = (e: PointerEvent) => {
    if (!session || e.pointerId !== session.pointerId) return;
    flush();
    session = null;
  };
  el.addEventListener('pointerup', drop);
  el.addEventListener('pointercancel', drop);
  el.addEventListener('keydown', (e) => {
    const step = (e.shiftKey ? 4 : 1) * ACTION_BAR_BIND_BANNER_NUDGE;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    e.stopPropagation();
    const b = bounds();
    // Current seat in author px; the grab offset is zero so the pointer IS the
    // new visual origin.
    const left = (Number.parseFloat(el.style.left) || 0) + dx;
    const top = (Number.parseFloat(el.style.top) || 0) + dy;
    write(
      draggedWindowPosition(
        { pointerX: left * b.scale, pointerY: top * b.scale, grabOffsetX: 0, grabOffsetY: 0 },
        b,
      ),
    );
  });
  const win = uiRoot.ownerDocument.defaultView;
  const onResize = () => {
    if (!el.isConnected) {
      win?.removeEventListener('resize', onResize);
      return;
    }
    if (!moved) placeActionBarBindBanner(el, uiRoot);
  };
  win?.addEventListener('resize', onResize);
}

/** Paint the status line for the mode's current state. */
export function setActionBarBindBannerStatus(banner: HTMLElement, state: ActionBarBindState): void {
  const el = banner.querySelector<HTMLElement>('.actionbar-bind-status');
  if (!el) return;
  const status = actionBarBindStatus(state);
  el.textContent =
    status === 'capturing'
      ? t('hudChrome.actionBar.bannerCapturing')
      : status === 'bound'
        ? t('hudChrome.actionBar.boundToKey', { key: state.lastBoundKeyLabel ?? '' })
        : '';
}
