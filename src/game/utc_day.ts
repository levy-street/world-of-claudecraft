// The offline sim wants two wall-clock day strings but must not read the clock
// itself, so the frame loop supplies them: `currentUtcDay` stamps WHEN something
// happened (the Book of Deeds earn date) and `currentResetDay` says which daily
// window we are in (the first battleground win, honor DR, the delve daily).
// Building either string is a Date allocation plus some formatting; at 60 Hz that
// is pure churn for a value that changes once a day, so cache and re-derive at
// most once a second.

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
