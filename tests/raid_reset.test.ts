import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RAID_RESET_TIME_ZONE,
  isSupportedTimeZone,
  nextRaidResetMs,
} from '../server/raid_reset';
import { resolveRaidResetTimeZone } from '../server/realm';

// The daily raid reset lands at 03:00 (3 AM, the classic daily-reset hour) in the realm's
// civil time zone (default US Eastern, America/New_York), so a realm shares one
// predictable reset boundary instead of a rolling "24h from kill" window. 3 AM also keeps
// the boundary clear of the DST spring-forward gap that skips local midnight in some
// zones. nextRaidResetMs is a pure function of (instant, zone), so it stays deterministic
// (no Date.now/rng). It lives server-side: the zone is a host concern, kept out of the sim
// core and injected via the lockout seam.

// Helper: the parts of an instant rendered in the reset zone, so a test can assert
// the result really lands on 00:00:00 local time regardless of DST.
function zoneParts(ms: number): { hour: number; minute: number; second: number } {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_RAID_RESET_TIME_ZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(new Date(ms))
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  return { hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second) };
}

describe('nextRaidResetMs', () => {
  it('is deterministic: same input gives the same output', () => {
    const now = Date.UTC(2025, 5, 29, 16, 0, 0); // a fixed instant
    expect(nextRaidResetMs(now)).toBe(nextRaidResetMs(now));
  });

  it('always returns an instant strictly in the future', () => {
    for (const now of [0, Date.UTC(2025, 0, 1, 5, 0, 0), Date.UTC(2025, 6, 4, 3, 30, 0)]) {
      expect(nextRaidResetMs(now)).toBeGreaterThan(now);
    }
  });

  it('lands exactly on 03:00 in the reset zone', () => {
    for (const now of [
      Date.UTC(2025, 5, 29, 16, 0, 0), // summer (EDT)
      Date.UTC(2025, 0, 15, 12, 0, 0), // winter (EST)
      Date.UTC(2025, 11, 31, 23, 59, 0), // year boundary
    ]) {
      const reset = nextRaidResetMs(now);
      expect(zoneParts(reset)).toEqual({ hour: 3, minute: 0, second: 0 });
    }
  });

  it('resolves to the next 03:00 reset during summer (EDT, UTC-4)', () => {
    // 2025-06-29 12:00 EDT == 16:00 UTC; this morning's 3 AM has passed, so the next
    // reset is 2025-06-30 03:00 EDT == 07:00 UTC.
    const now = Date.UTC(2025, 5, 29, 16, 0, 0);
    expect(nextRaidResetMs(now)).toBe(Date.UTC(2025, 5, 30, 7, 0, 0));
  });

  it('resolves to the next 03:00 reset during winter (EST, UTC-5)', () => {
    // 2025-01-15 12:00 EST == 17:00 UTC. Next reset is 2025-01-16 03:00 EST == 08:00 UTC.
    const now = Date.UTC(2025, 0, 15, 17, 0, 0);
    expect(nextRaidResetMs(now)).toBe(Date.UTC(2025, 0, 16, 8, 0, 0));
  });

  it('honors a non-default reset zone (Europe/Paris, CEST UTC+2 in summer)', () => {
    // 2025-06-29 12:00 Paris (CEST, UTC+2) == 10:00 UTC. Next Paris reset is
    // 2025-06-30 03:00 CEST == 2025-06-30 01:00 UTC, proving the zone is a parameter.
    const now = Date.UTC(2025, 5, 29, 10, 0, 0);
    expect(nextRaidResetMs(now, 'Europe/Paris')).toBe(Date.UTC(2025, 5, 30, 1, 0, 0));
  });

  it('unlocks a post-midnight kill at this morning 03:00 reset, not a full day later', () => {
    // 2025-06-30 02:30 EDT == 06:30 UTC. The 3 AM reset is only 30 min away; a kill
    // between midnight and 03:00 unlocks at this morning's reset.
    const now = Date.UTC(2025, 5, 30, 6, 30, 0);
    const reset = nextRaidResetMs(now);
    expect(reset).toBe(Date.UTC(2025, 5, 30, 7, 0, 0));
    expect(reset - now).toBe(30 * 60 * 1000);
  });

  it('at the reset instant itself, returns the following day (no zero-length lockout)', () => {
    const resetHour = Date.UTC(2025, 5, 30, 7, 0, 0); // 2025-06-30 03:00 EDT
    expect(nextRaidResetMs(resetHour)).toBe(Date.UTC(2025, 6, 1, 7, 0, 0));
  });

  it('handles the spring-forward day: 03:00 is the arrival of the 02:00 jump, so it exists', () => {
    // DST began 2025-03-09 (clocks jump 02:00 EST -> 03:00 EDT). A mid-day kill resets at
    // 2025-03-10 03:00 EDT == 07:00 UTC, landing exactly on 03:00 (never bumped to 04:00).
    const now = Date.UTC(2025, 2, 9, 18, 0, 0); // 2025-03-09 14:00 EDT
    expect(nextRaidResetMs(now)).toBe(Date.UTC(2025, 2, 10, 7, 0, 0));
    expect(zoneParts(nextRaidResetMs(now))).toEqual({ hour: 3, minute: 0, second: 0 });
  });

  it('handles the fall-back DST day (clocks repeat 01:00 to 02:00 EDT to EST)', () => {
    // DST ended 2025-11-02. Reset at 2025-11-03 03:00 EST == 08:00 UTC.
    const now = Date.UTC(2025, 10, 2, 12, 0, 0); // 2025-11-02 07:00 EST (after fall-back)
    expect(nextRaidResetMs(now)).toBe(Date.UTC(2025, 10, 3, 8, 0, 0));
  });

  it('when a spring-forward gap skips 03:00 (EET zones jump 03:00 to 04:00), lands at the gap end', () => {
    // Europe/Athens springs forward 2025-03-30 03:00 EET -> 04:00 EEST, so local 03:00
    // does not exist that day. A kill on the eve must still unlock at a strictly-future
    // boundary: the moment the clock resumes (04:00 EEST == 2025-03-30 01:00 UTC), never
    // collapsing backward onto the prior hour.
    const now = Date.UTC(2025, 2, 29, 10, 0, 0); // 2025-03-29 12:00 EET
    const reset = nextRaidResetMs(now, 'Europe/Athens');
    expect(reset).toBeGreaterThan(now);
    expect(reset).toBe(Date.UTC(2025, 2, 30, 1, 0, 0));
  });

  it('never yields a zero-length lockout in a midnight-skipping zone (America/Santiago)', () => {
    // Santiago springs forward at 00:00 (2022-09-11 midnight is skipped) - the case that
    // broke a midnight reset. The 3 AM reset is unaffected: a late kill on the eve still
    // unlocks at 2022-09-11 03:00 CLST == 06:00 UTC, strictly in the future.
    const now = Date.UTC(2022, 8, 11, 3, 30, 0); // 2022-09-10 23:30 Santiago (CLT, UTC-4)
    const reset = nextRaidResetMs(now, 'America/Santiago');
    expect(reset).toBeGreaterThan(now);
    expect(reset).toBe(Date.UTC(2022, 8, 11, 6, 0, 0));
  });
});

describe('isSupportedTimeZone', () => {
  it('accepts resolvable IANA zones', () => {
    expect(isSupportedTimeZone('America/New_York')).toBe(true);
    expect(isSupportedTimeZone('Europe/Paris')).toBe(true);
    expect(isSupportedTimeZone('UTC')).toBe(true);
  });

  it('rejects unknown or empty zones', () => {
    expect(isSupportedTimeZone('Not/AZone')).toBe(false);
    expect(isSupportedTimeZone('')).toBe(false);
  });
});

describe('resolveRaidResetTimeZone', () => {
  it('returns a valid configured zone unchanged', () => {
    expect(resolveRaidResetTimeZone('Europe/Paris')).toBe('Europe/Paris');
  });

  it('falls back to the default when unset or blank', () => {
    expect(resolveRaidResetTimeZone(undefined)).toBe(DEFAULT_RAID_RESET_TIME_ZONE);
    expect(resolveRaidResetTimeZone('   ')).toBe(DEFAULT_RAID_RESET_TIME_ZONE);
  });

  it('warns and falls back to the default for an unresolvable configured zone', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveRaidResetTimeZone('Bad/Zone')).toBe(DEFAULT_RAID_RESET_TIME_ZONE);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
