import { bindTouchTap, TAP_SLOP_PX } from './touch_tap';

export const TOUCH_TOOLTIP_LONG_PRESS_MS = 650;

export interface TouchTooltipToggleOwner {
  dataset: DOMStringMap;
  addEventListener(type: string, listener: (event: PointerEvent & MouseEvent) => void): void;
}

export interface TouchTooltipToggleDeps {
  isTouchUi(): boolean;
  isVisible(): boolean;
  hide(): void;
}

export interface TouchTooltipLongPressAction {
  /** Capture the exact action owned by the pressed content. Pooled aura nodes
   *  can be recycled while a finger is down, so resolving only when the timer
   *  fires could cancel the replacement aura instead. */
  capture(): (() => void) | null;
}

/**
 * Coordinates a group of touch controls that own one shared tooltip.
 *
 * The first tap shows the owner's tooltip, a second tap on the same owner hides
 * it, and a tap on another owner swaps the content without the capture-phase
 * outside-dismiss handler blanking the box first. The global dismiss handler
 * still owns taps everywhere outside the marked controls and the tooltip.
 */
export class TouchTooltipToggleGroup {
  private activeOwner: TouchTooltipToggleOwner | null = null;

  constructor(private readonly deps: TouchTooltipToggleDeps) {}

  bind(
    owner: TouchTooltipToggleOwner,
    show: () => void,
    longPress?: TouchTooltipLongPressAction,
  ): void {
    owner.dataset.tooltipTapToggle = '1';
    let longPressTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let capturedLongPress: (() => void) | null = null;
    let longPressPointerId: number | null = null;
    let longPressStartX = 0;
    let longPressStartY = 0;
    let longPressConsumed = false;
    const clearLongPress = () => {
      if (longPressTimer !== undefined) globalThis.clearTimeout(longPressTimer);
      longPressTimer = undefined;
      capturedLongPress = null;
      longPressPointerId = null;
    };
    owner.addEventListener('pointerdown', (event) => {
      longPressConsumed = false;
      if (event.pointerType !== 'touch' || !this.deps.isTouchUi()) return;
      clearLongPress();
      capturedLongPress = longPress?.capture() ?? null;
      if (!capturedLongPress) return;
      longPressPointerId = event.pointerId;
      longPressStartX = event.clientX;
      longPressStartY = event.clientY;
      longPressTimer = globalThis.setTimeout(() => {
        const run = capturedLongPress;
        longPressTimer = undefined;
        capturedLongPress = null;
        if (!run) return;
        longPressConsumed = true;
        run();
      }, TOUCH_TOOLTIP_LONG_PRESS_MS);
    });
    owner.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'touch' || event.pointerId !== longPressPointerId) return;
      if (
        Math.hypot(event.clientX - longPressStartX, event.clientY - longPressStartY) > TAP_SLOP_PX
      )
        clearLongPress();
    });
    owner.addEventListener('pointerup', (event) => {
      if (event.pointerId === longPressPointerId) clearLongPress();
    });
    owner.addEventListener('pointercancel', (event) => {
      if (event.pointerId === longPressPointerId) clearLongPress();
    });
    owner.addEventListener('contextmenu', (event) => {
      if (!this.deps.isTouchUi()) return;
      // Touch browsers may synthesize contextmenu before our intentional hold
      // threshold, including for read-only auras. Suppress that native path; a
      // connected mouse still keeps the desktop right-click handler owned by
      // the caller.
      if (event.pointerType === 'mouse') return;
      event.preventDefault();
    });
    bindTouchTap(owner, () => {
      if (!this.deps.isTouchUi()) return;
      if (longPressConsumed) {
        longPressConsumed = false;
        return;
      }
      if (this.activeOwner === owner && this.deps.isVisible()) {
        this.activeOwner = null;
        this.deps.hide();
        return;
      }
      this.activeOwner = owner;
      show();
    });
  }
}
