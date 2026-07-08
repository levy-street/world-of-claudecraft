// Tier-2, pg-backed GLOBAL rate-limit backstop for the multi-realm deployment
// (SQL only). The DDL (RATELIMIT_SCHEMA) is appended to ensureSchema() in db.ts
// like DISCORD_SCHEMA / GITHUB_SCHEMA; the store takes the shared `pool` by
// INJECTION (factory arg) and imports `pg` only as `import type { Pool }` so this
// module never imports db.ts, keeping db.ts <-> ratelimit_db.ts cycle-free (mirrors
// discord_db.ts / github_db.ts, both of which db.ts imports for their schema).
//
// Why tier-2 exists: each realm process keeps its own in-memory tier-1 limiter
// maps (server/ratelimit.ts), so N realms means N times the intended budget.
// This is a pg-backed GLOBAL fixed-window counter, one PRIMARY-KEY row per
// (policy, key), that enforces the same named limit across every realm process.
// Tier-1 always runs first in the resolver, so floods never reach pg; this store
// just needs to be correct, atomic, and cheap.
//
// Counting: the store counts each pg upsert on the real pg_limiter_writes_total
// {policy} series via the process-wide attack-signal slot
// (server/http/attack_signals.ts, installed by main.ts at boot). That is now the
// ONE source of truth for the tier-2 write count; the old
// http_requests_total{route='ratelimit.pg.hit'} proxy row is GONE, so the count
// can never be double-sourced.

import type { Pool } from 'pg';
import { attackSignalSink } from './http/attack_signals';
import type { RateLimitOutcome, RateLimitStore } from './http/types';
import { WINDOW_MS, windowedRateLimitOutcome } from './ratelimit';

// One fixed-window counter row per (policy, key). window_start is the epoch-ms
// start of the current window (a multiple of WINDOW_MS), stored as BIGINT so it
// survives past 2^31 ms; count is the attempts recorded in that window.
//
// Between boots the table is bounded by the policy x key cardinality, and a
// stale window is simply overwritten by the UPSERT on the next hit for that key
// (the CASE below resets count to 1 when the stored window is older than the
// incoming one). Rows for keys that never hit again are reclaimed by
// RATELIMIT_PRUNE_SQL below, which ensureSchema (server/db.ts) runs at every
// realm boot; nothing in the hot path depends on that sweep.
export const RATELIMIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS rate_limits (
  policy TEXT NOT NULL,
  key TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (policy, key)
);
`;

// The single-statement atomic UPSERT for one hit: no SELECT-then-INSERT, no
// transaction. On a fresh key it inserts count 1 for the incoming window. On a
// conflict it either increments (same or older stored window) or resets to 1
// (the incoming window is newer). The >= / GREATEST pairing means a clock-skewed
// realm whose window is BEHIND the stored one increments the newer STORED window
// instead of resetting it, so a slow clock can never reopen an already-counted
// window. Under skew larger than a full WINDOW_MS the slow realm keeps feeding
// the fast realm's future window and its resetSeconds can exceed the window
// size: that fails toward MORE limiting, never less, and NTP-synced hosts never
// hit it. Exported so the pinning test asserts the exact statement without
// duplicating it.
export const RATE_LIMIT_UPSERT_SQL = `INSERT INTO rate_limits (policy, key, window_start, count) VALUES ($1, $2, $3, 1)
ON CONFLICT (policy, key) DO UPDATE SET
  count = CASE WHEN rate_limits.window_start >= EXCLUDED.window_start THEN rate_limits.count + 1 ELSE 1 END,
  window_start = GREATEST(rate_limits.window_start, EXCLUDED.window_start)
RETURNING count, window_start`;

// Boot-time reclaim for the deferred pruning above: delete rows whose window
// expired more than one full window ago. Any LIVE window's window_start is at
// most WINDOW_MS old, so a 2 x WINDOW_MS horizon only ever removes dead rows;
// the extra window absorbs realm-vs-database clock skew. Uses the DATABASE
// clock (a static statement, no params) on purpose: this is a janitorial sweep,
// not limiter logic, and the static text keeps the schema_wiring boot pin
// byte-identical across runs. ensureSchema runs it at every realm boot under
// the advisory lock; between restarts the table grows only with distinct
// (policy, key) traffic, which tier-1 caps at `limit` writes per key per window.
export const RATELIMIT_PRUNE_SQL = `DELETE FROM rate_limits WHERE window_start < (EXTRACT(EPOCH FROM now()) * 1000 - ${2 * WINDOW_MS})`;

// A type alias (not an interface) so it satisfies pg's QueryResultRow index
// signature. count is INTEGER (returned as a JS number) and window_start is
// BIGINT (returned as a string to preserve precision); both are Number()'d.
type RateLimitCountRow = { count: number | string; window_start: number | string };

export interface PgRateLimitStoreOptions {
  /** The shared pg pool, injected so this module never imports db.ts. */
  readonly pool: Pool;
  /**
   * Injected wall clock. Date.now is the production default; every tested path
   * drives an injected fake so windows and resetSeconds are deterministic.
   */
  readonly now?: () => number;
}

class PgRateLimitStore implements RateLimitStore {
  private readonly pool: Pool;
  private readonly now: () => number;

  constructor(opts: PgRateLimitStoreOptions) {
    this.pool = opts.pool;
    this.now = opts.now ?? Date.now;
  }

  async hit(key: string, maxPerMinute: number): Promise<RateLimitOutcome> {
    const now = this.now();
    // Fixed-window start computed in JS (never a magic 60000). window_start is
    // pinned to the WINDOW_MS grid so every realm agrees on the same boundary.
    const windowStartMs = now - (now % WINDOW_MS);

    // The resolver composes the store key as `${policyName}:${classKey}`. Policy
    // names never contain ':', so split at the FIRST ':' into the (policy, key)
    // columns; the class key may itself contain ':' (an IPv6 address) and is kept
    // intact. With no ':' present, use policy 'default' and the whole string as key.
    const idx = key.indexOf(':');
    const policy = idx === -1 ? 'default' : key.slice(0, idx);
    const classKey = idx === -1 ? key : key.slice(idx + 1);

    const res = await this.pool.query<RateLimitCountRow>(RATE_LIMIT_UPSERT_SQL, [
      policy,
      classKey,
      windowStartMs,
    ]);
    const row = res.rows[0];
    const count = Number(row.count);
    const returnedWindowStartMs = Number(row.window_start);
    const outcome = windowedRateLimitOutcome(
      count,
      maxPerMinute,
      returnedWindowStartMs,
      WINDOW_MS,
      now,
    );

    // Count this pg upsert once on the real pg_limiter_writes_total{policy} series
    // via the process-wide attack-signal slot (server/http/attack_signals.ts,
    // installed by main.ts at boot; read here, never captured at import). This
    // counts WRITES, not decisions: an allowed hit and a tripped hit each add
    // exactly one. The allowed-vs-tripped split lives on the separate
    // rate_limit_hits_total series (the rate_limit middleware), so the old
    // http_requests_total{route='ratelimit.pg.hit'} proxy row is GONE.
    attackSignalSink().pgLimiterWrite(policy);

    return outcome;
  }

  async reset(): Promise<void> {
    // Test/support surface ONLY: mirror FakeRateLimitStore.reset (clear all
    // windows). This DELETE is GLOBAL (no realm or policy scope): every realm
    // shares this table, so mounting it on any admin/ops route would wipe all
    // realms' counters at once. Keep it off production paths.
    await this.pool.query('DELETE FROM rate_limits');
  }
}

/** Build the pg-backed tier-2 rate-limit store. See PgRateLimitStoreOptions. */
export function createPgRateLimitStore(opts: PgRateLimitStoreOptions): RateLimitStore {
  return new PgRateLimitStore(opts);
}
