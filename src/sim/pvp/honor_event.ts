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
// opens and closes at the realm's 3 AM reset exactly like every other daily
// window. An empty `resetDay` means the host set no calendar (headless runs,
// replays, parity traces): the event never fires there, keeping those runs
// byte-identical to what they were.
//
// The weekday is computed arithmetically from the `YYYY-MM-DD` key (Sakamoto's
// congruence) rather than through `Date`: the weekday of a calendar date is a
// pure fact about the Gregorian calendar, and keeping `Date` out of the sim
// keeps the no-wall-clock rule easy to audit.

/** Days of the week the event runs, 0=Sunday..6=Saturday (matching
 *  `getUTCDay` and the calendar view's weekday convention). The Saturday and
 *  Sunday RESET WINDOWS, so in realm time the event opens Saturday 3 AM and
 *  closes Monday 3 AM: the whole weekend, never mid-evening. */
export const DOUBLE_HONOR_WEEKDAYS: readonly number[] = [6, 0];

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

/** Is the weekly Double Honor window open for this host-provided reset day? */
export function doubleHonorActive(resetDay: string): boolean {
  return DOUBLE_HONOR_WEEKDAYS.includes(weekdayOfDayKey(resetDay));
}

/** The factor honor.ts applies to every battleground award:
 *  DOUBLE_HONOR_MULTIPLIER while the Saturday window is open, otherwise 1. */
export function honorEventMultiplier(resetDay: string): number {
  return doubleHonorActive(resetDay) ? DOUBLE_HONOR_MULTIPLIER : 1;
}
