import { describe, expect, it } from 'vitest';
import { secondsUntilRetry } from '../src/ui/reconnect_status_core';

describe('secondsUntilRetry', () => {
  it('rounds up a partial second so the overlay never shows 0s before the retry fires', () => {
    expect(secondsUntilRetry(10_500, 9_000)).toBe(2);
    expect(secondsUntilRetry(10_001, 9_000)).toBe(2);
    expect(secondsUntilRetry(10_000, 9_000)).toBe(1);
  });

  it('clamps to 0 once the retry time has passed, never negative', () => {
    expect(secondsUntilRetry(9_000, 9_000)).toBe(0);
    expect(secondsUntilRetry(8_000, 9_000)).toBe(0);
  });

  it('returns 0 exactly at the retry timestamp', () => {
    expect(secondsUntilRetry(5_000, 5_000)).toBe(0);
  });
});
