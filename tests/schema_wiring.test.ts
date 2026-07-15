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
  const state = { rateLimitsExists: true, invalidMetricsIndexExists: false };
  const query = vi.fn((sql: string) => {
    calls.push(String(sql));
    // The invalid-carcass check for the post-commit metrics index build; a test
    // flips the flag to exercise the repair arm. Checked before the to_regclass
    // arm because the check SQL also resolves the index via to_regclass.
    if (String(sql).includes('indisvalid')) {
      return Promise.resolve({
        rows: state.invalidMetricsIndexExists ? [{ found: 1 }] : [],
        rowCount: state.invalidMetricsIndexExists ? 1 : 0,
      });
    }
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
    clientConfigs: [] as unknown[],
  };
});
vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: h.query, connect: h.connect };
  }),
  // ensureSchema boots on a dedicated Client (resolved at call time), never a
  // pool checkout; record each construction config so a test can pin that the
  // boot client escapes the pool's timeout configuration.
  Client: vi.fn(function Client(config: unknown) {
    h.clientConfigs.push(config);
    return {
      connect: vi.fn(() => Promise.resolve()),
      query: h.query,
      end: vi.fn(() => Promise.resolve()),
    };
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
    h.state.invalidMetricsIndexExists = false;
    h.clientConfigs.length = 0;
  });

  it('boots on a dedicated client with no pool timeout config (the driver query_timeout must never cap the advisory-lock wait or the backfill)', async () => {
    h.connect.mockClear();
    await ensureSchema();
    expect(h.clientConfigs.length).toBeGreaterThan(0);
    const cfg = h.clientConfigs.at(-1) as Record<string, unknown>;
    expect(typeof cfg.connectionString).toBe('string');
    // query_timeout is a driver-side per-query timer that SET LOCAL cannot
    // lift; the boot client must not carry it (nor any other pool deadline).
    expect('query_timeout' in cfg).toBe(false);
    expect('statement_timeout' in cfg).toBe(false);
    expect('connectionTimeoutMillis' in cfg).toBe(false);
    // The pool was never dipped into for boot work.
    expect(h.connect).not.toHaveBeenCalled();
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

  it('disables the statement timeout for the boot transaction before the advisory lock', async () => {
    // Boot DDL serializes on the advisory lock across concurrent realm processes and
    // may legitimately wait far past any request budget, so the boot transaction runs
    // with statement_timeout disabled (SET LOCAL, reverts at COMMIT). The pool's own
    // default statement_timeout would otherwise cancel schema setup under a pile-up.
    await ensureSchema();
    const setLocalIdx = h.calls.findIndex((c) => c === 'SET LOCAL statement_timeout = 0');
    const lockIdx = h.calls.findIndex((c) => c.includes('pg_advisory_xact_lock'));
    expect(setLocalIdx).toBeGreaterThanOrEqual(0);
    // It must run before the advisory-lock wait it exists to protect.
    expect(setLocalIdx).toBeLessThan(lockIdx);
  });

  it('applies payout void metadata and append-only moderation audit storage', async () => {
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain(
      'ALTER TABLE daily_reward_payouts ADD COLUMN IF NOT EXISTS void_reason TEXT',
    );
    expect(applied).toContain(
      'ALTER TABLE daily_reward_payouts ADD COLUMN IF NOT EXISTS voided_by_id TEXT',
    );
    expect(applied).toContain(
      'ALTER TABLE daily_reward_payouts ADD COLUMN IF NOT EXISTS voided_by_username TEXT',
    );
    expect(applied).toContain(
      'ALTER TABLE daily_reward_payouts ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ',
    );
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS daily_reward_payout_moderation_audit');
    expect(applied).toContain("action TEXT NOT NULL CHECK (action IN ('void', 'restore'))");
    expect(applied).toContain('actor_id TEXT NOT NULL');
    expect(applied).toContain('actor_username TEXT NOT NULL');
    expect(applied).toContain(
      'ALTER TABLE daily_reward_payouts ADD COLUMN IF NOT EXISTS signed_transaction TEXT',
    );
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS daily_reward_payout_attempts');
    expect(applied).toContain("kind TEXT NOT NULL CHECK (kind IN ('payout', 'resend'))");
    expect(applied).toContain(
      'ALTER TABLE daily_reward_payout_attempts ADD COLUMN IF NOT EXISTS operation_id TEXT',
    );
    expect(applied).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS daily_reward_payout_attempts_operation',
    );
    expect(applied).toContain('tx_signature TEXT NOT NULL UNIQUE');
  });

  it('applies the bank-system tables (character_leases, bank_ledger) idempotently', async () => {
    // Bank system tables: the per-character load lease and the append-only
    // bank op ledger both live inline in the core SCHEMA string. Pin them by name so
    // they can never regress to defined-but-unwired (the DISCORD_SCHEMA lesson), and
    // boot twice to pin that a re-boot re-applies the same additive statements.
    await ensureSchema();
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS character_leases');
    expect(applied).toContain('CREATE INDEX IF NOT EXISTS character_leases_holder');
    // The same-account takeover column is added at boot on existing databases (the
    // owner reclaiming a lease stranded by a dead process); additive and idempotent.
    expect(applied).toContain(
      'ALTER TABLE character_leases ADD COLUMN IF NOT EXISTS account_id INT',
    );
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS bank_ledger');
    expect(applied).toContain('CREATE INDEX IF NOT EXISTS bank_ledger_character');
    expect(applied).toContain('CREATE INDEX IF NOT EXISTS bank_ledger_created');
    // Additive-only style within the two new blocks: inside the ONE core-SCHEMA
    // query call, slice from each CREATE TABLE to the next CREATE TABLE (or the end
    // of that call for the last table) and assert nothing destructive or
    // non-idempotent. Slicing the joined call log instead would run past the core
    // schema into later boot SQL that legitimately contains destructive keywords.
    for (const table of ['character_leases', 'bank_ledger']) {
      const coreCall = h.calls.find((c) => c.includes(`CREATE TABLE IF NOT EXISTS ${table}`));
      expect(coreCall).toBeDefined();
      const start = (coreCall as string).indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
      const rest = (coreCall as string).slice(start + 1);
      const end = rest.indexOf('CREATE TABLE');
      const ddl = rest.slice(0, end === -1 ? undefined : end);
      expect(ddl).not.toMatch(/\b(?:DROP|TRUNCATE|ALTER COLUMN)\b/i);
      expect(ddl).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/i);
    }
  });

  it('applies the deeds records table and the broadcast opt-out column idempotently', async () => {
    // The earned-deed index table and the accounts opt-out column live inline
    // in the core SCHEMA string. Pin them by name so they can never regress to
    // defined-but-unwired (the DISCORD_SCHEMA lesson), and boot twice to pin
    // that a re-boot re-applies the same additive statements.
    await ensureSchema();
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS character_deeds');
    expect(applied).toContain('CREATE INDEX IF NOT EXISTS character_deeds_account');
    expect(applied).toContain('CREATE INDEX IF NOT EXISTS character_deeds_character_earned');
    // The retired deed_id index: the CREATE is gone and the boot DDL converges
    // deployed databases with an idempotent DROP INDEX IF EXISTS.
    expect(applied).not.toContain('CREATE INDEX IF NOT EXISTS character_deeds_deed');
    expect(applied).toContain('DROP INDEX IF EXISTS character_deeds_deed;');
    expect(applied).toContain(
      'ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deed_broadcasts BOOLEAN NOT NULL DEFAULT TRUE',
    );
    // Additive-only within the block (the bank-tables slicing idiom above),
    // save for the ONE sanctioned reconcile: the DROP INDEX IF EXISTS that
    // retires the deed_id index is index-only and idempotent, so strip that
    // exact line before the destructive-token scan and the scan still catches
    // any UNsanctioned DROP/TRUNCATE/ALTER COLUMN in the block.
    const coreCall = h.calls.find((c) => c.includes('CREATE TABLE IF NOT EXISTS character_deeds'));
    expect(coreCall).toBeDefined();
    const start = (coreCall as string).indexOf('CREATE TABLE IF NOT EXISTS character_deeds');
    const rest = (coreCall as string).slice(start + 1);
    const end = rest.indexOf('CREATE TABLE');
    const ddl = rest.slice(0, end === -1 ? undefined : end);
    const sansReconcile = ddl.replace('DROP INDEX IF EXISTS character_deeds_deed;', '');
    expect(sansReconcile).not.toMatch(/\b(?:DROP|TRUNCATE|ALTER COLUMN)\b/i);
    expect(sansReconcile).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/i);
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

  it('applies the compact player-metrics schema without a boot backfill', async () => {
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS player_account_facts');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS player_activity_daily');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS player_business_daily');
    const ddl = h.calls.find((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS player_account_facts'),
    );
    expect(ddl).toBeDefined();
    expect(ddl).not.toMatch(/INSERT INTO|UPDATE |DELETE FROM/);

    const commitIndex = h.calls.indexOf('COMMIT');
    const concurrentIndex = h.calls.findIndex((sql) =>
      sql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS play_sessions_account_started_id'),
    );
    const sessionLock = h.calls.findIndex((sql) => sql.includes('pg_advisory_lock($1)'));
    const sessionUnlock = h.calls.findIndex((sql) => sql.includes('pg_advisory_unlock($1)'));
    expect(commitIndex).toBeGreaterThan(-1);
    expect(concurrentIndex).toBeGreaterThan(commitIndex);
    expect(sessionLock).toBeGreaterThan(commitIndex);
    expect(sessionLock).toBeLessThan(concurrentIndex);
    expect(sessionUnlock).toBeGreaterThan(concurrentIndex);

    // The boot transaction's SET LOCAL statement_timeout = 0 reverts at COMMIT,
    // so the post-commit migration must re-disable it session-wide before taking
    // the session lock: the advisory-lock wait and the concurrent build can both
    // outlast an operator-set database- or role-level statement_timeout.
    const postCommitTimeoutOff = h.calls.findIndex(
      (sql, i) => i > commitIndex && sql === 'SET statement_timeout = 0',
    );
    expect(postCommitTimeoutOff).toBeGreaterThan(commitIndex);
    expect(postCommitTimeoutOff).toBeLessThan(sessionLock);

    // The invalid-carcass check runs under the session lock, before the create
    // it protects; on a healthy boot (no carcass) nothing is dropped.
    const carcassCheck = h.calls.findIndex((sql) => sql.includes('indisvalid'));
    expect(carcassCheck).toBeGreaterThan(sessionLock);
    expect(carcassCheck).toBeLessThan(concurrentIndex);
    expect(h.calls.some((sql) => sql.includes('DROP INDEX CONCURRENTLY'))).toBe(false);
  });

  it('drops an INVALID metrics-index carcass before rebuilding it (a killed CONCURRENTLY build self-heals)', async () => {
    // A CREATE INDEX CONCURRENTLY killed mid-build (a deploy-watchdog restart,
    // a crash) strands an INVALID index that IF NOT EXISTS treats as existing
    // on every later boot: never rebuilt, unusable to the planner, yet
    // maintained on every play_sessions write. Boot must drop the carcass and
    // rebuild.
    h.state.invalidMetricsIndexExists = true;
    await ensureSchema();
    const sessionLock = h.calls.findIndex((sql) => sql.includes('pg_advisory_lock($1)'));
    const drop = h.calls.findIndex((sql) =>
      sql.includes('DROP INDEX CONCURRENTLY IF EXISTS play_sessions_account_started_id'),
    );
    const create = h.calls.findIndex((sql) =>
      sql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS play_sessions_account_started_id'),
    );
    expect(drop).toBeGreaterThan(sessionLock);
    expect(drop).toBeLessThan(create);
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
