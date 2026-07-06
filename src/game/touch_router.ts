/**
 * Touch ownership router: classifies a pointer/touch event into a single
 * "owner" so simultaneous multi-touch gestures (left-thumb move joystick,
 * right-thumb combat buttons, open-canvas camera swipe) never fight over the
 * same finger. Pure and DOM-free: every DOM capability is injected as a
 * minimal structural shape so this module tests with fake elements (never
 * jsdom) and carries zero document/window imports.
 *
 * ---------------------------------------------------------------------------
 * Consumer contract (for whoever wires this into `mobile_controls.ts`):
 *
 *   const ledger = new TouchOwnerLedger();
 *
 *   onPointerDown(e) {
 *     const owner = getTouchOwner(e, {
 *       menuOpen: document.body.classList.contains('mobile-window-open'),
 *       isMovementZone: (t) => t === this.moveZone || t === this.moveJoystick,
 *       isCombatButton: (t) => isInteractiveHudElement(t),
 *       isCameraSurface: (t) => t === this.canvas,
 *     });
 *     ledger.set(e.pointerId, owner);
 *     // route to the existing per-owner handler (onMoveDown/onCameraDown/
 *     // onSwipeLookDown/...) only when `owner` matches that handler's zone.
 *   }
 *
 *   onPointerMove(e) {
 *     const owner = ledger.get(e.pointerId); // 'movement' | 'combatButton' | 'camera' | 'menu' | 'ignored' | undefined
 *     // a touch that started on a button (owner === 'combatButton') must NEVER
 *     // fall through to the camera-drag handler, even if it drifts over the canvas.
 *   }
 *
 *   onPointerUp(e) / onPointerCancel(e) {
 *     ledger.release(e.pointerId);
 *   }
 *
 * `menuOpen` should be read from `body.mobile-window-open` (set whenever any
 * mobile window/panel is open); a window opening mid-drag means the NEXT
 * `getTouchOwner` call (or an explicit `ledger.release` + camera-drag stop
 * driven by the caller observing the class change) blocks new camera drags,
 * consistent with `isCameraDragAllowedAt`.
 *
 * This module intentionally does NOT wrap `Input.setTouchLook*`/
 * `applyTouchLookDelta`/`updateTouchLook`: those are already one-line calls
 * with no camera math to hide, so a delegating wrapper here would only add an
 * indirection with no behavior of its own. The consumer calls `Input`
 * directly, gated by the ownership decisions this module makes.
 * ---------------------------------------------------------------------------
 */

/** Who owns a touch, in router priority order (modal/menu highest, camera lowest). */
export type TouchOwner = 'movement' | 'combatButton' | 'camera' | 'menu' | 'ignored';

/**
 * The minimal structural shape this module needs from a DOM target: enough to
 * ask "does this element (or an ancestor) match a CSS selector". Both real
 * `Element` and a hand-rolled test fake satisfy this without importing `dom.lib`.
 */
export interface TouchRouterTarget {
  closest(selector: string): TouchRouterTarget | null;
  matches?(selector: string): boolean;
}

export interface TouchRouterContext {
  /** True whenever any mobile window/panel is open (`body.mobile-window-open`). */
  menuOpen: boolean;
  /** True when the event target landed on the movement joystick zone. */
  isMovementZone(target: TouchRouterTarget | null): boolean;
  /** True when the event target landed on a combat/ring button. Callers
   *  typically pass {@link isInteractiveHudElement} here directly. */
  isCombatButton(target: TouchRouterTarget | null): boolean;
  /** True when the event target is open gameplay space eligible for camera drag
   *  (typically the canvas element). */
  isCameraSurface(target: TouchRouterTarget | null): boolean;
}

/** The subset of a pointer/touch event this module reads. */
export interface TouchRouterEvent {
  target: TouchRouterTarget | null;
}

/** CSS selectors that count as "interactive HUD chrome": a touch landing on
 *  one of these must never be reinterpreted as a camera drag or movement
 *  input. Sourced from the real class/id names in `mobile_controls.ts` and
 *  `hud.mobile.css` (`.mobile-btn`, `.action-btn`) plus the paged action ring
 *  container (`#mobile-action-ring`, `.mobile-action-slot`), the generic
 *  window/panel chrome (`.window`, `.panel`), and the minimap/daily-chest/
 *  chat-log widgets (Phase 5 of the mobile combat HUD rework: none of these
 *  are `.window`/`.panel`/`.mobile-btn`, so a swipe starting on them was
 *  falling through to `isCameraDragAllowedAt` and could nudge the camera). */
const INTERACTIVE_HUD_SELECTORS = [
  '.mobile-btn',
  '.action-btn',
  '.mobile-action-slot',
  '#mobile-action-ring',
  '.window',
  '.panel',
  '#minimap-wrap',
  '#side-buttons',
  '#chatlog-wrap',
] as const;

/**
 * True when `target` is, or descends from, an element the repo already treats
 * as interactive HUD chrome (a mobile button, a desktop-style action button
 * shown scaled on mobile, a paged action-ring slot or its container, or any
 * window/panel). Uses `closest()` so both the element itself and any of its
 * descendants match, matching how `mobile_controls.ts` already tests
 * `target.closest('#mobile-extra-controls')` for its tap-outside-to-dismiss guard.
 */
export function isInteractiveHudElement(target: TouchRouterTarget | null): boolean {
  if (!target) return false;
  for (const selector of INTERACTIVE_HUD_SELECTORS) {
    if (target.closest(selector)) return true;
  }
  return false;
}

/**
 * True when a camera swipe-drag may begin at `target`: never while a modal/
 * menu is open, and never on top of interactive HUD chrome (so a swipe that
 * starts on a button or window can't also nudge the camera).
 */
export function isCameraDragAllowedAt(
  target: TouchRouterTarget | null,
  menuOpen: boolean,
): boolean {
  if (menuOpen) return false;
  return !isInteractiveHudElement(target);
}

/**
 * Classify a touch/pointer-down event into a single owner. Priority order
 * (highest first): an open modal/menu claims every touch as `'menu'` (so
 * nothing leaks through to gameplay while a window is up); then the movement
 * joystick zone; then combat/ring buttons; then camera drag on open gameplay
 * space. Anything matching none of these is `'ignored'`.
 */
export function getTouchOwner(ev: TouchRouterEvent, ctx: TouchRouterContext): TouchOwner {
  const target = ev.target;
  if (ctx.menuOpen) return 'menu';
  if (ctx.isMovementZone(target)) return 'movement';
  if (ctx.isCombatButton(target)) return 'combatButton';
  if (ctx.isCameraSurface(target) && isCameraDragAllowedAt(target, ctx.menuOpen)) return 'camera';
  return 'ignored';
}

/**
 * Per-pointer ownership ledger: records the owner decided at pointerdown and
 * holds it for the lifetime of that touch (pointermove reads it back;
 * pointerup/pointercancel releases it). This is what guarantees "a touch that
 * starts on a button stays a button touch" even if the finger later drifts
 * over the canvas or the joystick zone.
 */
export class TouchOwnerLedger {
  private owners = new Map<number, TouchOwner>();

  /** Record the owner decided for `pointerId` at pointerdown. */
  set(pointerId: number, owner: TouchOwner): void {
    this.owners.set(pointerId, owner);
  }

  /** The owner recorded for `pointerId`, or undefined if it was never
   *  recorded (or has already been released). */
  get(pointerId: number): TouchOwner | undefined {
    return this.owners.get(pointerId);
  }

  /** True when `pointerId` is currently owned by `owner`. */
  isOwnedBy(pointerId: number, owner: TouchOwner): boolean {
    return this.owners.get(pointerId) === owner;
  }

  /** Release `pointerId` (pointerup/pointercancel/lostpointercapture). */
  release(pointerId: number): void {
    this.owners.delete(pointerId);
  }

  /** Release every tracked pointer (window blur / visibilitychange hidden). */
  releaseAll(): void {
    this.owners.clear();
  }

  /** Number of pointers currently tracked (mainly for tests/diagnostics). */
  get size(): number {
    return this.owners.size;
  }
}
