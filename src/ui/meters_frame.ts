// Movable + resizable controller for one meter panel, instance-parameterized:
// the damage window and each detached meter window construct their own with
// their element, drag handle and storage key.
//
// Modeled on the chat box (src/ui/hud/chat/chat_geometry_controller.ts): drag by
// the panel's own title bar, resize from a south-east corner grip, persist the
// chosen box, and re-clamp on viewport changes. The pure math lives in
// meters_frame_core.ts; this file is the pointer/DOM adapter and owns no
// layout rules of its own.
//
// Until the player actually moves or resizes a panel NOTHING is written to its
// style, so the stock design (the meters window anchored above the action bars)
// is exactly what it was. Desktop only, mirroring the chat box and the unit
// frames: on mobile-touch the stylesheet owns panel placement, the grip is
// hidden, and every gesture here is refused.

import { t } from './i18n';
import {
  initialMeterFrame,
  METER_FRAME_LIMITS,
  type MeterFrameGeometry,
  type MeterFrameLimits,
  parseMeterFrame,
  placeMeterFrame,
  serializeMeterFrame,
} from './meters_frame_core';

export interface MeterFrameConfig {
  /** The panel being positioned. */
  el: HTMLElement;
  /**
   * Drag handles; a pointerdown on a button inside one is never a drag. The
   * panel passes BOTH its title bar and its summary line: on the tabbed damage
   * window the title is three tabs plus three controls, leaving only a sliver
   * of bare strip to grab, and the summary line under it is a roomy,
   * non-interactive place to take hold of the panel.
   */
  handles: HTMLElement[];
  /** localStorage key the chosen box persists under. */
  storageKey: string;
  /** Size used when the panel is measured while hidden (first open). */
  fallbackSize: { w: number; h: number };
  limits?: MeterFrameLimits;
}

export interface MeterFrameDeps {
  document: Document;
  window: Window;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  isMobileLayout(): boolean;
  uiScale(): number;
}

type Gesture =
  | { kind: 'move'; pointerId: number; grabX: number; grabY: number }
  | {
      kind: 'resize';
      pointerId: number;
      startX: number;
      startY: number;
      startW: number;
      startH: number;
    };

/** Body class the stylesheet uses to suppress text selection mid-gesture. */
const DRAGGING_BODY_CLASS = 'meter-frame-dragging';

/**
 * Interactive descendants of a handle. A pointerdown on one of these is that
 * control's, never a drag, and the handle's move tooltip must not claim them
 * either. Stated once so the two rules cannot drift apart.
 */
const HANDLE_CONTROL_SELECTOR = 'button, a, input, select, textarea';

export class MeterFrame {
  private geo: MeterFrameGeometry | null = null;
  private gesture: Gesture | null = null;
  private grip: HTMLElement | null = null;
  /** Where the panel lives in the HUD stack, so reset() can put it back. */
  private home: { parent: Node; next: Node | null } | null = null;

  constructor(
    private readonly cfg: MeterFrameConfig,
    private readonly deps: MeterFrameDeps,
  ) {}

  init(): void {
    const { el, handles } = this.cfg;
    this.home = { parent: el.parentNode as Node, next: el.nextSibling };
    // The grip is built here rather than in index.html (the chat box does the
    // same) so a detached window's markup stays a plain panel.
    const grip = this.deps.document.createElement('div');
    grip.className = 'panel-resize-grip';
    grip.title = t('hudChrome.meters.resize');
    grip.setAttribute('aria-hidden', 'true');
    el.appendChild(grip);
    this.grip = grip;

    for (const handle of handles) {
      handle.classList.add('mt-move-handle');
      handle.setAttribute('title', t('hudChrome.meters.move'));
      // A container's title is inherited by every descendant that has none of
      // its own, so on the tabbed window "Dmg" / "Heal" / "Threat" would each
      // advertise a drag that pressing them does NOT perform. An empty title is
      // what stops that inheritance; controls carrying their own tooltip (the
      // pager and close buttons, set by MetersPanel before this runs) keep it.
      for (const control of handle.querySelectorAll<HTMLElement>(HANDLE_CONTROL_SELECTOR)) {
        if (!control.hasAttribute('title')) control.setAttribute('title', '');
      }
      handle.addEventListener('pointerdown', (event) => this.onMoveStart(event));
    }
    grip.addEventListener('pointerdown', (event) => this.onResizeStart(event));
    this.deps.document.addEventListener('pointermove', (event) => this.onPointerMove(event));
    const end = (event: PointerEvent): void => this.onPointerEnd(event);
    this.deps.document.addEventListener('pointerup', end);
    this.deps.document.addEventListener('pointercancel', end);
    this.deps.window.addEventListener('resize', () => {
      if (this.geo) this.apply();
    });

    let saved: string | null = null;
    try {
      saved = this.deps.storage.getItem(this.cfg.storageKey);
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
    this.geo = parseMeterFrame(saved);
    if (this.geo) this.apply();
  }

  /** Re-clamp after the panel is shown (a box saved at another viewport). */
  refresh(): void {
    if (this.geo) this.apply();
  }

  /** Drop the custom box and return the panel to its stylesheet anchor. */
  reset(): void {
    this.geo = null;
    try {
      this.deps.storage.removeItem(this.cfg.storageKey);
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
    const el = this.cfg.el;
    const wasOpen = el.style.display === 'block' || el.style.display === 'flex';
    const { style } = el;
    for (const property of ['left', 'top', 'right', 'bottom', 'width', 'height', 'position']) {
      style.removeProperty(property);
    }
    el.classList.remove('mt-framed');
    // Back into the HUD stack it came from, at its original slot.
    if (this.home && el.parentNode !== this.home.parent) {
      this.home.parent.insertBefore(el, this.home.next);
    }
    if (wasOpen) style.display = 'block';
  }

  /**
   * True once the panel carries a player-chosen box AND that box is actually in
   * force. The `blocked()` half is load-bearing: apply() refuses to write on a
   * mobile layout, so a saved box there never adds `mt-framed` (which is what
   * supplies `flex-direction: column`). Without the check, MetersPanel.setOpen
   * would still take its 'flex' branch and lay the title, summary, hint and rows
   * out in a ROW. Reachable rather than theoretical: `mobile-touch` toggles at
   * runtime from the touch-controls setting, so a desktop player who moves a
   * panel and later turns touch controls on lands in it.
   */
  get isFramed(): boolean {
    return this.geo !== null && !this.blocked();
  }

  private blocked(): boolean {
    return this.deps.isMobileLayout();
  }

  // Seed from wherever the panel currently sits, so the first grab never jumps.
  private ensureGeometry(): void {
    if (this.geo) return;
    const rect = this.cfg.el.getBoundingClientRect();
    this.geo = initialMeterFrame(rect, {
      left: rect.left || METER_FRAME_LIMITS.margin,
      top: rect.top || METER_FRAME_LIMITS.margin,
      width: this.cfg.fallbackSize.w,
      height: this.cfg.fallbackSize.h,
    });
  }

  private onMoveStart(event: PointerEvent): void {
    if (this.blocked() || this.gesture || event.button !== 0) return;
    // A press on a tab, pager or close button is that button's, never a drag:
    // the title bar is both the control strip and the move handle.
    const target = event.target as HTMLElement | null;
    if (target?.closest(HANDLE_CONTROL_SELECTOR)) return;
    this.ensureGeometry();
    if (!this.geo) return;
    this.gesture = {
      kind: 'move',
      pointerId: event.pointerId,
      grabX: event.clientX - this.geo.left,
      grabY: event.clientY - this.geo.top,
    };
    this.beginGesture(event);
  }

  private onResizeStart(event: PointerEvent): void {
    if (this.blocked() || this.gesture || event.button !== 0) return;
    this.ensureGeometry();
    if (!this.geo) return;
    this.gesture = {
      kind: 'resize',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startW: this.geo.width,
      startH: this.geo.height,
    };
    this.beginGesture(event);
  }

  private beginGesture(event: PointerEvent): void {
    event.preventDefault();
    // Stop the press from also reaching Hud's window/drag plumbing underneath.
    event.stopPropagation();
    this.deps.document.body.classList.add(DRAGGING_BODY_CLASS);
    this.apply();
  }

  private onPointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId || !this.geo) return;
    if (gesture.kind === 'move') {
      this.geo = {
        ...this.geo,
        left: event.clientX - gesture.grabX,
        top: event.clientY - gesture.grabY,
      };
    } else {
      this.geo = {
        ...this.geo,
        width: gesture.startW + (event.clientX - gesture.startX),
        height: gesture.startH + (event.clientY - gesture.startY),
      };
    }
    this.apply();
  }

  private onPointerEnd(event: PointerEvent): void {
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
    this.gesture = null;
    this.deps.document.body.classList.remove(DRAGGING_BODY_CLASS);
    this.persist();
  }

  private apply(): void {
    if (!this.geo || this.blocked()) return;
    const placement = placeMeterFrame(
      this.geo,
      { w: this.deps.window.innerWidth, h: this.deps.window.innerHeight },
      this.deps.uiScale(),
      this.cfg.limits ?? METER_FRAME_LIMITS,
    );
    this.geo = placement.geo;
    const { css } = placement;
    const el = this.cfg.el;
    // left/top are viewport coordinates, so the panel must hang off a
    // viewport-aligned containing block. In the HUD stack its offset parent is
    // #bottom-bar, which is positioned and moves with the action bars, so a
    // framed panel is re-homed onto #ui (position:fixed at 0,0) the way every
    // .window.panel and the chat box already sit. reset() puts it back.
    const uiRoot = this.deps.document.getElementById('ui');
    if (uiRoot && el.parentElement !== uiRoot) uiRoot.appendChild(el);
    const { style } = el;
    // `mt-framed` is what turns the panel into a fixed-size column whose row
    // list scrolls; without it the panel keeps its stock auto height.
    el.classList.add('mt-framed');
    style.position = 'absolute';
    style.left = `${css.left}px`;
    style.top = `${css.top}px`;
    style.right = 'auto';
    style.bottom = 'auto';
    style.width = `${css.width}px`;
    style.height = `${css.height}px`;
    // A framed panel lays out as a column so its bar list can take the slack and
    // scroll. Only re-stated while the panel is actually on screen: applying a
    // saved box at boot must never reveal a closed window.
    if (style.display === 'block' || style.display === 'flex') style.display = 'flex';
  }

  private persist(): void {
    if (!this.geo) return;
    try {
      this.deps.storage.setItem(this.cfg.storageKey, serializeMeterFrame(this.geo));
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }
}
