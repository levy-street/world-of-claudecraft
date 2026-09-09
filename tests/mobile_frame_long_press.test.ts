import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindMobileFrameLongPress,
  MOBILE_CONTEXT_LONG_PRESS_MS,
} from '../src/ui/mobile_frame_long_press';
import { CLICK_SUPPRESS_MS, TAP_SLOP_PX } from '../src/ui/touch_tap';

// Safety net for the fake-timer tests below (mirrors tests/touch_tap.test.ts).
afterEach(() => {
  vi.useRealTimers();
});

type PressEvent = PointerEvent & MouseEvent;

// Minimal fake element: collects listeners and lets a test dispatch raw
// events, the house pattern for DOM-touching UI tests (no jsdom); see
// tests/touch_tap.test.ts.
function fakeElement() {
  const listeners = new Map<string, Array<(e: PressEvent) => void>>();
  return {
    addEventListener(type: string, fn: (e: PressEvent) => void) {
      const arr = listeners.get(type) ?? [];
      arr.push(fn);
      listeners.set(type, arr);
    },
    dispatch(type: string, e: Record<string, unknown> = {}) {
      const event = {
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
        ...e,
      } as unknown as PressEvent;
      for (const fn of listeners.get(type) ?? []) fn(event);
      return event;
    },
  };
}

const touch = (id: number, x = 100, y = 100, target: unknown = null) => ({
  pointerType: 'touch',
  pointerId: id,
  clientX: x,
  clientY: y,
  target,
});

describe('bindMobileFrameLongPress', () => {
  it('fires onLongPress at the down coordinates after the hold, in mobile layout', () => {
    vi.useFakeTimers();
    const el = fakeElement();
    const onLongPress = vi.fn();
    bindMobileFrameLongPress(el, onLongPress, () => true);
    el.dispatch('pointerdown', touch(1, 120, 240));
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS);
    expect(onLongPress).toHaveBeenCalledWith(120, 240);
  });

  it('never starts the hold when isMobileLayout is false', () => {
    vi.useFakeTimers();
    const el = fakeElement();
    const onLongPress = vi.fn();
    bindMobileFrameLongPress(el, onLongPress, () => false);
    el.dispatch('pointerdown', touch(1));
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('ignores a non-touch pointer entirely', () => {
    vi.useFakeTimers();
    const el = fakeElement();
    const onLongPress = vi.fn();
    bindMobileFrameLongPress(el, onLongPress, () => true);
    el.dispatch('pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels the hold when the finger slides past the slop before the delay elapses', () => {
    vi.useFakeTimers();
    const el = fakeElement();
    const onLongPress = vi.fn();
    bindMobileFrameLongPress(el, onLongPress, () => true);
    el.dispatch('pointerdown', touch(1, 100, 100));
    el.dispatch('pointermove', touch(1, 100 + TAP_SLOP_PX + 1, 100));
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels the hold on pointerup before the delay elapses', () => {
    vi.useFakeTimers();
    const el = fakeElement();
    const onLongPress = vi.fn();
    bindMobileFrameLongPress(el, onLongPress, () => true);
    el.dispatch('pointerdown', touch(1));
    el.dispatch('pointerup', touch(1));
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels the hold on pointercancel (browser gesture steals the touch)', () => {
    vi.useFakeTimers();
    const el = fakeElement();
    const onLongPress = vi.fn();
    bindMobileFrameLongPress(el, onLongPress, () => true);
    el.dispatch('pointerdown', touch(1));
    el.dispatch('pointercancel', touch(1));
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('an unrelated finger moving or lifting does not cancel the pressing finger', () => {
    vi.useFakeTimers();
    const el = fakeElement();
    const onLongPress = vi.fn();
    bindMobileFrameLongPress(el, onLongPress, () => true);
    el.dispatch('pointerdown', touch(1, 100, 100));
    el.dispatch('pointermove', touch(2, 100 + TAP_SLOP_PX + 50, 100));
    el.dispatch('pointerup', touch(2));
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS);
    expect(onLongPress).toHaveBeenCalledWith(100, 100);
  });

  it('never starts the hold when the pointerdown target matches the ignoreSelector', () => {
    vi.useFakeTimers();
    const el = fakeElement();
    const onLongPress = vi.fn();
    bindMobileFrameLongPress(el, onLongPress, () => true, { ignoreSelector: 'button' });
    const button = { closest: (selector: string) => (selector === 'button' ? button : null) };
    el.dispatch('pointerdown', touch(1, 100, 100, button));
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('suppresses the compatibility click fired right after a long press, then releases it', () => {
    vi.useFakeTimers();
    const el = fakeElement();
    bindMobileFrameLongPress(el, vi.fn(), () => true);
    el.dispatch('pointerdown', touch(1));
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS);
    const suppressed = el.dispatch('click', {});
    expect(suppressed.preventDefault).toHaveBeenCalled();
    expect(suppressed.stopImmediatePropagation).toHaveBeenCalled();
    vi.advanceTimersByTime(CLICK_SUPPRESS_MS + 1);
    const passthrough = el.dispatch('click', {});
    expect(passthrough.preventDefault).not.toHaveBeenCalled();
  });

  it('a click with no preceding long press is never suppressed', () => {
    const el = fakeElement();
    bindMobileFrameLongPress(el, vi.fn(), () => true);
    const clicked = el.dispatch('click', {});
    expect(clicked.preventDefault).not.toHaveBeenCalled();
  });

  it('suppresses the native contextmenu only while still in mobile layout, inside the window', () => {
    vi.useFakeTimers();
    const el = fakeElement();
    let mobile = true;
    bindMobileFrameLongPress(el, vi.fn(), () => mobile);
    el.dispatch('pointerdown', touch(1));
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS);
    const suppressed = el.dispatch('contextmenu', {});
    expect(suppressed.preventDefault).toHaveBeenCalled();

    mobile = false;
    const desktopMenu = el.dispatch('contextmenu', {});
    expect(desktopMenu.preventDefault).not.toHaveBeenCalled();
  });

  it('never suppresses a contextmenu outside the suppression window', () => {
    vi.useFakeTimers();
    const el = fakeElement();
    bindMobileFrameLongPress(el, vi.fn(), () => true);
    el.dispatch('pointerdown', touch(1));
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS + CLICK_SUPPRESS_MS + 1);
    const menu = el.dispatch('contextmenu', {});
    expect(menu.preventDefault).not.toHaveBeenCalled();
  });
});
