import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentResetDay, currentUtcDay, DAILY_RESET_HOUR, resetDayOf } from '../src/game/utc_day';

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

// Offline there is no realm, so the daily window turns over at the player's OWN
// local reset hour. `resetDayOf` is expressed entirely in local civil terms, so
// every case below is built with the LOCAL Date constructor and holds in any
// process zone. The server's zone-parameterized twin is `resetDayKey`
// (tests/raid_reset.test.ts), and the two share DAILY_RESET_HOUR.
describe('resetDayOf', () => {
  it('holds one key across an evening that midnight UTC would have split', () => {
    // The shape the realm bug was reported in: a win in the morning and the
    // banner re-arming that same evening.
    const morning = new Date(2026, 7, 7, 10, 0);
    const evening = new Date(2026, 7, 7, 18, 11);
    expect(resetDayOf(morning)).toBe('2026-08-07');
    expect(resetDayOf(evening)).toBe('2026-08-07');
  });

  it('turns over at the local reset hour, not at local midnight', () => {
    expect(resetDayOf(new Date(2026, 7, 7, 0, 1)), 'just past midnight').toBe('2026-08-06');
    expect(resetDayOf(new Date(2026, 7, 7, 2, 59)), 'the last minute before').toBe('2026-08-06');
    expect(resetDayOf(new Date(2026, 7, 7, 3, 0)), 'the reset hour opens it').toBe('2026-08-07');
  });

  it('rolls the month and the year back across an edge', () => {
    expect(resetDayOf(new Date(2026, 7, 1, 1, 0))).toBe('2026-07-31');
    expect(resetDayOf(new Date(2026, 0, 1, 2, 0))).toBe('2025-12-31');
  });

  it('zero-pads so keys compare and sort as strings', () => {
    expect(resetDayOf(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });

  it('does not mutate the Date it is handed', () => {
    const at = new Date(2026, 7, 7, 1, 0);
    const before = at.getTime();
    resetDayOf(at);
    expect(at.getTime()).toBe(before);
  });

  it('exports the reset hour it applies, so the server can be pinned against it', () => {
    expect(DAILY_RESET_HOUR).toBe(3);
  });
});

describe('currentResetDay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the clock through resetDayOf and caches for a second', () => {
    vi.useFakeTimers();
    const beforeReset = new Date(2026, 7, 7, 2, 59, 59, 700);
    vi.setSystemTime(beforeReset);
    expect(currentResetDay()).toBe('2026-08-06');
    vi.setSystemTime(new Date(2026, 7, 7, 3, 0, 0, 100));
    expect(currentResetDay(), 'inside the 1s window, the cached key is served').toBe('2026-08-06');
    vi.setSystemTime(new Date(2026, 7, 7, 3, 0, 0, 800));
    expect(currentResetDay(), 'past it, the next read re-derives').toBe('2026-08-07');
  });
});
