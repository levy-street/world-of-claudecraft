import { describe, expect, it, vi } from 'vitest';
import {
  TOUCH_TOOLTIP_LONG_PRESS_MS,
  TouchTooltipToggleGroup,
  type TouchTooltipToggleOwner,
} from '../src/ui/touch_tooltip_toggle';

type TapEvent = PointerEvent & MouseEvent;

function fakeOwner() {
  const listeners = new Map<string, Array<(event: TapEvent) => void>>();
  const dataset: Record<string, string> = {};
  const owner = {
    dataset,
    addEventListener(type: string, listener: (event: TapEvent) => void) {
      const group = listeners.get(type) ?? [];
      group.push(listener);
      listeners.set(type, group);
    },
    dispatch(type: string, values: Record<string, unknown> = {}) {
      const event = { preventDefault() {}, ...values } as unknown as TapEvent;
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
  return owner;
}

const touch = (pointerId: number) => ({
  pointerType: 'touch',
  pointerId,
  clientX: 100,
  clientY: 100,
});

function tap(owner: ReturnType<typeof fakeOwner>, pointerId: number): void {
  owner.dispatch('pointerdown', touch(pointerId));
  owner.dispatch('pointerup', touch(pointerId));
}

describe('TouchTooltipToggleGroup', () => {
  it('marks every owner so the global touch dismisser leaves its atomic swap alone', () => {
    const group = new TouchTooltipToggleGroup({
      isTouchUi: () => true,
      isVisible: () => false,
      hide: vi.fn(),
    });
    const owner = fakeOwner();

    group.bind(owner as unknown as TouchTooltipToggleOwner, vi.fn());

    expect(owner.dataset.tooltipTapToggle).toBe('1');
  });

  it('shows on first tap and hides on a second tap of the same owner', () => {
    let visible = false;
    const hide = vi.fn(() => {
      visible = false;
    });
    const show = vi.fn(() => {
      visible = true;
    });
    const group = new TouchTooltipToggleGroup({
      isTouchUi: () => true,
      isVisible: () => visible,
      hide,
    });
    const owner = fakeOwner();
    group.bind(owner as unknown as TouchTooltipToggleOwner, show);

    tap(owner, 1);
    expect(show).toHaveBeenCalledTimes(1);
    expect(visible).toBe(true);

    tap(owner, 2);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(visible).toBe(false);

    tap(owner, 3);
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('swaps directly to a different owner and reopens after an outside dismissal', () => {
    let visible = false;
    const hide = () => {
      visible = false;
    };
    const firstShow = vi.fn(() => {
      visible = true;
    });
    const secondShow = vi.fn(() => {
      visible = true;
    });
    const group = new TouchTooltipToggleGroup({
      isTouchUi: () => true,
      isVisible: () => visible,
      hide,
    });
    const first = fakeOwner();
    const second = fakeOwner();
    group.bind(first as unknown as TouchTooltipToggleOwner, firstShow);
    group.bind(second as unknown as TouchTooltipToggleOwner, secondShow);

    tap(first, 4);
    tap(second, 5);
    expect(firstShow).toHaveBeenCalledTimes(1);
    expect(secondShow).toHaveBeenCalledTimes(1);

    hide();
    tap(second, 6);
    expect(secondShow).toHaveBeenCalledTimes(2);
  });

  it('does not turn a desktop mouse or keyboard click into a tap-owned tooltip', () => {
    const show = vi.fn();
    const group = new TouchTooltipToggleGroup({
      isTouchUi: () => false,
      isVisible: () => false,
      hide: vi.fn(),
    });
    const owner = fakeOwner();
    group.bind(owner as unknown as TouchTooltipToggleOwner, show);

    owner.dispatch('click');
    expect(show).not.toHaveBeenCalled();
  });

  it('runs an enabled long-press action without also toggling the tooltip on release', () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const run = vi.fn();
    const group = new TouchTooltipToggleGroup({
      isTouchUi: () => true,
      isVisible: () => false,
      hide: vi.fn(),
    });
    const owner = fakeOwner();
    group.bind(owner as unknown as TouchTooltipToggleOwner, show, {
      capture: () => run,
    });

    owner.dispatch('pointerdown', touch(7));
    vi.advanceTimersByTime(TOUCH_TOOLTIP_LONG_PRESS_MS);
    owner.dispatch('pointerup', touch(7));

    expect(run).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('never runs the hold action for a non-cancelable owner or a scrolling gesture', () => {
    vi.useFakeTimers();
    let enabled = false;
    const run = vi.fn();
    const show = vi.fn();
    const group = new TouchTooltipToggleGroup({
      isTouchUi: () => true,
      isVisible: () => false,
      hide: vi.fn(),
    });
    const owner = fakeOwner();
    group.bind(owner as unknown as TouchTooltipToggleOwner, show, {
      capture: () => (enabled ? run : null),
    });

    owner.dispatch('pointerdown', touch(8));
    vi.advanceTimersByTime(TOUCH_TOOLTIP_LONG_PRESS_MS);
    owner.dispatch('pointerup', touch(8));
    expect(run).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledTimes(1);

    enabled = true;
    owner.dispatch('pointerdown', touch(9));
    owner.dispatch('pointermove', { ...touch(9), clientX: 114 });
    vi.advanceTimersByTime(TOUCH_TOOLTIP_LONG_PRESS_MS);
    owner.dispatch('pointerup', { ...touch(9), clientX: 114 });
    expect(run).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('keeps the exact held action when a pooled owner changes before the threshold', () => {
    vi.useFakeTimers();
    let liveAuraId = 'might';
    const run = vi.fn<(auraId: string) => void>();
    const group = new TouchTooltipToggleGroup({
      isTouchUi: () => true,
      isVisible: () => false,
      hide: vi.fn(),
    });
    const owner = fakeOwner();
    group.bind(owner as unknown as TouchTooltipToggleOwner, vi.fn(), {
      capture: () => {
        const pressedAuraId = liveAuraId;
        return () => run(pressedAuraId);
      },
    });

    owner.dispatch('pointerdown', touch(10));
    liveAuraId = 'fortitude';
    vi.advanceTimersByTime(TOUCH_TOOLTIP_LONG_PRESS_MS);
    owner.dispatch('pointerup', touch(10));

    expect(run).toHaveBeenCalledWith('might');
    vi.useRealTimers();
  });
});
