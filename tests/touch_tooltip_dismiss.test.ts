import { describe, expect, it, vi } from 'vitest';
import { bindTouchTooltipDismiss } from '../src/ui/touch_tooltip_dismiss';

type PointerDownListener = (event: PointerEvent) => void;

function fakePointerTarget() {
  let listener: PointerDownListener | undefined;
  let capture: boolean | AddEventListenerOptions | undefined;
  return {
    target: {
      addEventListener(
        type: 'pointerdown',
        next: PointerDownListener,
        options?: boolean | AddEventListenerOptions,
      ) {
        expect(type).toBe('pointerdown');
        listener = next;
        capture = options;
      },
      removeEventListener() {},
    },
    dispatch(event: Partial<PointerEvent>) {
      listener?.(event as PointerEvent);
    },
    capture: () => capture,
  };
}

describe('bindTouchTooltipDismiss', () => {
  it('dismisses a visible mobile tooltip on the next touch pointerdown', () => {
    const pointer = fakePointerTarget();
    const hide = vi.fn();
    bindTouchTooltipDismiss(pointer.target, {
      isTouchUi: () => true,
      isVisible: () => true,
      containsTarget: () => false,
      hide,
    });

    pointer.dispatch({ pointerType: 'touch', target: {} as EventTarget });

    expect(hide).toHaveBeenCalledTimes(1);
    expect(pointer.capture()).toBe(true);
  });

  it('does not alter mouse or non-touch UI interactions', () => {
    const pointer = fakePointerTarget();
    const hide = vi.fn();
    let touchUi = true;
    bindTouchTooltipDismiss(pointer.target, {
      isTouchUi: () => touchUi,
      isVisible: () => true,
      containsTarget: () => false,
      hide,
    });

    pointer.dispatch({ pointerType: 'mouse', target: {} as EventTarget });
    touchUi = false;
    pointer.dispatch({ pointerType: 'touch', target: {} as EventTarget });

    expect(hide).not.toHaveBeenCalled();
  });

  it('ignores hidden tooltips and touches inside the tooltip itself', () => {
    const pointer = fakePointerTarget();
    const hide = vi.fn();
    let visible = false;
    let inside = false;
    bindTouchTooltipDismiss(pointer.target, {
      isTouchUi: () => true,
      isVisible: () => visible,
      containsTarget: () => inside,
      hide,
    });

    pointer.dispatch({ pointerType: 'touch', target: {} as EventTarget });
    visible = true;
    inside = true;
    pointer.dispatch({ pointerType: 'touch', target: {} as EventTarget });

    expect(hide).not.toHaveBeenCalled();
  });
});
