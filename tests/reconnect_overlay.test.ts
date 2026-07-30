// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeBackoffDelay } from '../src/net/backoff';
import { RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS } from '../src/net/online';
import {
  hideReconnectOverlay,
  RECONNECT_OVERLAY_SHOW_GRACE_MS,
  showReconnectOverlay,
} from '../src/ui/reconnect_overlay';

const OVERLAY_ID = 'reconnect-overlay';

// The overlay mounts only after the show grace: a drop that resumes inside it
// paints nothing. Most cases below first advance past the grace to reach the
// mounted state the pre-grace suite pinned.
const pastGrace = () => vi.advanceTimersByTime(RECONNECT_OVERLAY_SHOW_GRACE_MS);

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

  it('a drop that resumes inside the show grace never paints the overlay', () => {
    showReconnectOverlay(1, 40, Date.now() + 1_000);
    // The socket blip resolves before the grace elapses (the measured quick
    // reconnect is well under it): the overlay must never have mounted.
    vi.advanceTimersByTime(RECONNECT_OVERLAY_SHOW_GRACE_MS - 200);
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
    hideReconnectOverlay();
    // Decisive: nothing pending either; the cancelled grace timer cannot mount
    // a veil after the world has already resumed.
    vi.advanceTimersByTime(60_000);
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a sustained drop mounts once the grace elapses, with the LATEST retry payload', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    showReconnectOverlay(1, 40, now + 1_000);
    // DECISIVE against an un-graced overlay: nothing may be mounted while the
    // grace is still pending, including right after the refresh below (the
    // pre-grace overlay mounted on the first show and this stayed green by
    // updating the mounted element to attempt 2 anyway).
    vi.advanceTimersByTime(500);
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
    // A second retry is scheduled while the mount is still pending: the
    // eventual mount must render attempt 2's payload, not attempt 1's.
    showReconnectOverlay(2, 40, now + 20_000);
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
    vi.advanceTimersByTime(RECONNECT_OVERLAY_SHOW_GRACE_MS - 500);
    const el = document.getElementById(OVERLAY_ID);
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('2');
  });

  it('the grace clears the whole attempt-1 jitter band plus a handshake margin', () => {
    // A quick resume completes at attempt 1's retry delay plus the socket
    // reopen and auth handshake. The band is full-jitter (0.5x to 1.5x of
    // RECONNECT_BASE_DELAY_MS), so a grace below its CEILING still flashes on
    // a top-of-band draw: the veil mounts, then the resume tears it down
    // moments later. Pin the grace against the live constants so widening the
    // band cannot quietly reintroduce the blink.
    const bandCeiling = computeBackoffDelay(
      1,
      RECONNECT_BASE_DELAY_MS,
      RECONNECT_MAX_DELAY_MS,
      () => 1,
    );
    const handshakeMarginMs = 1000;
    expect(RECONNECT_OVERLAY_SHOW_GRACE_MS).toBeGreaterThanOrEqual(bandCeiling + handshakeMarginMs);
  });

  it('a second showReconnectOverlay replaces the message in place, not a duplicate element', () => {
    showReconnectOverlay(1, 40, Date.now() + 15_000);
    pastGrace();
    expect(document.querySelectorAll(`#${OVERLAY_ID}`).length).toBe(1);
    const firstText = document.getElementById(OVERLAY_ID)?.textContent;

    showReconnectOverlay(2, 40, Date.now() + 8_000);
    expect(document.querySelectorAll(`#${OVERLAY_ID}`).length).toBe(1);
    expect(document.getElementById(OVERLAY_ID)?.textContent).not.toBe(firstText);
  });

  it('a second showReconnectOverlay replaces the tick interval rather than stacking a duplicate', () => {
    showReconnectOverlay(1, 40, Date.now() + 5_000);
    pastGrace();
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
    pastGrace();
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
    showReconnectOverlay(3, 40, now + RECONNECT_OVERLAY_SHOW_GRACE_MS + 2_000);
    pastGrace();
    const before = document.getElementById(OVERLAY_ID)?.textContent ?? '';
    expect(before).toMatch(/2s|1s/);

    vi.setSystemTime(now + RECONNECT_OVERLAY_SHOW_GRACE_MS + 2_000);
    vi.advanceTimersByTime(2_000);
    const after = document.getElementById(OVERLAY_ID)?.textContent ?? '';
    expect(after).not.toBe(before);
    expect(after).not.toMatch(/\ds\)/);
  });
});
