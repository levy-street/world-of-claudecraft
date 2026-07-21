import { describe, expect, it, vi } from 'vitest';
import {
  bindTouchDoubleTap,
  bindTouchTap,
  CLICK_SUPPRESS_MS,
  DOUBLE_TAP_MS,
  TAP_SLOP_PX,
} from '../src/ui/touch_tap';

// Minimal fake element: collects listeners and lets a test dispatch raw
// events, the house pattern for DOM-touching UI tests (no jsdom).
type TapEvent = PointerEvent & MouseEvent;
function fakeButton() {
  const listeners = new Map<string, Array<(e: TapEvent) => void>>();
  return {
    addEventListener(type: string, fn: (e: TapEvent) => void) {
      const arr = listeners.get(type) ?? [];
      arr.push(fn);
      listeners.set(type, arr);
    },
    dispatch(type: string, e: Record<string, unknown> = {}) {
      const event = { preventDefault() {}, ...e } as unknown as TapEvent;
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
}

const touch = (id: number, x = 100, y = 100) => ({
  pointerType: 'touch',
  pointerId: id,
  clientX: x,
  clientY: y,
});

describe('bindTouchTap', () => {
  it('fires for a NON-PRIMARY touch tap (the second finger while steering)', () => {
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchTap(el, cb);
    // A second finger never gets a synthesized click; only pointer events.
    el.dispatch('pointerdown', touch(7));
    el.dispatch('pointerup', touch(7));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('suppresses the synthesized click after a handled touch tap (no double-fire)', () => {
    vi.useFakeTimers();
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchTap(el, cb);
    el.dispatch('pointerdown', touch(1));
    el.dispatch('pointerup', touch(1));
    el.dispatch('click', {}); // the primary pointer's compatibility click
    expect(cb).toHaveBeenCalledTimes(1);
    // After the window, keyboard/mouse clicks work again.
    vi.advanceTimersByTime(CLICK_SUPPRESS_MS + 1);
    el.dispatch('click', {});
    expect(cb).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('keeps the plain click path for mouse and keyboard activation', () => {
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchTap(el, cb);
    el.dispatch('click', {}); // Enter/Space or a mouse click: no pointer touch preamble
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('cancels when the finger slides off past the slop before lifting', () => {
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchTap(el, cb);
    el.dispatch('pointerdown', touch(2, 100, 100));
    el.dispatch('pointerup', touch(2, 100 + TAP_SLOP_PX + 1, 100));
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancels on pointercancel (browser gesture steals the touch)', () => {
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchTap(el, cb);
    el.dispatch('pointerdown', touch(3));
    el.dispatch('pointercancel', { pointerId: 3 });
    el.dispatch('pointerup', touch(3));
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores a pointerup whose pointerdown landed elsewhere', () => {
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchTap(el, cb);
    el.dispatch('pointerup', touch(4)); // finger slid IN from outside
    expect(cb).not.toHaveBeenCalled();
  });

  it('an unrelated finger lifting does not fire, the pressing finger still does', () => {
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchTap(el, cb);
    el.dispatch('pointerdown', touch(5));
    el.dispatch('pointerup', touch(6)); // different pointer: ignored
    expect(cb).not.toHaveBeenCalled();
    el.dispatch('pointerup', touch(5)); // the finger that pressed lifts: fires
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('mouse pointerdown/up alone does not fire (click handles mouse)', () => {
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchTap(el, cb);
    el.dispatch('pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0 });
    el.dispatch('pointerup', { pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0 });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('bindTouchDoubleTap', () => {
  // A single tap = a touch pointerdown followed by a pointerup on the same id.
  const tap = (el: ReturnType<typeof fakeButton>, id: number, x = 100, y = 100) => {
    el.dispatch('pointerdown', touch(id, x, y));
    el.dispatch('pointerup', touch(id, x, y));
  };

  it('fires when a second tap lands inside the double-tap window', () => {
    vi.useFakeTimers();
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchDoubleTap(el, cb);
    tap(el, 1);
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 50);
    tap(el, 2);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does NOT fire when the second tap is too slow (re-arms instead)', () => {
    vi.useFakeTimers();
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchDoubleTap(el, cb);
    tap(el, 1);
    vi.advanceTimersByTime(DOUBLE_TAP_MS + 50);
    tap(el, 2); // too late: this becomes the new first tap, not a double-tap
    expect(cb).not.toHaveBeenCalled();
    // A prompt third tap now pairs with the second, so the detector still works.
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 50);
    tap(el, 3);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('fires at exactly the window boundary (inclusive <=, pinning the off-by-one)', () => {
    vi.useFakeTimers();
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchDoubleTap(el, cb);
    tap(el, 1);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    tap(el, 2);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does NOT fire when the second tap slid past the slop (a frame drag)', () => {
    vi.useFakeTimers();
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchDoubleTap(el, cb);
    tap(el, 1);
    vi.advanceTimersByTime(50);
    // Second finger presses then slides off past the slop: a drag, not a tap.
    el.dispatch('pointerdown', touch(2, 100, 100));
    el.dispatch('pointerup', touch(2, 100 + TAP_SLOP_PX + 1, 100));
    expect(cb).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('a drag also un-primes an earlier tap (tap, drag, tap is not a double-tap)', () => {
    vi.useFakeTimers();
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchDoubleTap(el, cb);
    tap(el, 1);
    vi.advanceTimersByTime(50);
    // A drag between the two taps: the pair must not read as a double-tap.
    el.dispatch('pointerdown', touch(2, 100, 100));
    el.dispatch('pointerup', touch(2, 100 + TAP_SLOP_PX + 1, 100));
    vi.advanceTimersByTime(50);
    tap(el, 3);
    expect(cb).not.toHaveBeenCalled();
    // The post-drag tap primed a fresh pair, so a prompt follow-up still fires.
    vi.advanceTimersByTime(50);
    tap(el, 4);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('requires two taps: a lone tap never fires', () => {
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchDoubleTap(el, cb);
    tap(el, 1);
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not treat a mouse double-click as a double-tap (touch only)', () => {
    vi.useFakeTimers();
    const el = fakeButton();
    const cb = vi.fn();
    bindTouchDoubleTap(el, cb);
    const mouse = { pointerType: 'mouse', pointerId: 9, clientX: 0, clientY: 0 };
    el.dispatch('pointerdown', mouse);
    el.dispatch('pointerup', mouse);
    el.dispatch('pointerdown', mouse);
    el.dispatch('pointerup', mouse);
    expect(cb).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('single bindTouchTap taps still work alongside a double-tap binding', () => {
    vi.useFakeTimers();
    const el = fakeButton();
    const single = vi.fn();
    const dbl = vi.fn();
    bindTouchTap(el, single);
    bindTouchDoubleTap(el, dbl);
    tap(el, 1);
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 50);
    tap(el, 2);
    // Both single taps fired their own callback; the pair also fired the double.
    expect(single).toHaveBeenCalledTimes(2);
    expect(dbl).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
