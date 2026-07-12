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
      deps.hide();
    },
    true,
  );
}
