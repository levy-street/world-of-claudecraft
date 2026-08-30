// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STORAGE_RUNG_ECHO_TIMEOUT_MS,
  StorageRungEchoLatch,
  storageRungRefusalTargets,
} from '../src/ui/storage_rung_echo_core';

function latch(onTimeout = vi.fn()): StorageRungEchoLatch {
  return new StorageRungEchoLatch(
    {
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (handle) => window.clearTimeout(handle),
    },
    onTimeout,
  );
}

afterEach(() => vi.useRealTimers());

describe('StorageRungEchoLatch', () => {
  it('holds through stale revisions and releases on the expected authoritative echo', () => {
    vi.useFakeTimers();
    const echo = latch();
    expect(echo.arm(24, 30)).toBe(true);
    expect(echo.pending).toBe(true);
    expect(echo.arm(24, 30)).toBe(false);
    expect(echo.observe(24)).toBe(false);
    expect(echo.observe(29)).toBe(false);
    expect(echo.pending).toBe(true);
    expect(echo.observe(30)).toBe(true);
    expect(echo.pending).toBe(false);
  });

  it('accepts a newer coalesced echo and ignores malformed revisions', () => {
    vi.useFakeTimers();
    const echo = latch();
    expect(echo.arm(1, 2)).toBe(true);
    expect(echo.observe(Number.NaN)).toBe(false);
    expect(echo.observe(1.5)).toBe(false);
    expect(echo.observe(3)).toBe(true);
  });

  it('releases at exactly the bounded 12,000ms timeout, never one millisecond early', () => {
    vi.useFakeTimers();
    expect(STORAGE_RUNG_ECHO_TIMEOUT_MS).toBe(12_000);
    const onTimeout = vi.fn();
    const echo = latch(onTimeout);
    expect(echo.arm(0, 1)).toBe(true);

    vi.advanceTimersByTime(11_999);
    expect(echo.pending).toBe(true);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(echo.pending).toBe(false);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('releases immediately on a correlated refusal and cancels the timeout', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const echo = latch(onTimeout);
    expect(echo.arm(1, 2)).toBe(true);
    expect(echo.refuse()).toBe(true);
    expect(echo.refuse()).toBe(false);
    vi.advanceTimersByTime(STORAGE_RUNG_ECHO_TIMEOUT_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('refuses invalid or non-advancing revisions without arming', () => {
    vi.useFakeTimers();
    for (const [current, expected] of [
      [1, 1],
      [2, 1],
      [1.5, 2],
      [1, Number.NaN],
    ]) {
      expect(latch().arm(current, expected)).toBe(false);
    }
  });
});

describe('storageRungRefusalTargets', () => {
  it('maps every purchase-specific authoritative refusal to only its own ladder', () => {
    for (const text of [
      'Your guild cannot afford that expansion.',
      'The guild bank cannot be expanded further.',
    ]) {
      expect(storageRungRefusalTargets(text), text).toEqual({ guild: true, vault: false });
    }
    for (const text of [
      'You cannot afford that vault upgrade.',
      'Your vault cannot be upgraded further.',
    ]) {
      expect(storageRungRefusalTargets(text), text).toEqual({ guild: false, vault: true });
    }
  });

  it('does not treat generic errors from unrelated actions as purchase refusals', () => {
    for (const text of [
      'Not enough money.',
      'You are busy.',
      'You are busy. Try again in a moment.',
      'You are too far from the banker.',
      'You must be in a guild to use the guild bank.',
      'Only guild officers may use the guild bank.',
      'The guild bank is closing. Try again in a moment.',
      'Something unrelated failed.',
    ]) {
      expect(storageRungRefusalTargets(text), text).toEqual({ guild: false, vault: false });
    }
  });
});
