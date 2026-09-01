// MeterFrame (src/ui/meters_frame.ts): the movable + resizable adapter behind
// the damage window and every detached meter panel (also reused verbatim by
// the target-auras window). Per the repo testing convention this drives the
// shared fake DOM (tests/helpers/fake_dom.ts) rather than a hand-rolled one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeterFrame } from '../src/ui/meters_frame';
import { FakeDocument, FakeWindow, pointerEvent } from './helpers/fake_dom';

class MemoryStorage {
  readonly values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const KEY = 'woc_test_meter_frame_pos';

function makeHarness(
  initialStorage: Record<string, string> = {},
  options: { mobile?: boolean } = {},
) {
  const document = new FakeDocument();
  const window = new FakeWindow(1600, 900);
  const panel = document.element('test-meter-panel');
  panel.setRect({ left: 40, top: 500, width: 240, height: 180 });
  const handle = document.element('test-meter-title');
  const storage = new MemoryStorage(initialStorage);
  const frame = new MeterFrame(
    {
      el: panel as unknown as HTMLElement,
      handles: [handle as unknown as HTMLElement],
      storageKey: KEY,
      fallbackSize: { w: 240, h: 180 },
    },
    {
      document: document as unknown as Document,
      window: window as unknown as Window,
      storage,
      isMobileLayout: () => options.mobile ?? false,
      uiScale: () => 1,
    },
  );
  return { frame, document, window, panel, handle, storage };
}

describe('MeterFrame', () => {
  it('a shrink re-anchors the render, and growing back restores the SAVED spot', () => {
    const harness = makeHarness();
    harness.frame.init();

    // Drag the panel into the bottom-right corner at a large (4K) viewport.
    harness.window.innerWidth = 3840;
    harness.window.innerHeight = 2160;
    harness.handle.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 3, clientX: 60, clientY: 520 }),
    );
    harness.document.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 3, clientX: 3560, clientY: 1980 }),
    );
    harness.document.dispatchEvent(
      pointerEvent('pointerup', { pointerId: 3, clientX: 3560, clientY: 1980 }),
    );
    expect(harness.panel.style.left).toBe('3540px');
    expect(harness.panel.style.top).toBe('1960px');
    expect(JSON.parse(harness.storage.getItem(KEY) ?? '{}')).toMatchObject({
      left: 3540,
      top: 1960,
      vw: 3840,
      vh: 2160,
    });

    // Leave fullscreen: the browser fires 'resize' as the window shrinks to 1080p.
    harness.window.innerWidth = 1920;
    harness.window.innerHeight = 1080;
    harness.window.dispatchEvent(new Event('resize'));
    // Re-anchored to the smaller viewport (still keeping its distance to the
    // bottom-right corner), NOT the stale absolute 4K offset.
    expect(harness.panel.style.left).toBe('1620px');
    expect(harness.panel.style.top).toBe('880px');
    // The shrink must never overwrite the saved 4K spot in storage.
    expect(JSON.parse(harness.storage.getItem(KEY) ?? '{}')).toMatchObject({
      left: 3540,
      top: 1960,
      vw: 3840,
      vh: 2160,
    });

    // Back to fullscreen: growing the window back restores the EXACT saved spot
    // (the bug: it used to stay wherever the shrink-clamp had left it).
    harness.window.innerWidth = 3840;
    harness.window.innerHeight = 2160;
    harness.window.dispatchEvent(new Event('resize'));
    expect(harness.panel.style.left).toBe('3540px');
    expect(harness.panel.style.top).toBe('1960px');
  });

  it('a mid-gesture resize leaves the live drag alone', () => {
    const harness = makeHarness({
      woc_test_meter_frame_pos: JSON.stringify({
        left: 100,
        top: 100,
        width: 240,
        height: 180,
        vw: 1600,
        vh: 900,
      }),
    });
    harness.frame.init();
    harness.handle.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 5, clientX: 120, clientY: 120 }),
    );
    harness.document.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 5, clientX: 300, clientY: 260 }),
    );
    expect(harness.panel.style.left).toBe('280px');

    // A resize fired mid-drag (an OS fullscreen transition) must not clobber
    // the position the pointer is actively controlling.
    harness.window.innerWidth = 1280;
    harness.window.innerHeight = 720;
    harness.window.dispatchEvent(new Event('resize'));
    expect(harness.panel.style.left).toBe('280px');

    harness.document.dispatchEvent(
      pointerEvent('pointerup', { pointerId: 5, clientX: 300, clientY: 260 }),
    );
    expect(JSON.parse(harness.storage.getItem(KEY) ?? '{}')).toMatchObject({ left: 280, top: 240 });
  });

  it('refresh() re-derives from the saved viewport-stamped spot, not the last render', () => {
    const harness = makeHarness();
    harness.frame.init();
    harness.window.innerWidth = 3840;
    harness.window.innerHeight = 2160;
    harness.handle.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 3, clientX: 60, clientY: 520 }),
    );
    harness.document.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 3, clientX: 3560, clientY: 1980 }),
    );
    harness.document.dispatchEvent(
      pointerEvent('pointerup', { pointerId: 3, clientX: 3560, clientY: 1980 }),
    );

    // The panel closes (its window hides) while still at 4K, the browser then
    // shrinks to 1080p, and only THEN does the panel show again: refresh() is
    // what a reshow calls, and it must re-anchor from storage the same way a
    // live resize does.
    harness.window.innerWidth = 1920;
    harness.window.innerHeight = 1080;
    harness.frame.refresh();
    expect(harness.panel.style.left).toBe('1620px');
    expect(harness.panel.style.top).toBe('880px');
  });

  it('migrates a legacy (pre-viewport-stamp) save by stamping it on the first apply', () => {
    const harness = makeHarness({
      woc_test_meter_frame_pos: JSON.stringify({ left: 300, top: 200, width: 240, height: 180 }),
    });
    harness.frame.init();
    expect(JSON.parse(harness.storage.getItem(KEY) ?? '{}')).toMatchObject({
      left: 300,
      top: 200,
      vw: 1600,
      vh: 900,
    });
  });

  describe('the trailing settle pass', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('re-derives once more after the metrics settle, correcting a resize that first reported stale metrics', () => {
      const harness = makeHarness();
      harness.frame.init();
      harness.window.innerWidth = 3840;
      harness.window.innerHeight = 2160;
      harness.handle.dispatchEvent(
        pointerEvent('pointerdown', { pointerId: 3, clientX: 60, clientY: 520 }),
      );
      harness.document.dispatchEvent(
        pointerEvent('pointermove', { pointerId: 3, clientX: 3560, clientY: 1980 }),
      );
      harness.document.dispatchEvent(
        pointerEvent('pointerup', { pointerId: 3, clientX: 3560, clientY: 1980 }),
      );
      expect(harness.panel.style.left).toBe('3540px');

      // A resize event fires but window.innerWidth/Height still report the
      // OLD metrics on this first tick (an OS fullscreen-exit race): the
      // immediate pass sees the SAME viewport it was stamped under and is a
      // no-op.
      harness.window.dispatchEvent(new Event('resize'));
      expect(harness.panel.style.left).toBe('3540px');

      // The real metrics land a beat later; only the trailing 200ms pass
      // (never a second 'resize' event) picks them up.
      harness.window.innerWidth = 1920;
      harness.window.innerHeight = 1080;
      vi.advanceTimersByTime(200);
      expect(harness.panel.style.left).toBe('1620px');
      expect(harness.panel.style.top).toBe('880px');
    });
  });
});
