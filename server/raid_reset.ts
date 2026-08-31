// Daily raid reset boundary (server-side).
//
// Classic-style realms expire raid lockouts at a fixed daily reset time, not on a
// rolling "24h from kill" window, so a guild can plan its raid night around one
// predictable boundary. The reset lands at 03:00 (3 AM, the classic daily-reset hour)
// in the realm's own civil time zone (an IANA name, e.g. America/New_York or
// Europe/Paris); each realm process picks its zone via REALM_RESET_TZ (see
// server/realm.ts), defaulting to US Eastern. 3 AM also keeps the boundary clear of the
// DST spring-forward gap that skips local midnight in a few zones.
//
// This lives on the SERVER, not in src/sim/, on purpose: the reset zone is a host /
// wall-clock concern (like the lockout clock itself), so the deterministic sim core
// never reads the host time zone database. The server computes the next-reset instant
// and injects it into the sim through the lockout seam (SimContext.raidResetMs); the
// sim just stores the number it is handed. nextRaidResetMs is a pure function of
// (instant, zone): it draws no randomness and reads no live clock, using only
// Intl.DateTimeFormat, new Date(ms), and Date.UTC.

import { DOUBLE_HONOR_LEAD_MS } from '../src/sim/pvp/honor_event';

export const DEFAULT_RAID_RESET_TIME_ZONE = 'America/New_York';

// The civil-time hour of the daily raid reset: 03:00, the classic 3 AM daily reset.
// Deliberately off midnight so the boundary is never a wall-clock time a spring-forward
// DST transition skips: the common zones jump 02:00 -> 03:00 (so 03:00 always exists),
// whereas a handful of zones skip 00:00 entirely.
export const RAID_RESET_HOUR = 3;

// Whether the host ICU database can resolve the given IANA zone. A Node built without
// full ICU throws here even for a valid zone, so callers can validate config and fail
// fast at boot instead of crashing mid-raid on the first boss kill.
export function isSupportedTimeZone(zone: string): boolean {
  try {
    // The constructor throws RangeError for an unknown/unsupported zone.
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// The reset zone's UTC offset (in ms) active at a given instant. Derived by rendering
// the instant as wall-clock parts in the zone and diffing against the same numbers read
// as if they were UTC. Positive for zones ahead of UTC, negative (US Eastern) behind it.
function zoneOffsetMs(instantMs: number, zone: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(new Date(instantMs))
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24, // some runtimes render midnight as hour '24'
    Number(p.minute),
    Number(p.second),
  );
  // asUtc - instantMs rounds to whole seconds; reset boundaries are whole hours so
  // this is exact for every modern IANA offset.
  return asUtc - instantMs;
}

// The civil calendar date (year, month 1-12, day) of an instant in the reset zone.
function zoneDate(instantMs: number, zone: string): { y: number; mo: number; d: number } {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date(instantMs))
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day) };
}

// The zone-local clock hour (0-23) of an instant.
function zoneHour(instantMs: number, zone: string): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour12: false, hour: '2-digit' })
    .formatToParts(new Date(instantMs))
    .find((p) => p.type === 'hour');
  return Number(part?.value ?? '0') % 24; // some runtimes render midnight as '24'
}

// The epoch ms of RAID_RESET_HOUR:00:00 reset-zone time for the given civil date. Day
// overflow (e.g. d = 32) wraps the month/year via Date.UTC. The offset is resolved twice
// (a refinement pass) so a reset time near a DST transition still maps to the correct UTC
// instant. If a spring-forward gap SKIPS the reset hour outright (a few zones jump
// 03:00 -> 04:00), the resolved instant does not round-trip back to the reset hour; we
// then snap to the later edge, so the reset lands the moment the clock resumes rather
// than collapsing backward onto the prior hour (which would make a lockout zero-length).
function zoneResetInstant(y: number, mo: number, d: number, zone: string): number {
  const naive = Date.UTC(y, mo - 1, d, RAID_RESET_HOUR, 0, 0);
  const firstGuess = naive - zoneOffsetMs(naive, zone);
  const resolved = naive - zoneOffsetMs(firstGuess, zone);
  if (zoneHour(resolved, zone) === RAID_RESET_HOUR) return resolved;
  return Math.max(firstGuess, resolved);
}

// The next daily raid reset strictly after nowMs (epoch ms): RAID_RESET_HOUR:00 local
// in the given reset zone (default US Eastern). A kill after midnight but before the
// reset hour unlocks at this morning's reset; every other kill unlocks at the next
// civil day's reset.
export function nextRaidResetMs(
  nowMs: number,
  zone: string = DEFAULT_RAID_RESET_TIME_ZONE,
): number {
  const { y, mo, d } = zoneDate(nowMs, zone);
  const today = zoneResetInstant(y, mo, d, zone);
  return today > nowMs ? today : zoneResetInstant(y, mo, d + 1, zone);
}

// The civil weekday (0 Sunday .. 6 Saturday) of the reset-zone calendar date the
// instant falls on. Weekday is pure calendar arithmetic once the civil date is
// known, so Date.UTC on the date parts answers it without another zone lookup.
function zoneWeekday(instantMs: number, zone: string): number {
  const { y, mo, d } = zoneDate(instantMs, zone);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

// The weekly raid reset weekday: Tuesday, the classic-era US reset day. Chosen
// against 28 days of measured prod concurrency (2026-08): the population is
// EU-evening / US-afternoon shaped (weekly peak Sunday ~18:00-20:00 UTC, daily
// trough 00:00-06:00 UTC), so Tuesday RAID_RESET_HOUR US Eastern lands in the
// dead band, every lockout week keeps one full weekend, and the boundary reuses
// the daily-reset hour players already know.
export const WEEKLY_RESET_WEEKDAY = 2;

/**
 * The next WEEKLY raid reset strictly after nowMs: RAID_RESET_HOUR:00 zone-local
 * time on the configured weekday (default Tuesday). A kill in the small hours of
 * reset day unlocks at that same morning's boundary; the boundary instant itself
 * belongs to the next week (the same strictly-after contract nextRaidResetMs
 * keeps). DST transitions resolve through zoneResetInstant exactly like the
 * daily boundary.
 */
export function nextWeeklyRaidResetMs(
  nowMs: number,
  zone: string = DEFAULT_RAID_RESET_TIME_ZONE,
  weekday: number = WEEKLY_RESET_WEEKDAY,
): number {
  const { y, mo, d } = zoneDate(nowMs, zone);
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = zoneResetInstant(y, mo, d + offset, zone);
    if (candidate > nowMs && zoneWeekday(candidate, zone) === weekday) return candidate;
  }
  // Unreachable: eight consecutive civil days always contain the weekday with a
  // future reset instant; kept as a loud failure rather than a silent lock.
  throw new Error(`nextWeeklyRaidResetMs found no boundary after ${nowMs} in ${zone}`);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * The daily-reset WINDOW an instant falls in, as `YYYY-MM-DD`: the civil date of
 * the reset that opened it. This is the key the sim compares to decide whether a
 * daily has rolled over (the first battleground win, arena honor DR, the delve
 * daily), and it deliberately answers the SAME question the raid lockout answers
 * through `nextRaidResetMs`, so a realm has ONE daily boundary rather than two.
 *
 * The alternative it replaces was the UTC calendar date, which put the rollover
 * at midnight UTC: 5 PM Pacific, in the middle of an evening's play, with no
 * relation to when the realm's raids reset. Between midnight and the reset hour
 * the day still belongs to the window that opened yesterday, exactly as
 * `nextRaidResetMs` treats it for lockouts.
 *
 * Pure in (instant, zone), like every other export here: no live clock read, no
 * randomness. A caller reads the clock and passes the instant in, which is what
 * keeps the sim deterministic.
 */
// resetDayKey and its eventLeadDayKey twin below run in the 20 Hz world loop,
// and each computation builds two Intl.DateTimeFormat instances (~0.1ms). The
// answer can only change on an epoch-minute boundary (the reset hour is a whole
// hour and modern zone offsets are whole minutes), so memoize per (epoch
// minute, zone). Still pure: the memo key is derived from the arguments alone,
// so the same inputs always give the same output. The map is tiny (the loop
// alternates two buckets per zone); the cap is a leak guard for many-zone
// callers like the tests.
const DAY_KEY_MEMO_MAX = 16;
const dayKeyMemo = new Map<string, string>();

export function resetDayKey(nowMs: number, zone: string = DEFAULT_RAID_RESET_TIME_ZONE): string {
  const memoKey = `${Math.floor(nowMs / 60_000)}:${zone}`;
  const memoized = dayKeyMemo.get(memoKey);
  if (memoized !== undefined) return memoized;
  const { y, mo, d } = zoneDate(nowMs, zone);
  // Date.UTC normalizes the day-before rollback across month and year edges. The
  // arithmetic is on a pure calendar triple, never on an instant, so no offset or
  // DST transition can shift which date comes out.
  const at = new Date(Date.UTC(y, mo - 1, zoneHour(nowMs, zone) < RAID_RESET_HOUR ? d - 1 : d));
  const key = `${at.getUTCFullYear()}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())}`;
  if (dayKeyMemo.size >= DAY_KEY_MEMO_MAX) dayKeyMemo.clear();
  dayKeyMemo.set(memoKey, key);
  return key;
}

/**
 * The weekend event's early-open probe: the reset-day window this realm will
 * be in DOUBLE_HONOR_LEAD_MS from the given instant. The game loop feeds it to
 * the sim beside `resetDayKey` (Sim.eventLeadDay), and honor_event.ts opens
 * the Double Honor window when either key reads a weekend day, which is what
 * moves the open from Saturday 3 AM back to Friday 3 PM realm time. Pure in
 * (instant, zone), like everything else here; the offline twin is
 * `eventLeadDayOf` in src/game/utc_day.ts.
 */
export function eventLeadDayKey(
  nowMs: number,
  zone: string = DEFAULT_RAID_RESET_TIME_ZONE,
): string {
  return resetDayKey(nowMs + DOUBLE_HONOR_LEAD_MS, zone);
}
