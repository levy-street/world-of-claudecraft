import { describe, expect, it } from 'vitest';
import {
  utcDayFromMs,
  advanceStreak,
  isNewDay,
  keysForStreak,
  NEW_STREAK,
  StreakState,
} from '../server/daily_streak';

describe('utcDayFromMs', () => {
  it('counts whole UTC days since the epoch', () => {
    expect(utcDayFromMs(0)).toBe(0);
    expect(utcDayFromMs(86_400_000 - 1)).toBe(0);
    expect(utcDayFromMs(86_400_000)).toBe(1);
    expect(utcDayFromMs(Date.UTC(2026, 5, 24))).toBe(20628);
  });
});

describe('advanceStreak', () => {
  it('starts a streak at 1 on the first ever credit', () => {
    expect(advanceStreak(NEW_STREAK, 100)).toEqual({ lastDay: 100, streak: 1 });
  });

  it('is idempotent within the same day', () => {
    const s: StreakState = { lastDay: 100, streak: 5 };
    expect(advanceStreak(s, 100)).toEqual(s);
  });

  it('increments on the immediately following day', () => {
    expect(advanceStreak({ lastDay: 100, streak: 5 }, 101)).toEqual({ lastDay: 101, streak: 6 });
  });

  it('resets to 1 after a gap of two or more days', () => {
    expect(advanceStreak({ lastDay: 100, streak: 5 }, 102)).toEqual({ lastDay: 102, streak: 1 });
    expect(advanceStreak({ lastDay: 100, streak: 5 }, 130)).toEqual({ lastDay: 130, streak: 1 });
  });

  it('ignores a day earlier than the last credited (clock skew / replay)', () => {
    const s: StreakState = { lastDay: 100, streak: 5 };
    expect(advanceStreak(s, 99)).toEqual(s);
    expect(advanceStreak(s, 0)).toEqual(s);
  });

  it('builds a real multi-day run', () => {
    let s = NEW_STREAK;
    for (let day = 10; day < 17; day++) s = advanceStreak(s, day);
    expect(s).toEqual({ lastDay: 16, streak: 7 });
  });
});

describe('isNewDay', () => {
  it('is true for the first credit and any forward day, false within a day or backwards', () => {
    expect(isNewDay(NEW_STREAK, 5)).toBe(true);
    expect(isNewDay({ lastDay: 5, streak: 1 }, 6)).toBe(true);
    expect(isNewDay({ lastDay: 5, streak: 1 }, 5)).toBe(false);
    expect(isNewDay({ lastDay: 5, streak: 1 }, 4)).toBe(false);
  });
});

describe('keysForStreak', () => {
  it('awards one key per ordinary day', () => {
    expect(keysForStreak(1)).toBe(1);
    expect(keysForStreak(2)).toBe(1);
    expect(keysForStreak(4)).toBe(1);
  });

  it('stacks the largest applicable milestone, not all of them', () => {
    expect(keysForStreak(3)).toBe(2); // +1 at /3
    expect(keysForStreak(6)).toBe(2);
    expect(keysForStreak(7)).toBe(4); // +3 at /7
    expect(keysForStreak(21)).toBe(4); // 21 is /3 and /7 -> /7 wins (4), not 5
    expect(keysForStreak(30)).toBe(11); // +10 at /30 (also /3, /7-no -> /30 wins)
    expect(keysForStreak(0)).toBe(0);
    expect(keysForStreak(-3)).toBe(0);
  });
});
