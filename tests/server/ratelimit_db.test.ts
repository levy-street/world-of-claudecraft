// Unit test for the tier-2 pg-backed rate-limit store (server/ratelimit_db.ts).
// Postgres is injected as a fake pool (a query spy over a stubbed RETURNING row)
// and the clock is an injected fake, so every path is deterministic with no live
// database and no real timers. WINDOW_MS is imported from server/ratelimit as the
// single source of truth (no magic 60000).
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AttackSignalSink,
  noopAttackSignalSink,
  setAttackSignalSink,
} from '../../server/http/attack_signals';
import { WINDOW_MS } from '../../server/ratelimit';
import { createPgRateLimitStore, RATE_LIMIT_UPSERT_SQL } from '../../server/ratelimit_db';

// A fake clock: returns the current `t`, settable by the test.
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    set: (next: number) => {
      t = next;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

// A fake pool whose query resolves the given RETURNING row. The spy records the
// (sql, params) of every call so tests assert the exact statement and params. The
// returned row is mutable so a test can pin what the UPSERT "returns" next.
function fakePool(returnRow: { count: number | string; window_start: number | string }) {
  const row = { ...returnRow };
  const query = vi.fn((_sql: string, _params?: unknown[]) => Promise.resolve({ rows: [row] }));
  return {
    query,
    setRow(next: { count: number | string; window_start: number | string }) {
      row.count = next.count;
      row.window_start = next.window_start;
    },
    // Cast through unknown: the store only ever calls pool.query.
    asPool: { query } as unknown as Pool,
  };
}

// A recording AttackSignalSink: captures the policy label of every pgLimiterWrite
// so a test can pin exactly which policy (and how many writes) the store emitted.
function recordingAttackSignalSink(): AttackSignalSink & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    rateLimitHit() {},
    authFailure() {},
    bolaDenied() {},
    pgLimiterWrite(policy) {
      writes.push(policy);
    },
  };
}

// The store emits its pg-write count through the process-wide attack-signal slot
// (server/http/attack_signals.ts), so install a fresh recording fake before each
// test and restore the no-op after, never leaking a sink across tests.
let attackSink: ReturnType<typeof recordingAttackSignalSink>;

beforeEach(() => {
  attackSink = recordingAttackSignalSink();
  setAttackSignalSink(attackSink);
});

afterEach(() => {
  setAttackSignalSink(noopAttackSignalSink);
});

describe('createPgRateLimitStore hit()', () => {
  it('issues the exact parameterized UPSERT, splitting the policy at the first colon', async () => {
    const clock = fakeClock(90_000); // windowStart = 90000 - (90000 % 60000) = 60000
    const pool = fakePool({ count: 1, window_start: 60_000 });
    const store = createPgRateLimitStore({ pool: pool.asPool, now: clock.now });

    await store.hit('login:1.2.3.4', 5);

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(RATE_LIMIT_UPSERT_SQL, ['login', '1.2.3.4', 60_000]);
  });

  it('preserves an IPv6-containing class key intact after the first colon', async () => {
    const clock = fakeClock(0);
    const pool = fakePool({ count: 1, window_start: 0 });
    const store = createPgRateLimitStore({ pool: pool.asPool, now: clock.now });

    await store.hit('login:2001:db8::1', 5);

    // Only the FIRST colon splits: policy 'login', key the whole IPv6 literal.
    expect(pool.query).toHaveBeenCalledWith(RATE_LIMIT_UPSERT_SQL, ['login', '2001:db8::1', 0]);
  });

  it("falls back to policy 'default' for a key with no colon", async () => {
    const clock = fakeClock(0);
    const pool = fakePool({ count: 1, window_start: 0 });
    const store = createPgRateLimitStore({ pool: pool.asPool, now: clock.now });

    await store.hit('globalflood', 5);

    expect(pool.query).toHaveBeenCalledWith(RATE_LIMIT_UPSERT_SQL, ['default', 'globalflood', 0]);
  });

  it('coerces a string count / window_start (pg returns BIGINT as a string)', async () => {
    // The real pg driver returns window_start (BIGINT) as a STRING to preserve
    // precision. Drive that shape so a dropped Number() cannot survive: string
    // arithmetic ('60000' + WINDOW_MS) would concatenate instead of add and blow
    // up resetSeconds, while tsc alone cannot reject it (string + number is
    // legal). Same numbers as the pinned-clock case below, string-typed.
    const pool = fakePool({ count: '3', window_start: '60000' });
    const store = createPgRateLimitStore({ pool: pool.asPool, now: () => 90_000 });

    const outcome = await store.hit('login:ip', 5);

    expect(outcome).toEqual({ allowed: true, remaining: 2, resetSeconds: 30 });
  });

  it('rejects when the UPSERT returns no row (the resolver fail-open catch absorbs it)', async () => {
    // INSERT ... ON CONFLICT ... RETURNING always returns exactly one row, so an
    // empty result means a broken driver or statement. hit() throws rather than
    // fabricating an outcome, and the two-tier resolver's fail-open catch turns
    // that into tier-1-only limiting (never a 500).
    const query = vi.fn(() => Promise.resolve({ rows: [] }));
    const store = createPgRateLimitStore({ pool: { query } as unknown as Pool, now: () => 0 });

    await expect(store.hit('login:ip', 5)).rejects.toThrow();
  });

  it('computes allowed / remaining / resetSeconds from the returned row at a pinned clock', async () => {
    const clock = fakeClock(90_000);
    // Stored window opened at 60000; it closes at 60000 + WINDOW_MS = 120000, so
    // 30s remain at now=90000. count 3 under a max of 5 is allowed with 2 left.
    const pool = fakePool({ count: 3, window_start: 60_000 });
    const store = createPgRateLimitStore({ pool: pool.asPool, now: clock.now });

    const outcome = await store.hit('login:ip', 5);

    expect(outcome).toEqual({ allowed: true, remaining: 2, resetSeconds: 30 });
  });

  it('flips allowed to false at count = maxPerMinute + 1', async () => {
    const clock = fakeClock(0);
    const pool = fakePool({ count: 5, window_start: 0 });
    const store = createPgRateLimitStore({ pool: pool.asPool, now: clock.now });

    // count 5 with max 5: the last allowed hit (remaining 0).
    const atLimit = await store.hit('login:ip', 5);
    expect(atLimit).toEqual({ allowed: true, remaining: 0, resetSeconds: WINDOW_MS / 1000 });

    // count 6 with max 5: over the limit, still remaining 0 (clamped at 0).
    pool.setRow({ count: 6, window_start: 0 });
    const over = await store.hit('login:ip', 5);
    expect(over).toEqual({ allowed: false, remaining: 0, resetSeconds: WINDOW_MS / 1000 });
  });

  it('reports resetSeconds decreasing as the clock advances within one window', async () => {
    // A single stored window opened at 60000 (closes at 120000). The store reads
    // the returned window_start, so resetSeconds counts down toward the boundary.
    const pool = fakePool({ count: 1, window_start: 60_000 });

    const at = async (nowMs: number) => {
      const store = createPgRateLimitStore({ pool: pool.asPool, now: () => nowMs });
      return (await store.hit('login:ip', 5)).resetSeconds;
    };

    expect(await at(60_000)).toBe(60); // ceil((120000 - 60000) / 1000)
    expect(await at(90_000)).toBe(30);
    expect(await at(119_000)).toBe(1);
    expect(await at(120_000)).toBe(0); // boundary reached, never negative
  });

  it('reads count 1 for the new window once the returned window_start rolls forward', async () => {
    const clock = fakeClock(0);
    const pool = fakePool({ count: 1, window_start: 0 });
    const store = createPgRateLimitStore({ pool: pool.asPool, now: clock.now });

    // First hit at t=0 sits in the window that opened at 0.
    const first = await store.hit('login:ip', 5);
    expect(first).toEqual({ allowed: true, remaining: 4, resetSeconds: WINDOW_MS / 1000 });
    expect(pool.query).toHaveBeenLastCalledWith(RATE_LIMIT_UPSERT_SQL, ['login', 'ip', 0]);

    // Advance a full window. The UPSERT's CASE resets count to 1 for the new
    // window, which the store surfaces as a fresh window (params carry the new
    // window_start, and the returned row drives full remaining again).
    clock.set(WINDOW_MS);
    pool.setRow({ count: 1, window_start: WINDOW_MS });
    const rolled = await store.hit('login:ip', 5);
    expect(rolled).toEqual({ allowed: true, remaining: 4, resetSeconds: WINDOW_MS / 1000 });
    expect(pool.query).toHaveBeenLastCalledWith(RATE_LIMIT_UPSERT_SQL, ['login', 'ip', WINDOW_MS]);
  });

  it('counts one pg write under the parsed policy, never labeled with the ip portion', async () => {
    const clock = fakeClock(0);
    const pool = fakePool({ count: 1, window_start: 0 });
    const store = createPgRateLimitStore({ pool: pool.asPool, now: clock.now });

    await store.hit('some_policy:ip:1.2.3.4', 5);

    // Exactly one write, labeled with the POLICY the key parsed to (the segment
    // before the first colon), never the ip / class-key portion after it.
    expect(attackSink.writes).toEqual(['some_policy']);
    expect(attackSink.writes[0]).not.toContain('1.2.3.4');
    expect(attackSink.writes[0]).not.toContain(':');
  });

  it("counts a colonless key under the literal 'default' policy", async () => {
    const clock = fakeClock(0);
    const pool = fakePool({ count: 1, window_start: 0 });
    const store = createPgRateLimitStore({ pool: pool.asPool, now: clock.now });

    await store.hit('globalflood', 5);

    expect(attackSink.writes).toEqual(['default']);
  });

  it('counts each upsert exactly once whether the hit is allowed or tripped', async () => {
    const clock = fakeClock(0);
    const pool = fakePool({ count: 5, window_start: 0 });
    const store = createPgRateLimitStore({ pool: pool.asPool, now: clock.now });

    await store.hit('login:1.2.3.4', 5); // count 5, max 5: allowed
    pool.setRow({ count: 6, window_start: 0 });
    await store.hit('login:1.2.3.4', 5); // count 6, max 5: over the limit (tripped)

    // It counts WRITES, not decisions: one per upsert regardless of allow/deny.
    expect(attackSink.writes).toEqual(['login', 'login']);
  });

  it('drops the write and still returns a correct outcome when the slot holds the no-op', async () => {
    // With no real sink installed (the boot default), the emission is a no-op:
    // hit() must not throw and must still return the correct outcome.
    setAttackSignalSink(noopAttackSignalSink);
    const clock = fakeClock(0);
    const pool = fakePool({ count: 1, window_start: 0 });
    const store = createPgRateLimitStore({ pool: pool.asPool, now: clock.now });

    const outcome = await store.hit('login:ip', 5);
    expect(outcome).toEqual({ allowed: true, remaining: 4, resetSeconds: WINDOW_MS / 1000 });
  });
});

describe('RATE_LIMIT_UPSERT_SQL', () => {
  it('pins the load-bearing UPSERT fragments to literal text', () => {
    // The hit() assertions above reference the exported constant, so both sides
    // of those checks move together on an edit. These literal pins anchor the
    // atomic counting logic itself (mirroring the schema_wiring prune pin): a
    // flipped comparison or a dropped increment cannot pass silently.
    expect(RATE_LIMIT_UPSERT_SQL).toContain('ON CONFLICT (policy, key) DO UPDATE');
    expect(RATE_LIMIT_UPSERT_SQL).toContain(
      'CASE WHEN rate_limits.window_start >= EXCLUDED.window_start THEN rate_limits.count + 1 ELSE 1 END',
    );
    expect(RATE_LIMIT_UPSERT_SQL).toContain(
      'GREATEST(rate_limits.window_start, EXCLUDED.window_start)',
    );
    expect(RATE_LIMIT_UPSERT_SQL).toContain('RETURNING count, window_start');
  });
});

describe('createPgRateLimitStore reset()', () => {
  it('issues a DELETE against rate_limits', async () => {
    const pool = fakePool({ count: 1, window_start: 0 });
    const store = createPgRateLimitStore({ pool: pool.asPool });

    await store.reset();

    expect(pool.query).toHaveBeenCalledWith('DELETE FROM rate_limits');
  });
});
