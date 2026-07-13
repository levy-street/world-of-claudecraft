interface PointerDownTarget {
  addEventListener(
    type: 'pointerdown',
    listener: (event: PointerEvent) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

export interface TouchTooltipDismissDeps {
  isTouchUi(): boolean;
  isVisible(): boolean;
  containsTarget(target: EventTarget | null): boolean;
  hide(): void;
}

/** Dismisses the shared touch tooltip before the next control handles its press. */
export function bindTouchTooltipDismiss(
  target: PointerDownTarget,
  deps: TouchTooltipDismissDeps,
): void {
  target.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType !== 'touch' || !deps.isTouchUi() || !deps.isVisible()) return;
      if (deps.containsTarget(event.target)) return;
      // A control that OWNS its tooltip via tap (data-tooltip-tap-toggle, the
      // touch spellbook rows) swaps or toggles the box itself on pointerup:
      // hiding at pointerdown would blank it for the whole press duration,
      // which reads as a visible blink between two paints.
      const pressed = event.target as Element | null;
      if (pressed && typeof pressed.closest === 'function') {
        if (pressed.closest('[data-tooltip-tap-toggle]')) return;
      }
      deps.hide();
    },
    true,
  );
}
