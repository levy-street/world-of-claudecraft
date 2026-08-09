// Wiring pins for the admin activity memo (server/admin_activity_cache.ts): the
// lazy singleton TTL cache over admin_db's registrationsByDay/sessionsByDay/
// classDistribution/levelDistribution bundle. The primitive's full behavior
// matrix (single-flight, epoch bust, warn-once) is pinned by
// tests/server/cached_read.test.ts; this file pins THIS module's wiring of it:
// cold start collapses the four reads into one refresh, a warm hit inside the
// TTL serves without re-querying, a read past the TTL re-queries, stale-serve
// on a failed refresh, the reset, and the exported registrationsByDay/
// sessionsByDay/classDistribution/levelDistribution drop-in shape admin.ts
// depends on (same names, same signatures, same days-window guard).
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is
// unset; admin_activity_cache imports admin_db which imports it, so set a
// dummy URL. The pool never connects: every read here goes through the
// injected fake.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_activity_cache';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_WINDOW_DAYS,
  ADMIN_ACTIVITY_TTL_MS,
  type AdminActivityBundle,
  classDistribution,
  levelDistribution,
  registrationsByDay,
  resetAdminActivityCacheForTests,
  sessionsByDay,
  setAdminActivityCacheForTests,
} from '../../server/admin_activity_cache';

// Distinct value per field so a dropped or swapped field fails the toEqual pin.
const BUNDLE: AdminActivityBundle = {
  registrations: [{ day: '2026-08-01', count: 3 }],
  sessions: [{ day: '2026-08-01', sessions: 5, uniqueAccounts: 4, playtimeSeconds: 600 }],
  classes: [{ key: 'warrior', count: 7 }],
  levels: [{ key: '10', count: 9 }],
};

let nowMs = 0;
let calls = 0;
let fail = false;

beforeEach(() => {
  resetAdminActivityCacheForTests();
  nowMs = 1_000_000;
  calls = 0;
  fail = false;
  setAdminActivityCacheForTests({
    query: async () => {
      calls += 1;
      if (fail) throw new Error('refresh failed');
      return BUNDLE;
    },
    now: () => nowMs,
  });
});

afterEach(() => {
  resetAdminActivityCacheForTests();
  vi.restoreAllMocks();
});

describe('admin activity cache', () => {
  it('pins the window and TTL', () => {
    expect(ACTIVITY_WINDOW_DAYS).toBe(30);
    expect(ADMIN_ACTIVITY_TTL_MS).toBe(60_000);
  });

  it('cold start: four bundle reads collapse into exactly one refresh', async () => {
    const [registrations, sessions, classes, levels] = await Promise.all([
      registrationsByDay(ACTIVITY_WINDOW_DAYS),
      sessionsByDay(ACTIVITY_WINDOW_DAYS),
      classDistribution(),
      levelDistribution(),
    ]);
    expect(calls).toBe(1);
    expect(registrations).toEqual(BUNDLE.registrations);
    expect(sessions).toEqual(BUNDLE.sessions);
    expect(classes).toEqual(BUNDLE.classes);
    expect(levels).toEqual(BUNDLE.levels);
  });

  it('a warm hit inside the TTL serves every field without re-querying', async () => {
    await registrationsByDay(ACTIVITY_WINDOW_DAYS);
    nowMs += ADMIN_ACTIVITY_TTL_MS - 1;
    const sessions = await sessionsByDay(ACTIVITY_WINDOW_DAYS);
    const classes = await classDistribution();
    const levels = await levelDistribution();
    expect(calls).toBe(1);
    expect(sessions).toEqual(BUNDLE.sessions);
    expect(classes).toEqual(BUNDLE.classes);
    expect(levels).toEqual(BUNDLE.levels);
  });

  it('a read past the TTL re-queries', async () => {
    await registrationsByDay(ACTIVITY_WINDOW_DAYS);
    nowMs += ADMIN_ACTIVITY_TTL_MS;
    await sessionsByDay(ACTIVITY_WINDOW_DAYS);
    expect(calls).toBe(2);
  });

  it('a mismatched days argument throws instead of silently serving the wrong window', async () => {
    await expect(registrationsByDay(7)).rejects.toThrow(/30-day window, got 7/);
    await expect(sessionsByDay(90)).rejects.toThrow(/30-day window, got 90/);
    expect(calls).toBe(0);
  });

  it('a failed refresh after a success keeps serving the last snapshot', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await registrationsByDay(ACTIVITY_WINDOW_DAYS);
    nowMs += ADMIN_ACTIVITY_TTL_MS;
    fail = true;
    const classes = await classDistribution();
    expect(calls).toBe(2);
    expect(classes).toEqual(BUNDLE.classes);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reset drops the instance so the next read is cold', async () => {
    await registrationsByDay(ACTIVITY_WINDOW_DAYS);
    expect(calls).toBe(1);
    resetAdminActivityCacheForTests();
    setAdminActivityCacheForTests({
      query: async () => {
        calls += 1;
        return BUNDLE;
      },
      now: () => nowMs,
    });
    const levels = await levelDistribution();
    expect(calls).toBe(2);
    expect(levels).toEqual(BUNDLE.levels);
  });
});
