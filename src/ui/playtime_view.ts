// Pure, host-agnostic view model for the character sheet's lifetime "Time
// Played" line (IWorldProgressionXp.playtimeSeconds).
//
// The raid_lockout.ts doctrine applied to an accumulator instead of a
// countdown: split the total into whole day/hour/minute parts here (FLOORED,
// never rounded up: a lifetime total must not overstate) and let the thin
// consumer (char_window.ts) splice them into localized t()/tPlural templates.
// The shape picks the two coarsest units so a veteran reads "12 days, 5 hours"
// and a fresh character "42 minutes", RuneScape style, with the zero minor
// unit dropped ("exactly 2 days" never renders as "2 days, 0 hours"). No DOM,
// no i18n runtime import, no RNG or wall clock. Unit tested in
// tests/playtime_view.test.ts.

export interface PlaytimeParts {
  days: number;
  hours: number;
  minutes: number;
}

/** Which template the consumer renders: the two coarsest non-zero units, a
 *  single unit when the next one down is zero, or the sub-minute floor text
 *  (never a bare "0 minutes"). */
export type PlaytimeShape =
  | 'daysHours'
  | 'days'
  | 'hoursMinutes'
  | 'hours'
  | 'minutes'
  | 'lessThanMinute';

/** Split a lifetime seconds total into whole days/hours/minutes, flooring the
 *  minute (an accumulator never overstates; only the display granularity is
 *  coarse). Negative or non-finite input degrades safely to zero. */
export function playtimeParts(seconds: number): PlaytimeParts {
  const totalMinutes = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds / 60)) : 0;
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
  };
}

/** Choose the display shape for a lifetime seconds total (see PlaytimeShape). */
export function playtimeShape(seconds: number): PlaytimeShape {
  const { days, hours, minutes } = playtimeParts(seconds);
  if (days > 0) return hours > 0 ? 'daysHours' : 'days';
  if (hours > 0) return minutes > 0 ? 'hoursMinutes' : 'hours';
  if (minutes > 0) return 'minutes';
  return 'lessThanMinute';
}
