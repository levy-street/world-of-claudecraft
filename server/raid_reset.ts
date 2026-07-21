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

export const DEFAULT_RAID_RESET_TIME_ZONE = 'America/New_York';

// The civil-time hour of the daily raid reset: 03:00, the classic 3 AM daily reset.
// Deliberately off midnight so the boundary is never a wall-clock time a spring-forward
// DST transition skips: the common zones jump 02:00 -> 03:00 (so 03:00 always exists),
// whereas a handful of zones skip 00:00 entirely.
const RAID_RESET_HOUR = 3;

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
