// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  noteLoadingProgress,
  startSlowConnectionWatch,
  stopSlowConnectionWatch,
} from '../src/ui/loading_slow_hint';
import { SLOW_CONNECTION_HINT_THRESHOLD_MS } from '../src/ui/loading_slow_hint_core';

function makeHintEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'ls-slow-hint';
  document.body.appendChild(el);
  return el;
}

describe('loading_slow_hint (arm/disarm policy)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    stopSlowConnectionWatch();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('does not show the hint before progress has been quiet for the full threshold', () => {
    const el = makeHintEl();
    startSlowConnectionWatch();
    vi.advanceTimersByTime(SLOW_CONNECTION_HINT_THRESHOLD_MS - 1_000);
    expect(el.classList.contains('visible')).toBe(false);
  });

  it('shows the hint once progress has been quiet for the full threshold', () => {
    const el = makeHintEl();
    startSlowConnectionWatch();
    vi.advanceTimersByTime(SLOW_CONNECTION_HINT_THRESHOLD_MS + 1_000);
    expect(el.classList.contains('visible')).toBe(true);
  });

  it('noteLoadingProgress resets the quiet-timer and hides an already-shown hint', () => {
    const el = makeHintEl();
    startSlowConnectionWatch();
    vi.advanceTimersByTime(SLOW_CONNECTION_HINT_THRESHOLD_MS + 1_000);
    expect(el.classList.contains('visible')).toBe(true);

    noteLoadingProgress();
    expect(el.classList.contains('visible')).toBe(false);

    // Progress just moved: a tick right after must not immediately re-show it.
    vi.advanceTimersByTime(1_000);
    expect(el.classList.contains('visible')).toBe(false);
  });

  it('stopSlowConnectionWatch clears the interval and hides the hint, so a stopped watch never re-fires', () => {
    const el = makeHintEl();
    startSlowConnectionWatch();
    vi.advanceTimersByTime(SLOW_CONNECTION_HINT_THRESHOLD_MS + 1_000);
    expect(el.classList.contains('visible')).toBe(true);

    stopSlowConnectionWatch();
    expect(el.classList.contains('visible')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    // No live interval left: time passing must not resurrect the hint.
    vi.advanceTimersByTime(SLOW_CONNECTION_HINT_THRESHOLD_MS * 2);
    expect(el.classList.contains('visible')).toBe(false);
  });

  it('a second startSlowConnectionWatch does not stack a duplicate interval', () => {
    makeHintEl();
    startSlowConnectionWatch();
    expect(vi.getTimerCount()).toBe(1);
    startSlowConnectionWatch();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('is a safe no-op when #ls-slow-hint is absent from the DOM (survives entry drift)', () => {
    startSlowConnectionWatch();
    expect(() => vi.advanceTimersByTime(SLOW_CONNECTION_HINT_THRESHOLD_MS + 1_000)).not.toThrow();
    expect(() => noteLoadingProgress()).not.toThrow();
    expect(() => stopSlowConnectionWatch()).not.toThrow();
  });
});
