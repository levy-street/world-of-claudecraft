// Shared movable / lockable unit-frame controller: the DOM wiring behind the
// small corner button that toggles a frame between locked (fixed) and unlocked
// (draggable), the pointer drag itself, and localStorage persistence of the
// chosen spot. Extracted from the hud.ts target-frame cluster on its second
// instance (the player frame), INSTANCE-PARAMETERIZED per the HUD component
// recipe: each frame passes its element, storage key, labels, and body class.
// The pure position math (clamping, (de)serialization) stays in
// target_frame_pos.ts; the saved spot survives reloads, the lock state does not
// (a frame always loads locked so a stray drag never moves it). Desktop only:
// the button is hidden on mobile-touch by CSS and the drag gate checks
// isMobileLayout(), where the mobile stylesheet owns frame positions.

import { t } from './i18n';
import type { TranslationKey } from './i18n.catalog';
import {
  parseTargetFramePos,
  placeTargetFrame,
  serializeTargetFramePos,
  type TargetFramePos,
} from './target_frame_pos';
import { getUiScale } from './ui_scale';

export interface MovableFrameConfig {
  frame: HTMLElement;
  /** localStorage key the chosen top-left persists under. */
  storageKey: string;
  /** aria-label / title while LOCKED (aria-pressed=false): press to move it. */
  unlockLabelKey: TranslationKey;
  /** aria-label / title while UNLOCKED (aria-pressed=true): press to fix it. */
  lockLabelKey: TranslationKey;
  /** Body class set while a drag is live (CSS disables user-select under it). */
  draggingBodyClass: string;
  /** Nominal size used to clamp a saved spot while the frame is display:none. */
  fallbackSize: { w: number; h: number };
  isMobileLayout(): boolean;
  /** Fired whenever a custom position starts (true) or stops (false) applying,
   *  e.g. the player frame detaches from the action-bar stack to position:fixed. */
  onPositioned?(active: boolean): void;
}

export class MovableFrame {
  private pos: TargetFramePos | null = null;
  private unlocked = false;
  private gesture: { pointerId: number; grabX: number; grabY: number } | null = null;
  private readonly btn: HTMLButtonElement;

  constructor(private readonly cfg: MovableFrameConfig) {
    // The corner toggle. Built here (like the chat resize grip) so index.html
    // stays untouched; its glyph + position are styled in hud.css.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tf-move-btn';
    btn.setAttribute('aria-pressed', 'false');
    cfg.frame.appendChild(btn);
    this.btn = btn;
    this.refreshBtn();
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.setUnlocked(!this.unlocked);
    });

    // touch-action:none (so a drag is not stolen by browser panning) is scoped to
    // the unlocked state in CSS (.unitframe.tf-unlocked), never applied while
    // locked so it cannot interfere with normal touch behaviour on the frame.
    cfg.frame.addEventListener('pointerdown', (ev) => this.onMoveStart(ev));
    document.addEventListener('pointermove', (ev) => this.onPointerMove(ev));
    const end = (ev: PointerEvent) => this.onPointerEnd(ev);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    // Re-clamp into view when the viewport changes (mirrors the chat box logic).
    window.addEventListener('resize', () => {
      if (this.pos) this.applyPos();
    });

    let saved: string | null = null;
    try {
      saved = localStorage.getItem(cfg.storageKey);
    } catch {
      /* storage unavailable */
    }
    this.pos = parseTargetFramePos(saved);
    if (this.pos) this.applyPos();
  }

  /** Re-resolve the button's t() label in place (called on a language switch). */
  relocalize(): void {
    this.refreshBtn();
  }

  /** Repaint the saved visual-space position against the live UI Scale. */
  reapplyPosition(): void {
    if (this.pos) this.applyPos();
  }

  /** Snap the frame back to its stock CSS spot: forget the saved position,
   *  clear the inline styles, undo any detach (onPositioned(false)), and lock
   *  the frame. Wired to the "Reset Frame Positions" interface option. */
  reset(): void {
    if (this.gesture) {
      this.gesture = null;
      document.body.classList.remove(this.cfg.draggingBodyClass);
    }
    this.pos = null;
    try {
      localStorage.removeItem(this.cfg.storageKey);
    } catch {
      /* storage unavailable */
    }
    for (const prop of ['left', 'top', 'right', 'bottom'])
      this.cfg.frame.style.removeProperty(prop);
    this.cfg.onPositioned?.(false);
    this.setUnlocked(false);
  }

  // The move button's accessible name / tooltip and pressed state track whether the
  // frame is unlocked; the frame gets a class so the cursor + drag affordance show.
  private refreshBtn(): void {
    const label = this.unlocked ? t(this.cfg.lockLabelKey) : t(this.cfg.unlockLabelKey);
    this.btn.setAttribute('aria-pressed', this.unlocked ? 'true' : 'false');
    this.btn.setAttribute('aria-label', label);
    this.btn.title = label;
    this.btn.classList.toggle('active', this.unlocked);
    this.cfg.frame.classList.toggle('tf-unlocked', this.unlocked);
  }

  private setUnlocked(unlocked: boolean): void {
    this.unlocked = unlocked;
    this.refreshBtn();
  }

  // Seed the position from the live rect the first time a drag starts, so a frame
  // still on its CSS default converts cleanly to explicit px coordinates.
  private ensurePos(): void {
    if (this.pos) return;
    const rect = this.cfg.frame.getBoundingClientRect();
    this.pos = { left: rect.left, top: rect.top };
  }

  private onMoveStart(ev: PointerEvent): void {
    if (ev.button !== 0 || this.cfg.isMobileLayout() || !this.unlocked) return;
    const target = ev.target as HTMLElement | null;
    // The move button (and any icon buttons inside the frame) keep their own
    // behaviour; only the frame body area initiates a drag.
    if (!target || target.closest('button')) return;
    ev.preventDefault();
    this.ensurePos();
    // Apply the position NOW (converting a CSS-default spot to explicit px and
    // firing any detach side effect) so the grab offsets below are measured
    // against the frame's final dragged size, not its docked one.
    this.applyPos();
    const rect = this.cfg.frame.getBoundingClientRect();
    this.gesture = {
      pointerId: ev.pointerId,
      grabX: ev.clientX - rect.left,
      grabY: ev.clientY - rect.top,
    };
    document.body.classList.add(this.cfg.draggingBodyClass);
    try {
      this.cfg.frame.setPointerCapture?.(ev.pointerId);
    } catch {
      /* synthetic pointer */
    }
  }

  private onPointerMove(ev: PointerEvent): void {
    const g = this.gesture;
    if (!g || g.pointerId !== ev.pointerId) return;
    ev.preventDefault();
    this.pos = { left: ev.clientX - g.grabX, top: ev.clientY - g.grabY };
    this.applyPos();
  }

  private onPointerEnd(ev: PointerEvent): void {
    const g = this.gesture;
    if (!g || g.pointerId !== ev.pointerId) return;
    this.gesture = null;
    document.body.classList.remove(this.cfg.draggingBodyClass);
    this.persistPos();
  }

  private applyPos(): void {
    if (!this.pos) return;
    const frame = this.cfg.frame;
    // On the mobile layout the desktop-saved position must not apply. Clear any
    // inline left/top/right/bottom (e.g. left over after a live desktop-to-mobile
    // viewport shrink) so the mobile stylesheet owns the frame's position again.
    if (this.cfg.isMobileLayout()) {
      for (const prop of ['left', 'top', 'right', 'bottom']) frame.style.removeProperty(prop);
      this.cfg.onPositioned?.(false);
      return;
    }
    // Detach BEFORE measuring: a docked frame (the player frame in the action-bar
    // stack) changes size when its detached style kicks in, and the clamp must see
    // the size the frame will actually have at the applied position.
    this.cfg.onPositioned?.(true);
    const rect = frame.getBoundingClientRect();
    // The frame may be display:none (target frame with no target; rect is 0x0);
    // fall back to a nominal size so a saved spot still clamps sensibly.
    const size = {
      w: rect.width || this.cfg.fallbackSize.w,
      h: rect.height || this.cfg.fallbackSize.h,
    };
    // this.pos, the rect, and the viewport are all in visual (post-zoom) space; the
    // frame lives inside #ui (`zoom: var(--ui-scale)`), so the style write divides by
    // the live UI scale into author space (placeTargetFrame). The clamped VISUAL spot
    // is what we keep + persist, so a saved position renders at the same visual place
    // at any UI Scale.
    const placement = placeTargetFrame(
      this.pos,
      { w: window.innerWidth, h: window.innerHeight },
      size,
      getUiScale(),
    );
    this.pos = placement.pos;
    frame.style.left = `${placement.css.left}px`;
    frame.style.top = `${placement.css.top}px`;
    frame.style.right = 'auto';
    frame.style.bottom = 'auto';
  }

  private persistPos(): void {
    if (!this.pos) return;
    try {
      localStorage.setItem(this.cfg.storageKey, serializeTargetFramePos(this.pos));
    } catch {
      /* storage unavailable */
    }
  }
}
