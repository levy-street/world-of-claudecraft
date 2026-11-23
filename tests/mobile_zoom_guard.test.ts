// @vitest-environment happy-dom
// The mobile page-zoom guard (src/game/mobile_zoom_guard.ts). The bug it pins:
// on a phone, focusing the Book of Deeds search and then tapping elsewhere in
// the window left the page zoomed, the close button off-screen, and no pinch
// to undo it (pinch is blocked in game).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installMobileZoomGuard,
  isPageZoomed,
  RESET_HOLD_MS,
  resetPageZoom,
  shouldResetFocusZoom,
} from '../src/game/mobile_zoom_guard';

// The shipped viewport content, read from the entry so a meta change is seen.
const SHIPPED_VIEWPORT = /<meta name="viewport" content="([^"]+)"/.exec(
  readFileSync(join(__dirname, '../index.html'), 'utf8'),
)![1];

describe('isPageZoomed', () => {
  it('treats scale 1 and a missing visualViewport as at rest', () => {
    expect(isPageZoomed(1)).toBe(false);
    expect(isPageZoomed(1.005)).toBe(false);
    expect(isPageZoomed(undefined)).toBe(false);
  });
  it('treats any real zoom-in as zoomed', () => {
    expect(isPageZoomed(1.2)).toBe(true);
    expect(isPageZoomed(2)).toBe(true);
  });
});

describe('shouldResetFocusZoom', () => {
  it('resets a zoom that began with the focus (the iOS small-text auto-zoom)', () => {
    expect(shouldResetFocusZoom(1, 1.4)).toBe(true);
    expect(shouldResetFocusZoom(undefined, 1.4)).toBe(true);
  });
  it('leaves an unzoomed page alone', () => {
    expect(shouldResetFocusZoom(1, 1)).toBe(false);
  });
  it('never undoes a zoom the player was already in before tapping the field', () => {
    expect(shouldResetFocusZoom(1.5, 1.5)).toBe(false);
    expect(shouldResetFocusZoom(1.5, 2)).toBe(false);
  });
});

describe('installMobileZoomGuard', () => {
  let meta: HTMLMetaElement;
  let vvScale: number;
  let uninstall: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = '';
    document.body.innerHTML =
      '<div id="ui"><div id="deeds-window"><input class="deed-search"><button class="deed-card">x</button></div></div>';
    meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.setAttribute('content', SHIPPED_VIEWPORT);
    document.head.appendChild(meta);
    vvScale = 1;
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      get: () => ({ scale: vvScale }),
    });
    uninstall = installMobileZoomGuard(window);
  });
  afterEach(() => {
    uninstall();
    vi.useRealTimers();
  });

  const search = () => document.querySelector<HTMLInputElement>('.deed-search')!;
  const clamped = () => `${SHIPPED_VIEWPORT}, maximum-scale=1.0`;

  it('blocks pinch gestures', () => {
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      const ev = new Event(type, { cancelable: true });
      document.dispatchEvent(ev);
      expect(ev.defaultPrevented, type).toBe(true);
    }
  });

  it('snaps the page back to scale 1 when leaving the search leaves it zoomed, then restores the meta', () => {
    search().focus();
    // iOS zooms in after the focus lands.
    vvScale = 1.5;
    search().blur();
    vi.advanceTimersByTime(0);
    expect(meta.getAttribute('content')).toBe(clamped());
    vi.advanceTimersByTime(RESET_HOLD_MS);
    expect(meta.getAttribute('content')).toBe(SHIPPED_VIEWPORT);
  });

  it('keeps the pre-focus baseline across the per-keystroke re-render and re-focus', () => {
    search().focus();
    vvScale = 1.5;
    // deeds_window.ts re-renders on input: the focused node is replaced and
    // the fresh input re-focused while the page is already zoomed.
    const win = document.querySelector('#deeds-window')!;
    win.innerHTML = '<input class="deed-search"><button class="deed-card">x</button>';
    search().focus();
    vi.advanceTimersByTime(0);
    expect(meta.getAttribute('content')).toBe(SHIPPED_VIEWPORT);
    // Then the player taps elsewhere in the window.
    document.querySelector<HTMLButtonElement>('.deed-card')!.focus();
    vi.advanceTimersByTime(0);
    expect(meta.getAttribute('content')).toBe(clamped());
  });

  it('does not reset mid-entry when focus hops from one field to another', () => {
    const other = document.createElement('input');
    document.body.appendChild(other);
    search().focus();
    vvScale = 1.5;
    other.focus();
    vi.advanceTimersByTime(0);
    expect(meta.getAttribute('content')).toBe(SHIPPED_VIEWPORT);
  });

  it('does not touch the meta when the focus never zoomed the page', () => {
    search().focus();
    search().blur();
    vi.runAllTimers();
    expect(meta.getAttribute('content')).toBe(SHIPPED_VIEWPORT);
  });

  it('never undoes a zoom the player was already in before tapping the field', () => {
    vvScale = 1.5;
    search().focus();
    search().blur();
    vi.runAllTimers();
    expect(meta.getAttribute('content')).toBe(SHIPPED_VIEWPORT);
  });

  it('cancels a quick second tap on plain chrome (double-tap zoom) but never on a control', () => {
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    const tap = (el: Element) => {
      const ev = new Event('touchend', { cancelable: true, bubbles: true });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(tap(plain)).toBe(false);
    expect(tap(plain)).toBe(true);
    const button = document.querySelector('.deed-card')!;
    expect(tap(button)).toBe(false);
    expect(tap(button)).toBe(false);
  });
});

describe('resetPageZoom', () => {
  it('never stacks a second clamp onto a meta that already carries one', () => {
    document.head.innerHTML =
      '<meta name="viewport" content="width=device-width, maximum-scale=1.0">';
    resetPageZoom(window);
    expect(document.querySelector('meta')!.getAttribute('content')).toBe(
      'width=device-width, maximum-scale=1.0',
    );
  });
});

describe('the zoom-aware 16px input floor', () => {
  const baseCss = readFileSync(join(__dirname, '../src/styles/base.css'), 'utf8');
  it('divides the floor by the #ui zoom inside the coarse-pointer block', () => {
    const start = baseCss.indexOf('@media (pointer: coarse) {');
    const block = baseCss.slice(start, baseCss.indexOf('\n  }\n', start));
    expect(block).toContain(
      '#ui :is(input, textarea, select) {\n      font-size: max(16px, calc(16px / var(--ui-scale, 1))) !important;',
    );
  });
});
