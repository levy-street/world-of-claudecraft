// Pure UTC-day login-streak math for the daily-tasks loop. A "day" is the
// integer count of whole UTC days since the epoch, so day boundaries are
// timezone-stable and a streak is just consecutive integers. Soft currency
// (spin tokens / pack keys) is awarded per day with milestone bonuses. No IO, so
// every transition is unit-testable.

const MS_PER_DAY = 86_400_000;

/** Whole UTC days since the epoch for a millisecond timestamp. */
export function utcDayFromMs(ms: number): number {
  return Math.floor(ms / MS_PER_DAY);
}

export interface StreakState {
  /** The last UTC day the account was credited, or null if never. */
  lastDay: number | null;
  /** Current consecutive-day streak (>= 0; 0 only in the never-credited state). */
  streak: number;
}

export const NEW_STREAK: StreakState = { lastDay: null, streak: 0 };

/**
 * Advance a streak for activity on UTC day `today`. Idempotent within a day
 * (claiming twice on the same day does not move the streak), increments on the
 * immediately following day, resets to 1 after a gap, and ignores a `today` that
 * is earlier than the last credited day (clock skew or a replayed request).
 */
export function advanceStreak(prev: StreakState, today: number): StreakState {
  if (prev.lastDay === null) return { lastDay: today, streak: 1 };
  if (today <= prev.lastDay) return prev; // already counted today, or backwards
  if (today === prev.lastDay + 1) return { lastDay: today, streak: prev.streak + 1 };
  return { lastDay: today, streak: 1 }; // gap of 2+ days resets
}

/** True only when `today` advances the streak (the day-credit should fire). */
export function isNewDay(prev: StreakState, today: number): boolean {
  return prev.lastDay === null || today > prev.lastDay;
}

/**
 * Spin/pack keys awarded for reaching `streak`. One per day, with stacking
 * milestone bonuses: +1 every 3 days, +3 every 7, +10 every 30 (the largest
 * applicable milestone wins, they do not compound on the same day).
 */
export function keysForStreak(streak: number): number {
  if (streak <= 0) return 0;
  let keys = 1;
  if (streak % 30 === 0) keys += 10;
  else if (streak % 7 === 0) keys += 3;
  else if (streak % 3 === 0) keys += 1;
  return keys;
}
