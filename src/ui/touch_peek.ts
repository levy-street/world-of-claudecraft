// Touch "peek" guard for long-press tooltips.
//
// On a touch device there is no hover, so the HUD shows an element's tooltip
// after a long press (see `Hud.attachTooltip`). The problem: a synthetic
// `click` still fires when the finger lifts, so long-pressing an action-bar
// slot to read its tooltip would ALSO fire the slot's click action (casting the
// ability). This guard lets the click handler tell "this click is the release
// of a long-press peek" apart from "this is a real quick tap" and swallow the
// former, so holding a control inspects it instead of triggering it.

/** Default hold (ms) before a touch press is treated as a tooltip peek. */
export const TOOLTIP_PEEK_MS = 950;

// Movement (px) that cancels a pending peek, treating the press as the start
// of a scroll instead of a held tap. Every element attachTooltip binds to
// sits inside a touch-action: pan-y scroll container with no pointermove
// listener of its own, so iOS Safari's gesture arbiter was free to read any
// finger drift during the ~1s hold as scroll intent and fire pointercancel,
// wiping the timer before it ever fired (the reported "never works on iOS"
// failure). touch_item_drag.ts already solves this exact disambiguation for
// its own long-press gesture on the same rows (TOUCH_DRAG_MOVE_TOLERANCE_PX);
// this constant matches its value independently rather than importing it, so
// the two gesture modules stay decoupled.
export const TOOLTIP_PEEK_MOVE_TOLERANCE_PX = 9;

/** Whether a finger has drifted far enough from where a peek press started to
 *  treat it as scroll intent rather than a still-held tap. Pure so it is
 *  unit-tested directly; the pointermove wiring lives in Hud.attachTooltip. */
export function exceedsPeekMoveTolerance(
  startX: number,
  startY: number,
  x: number,
  y: number,
): boolean {
  return Math.hypot(x - startX, y - startY) > TOOLTIP_PEEK_MOVE_TOLERANCE_PX;
}

export type TooltipTriggerKind = 'touch' | 'mouse' | 'focus';

export class TouchPeekGuard {
  private peeked = false;

  /** A fresh press began — clear any stale peek from a previous interaction. */
  press(): void {
    this.peeked = false;
  }

  /** The long-press tooltip was shown for the held control. */
  peek(): void {
    this.peeked = true;
  }

  /** A tooltip became visible; only touch long-press tooltips suppress release clicks. */
  tooltipShown(kind: TooltipTriggerKind): void {
    if (kind === 'touch') this.peek();
  }

  /**
   * Called from the `click` that follows a release. Returns true when that
   * click is the tail of a peek and the control's action should be SUPPRESSED.
   * Consuming resets the guard so the next quick tap activates normally.
   */
  consume(): boolean {
    const wasPeek = this.peeked;
    this.peeked = false;
    return wasPeek;
  }
}

export interface TooltipTouchPeekDeps {
  /** True on a touch device (Hud.attachTooltip's own `mobile()` check). */
  isMobile(): boolean;
  /** A fresh press began: drop any stale peek state. */
  press(): void;
  /** Hide a lingering tooltip before arming a new peek. */
  hide(): void;
  /** The hold completed: show the tooltip at (x, y). */
  showAt(x: number, y: number): void;
}

/** Binds the whole long-press-to-peek touch gesture to one attachTooltip
 *  target: pointerdown arms the TOOLTIP_PEEK_MS timer, and pointerup /
 *  pointercancel / a move past TOOLTIP_PEEK_MOVE_TOLERANCE_PX clear it.
 *  Mirrors touch_item_drag.ts's own pointer-event shape (hold timer plus a
 *  move-tolerance stand-down) for the identical scroll-vs-hold
 *  disambiguation on the same scrollable rows. The caller's own
 *  mouseleave/focusout/pointerup/pointercancel handlers call the returned
 *  `clear()` to drop a pending timer on their own cleanup paths. */
export function bindTooltipTouchPeek(
  el: HTMLElement,
  deps: TooltipTouchPeekDeps,
): { clear(): void } {
  let timer: number | undefined;
  let startX = 0;
  let startY = 0;
  const clear = (): void => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };
  el.addEventListener('pointerdown', (e) => {
    if (!deps.isMobile() || e.pointerType === 'mouse') return;
    clear();
    deps.press();
    deps.hide();
    const x = e.clientX;
    const y = e.clientY;
    startX = x;
    startY = y;
    timer = window.setTimeout(() => deps.showAt(x, y), TOOLTIP_PEEK_MS);
  });
  el.addEventListener('pointermove', (e) => {
    if (timer === undefined) return;
    if (exceedsPeekMoveTolerance(startX, startY, e.clientX, e.clientY)) clear();
  });
  el.addEventListener('pointerup', clear);
  el.addEventListener('pointercancel', clear);
  return { clear };
}
