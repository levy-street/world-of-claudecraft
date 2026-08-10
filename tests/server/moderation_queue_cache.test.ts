// Wiring pins for the moderation queue memo (server/moderation_queue_cache.ts):
// the lazy singleton TTL cache over moderation_db.moderationQueue's expensive
// player_reports/accounts scan. The primitive's full behavior matrix
// (single-flight, epoch bust, warn-once) is pinned by
// tests/server/cached_read.test.ts; this file pins THIS module's wiring of it,
// plus the two things unique to this cache: the live online-status merge
// (never cached) and the bust hook.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is
// unset; moderation_queue_cache imports moderation_db which imports it, so set
// a dummy URL. The pool never connects: every read here goes through the
// injected fake.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_modqueue_cache';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModerationQueueRow } from '../../server/moderation_db';
import {
  bustModerationQueueCache,
  MODERATION_QUEUE_TTL_MS,
  readModerationQueue,
  resetModerationQueueCacheForTests,
  setModerationQueueCacheForTests,
} from '../../server/moderation_queue_cache';

function row(overrides: Partial<ModerationQueueRow>): ModerationQueueRow {
  return {
    accountId: 1,
    username: 'p1',
    isAdmin: false,
    status: 'active',
    suspendedUntil: null,
    openReports: 1,
    latestReportAt: '2026-08-01T00:00:00.000Z',
    latestReason: 'spam',
    characterNames: ['P1'],
    online: false,
    ...overrides,
  };
}

// Three rows with a DELIBERATE ordering trap: accounts 2 and 3 tie on BOTH
// openReports and latestReportAt (K1 and K2), so only the live online status
// (K3) can break the tie. Without the live online merge and re-sort, the base
// SQL order alone cannot express "whichever of 2/3 is online sorts first";
// account 1 always leads on openReports alone, proving K1 still wins over K3.
const BASE_ROWS: ModerationQueueRow[] = [
  row({ accountId: 1, openReports: 4, latestReportAt: '2026-08-03T00:00:00.000Z' }),
  row({ accountId: 2, openReports: 2, latestReportAt: '2026-08-02T00:00:00.000Z' }),
  row({ accountId: 3, openReports: 2, latestReportAt: '2026-08-02T00:00:00.000Z' }),
];

let nowMs = 0;
let calls = 0;
let fail = false;

beforeEach(() => {
  resetModerationQueueCacheForTests();
  nowMs = 1_000_000;
  calls = 0;
  fail = false;
  setModerationQueueCacheForTests({
    query: async () => {
      calls += 1;
      if (fail) throw new Error('refresh failed');
      return BASE_ROWS;
    },
    now: () => nowMs,
  });
});

afterEach(() => {
  resetModerationQueueCacheForTests();
  vi.restoreAllMocks();
});

describe('moderation queue cache', () => {
  it('pins the TTL', () => {
    expect(MODERATION_QUEUE_TTL_MS).toBe(5_000);
  });

  it('cold start awaits exactly one refresh and merges the live online set', async () => {
    const rows = await readModerationQueue(new Set([3]));
    expect(calls).toBe(1);
    expect(rows.map((r) => r.accountId)).toEqual([1, 3, 2]);
    expect(rows.map((r) => r.online)).toEqual([false, true, false]);
  });

  it('a warm hit inside the TTL re-merges a DIFFERENT online set without re-querying', async () => {
    await readModerationQueue(new Set([3]));
    nowMs += MODERATION_QUEUE_TTL_MS - 1;
    // A different caller (or the same admin a second later) with a different
    // live set: still one refresh, but the merge and sort are per-call.
    const rows = await readModerationQueue(new Set([2]));
    expect(calls).toBe(1);
    expect(rows.map((r) => r.accountId)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.online)).toEqual([false, true, false]);
  });

  it('matches calling moderationQueue directly with the real online set (behavior preserved)', async () => {
    // No online rows: the K3 tie-break is a no-op, so order is exactly the
    // base (openReports desc, latestReportAt desc) SQL order.
    const rows = await readModerationQueue(new Set());
    expect(rows.map((r) => r.accountId)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.online === false)).toBe(true);
  });

  it('a read past the TTL re-queries', async () => {
    await readModerationQueue(new Set());
    nowMs += MODERATION_QUEUE_TTL_MS;
    await readModerationQueue(new Set());
    expect(calls).toBe(2);
  });

  it('bustModerationQueueCache forces the next read to re-query even inside the TTL', async () => {
    await readModerationQueue(new Set());
    bustModerationQueueCache();
    const rows = await readModerationQueue(new Set([2]));
    expect(calls).toBe(2);
    expect(rows.find((r) => r.accountId === 2)?.online).toBe(true);
  });

  it('a bust before any read is a harmless no-op', () => {
    expect(() => bustModerationQueueCache()).not.toThrow();
  });

  it('a failed refresh after a success keeps serving the last snapshot', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await readModerationQueue(new Set());
    nowMs += MODERATION_QUEUE_TTL_MS;
    fail = true;
    const rows = await readModerationQueue(new Set());
    expect(calls).toBe(2);
    expect(rows.map((r) => r.accountId)).toEqual([1, 2, 3]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reset drops the instance so the next read is cold', async () => {
    await readModerationQueue(new Set());
    expect(calls).toBe(1);
    resetModerationQueueCacheForTests();
    setModerationQueueCacheForTests({
      query: async () => {
        calls += 1;
        return BASE_ROWS;
      },
      now: () => nowMs,
    });
    await readModerationQueue(new Set());
    expect(calls).toBe(2);
  });
});
