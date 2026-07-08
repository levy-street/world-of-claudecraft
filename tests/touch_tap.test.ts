import { describe, expect, it, vi } from 'vitest';
import { bindTouchTap, CLICK_SUPPRESS_MS, TAP_SLOP_PX } from '../src/ui/touch_tap';

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
