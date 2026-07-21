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
