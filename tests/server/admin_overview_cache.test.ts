// Wiring pins for the admin overview memo (server/admin_overview_cache.ts): the
// lazy singleton TTL cache over admin_db.overviewCounts. The primitive's full
// behavior matrix (single-flight, epoch bust, warn-once) is pinned by
// tests/server/cached_read.test.ts; this file pins THIS module's wiring of it:
// cold start, the TTL window, stale-serve on a failed refresh, and the reset.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is
// unset; admin_overview_cache imports admin_db which imports it, so set a dummy
// URL. The pool never connects: every read here goes through the injected fake.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_overview_cache';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverviewCounts } from '../../server/admin_db';
import {
  ADMIN_OVERVIEW_TTL_MS,
  readOverviewCounts,
  resetOverviewCacheForTests,
  setOverviewCacheForTests,
} from '../../server/admin_overview_cache';

// Distinct value per field so a dropped or swapped field fails the toEqual pin.
const COUNTS: OverviewCounts = {
  accounts: 101,
  characters: 202,
  accountsToday: 3,
  accountsWeek: 14,
  accountsMonth: 31,
  sessionsToday: 55,
  activeAccountsToday: 21,
  activeAccountsWeek: 42,
  activeAccountsMonth: 84,
  returningAccountsToday: 7,
  avgPlaytimeSeconds: 1234,
  peakOnlineToday: 17,
  peakOnlineAllTime: 99,
  siteUsersNow: 5,
};

let nowMs = 0;
let calls = 0;
let fail = false;

beforeEach(() => {
  resetOverviewCacheForTests();
  nowMs = 1_000_000;
  calls = 0;
  fail = false;
  setOverviewCacheForTests({
    query: async () => {
      calls += 1;
      if (fail) throw new Error('refresh failed');
      return COUNTS;
    },
    now: () => nowMs,
  });
});

afterEach(() => {
  resetOverviewCacheForTests();
  vi.restoreAllMocks();
});

describe('admin overview cache', () => {
  it('pins the TTL: one refresh per 60 second window', () => {
    expect(ADMIN_OVERVIEW_TTL_MS).toBe(60_000);
  });

  it('cold start awaits exactly one refresh and returns the injected body', async () => {
    const body = await readOverviewCounts();
    expect(calls).toBe(1);
    expect(body).toEqual(COUNTS);
    // The one snapshot object is shared by every reader in the TTL window; the
    // memo freezes it so a consumer cannot poison the shared counts.
    expect(Object.isFrozen(body)).toBe(true);
  });

  it('a warm hit inside the TTL serves the snapshot without re-querying', async () => {
    await readOverviewCounts();
    nowMs += ADMIN_OVERVIEW_TTL_MS - 1;
    const body = await readOverviewCounts();
    expect(calls).toBe(1);
    expect(body).toEqual(COUNTS);
  });

  it('a read past the TTL re-queries', async () => {
    await readOverviewCounts();
    nowMs += ADMIN_OVERVIEW_TTL_MS;
    const body = await readOverviewCounts();
    expect(calls).toBe(2);
    expect(body).toEqual(COUNTS);
  });

  it('a failed refresh after a success keeps serving the last snapshot', async () => {
    // The stale-serve path warns once per failure streak; keep test output clean.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await readOverviewCounts();
    nowMs += ADMIN_OVERVIEW_TTL_MS;
    fail = true;
    const body = await readOverviewCounts();
    expect(calls).toBe(2);
    expect(body).toEqual(COUNTS);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reset drops the instance so the next read is cold', async () => {
    await readOverviewCounts();
    expect(calls).toBe(1);
    // Reset restores the REAL query, so re-inject the counting fake before the
    // next read; no clock advance, proving the re-query comes from the reset.
    resetOverviewCacheForTests();
    setOverviewCacheForTests({
      query: async () => {
        calls += 1;
        return COUNTS;
      },
      now: () => nowMs,
    });
    const body = await readOverviewCounts();
    expect(calls).toBe(2);
    expect(body).toEqual(COUNTS);
  });
});
