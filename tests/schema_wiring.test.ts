import { beforeEach, describe, expect, it, vi } from 'vitest';

// Guards that ensureSchema() actually APPLIES every schema module, not just the
// core one. The Discord integration wiring regressed once (DISCORD_SCHEMA was
// defined but never run, so its tables were never created at boot and every
// Discord query would throw "relation does not exist"); this pins it. Mock pg so
// ensureSchema runs against a recording client with no live database.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  const calls: string[] = [];
  // The boot-time assertion in ensureSchema SELECTs to_regclass('public.rate_limits')
  // and throws when it is null. Answer that one query from a mutable flag so a test
  // can flip it to null to exercise the throw; every other query returns empty rows
  // (the existing assertions only inspect `calls`, so they are unaffected).
  const state = { rateLimitsExists: true };
  const query = vi.fn((sql: string) => {
    calls.push(String(sql));
    if (String(sql).includes('to_regclass')) {
      return Promise.resolve({
        rows: [{ reg: state.rateLimitsExists ? 'public.rate_limits' : null }],
        rowCount: 1,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return {
    calls,
    state,
    query,
    connect: vi.fn(() => Promise.resolve({ query, release: vi.fn() })),
  };
});
vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: h.query, connect: h.connect };
  }),
}));

import { closeMarketWriteGateForTests, ensureSchema, saveMarketState } from '../server/db';
import { RATELIMIT_PRUNE_SQL } from '../server/ratelimit_db';
import type { MarketSave } from '../src/sim/sim';

const emptyMarket: MarketSave = { listings: [], collections: [], nextListingId: 1 };

describe('ensureSchema wires every schema module at boot', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.state.rateLimitsExists = true;
  });

  it('applies the Discord schema so its tables exist before the feature is enabled', async () => {
    await ensureSchema();
    const applied = h.calls.join('\n');
    // The whole Discord integration depends on all six tables being created at boot:
    // the five the Discord route surface reads (discord_links, discord_oauth_states,
    // reward_points, reward_ledger, swag_claims) plus the discord_pending_logins
    // chooser table (PR #1075).
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS discord_links');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS discord_oauth_states');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS discord_pending_logins');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS reward_points');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS reward_ledger');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS swag_claims');
    // The captured Discord email column (recovery-email capture) must be added at boot,
    // on both the durable link and the first-time pending-login rows.
    expect(applied).toContain('ALTER TABLE discord_links ADD COLUMN IF NOT EXISTS discord_email');
    expect(applied).toContain(
      'ALTER TABLE discord_pending_logins ADD COLUMN IF NOT EXISTS discord_email',
    );
  });

  it('applies the Discord schema idempotently (a second boot is a no-op: only guarded DDL)', async () => {
    // The Discord routes run on the API request pipeline and rely on the schema
    // being wired (it was, since PR #1075). This pins that re-running ensureSchema (every
    // boot re-applies it under the advisory lock) is safe: the whole boot is deterministic
    // and the Discord DDL is entirely IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so a
    // second boot against a live database changes nothing.
    await ensureSchema();
    const firstBoot = h.calls.slice();
    h.calls.length = 0;
    await ensureSchema();
    const secondBoot = h.calls.slice();
    // Deterministic re-run against the recording client: the second boot issues the
    // identical statements (this pins HARNESS determinism, not real-DB idempotency;
    // against a live database the second boot would legitimately differ where a seed
    // already exists). The REAL no-op-on-re-run guarantee for the Discord schema is the
    // IF-NOT-EXISTS / ADD-COLUMN-IF-NOT-EXISTS guard block below.
    expect(secondBoot).toEqual(firstBoot);
    // The Discord DDL is applied as one multi-statement query. Every table/index/column
    // op must be guarded so a re-run is a no-op, and there must be no destructive op.
    const discordDdl = secondBoot.find((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS discord_links'),
    );
    expect(discordDdl).toBeDefined();
    if (discordDdl) {
      // Case-insensitive so a future lowercase (or mixed-case) destructive statement
      // cannot slip past the guard; the repo's DDL style is uppercase today.
      expect(discordDdl).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/i);
      expect(discordDdl).not.toMatch(/CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/i);
      expect(discordDdl).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/i);
      expect(discordDdl).not.toMatch(/\b(?:DROP|TRUNCATE|ALTER COLUMN)\b/i);
    }
  });

  it('still applies the core schema (accounts) under the advisory lock', async () => {
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain('pg_advisory_xact_lock');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS accounts');
    // password_set is the column the unlink guard reads; it must be added at boot.
    expect(applied).toContain('password_set');
  });

  it('applies the tier-2 rate-limit schema under the advisory lock', async () => {
    // The multi-realm tier-2 backstop depends on the rate_limits table being
    // created at boot (RATELIMIT_SCHEMA in server/ratelimit_db.ts). Pin that it is
    // wired, so it never regresses to defined-but-unwired like DISCORD_SCHEMA once did.
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain('pg_advisory_xact_lock');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS rate_limits');
  });

  it('applies the rate-limit schema idempotently (a second boot re-issues the same DDL)', async () => {
    await ensureSchema();
    const firstBoot = h.calls.slice();
    h.calls.length = 0;
    await ensureSchema();
    const secondBoot = h.calls.slice();
    expect(secondBoot).toEqual(firstBoot);
    // The rate-limit DDL must be entirely guarded (IF NOT EXISTS) with no
    // destructive op, so re-running it against a live database is a no-op.
    const rateLimitDdl = secondBoot.find((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS rate_limits'),
    );
    expect(rateLimitDdl).toBeDefined();
    if (rateLimitDdl) {
      expect(rateLimitDdl).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/i);
      expect(rateLimitDdl).not.toMatch(/\b(?:DROP|TRUNCATE|ALTER COLUMN)\b/i);
    }
  });

  it('prunes expired tier-2 windows at boot with the static reclaim statement', async () => {
    // The boot prune is the reclaim path for the deferred row-pruning decision
    // (the two-tier rate limiter's security review): expired (older than two windows) rate_limits
    // rows are deleted at every realm boot, under the same advisory lock. The
    // statement is STATIC (database clock, no params) so this pin, and the
    // byte-identical second-boot pin above, hold across runs.
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain(RATELIMIT_PRUNE_SQL);
    expect(RATELIMIT_PRUNE_SQL).toContain('DELETE FROM rate_limits WHERE window_start <');
    expect(RATELIMIT_PRUNE_SQL).not.toMatch(/\$\d/);
  });

  it('runs the market backfill inside the boot transaction', async () => {
    // The partitioned World Market backfill runs inside ensureSchema's advisory-lock
    // transaction (server/market_backfill.ts): a marker probe, the legacy row
    // claim (FOR UPDATE), and the marker upsert all run under the same lock as
    // the schema DDL. Pinned with literal SQL fragments so a refactor that
    // drops the backfill is caught. The recording fake returns no rows for
    // world_state, so the backfill finds no legacy blob and only probes the
    // marker, claims the (absent) legacy row, and upserts the marker.
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain('pg_advisory_xact_lock');
    // The marker probe and the legacy claim read world_state; the claim locks
    // the legacy row so a not-yet-upgraded process's lazy claim serializes.
    expect(applied).toContain('FROM world_state');
    expect(applied).toContain('FOR UPDATE');
    // The marker (and any realm partition) is written with the world_state
    // upsert, so a re-run is a no-op.
    expect(applied).toContain('INTO world_state');
    expect(applied).toContain('ON CONFLICT (key) DO UPDATE');
  });

  it('opens the market write gate only after the boot transaction commits', async () => {
    // The market-backfill boot-ordering gate: a market write before ensureSchema has
    // confirmed the backfill marker must throw, and a successful boot must open
    // the gate (openMarketWriteGate runs after COMMIT in ensureSchema).
    closeMarketWriteGateForTests();
    await expect(saveMarketState(emptyMarket)).rejects.toThrow(/market write blocked/);
    await ensureSchema();
    await expect(saveMarketState(emptyMarket)).resolves.toBeUndefined();
  });

  it('halts boot under MARKET_BACKFILL_DRY_RUN without writing or opening the gate', async () => {
    // The operator dry-run: ensureSchema throws deliberately after logging the
    // partition plan, the transaction rolls back, nothing is written to
    // world_state (no marker, no partitions), and the write gate stays closed.
    closeMarketWriteGateForTests();
    process.env.MARKET_BACKFILL_DRY_RUN = '1';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(ensureSchema()).rejects.toThrow(/MARKET_BACKFILL_DRY_RUN/);
    } finally {
      delete process.env.MARKET_BACKFILL_DRY_RUN;
      logSpy.mockRestore();
    }
    const applied = h.calls.join('\n');
    expect(applied).not.toContain('INSERT INTO world_state');
    expect(applied).toContain('ROLLBACK');
    await expect(saveMarketState(emptyMarket)).rejects.toThrow(/market write blocked/);
  });

  it('boot assertion passes when to_regclass reports the rate_limits table exists', async () => {
    // The default fake answers to_regclass with a non-null regclass, so the
    // fail-fast assertion is satisfied and ensureSchema resolves.
    await expect(ensureSchema()).resolves.toBeUndefined();
    const applied = h.calls.join('\n');
    expect(applied).toContain("to_regclass('public.rate_limits')");
  });

  it('boot assertion throws a descriptive error when to_regclass returns null', async () => {
    // Simulate the defined-but-unwired failure: to_regclass('public.rate_limits')
    // is null, so ensureSchema must fail fast with a message naming the table and
    // the schema module, and roll the transaction back.
    h.state.rateLimitsExists = false;
    await expect(ensureSchema()).rejects.toThrow(/rate_limits/);
    await expect(ensureSchema()).rejects.toThrow(/RATELIMIT_SCHEMA/);
  });
});
