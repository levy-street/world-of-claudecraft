// window_reflow.ts: the "requested spot" persistence + post-resize reflow
// shared by every managed `.window.panel` (bags, vendor, bank, quest log, and
// the rest); the pure placement/anchor math lives in window_reflow_core.ts
// (see window_reflow_core.test.ts). Per the repo testing convention this
// drives a small hand-rolled fake DOM stubbed on globalThis (no jsdom),
// mirroring movable_frame.test.ts (window_reflow.ts reads the bare `window`
// global the same way movable_frame.ts does).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installWindowReflow,
  rememberWindowPos,
  requestedWindowPos,
} from '../src/ui/window_reflow';

class FakeElement {
  dataset: Record<string, string> = {};
}

type Listener = () => void;

const fakeWindow = {
  innerWidth: 1600,
  innerHeight: 900,
  listeners: new Map<string, Listener[]>(),
  addEventListener(type: string, fn: Listener): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  },
  removeEventListener(type: string, fn: Listener): void {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const index = arr.indexOf(fn);
    if (index >= 0) arr.splice(index, 1);
  },
  dispatch(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  },
};

beforeEach(() => {
  fakeWindow.innerWidth = 1600;
  fakeWindow.innerHeight = 900;
  fakeWindow.listeners.clear();
  (globalThis as Record<string, unknown>).window = fakeWindow;
});

describe('rememberWindowPos + requestedWindowPos', () => {
  it('round-trips a stamped spot back out unchanged at the same viewport', () => {
    const el = new FakeElement() as unknown as HTMLElement;
    rememberWindowPos(el, 500, 300);
    expect(requestedWindowPos(el, { left: 999, top: 999, width: 300, height: 200 })).toEqual({
      left: 500,
      top: 300,
    });
  });

  it('falls back to the current rect when no spot was ever stamped', () => {
    const el = new FakeElement() as unknown as HTMLElement;
    expect(requestedWindowPos(el, { left: 42, top: 24, width: 300, height: 200 })).toEqual({
      left: 42,
      top: 24,
    });
  });

  it('falls back to the current rect when the stamped viewport is corrupt (zero/negative)', () => {
    const el = new FakeElement() as unknown as HTMLElement;
    el.dataset.reqLeft = '500';
    el.dataset.reqTop = '300';
    el.dataset.reqVw = '0';
    el.dataset.reqVh = '900';
    expect(requestedWindowPos(el, { left: 42, top: 24, width: 300, height: 200 })).toEqual({
      left: 42,
      top: 24,
    });
  });

  // The regression the bug report described: a window dragged into a corner
  // at 4K must return to the exact same spot after leaving then re-entering
  // fullscreen, not wherever the shrink-time clamp left it.
  it('re-anchors a corner-parked spot across a viewport change, and growing back restores it', () => {
    const el = new FakeElement() as unknown as HTMLElement;
    fakeWindow.innerWidth = 3840;
    fakeWindow.innerHeight = 2160;
    rememberWindowPos(el, 3500, 1900);

    fakeWindow.innerWidth = 1920;
    fakeWindow.innerHeight = 1080;
    expect(requestedWindowPos(el, { left: 0, top: 0, width: 300, height: 200 })).toEqual({
      left: 1580,
      top: 820,
    });

    fakeWindow.innerWidth = 3840;
    fakeWindow.innerHeight = 2160;
    expect(requestedWindowPos(el, { left: 0, top: 0, width: 300, height: 200 })).toEqual({
      left: 3500,
      top: 1900,
    });
  });
});

describe('installWindowReflow', () => {
  it('reflows every reported window from its requested spot on resize, and stops on teardown', () => {
    const el = Object.assign(new FakeElement(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }),
      classList: { contains: () => false },
    }) as unknown as HTMLElement;
    fakeWindow.innerWidth = 3840;
    fakeWindow.innerHeight = 2160;
    rememberWindowPos(el, 3500, 1900);

    const calls: Array<[number, number]> = [];
    const teardown = installWindowReflow({
      movedWindows: () => [el],
      reflow: (_el, left, top) => calls.push([left, top]),
    });

    fakeWindow.innerWidth = 1920;
    fakeWindow.innerHeight = 1080;
    fakeWindow.dispatch('resize');
    expect(calls).toEqual([[1580, 820]]);

    teardown();
    fakeWindow.dispatch('resize');
    expect(calls).toHaveLength(1);
  });

  it('skips a window mid-drag or mid-resize: the live gesture owns the position', () => {
    const dragging = Object.assign(new FakeElement(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }),
      classList: { contains: (c: string) => c === 'window-dragging' },
    }) as unknown as HTMLElement;
    const resizing = Object.assign(new FakeElement(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }),
      classList: { contains: (c: string) => c === 'window-resizing' },
    }) as unknown as HTMLElement;
    rememberWindowPos(dragging, 100, 100);
    rememberWindowPos(resizing, 200, 200);

    const calls: HTMLElement[] = [];
    installWindowReflow({
      movedWindows: () => [dragging, resizing],
      reflow: (el) => calls.push(el),
    });

    fakeWindow.dispatch('resize');
    expect(calls).toEqual([]);
  });

  describe('the trailing settle pass', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('re-derives once more after the metrics settle, correcting a resize that first reported stale metrics', () => {
      const el = Object.assign(new FakeElement(), {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }),
        classList: { contains: () => false },
      }) as unknown as HTMLElement;
      fakeWindow.innerWidth = 3840;
      fakeWindow.innerHeight = 2160;
      rememberWindowPos(el, 3500, 1900);

      const calls: Array<[number, number]> = [];
      installWindowReflow({
        movedWindows: () => [el],
        reflow: (_el, left, top) => calls.push([left, top]),
      });

      // A resize event fired mid-transition (an OS fullscreen exit) can still
      // observe the OLD innerWidth/Height on its first tick: the immediate
      // pass sees the SAME viewport it was stamped under and is a no-op.
      fakeWindow.dispatch('resize');
      expect(calls).toEqual([[3500, 1900]]);

      // The real metrics land a beat later; only the trailing 200ms pass
      // (never a second 'resize' event) picks them up.
      fakeWindow.innerWidth = 1920;
      fakeWindow.innerHeight = 1080;
      vi.advanceTimersByTime(200);
      expect(calls).toEqual([
        [3500, 1900],
        [1580, 820],
      ]);
    });

    it('coalesces repeated resizes into one trailing pass', () => {
      const el = Object.assign(new FakeElement(), {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }),
        classList: { contains: () => false },
      }) as unknown as HTMLElement;
      rememberWindowPos(el, 500, 300);
      const calls: Array<[number, number]> = [];
      installWindowReflow({
        movedWindows: () => [el],
        reflow: (_el, left, top) => calls.push([left, top]),
      });

      fakeWindow.dispatch('resize');
      vi.advanceTimersByTime(100);
      fakeWindow.dispatch('resize'); // restarts the 200ms settle window
      vi.advanceTimersByTime(100);
      // 200ms after the FIRST dispatch: the restarted timer has not fired yet.
      expect(calls).toHaveLength(2);
      vi.advanceTimersByTime(100);
      expect(calls).toHaveLength(3);
    });
  });
});
