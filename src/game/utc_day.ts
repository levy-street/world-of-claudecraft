// The offline sim wants its wall-clock day strings but must not read the clock
// itself, so the frame loop supplies them (via `feedSimCalendar` below):
// `currentUtcDay` stamps WHEN something happened (the Book of Deeds earn date),
// `currentResetDay` says which daily window we are in (the first battleground
// win, honor DR, the delve daily), and `currentEventLeadDay` is the weekend
// event's early-open probe of the same boundary. Building any of the strings is
// a Date allocation plus some formatting; at 60 Hz that is pure churn for a
// value that changes once a day, so cache and re-derive at most once a second.

import { DOUBLE_HONOR_LEAD_MS } from '../sim/pvp/honor_event';

// The civil hour a daily window opens. Mirrors RAID_RESET_HOUR in
// server/raid_reset.ts, which is the authority for the online realm; the two are
// pinned equal by tests/raid_reset.test.ts. Offline there is no realm, so the
// boundary is the player's OWN local 3 AM, which is the same promise the realm
// makes its players: a daily never turns over in the middle of an evening.
export const DAILY_RESET_HOUR = 3;

let cachedDay = '';
let dayRefreshAtMs = 0;
let cachedResetDay = '';
let resetRefreshAtMs = 0;

/** Current UTC day as `YYYY-MM-DD`, recomputed at most once per second. */
export function currentUtcDay(): string {
  const now = Date.now();
  if (now >= dayRefreshAtMs) {
    cachedDay = new Date(now).toISOString().slice(0, 10);
    dayRefreshAtMs = now + 1000;
  }
  return cachedDay;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * The daily-reset window an instant falls in, as `YYYY-MM-DD`: the LOCAL civil
 * date of the reset that opened it. Between local midnight and the reset hour the
 * window still belongs to the previous date, the same rule `resetDayKey` applies
 * on the server with a realm's configured zone instead of the player's own.
 *
 * Clock-free (the caller supplies the instant) and expressed entirely in local
 * `Date` terms, so month, year, and DST edges are the platform's arithmetic
 * rather than ours, and a test can drive it without touching the process zone.
 */
export function resetDayOf(at: Date): string {
  const d = new Date(at.getTime());
  if (d.getHours() < DAILY_RESET_HOUR) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The current daily-reset window, recomputed at most once per second. */
export function currentResetDay(): string {
  const now = Date.now();
  if (now >= resetRefreshAtMs) {
    cachedResetDay = resetDayOf(new Date(now));
    resetRefreshAtMs = now + 1000;
  }
  return cachedResetDay;
}

/**
 * The weekend event's early-open probe: the daily-reset window the player will
 * be in DOUBLE_HONOR_LEAD_MS from the given instant, in their OWN local zone
 * (offline there is no realm). honor_event.ts opens the Double Honor window
 * when either this key or `resetDayOf` reads a weekend day, which moves the
 * open from Saturday 3 AM back to Friday 3 PM. The server twin is
 * `eventLeadDayKey` in server/raid_reset.ts.
 */
export function eventLeadDayOf(at: Date): string {
  return resetDayOf(new Date(at.getTime() + DOUBLE_HONOR_LEAD_MS));
}

let cachedEventLeadDay = '';
let eventLeadRefreshAtMs = 0;

/** The current early-open probe key, recomputed at most once per second. */
export function currentEventLeadDay(): string {
  const now = Date.now();
  if (now >= eventLeadRefreshAtMs) {
    cachedEventLeadDay = eventLeadDayOf(new Date(now));
    eventLeadRefreshAtMs = now + 1000;
  }
  return cachedEventLeadDay;
}

/**
 * Feed the offline sim its whole host calendar in one call: the frame loop's
 * single entry point, so a new calendar key lands here rather than as another
 * assignment in main.ts. Mutating the sim's host-fed fields in place is the
 * calendar seam's contract (the server loop feeds the same fields each tick).
 */
export function feedSimCalendar(sim: {
  utcDay: string;
  resetDay: string;
  eventLeadDay: string;
}): void {
  sim.utcDay = currentUtcDay();
  sim.resetDay = currentResetDay();
  sim.eventLeadDay = currentEventLeadDay();
}
