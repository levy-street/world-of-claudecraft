// Unit tests for the mismatch-warn flood bound (server/http/mismatch_warn_throttle.ts):
// the per-key fixed-window cap, the prior-window suppressed tally riding the first
// line of the next window, per-key independence (cardinality is per route template,
// never shared or per concrete path), the window boundary, and the default bounds
// pinned as literals. The clock is injected everywhere, so every case is
// deterministic.

import { describe, expect, it } from 'vitest';
import {
  createMismatchWarnThrottle,
  MISMATCH_WARN_MAX_PER_WINDOW,
  MISMATCH_WARN_WINDOW_MS,
} from '../../../server/http/mismatch_warn_throttle';

/** A throttle on a hand-advanced clock; returns the throttle and the clock setter. */
function fakeClockThrottle(opts: { maxPerWindow?: number; windowMs?: number } = {}) {
  let t = 0;
  const throttle = createMismatchWarnThrottle({ ...opts, now: () => t });
  const setTime = (next: number) => {
    t = next;
  };
  return { throttle, setTime };
}

describe('createMismatchWarnThrottle: per-key window cap', () => {
  it('admits exactly maxPerWindow lines out of a same-window flood, then suppresses', () => {
    const { throttle } = fakeClockThrottle({ maxPerWindow: 3, windowMs: 1000 });
    const admissions = Array.from({ length: 10 }, () => throttle.admit('POST /api/register'));
    expect(admissions.filter((a) => a.emit)).toHaveLength(3);
    // The first three are the admitted ones (no reordering), all tally-free.
    expect(admissions.slice(0, 3).every((a) => a.emit && a.suppressed === 0)).toBe(true);
    // Every later admission in the same window is suppressed with a zero tally.
    expect(admissions.slice(3).every((a) => !a.emit && a.suppressed === 0)).toBe(true);
  });

  it('reports the prior window suppressed tally on the FIRST line of the next window only', () => {
    const { throttle, setTime } = fakeClockThrottle({ maxPerWindow: 2, windowMs: 1000 });
    for (let i = 0; i < 9; i++) throttle.admit('POST /api/register');
    setTime(1000);
    // 9 mismatches minus 2 admitted = 7 suppressed, surfaced exactly once.
    expect(throttle.admit('POST /api/register')).toEqual({ emit: true, suppressed: 7 });
    expect(throttle.admit('POST /api/register')).toEqual({ emit: true, suppressed: 0 });
  });

  it('reports a zero tally after a window with no suppression', () => {
    const { throttle, setTime } = fakeClockThrottle({ maxPerWindow: 3, windowMs: 1000 });
    expect(throttle.admit('POST /api/register')).toEqual({ emit: true, suppressed: 0 });
    setTime(1000);
    expect(throttle.admit('POST /api/register')).toEqual({ emit: true, suppressed: 0 });
  });

  it('resets the tally each window: the second roll surfaces only the second window count', () => {
    const { throttle, setTime } = fakeClockThrottle({ maxPerWindow: 1, windowMs: 1000 });
    for (let i = 0; i < 4; i++) throttle.admit('k');
    setTime(1000);
    // Window 1 suppressed 3; window 2 opens carrying exactly that tally.
    expect(throttle.admit('k')).toEqual({ emit: true, suppressed: 3 });
    throttle.admit('k');
    throttle.admit('k');
    setTime(2000);
    // Window 2 suppressed 2 of its own; the tally is NOT 3 + 2 carried forward.
    expect(throttle.admit('k')).toEqual({ emit: true, suppressed: 2 });
  });

  it('rolls the window at exactly windowMs and not one millisecond earlier', () => {
    const { throttle, setTime } = fakeClockThrottle({ maxPerWindow: 1, windowMs: 1000 });
    expect(throttle.admit('k').emit).toBe(true);
    setTime(999);
    expect(throttle.admit('k').emit).toBe(false);
    setTime(1000);
    expect(throttle.admit('k')).toEqual({ emit: true, suppressed: 1 });
  });
});

describe('createMismatchWarnThrottle: per-key independence', () => {
  it('bounds two different route templates independently', () => {
    const { throttle } = fakeClockThrottle({ maxPerWindow: 2, windowMs: 1000 });
    for (let i = 0; i < 8; i++) throttle.admit('POST /api/register');
    // The flooded key is exhausted; a different template still has its full budget.
    expect(throttle.admit('POST /api/register').emit).toBe(false);
    expect(throttle.admit('POST /api/login').emit).toBe(true);
    expect(throttle.admit('POST /api/login').emit).toBe(true);
    expect(throttle.admit('POST /api/login').emit).toBe(false);
  });

  it('keeps each key its own suppressed tally across the window roll', () => {
    const { throttle, setTime } = fakeClockThrottle({ maxPerWindow: 1, windowMs: 1000 });
    for (let i = 0; i < 5; i++) throttle.admit('a');
    for (let i = 0; i < 3; i++) throttle.admit('b');
    setTime(1000);
    expect(throttle.admit('a')).toEqual({ emit: true, suppressed: 4 });
    expect(throttle.admit('b')).toEqual({ emit: true, suppressed: 2 });
  });

  it('gives two separate instances independent state (the two gates never share)', () => {
    const t = 0;
    const now = () => t;
    const contentType = createMismatchWarnThrottle({ maxPerWindow: 1, windowMs: 1000, now });
    const origin = createMismatchWarnThrottle({ maxPerWindow: 1, windowMs: 1000, now });
    expect(contentType.admit('POST /api/thing').emit).toBe(true);
    expect(contentType.admit('POST /api/thing').emit).toBe(false);
    expect(origin.admit('POST /api/thing').emit).toBe(true);
  });
});

describe('createMismatchWarnThrottle: default bounds', () => {
  it('pins the named constants as literals', () => {
    expect(MISMATCH_WARN_MAX_PER_WINDOW).toBe(5);
    expect(MISMATCH_WARN_WINDOW_MS).toBe(60000);
  });

  it('applies the literal defaults when only the clock is injected', () => {
    const { throttle, setTime } = fakeClockThrottle();
    const first = Array.from({ length: 6 }, () => throttle.admit('POST /api/register'));
    // Five admitted, the sixth suppressed: the default cap is 5.
    expect(first.map((a) => a.emit)).toEqual([true, true, true, true, true, false]);
    // 59999 ms is still the same window; 60000 ms opens the next one.
    setTime(59999);
    expect(throttle.admit('POST /api/register').emit).toBe(false);
    setTime(60000);
    expect(throttle.admit('POST /api/register')).toEqual({ emit: true, suppressed: 2 });
  });
});
