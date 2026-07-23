// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hideReconnectOverlay, showReconnectOverlay } from '../src/ui/reconnect_overlay';

const OVERLAY_ID = 'reconnect-overlay';

describe('reconnect overlay stateful half (show/show/hide)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    hideReconnectOverlay();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('a second showReconnectOverlay replaces the message in place, not a duplicate element', () => {
    showReconnectOverlay(1, 40, Date.now() + 15_000);
    expect(document.querySelectorAll(`#${OVERLAY_ID}`).length).toBe(1);
    const firstText = document.getElementById(OVERLAY_ID)?.textContent;

    showReconnectOverlay(2, 40, Date.now() + 8_000);
    expect(document.querySelectorAll(`#${OVERLAY_ID}`).length).toBe(1);
    expect(document.getElementById(OVERLAY_ID)?.textContent).not.toBe(firstText);
  });

  it('a second showReconnectOverlay replaces the tick interval rather than stacking a duplicate', () => {
    showReconnectOverlay(1, 40, Date.now() + 5_000);
    showReconnectOverlay(2, 40, Date.now() + 5_000);
    // Decisive: if the first interval were still alive alongside the second,
    // there would be two live timers here, not one. Both intervals share the
    // same 1000ms tick and would race renders of the same messageEl, which the
    // text-based assertions below cannot distinguish from a single replaced
    // timer (both land on the same text either way).
    expect(vi.getTimerCount()).toBe(1);
  });

  it('hideReconnectOverlay removes the element and clears the interval so no leaked timer keeps firing', () => {
    showReconnectOverlay(1, 40, Date.now() + 15_000);
    hideReconnectOverlay();
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
    // Decisive: proves the interval itself is gone, not merely that the
    // module's handle was nulled (which a leaked-but-forgotten interval would
    // also satisfy).
    expect(vi.getTimerCount()).toBe(0);

    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    hideReconnectOverlay(); // idempotent: no interval left to clear a second time
    expect(clearIntervalSpy).not.toHaveBeenCalled();
  });

  it('switches to the "reconnecting now" message once the countdown reaches zero', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    showReconnectOverlay(3, 40, now + 2_000);
    const before = document.getElementById(OVERLAY_ID)?.textContent ?? '';
    expect(before).toMatch(/2s|1s/);

    vi.setSystemTime(now + 2_000);
    vi.advanceTimersByTime(2_000);
    const after = document.getElementById(OVERLAY_ID)?.textContent ?? '';
    expect(after).not.toBe(before);
    expect(after).not.toMatch(/\ds\)/);
  });
});
