// Weekly Double Honor: every weekend, every Thornhollow Fields (5v5 CTF)
// honor award pays double, and a played-out loss or draw pays the WIN base
// (see honor.ts awardBattlegroundHonor). The 5v5-only scope follows the
// feature request ("Double Honor Saturday, 5v5 CTF only", later widened by
// the owner to the whole weekend) and the classic-era shape: battleground
// holiday weekends boosted ONE battleground's honor faucet, never the
// arena's. The weekly cadence exists to concentrate the PvP population into
// one predictable window so the ten-player queue actually pops (casual
// players cannot progress toward Warfare gear while the queue is dead five
// days a week), which is why the bonus is a flat realm-wide window rather
// than a per-player hook like the first-win bonus. The multiplier is applied
// by honor.ts inside the four battleground award paths (result, kill,
// assist, first-win bonus); arena and Fiesta honor never read it.
//
// "Saturday" is the realm's own reset window: the day is read from the
// HOST-provided `resetDay` key (the same boundary the first-win bonus and the
// per-opponent daily counters roll on), never from a wall clock, so the event
// closes at the realm's 3 AM reset exactly like every other daily window. The
// OPEN comes DOUBLE_HONOR_LEAD_HOURS earlier: the host also feeds an
// `eventLeadDay` probe (the reset-day key that many hours ahead of now), and
// the window is open when EITHER key reads a weekend day, so the event runs
// Friday 3 PM through Monday 3 AM realm time. The event stays off only when
// BOTH keys are empty (no host calendar: headless runs, replays, parity
// traces), keeping those runs byte-identical to what they were; a host feeds
// both keys or neither, never just one.
//
// The weekday is computed arithmetically from the `YYYY-MM-DD` key (Sakamoto's
// congruence) rather than through `Date`: the weekday of a calendar date is a
// pure fact about the Gregorian calendar, and keeping `Date` out of the sim
// keeps the no-wall-clock rule easy to audit.

/** Days of the week the event runs, 0=Sunday..6=Saturday (matching
 *  `getUTCDay` and the calendar view's weekday convention). The Saturday and
 *  Sunday RESET WINDOWS, opened early by the lead below, so in realm time the
 *  event runs Friday 3 PM through Monday 3 AM: the whole weekend, never
 *  mid-evening. */
export const DOUBLE_HONOR_WEEKDAYS: readonly number[] = [6, 0];

/** The early open: how many hours BEFORE the Saturday reset window the event
 *  opens. The hosts feed the sim a second day key probed this far ahead of
 *  now (`eventLeadDay`), so with the 3 AM reset the window opens Friday 3 PM
 *  realm time. At 12 hours, a realm on US Eastern opens while Saturday
 *  morning is already underway on the far side of the date line (7 AM in New
 *  Zealand), so those players get their whole weekend instead of joining
 *  Saturday evening. The close is unchanged: Monday's own 3 AM reset. The
 *  lead is real time, not wall-clock: on a DST-shift night the wall-clock
 *  lead reads 11 or 13 hours, which never lands near the Friday open
 *  (mainstream zones shift early Sunday morning) and is masked by the
 *  resetDay arm on Sunday. */
export const DOUBLE_HONOR_LEAD_HOURS = 12;

/** The same lead in epoch milliseconds, for the hosts that build the probe
 *  (server/raid_reset.ts `eventLeadDayKey`, src/game/utc_day.ts
 *  `eventLeadDayOf`). */
export const DOUBLE_HONOR_LEAD_MS = DOUBLE_HONOR_LEAD_HOURS * 3_600_000;

/** Event multiplier applied to every battleground honor award while the
 *  window is open. 2x is owner tuning in the same spirit as the classic-era
 *  battleground holiday weekends (which roughly doubled a battleground's
 *  honor faucet for their weekend); like the 60/20 result awards it is sized
 *  for participation, not derived from a documented classic curve. Revisit
 *  against live Saturday queue data. */
export const DOUBLE_HONOR_MULTIPLIER = 2;

// Sakamoto's day-of-week congruence, month offsets for January..December.
const SAKAMOTO_OFFSETS = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4] as const;

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Day of the week (0=Sunday..6=Saturday) of a `YYYY-MM-DD` day key, or -1 for
 * anything that is not one (the empty "host set no calendar" key included).
 * Pure Gregorian arithmetic; no `Date`, no wall clock.
 */
export function weekdayOfDayKey(dayKey: string): number {
  const m = DAY_KEY_RE.exec(dayKey);
  if (!m) return -1;
  let year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return -1;
  if (month < 3) year -= 1;
  return (
    (year +
      Math.floor(year / 4) -
      Math.floor(year / 100) +
      Math.floor(year / 400) +
      SAKAMOTO_OFFSETS[month - 1] +
      day) %
    7
  );
}

/** Is the weekly Double Honor window open? Open when the realm's own reset
 *  day is a weekend day, OR when the host's `eventLeadDay` probe (the reset
 *  day DOUBLE_HONOR_LEAD_HOURS ahead of now) already reads one: the second
 *  arm is what opens the window Friday 3 PM, and the first is what holds it
 *  open through Sunday evening until Monday's reset. */
export function doubleHonorActive(resetDay: string, eventLeadDay: string): boolean {
  return (
    DOUBLE_HONOR_WEEKDAYS.includes(weekdayOfDayKey(resetDay)) ||
    DOUBLE_HONOR_WEEKDAYS.includes(weekdayOfDayKey(eventLeadDay))
  );
}

/** The factor honor.ts applies to every battleground award:
 *  DOUBLE_HONOR_MULTIPLIER while the weekend window is open, otherwise 1. */
export function honorEventMultiplier(resetDay: string, eventLeadDay: string): number {
  return doubleHonorActive(resetDay, eventLeadDay) ? DOUBLE_HONOR_MULTIPLIER : 1;
}
