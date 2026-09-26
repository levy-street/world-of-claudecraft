import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindMobileFrameLongPress,
  bindTouchDoubleTap,
  bindTouchTap,
  CLICK_SUPPRESS_MS,
  DOUBLE_TAP_MS,
  MOBILE_CONTEXT_LONG_PRESS_MS,
  TAP_SLOP_PX,
} from '../src/ui/touch_tap';

// Safety net for the fake-timer tests below: if one of them fails its
// assertion partway through, this still restores real timers so the
// failure does not leak fake timers into a sibling test (mirrors
// tests/admin/guilds_page.test.ts).
afterEach(() => {
  vi.useRealTimers();
});

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

// bindMobileFrameLongPress moved here from the Hud coordinator when the
// target-of-target frame became its third consumer. It is the touch stand-in for
// right-click on the player, target and target-of-target frames, so what it must
// keep is the desktop refusal, the slop cancel, and the post-press suppression of
// the click AND contextmenu the browser fires next.
describe('bindMobileFrameLongPress', () => {
  const frameEl = fakeButton;
  const press = (el: ReturnType<typeof fakeButton>, opts: { mobile?: boolean } = {}) => {
    const onLongPress = vi.fn();
    bindMobileFrameLongPress(
      el as unknown as HTMLElement,
      () => opts.mobile !== false,
      onLongPress,
    );
    return onLongPress;
  };
  // A finger resting past the threshold, with no target element in the way.
  const restingTouch = (id: number, x = 100, y = 100) => ({ ...touch(id, x, y), target: null });

  it('fires once the finger has rested past the long-press threshold', () => {
    vi.useFakeTimers();
    const el = frameEl();
    const onLongPress = press(el);
    el.dispatch('pointerdown', restingTouch(1, 120, 64));
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS);
    // The press POINT is passed through so the caller can anchor its menu there.
    expect(onLongPress).toHaveBeenCalledWith(120, 64);
    vi.useRealTimers();
  });

  it('never fires on the desktop layout, however long the pointer rests', () => {
    vi.useFakeTimers();
    const el = frameEl();
    const onLongPress = press(el, { mobile: false });
    el.dispatch('pointerdown', restingTouch(1));
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS * 4);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('never fires for a MOUSE pointer, which has its own contextmenu path', () => {
    vi.useFakeTimers();
    const el = frameEl();
    const onLongPress = press(el);
    el.dispatch('pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS * 2);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('cancels when the finger slides past the tap slop (a frame drag, not a press)', () => {
    vi.useFakeTimers();
    const el = frameEl();
    const onLongPress = press(el);
    el.dispatch('pointerdown', restingTouch(1, 100, 100));
    el.dispatch('pointermove', restingTouch(1, 100 + TAP_SLOP_PX + 1, 100));
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS * 2);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('cancels when the finger lifts before the threshold (an ordinary tap)', () => {
    vi.useFakeTimers();
    const el = frameEl();
    const onLongPress = press(el);
    el.dispatch('pointerdown', restingTouch(1));
    el.dispatch('pointerup', restingTouch(1));
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS * 2);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('swallows the click AND contextmenu the browser fires right after the press', () => {
    // Both frames underneath bind their own click / contextmenu handlers, so an
    // unswallowed pair would select the unit (or open a second menu) as well.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));
    const el = frameEl();
    press(el);
    el.dispatch('pointerdown', restingTouch(1));
    vi.advanceTimersByTime(MOBILE_CONTEXT_LONG_PRESS_MS);
    for (const type of ['click', 'contextmenu']) {
      const prevented = vi.fn();
      const stopped = vi.fn();
      el.dispatch(type, { preventDefault: prevented, stopImmediatePropagation: stopped });
      expect(prevented, `${type} not prevented`).toHaveBeenCalled();
      expect(stopped, `${type} not stopped`).toHaveBeenCalled();
    }
    vi.useRealTimers();
  });

  it('lets a plain click through when no long press happened', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));
    const el = frameEl();
    press(el);
    const prevented = vi.fn();
    el.dispatch('click', { preventDefault: prevented, stopImmediatePropagation: vi.fn() });
    expect(prevented).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('bindMobileFrameLongPress stopBubble (a frame nested in another bound frame)', () => {
  it('stops the accepted touch pointerdown so the outer frame never arms a press', () => {
    // The target-of-target mini sits inside #target-frame, which binds the same
    // gesture: without this the outer press also fires and its menu opens over
    // the mini's own.
    const el = fakeButton();
    const onLongPress = vi.fn();
    const stopped = vi.fn();
    bindMobileFrameLongPress(el as unknown as HTMLElement, () => true, onLongPress, {
      stopBubble: true,
    });
    el.dispatch('pointerdown', { ...touch(1), target: null, stopPropagation: stopped });
    expect(stopped).toHaveBeenCalled();
  });

  it('leaves the bubble alone without the option, and for a press it refused', () => {
    const plain = fakeButton();
    const plainStopped = vi.fn();
    bindMobileFrameLongPress(plain as unknown as HTMLElement, () => true, vi.fn());
    plain.dispatch('pointerdown', { ...touch(1), target: null, stopPropagation: plainStopped });
    expect(plainStopped).not.toHaveBeenCalled();

    // Desktop layout: the gesture bails before the stop, so an ordinary
    // right-click path on the outer frame is untouched.
    const desktop = fakeButton();
    const desktopStopped = vi.fn();
    bindMobileFrameLongPress(desktop as unknown as HTMLElement, () => false, vi.fn(), {
      stopBubble: true,
    });
    desktop.dispatch('pointerdown', {
      ...touch(1),
      target: null,
      stopPropagation: desktopStopped,
    });
    expect(desktopStopped).not.toHaveBeenCalled();
  });
});
