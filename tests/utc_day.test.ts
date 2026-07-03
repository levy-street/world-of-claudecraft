import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentUtcDay } from '../src/game/utc_day';

describe('currentUtcDay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the ISO UTC day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:34:56Z'));
    expect(currentUtcDay()).toBe('2026-07-01');
  });

  it('caches within the refresh window and rolls over across midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T23:59:59.700Z'));
    expect(currentUtcDay()).toBe('2026-07-01');
    // still inside the 1s cache window: the cached day is served as-is
    vi.setSystemTime(new Date('2026-07-02T00:00:00.100Z'));
    expect(currentUtcDay()).toBe('2026-07-01');
    // past the window: the next read re-derives and sees the new day
    vi.setSystemTime(new Date('2026-07-02T00:00:00.800Z'));
    expect(currentUtcDay()).toBe('2026-07-02');
  });
});
