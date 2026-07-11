// Mobile chat overlay controller: the DOM wiring behind the movable, resizable
// body.mobile-chat-open panel. Owns the two grab affordances (a 40x40 move chip
// at the panel's top-right corner and the body-level bottom resize bar), the
// --mobile-chat-left/top/h CSS vars the open-state rules in hud.mobile.css
// consume, and the localStorage persistence (one JSON key, plus a one-time
// migration from the legacy bottom-inset key). The pure geometry math
// (clamping, (de)serialization, migration) lives in chat_mobile_panel.ts, the
// mobile sibling of the desktop chat_window.ts + hud.ts pairing.
//
// Touch ownership: the move chip lives INSIDE #chatlog-wrap, which
// touch_router.ts already classifies as interactive HUD chrome, so a drag on it
// can never fall through to the camera; the resize bar stays a body-level
// element (its very high z-index must not be capped by an ancestor stacking
// context) and owns its touches via pointer capture + touch-action:none, same
// as the model it replaces. Desktop is untouched: both affordances are
// display:none outside body.mobile-touch.mobile-chat-open, and every gesture
// gates on the mobile layout.

import {
  clampMobileChatPanel,
  defaultMobileChatWidth,
  MOBILE_CHAT_PANEL_LIMITS,
  type MobileChatPanelGeom,
  migrateMobileChatBottomInset,
  parseMobileChatPanel,
  serializeMobileChatPanel,
} from './chat_mobile_panel';
import { t } from './i18n';

// Persisted mobile chat panel geometry: left/top/height as one JSON blob
// (chat_mobile_panel.ts round-trips it). CSS clamps the applied vars as a
// backstop, and every restore re-clamps in JS for the live viewport, so a value
// saved in one orientation stays safe in another.
export const MOBILE_CHAT_PANEL_KEY = 'woc_mobile_chat_panel';
// The pre-move model's key (a bare px bottom inset from the resize handle).
// Read once as a seed when the new key is absent, so an existing player's
// chosen panel size survives the model change.
const LEGACY_MOBILE_CHAT_BOTTOM_KEY = 'woc_mobile_chat_bottom';

// Four-direction move glyph (MDI cursor-move), drawn in the chip's currentColor.
const MOVE_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M13 6v5h5V7.75L22.25 12 18 16.25V13h-5v5h3.25L12 22.25 ' +
  '7.75 18H11v-5H6v3.25L1.75 12 6 7.75V11h5V6H7.75L12 1.75 16.25 6H13Z"/></svg>';

export class ChatMobileOverlay {
  private geom: MobileChatPanelGeom | null = null;
  private move: { pointerId: number; grabX: number; grabY: number } | null = null;
  private resize: { pointerId: number; startY: number; startTop: number; startH: number } | null =
    null;

  constructor(private readonly wrap: HTMLElement) {
    // Bottom resize bar: a BODY-LEVEL element (not #ui / the wrap) so its
    // z-index is not capped by an ancestor stacking context; CSS pins it to the
    // panel's bottom edge via the same resolved top/height vars, so they track
    // with no per-frame JS. touch-action:none makes a drag a RESIZE, not a
    // page scroll. Hidden on desktop and while the OS keyboard is up.
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'chat-mobile-resize';
    resizeHandle.title = t('hudChrome.chatWindow.resize');
    resizeHandle.setAttribute('aria-hidden', 'true');
    document.body.appendChild(resizeHandle);
    resizeHandle.addEventListener('pointerdown', (ev) => this.onResizeStart(ev, resizeHandle));
    resizeHandle.addEventListener('pointermove', (ev) => this.onResizeMove(ev));
    const endResize = (ev: PointerEvent) => this.onResizeEnd(ev);
    resizeHandle.addEventListener('pointerup', endResize);
    resizeHandle.addEventListener('pointercancel', endResize);

    // Move chip: a real button at the panel's top-right corner (40x40 touch
    // floor), inside the wrap so the touch router owns its touches. Dragging it
    // moves the whole overlay; position persists with the size.
    const moveHandle = document.createElement('button');
    moveHandle.type = 'button';
    moveHandle.className = 'chat-mobile-move';
    moveHandle.setAttribute('aria-label', t('hudChrome.chatWindow.move'));
    moveHandle.title = t('hudChrome.chatWindow.move');
    moveHandle.innerHTML = MOVE_ICON_SVG;
    wrap.appendChild(moveHandle);
    moveHandle.addEventListener('pointerdown', (ev) => this.onMoveStart(ev, moveHandle));
    moveHandle.addEventListener('pointermove', (ev) => this.onMoveMove(ev));
    const endMove = (ev: PointerEvent) => this.onMoveEnd(ev);
    moveHandle.addEventListener('pointerup', endMove);
    moveHandle.addEventListener('pointercancel', endMove);

    this.restore();
    // Re-clamp into view when the viewport changes (a rotation must never
    // strand the panel off-screen; mirrors the desktop chat box logic).
    window.addEventListener('resize', () => {
      if (this.geom) this.apply();
    });
  }

  /** Snap the panel back to its stock CSS seat and forget the saved geometry.
   *  Reached through Hud.resetChatWindow (the "Reset Chat Window" option). */
  reset(): void {
    this.move = null;
    this.resize = null;
    document.body.classList.remove('chat-box-dragging');
    this.geom = null;
    try {
      localStorage.removeItem(MOBILE_CHAT_PANEL_KEY);
      localStorage.removeItem(LEGACY_MOBILE_CHAT_BOTTOM_KEY);
    } catch {
      /* storage unavailable */
    }
    for (const prop of ['--mobile-chat-left', '--mobile-chat-top', '--mobile-chat-h'])
      document.documentElement.style.removeProperty(prop);
  }

  private isMobileLayout(): boolean {
    return document.body.classList.contains('mobile-touch');
  }

  private viewport(): { w: number; h: number } {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  /** The panel's live width for clamping; falls back to the CSS default
   *  formula while the wrap is display:none (restore happens before the panel
   *  first opens). */
  private width(): number {
    const w = this.wrap.getBoundingClientRect().width;
    return w > 0 ? w : defaultMobileChatWidth(window.innerWidth);
  }

  private restore(): void {
    let saved: string | null = null;
    let legacy: string | null = null;
    try {
      saved = localStorage.getItem(MOBILE_CHAT_PANEL_KEY);
      legacy = localStorage.getItem(LEGACY_MOBILE_CHAT_BOTTOM_KEY);
    } catch {
      /* storage unavailable */
    }
    const parsed =
      parseMobileChatPanel(saved) ?? migrateMobileChatBottomInset(legacy, this.viewport());
    if (!parsed) return;
    this.geom = parsed;
    this.apply();
    // One-time upgrade: a legacy inset that seeded the geometry is re-saved
    // under the new key (post-clamp), so the next session reads it directly.
    if (!saved) this.persist();
  }

  // Seed the geometry from the live layout the first time a gesture starts, so
  // a panel still on its CSS-default seat converts cleanly to explicit px.
  private ensureGeom(): void {
    if (this.geom) return;
    const rect = this.wrap.getBoundingClientRect();
    this.geom = { left: rect.left, top: rect.top, height: rect.height };
  }

  /** Clamp, stamp the CSS vars (documentElement, so the wrap's open rule AND
   *  the body-level resize bar resolve the same values), and keep this.geom on
   *  the clamped result so the next gesture starts in range. */
  private apply(): void {
    if (!this.geom) return;
    this.geom = clampMobileChatPanel(this.geom, this.viewport(), this.width());
    const s = document.documentElement.style;
    s.setProperty('--mobile-chat-left', `${Math.round(this.geom.left)}px`);
    s.setProperty('--mobile-chat-top', `${Math.round(this.geom.top)}px`);
    s.setProperty('--mobile-chat-h', `${Math.round(this.geom.height)}px`);
  }

  private persist(): void {
    if (!this.geom) return;
    try {
      localStorage.setItem(MOBILE_CHAT_PANEL_KEY, serializeMobileChatPanel(this.geom));
    } catch {
      /* storage unavailable */
    }
  }

  private onMoveStart(ev: PointerEvent, handle: HTMLElement): void {
    if (!this.isMobileLayout()) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.ensureGeom();
    if (!this.geom) return;
    this.move = {
      pointerId: ev.pointerId,
      grabX: ev.clientX - this.geom.left,
      grabY: ev.clientY - this.geom.top,
    };
    document.body.classList.add('chat-box-dragging');
    try {
      handle.setPointerCapture?.(ev.pointerId);
    } catch {
      /* synthetic pointer */
    }
  }

  private onMoveMove(ev: PointerEvent): void {
    const g = this.move;
    if (!g || g.pointerId !== ev.pointerId || !this.geom) return;
    ev.preventDefault();
    this.geom = { ...this.geom, left: ev.clientX - g.grabX, top: ev.clientY - g.grabY };
    this.apply();
  }

  private onMoveEnd(ev: PointerEvent): void {
    const g = this.move;
    if (!g || g.pointerId !== ev.pointerId) return;
    this.move = null;
    document.body.classList.remove('chat-box-dragging');
    this.persist();
  }

  private onResizeStart(ev: PointerEvent, handle: HTMLElement): void {
    if (!this.isMobileLayout()) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.ensureGeom();
    if (!this.geom) return;
    this.resize = {
      pointerId: ev.pointerId,
      startY: ev.clientY,
      startTop: this.geom.top,
      startH: this.geom.height,
    };
    document.body.classList.add('chat-box-dragging');
    try {
      handle.setPointerCapture?.(ev.pointerId);
    } catch {
      /* synthetic pointer */
    }
  }

  private onResizeMove(ev: PointerEvent): void {
    const g = this.resize;
    if (!g || g.pointerId !== ev.pointerId || !this.geom) return;
    ev.preventDefault();
    // The top edge stays put while the bottom follows the finger. Cap the
    // height to the room below the CURRENT top first, so the generic clamp
    // never has to slide the panel up mid-drag to make an oversized height fit.
    const room = this.viewport().h - g.startTop - MOBILE_CHAT_PANEL_LIMITS.margin;
    const height = Math.min(g.startH + (ev.clientY - g.startY), room);
    this.geom = { ...this.geom, top: g.startTop, height };
    this.apply();
  }

  private onResizeEnd(ev: PointerEvent): void {
    const g = this.resize;
    if (!g || g.pointerId !== ev.pointerId) return;
    this.resize = null;
    document.body.classList.remove('chat-box-dragging');
    this.persist();
  }
}
