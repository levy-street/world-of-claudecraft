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
  const state = {
    rateLimitsExists: true,
    invalidMetricsIndexExists: false,
    failOpenIndexCreate: false,
    failLargeAccountIndexCreate: false,
    failReceiptsValidate: false,
  };
  const query = vi.fn((sql: string) => {
    calls.push(String(sql));
    // A test flips this flag to simulate an interrupted concurrent index
    // build, exercising the post-commit loop's unlock-in-finally guarantee.
    if (
      state.failOpenIndexCreate &&
      String(sql).includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS play_sessions_open_character')
    ) {
      return Promise.reject(new Error('index build interrupted'));
    }
    if (
      state.failLargeAccountIndexCreate &&
      String(sql).includes(
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS bank_ledger_account_large_recent',
      )
    ) {
      return Promise.reject(new Error('large account index build interrupted'));
    }
    // A shape-violating survivor row: the real fragment raises 23514 from the
    // VALIDATE inside the DO block.
    if (
      state.failReceiptsValidate &&
      String(sql).includes('VALIDATE CONSTRAINT bank_ledger_batch_receipts_key_shape')
    ) {
      return Promise.reject(
        Object.assign(
          new Error(
            'check constraint "bank_ledger_batch_receipts_key_shape" of relation "bank_ledger_batch_receipts" is violated by some row',
          ),
          { code: '23514' },
        ),
      );
    }
    // Mirror node-postgres: a simple query carrying several top-level
    // statements resolves to an ARRAY of per-statement results (dollar-quoted
    // bodies are not statement boundaries). ensureSchema once read `.rows[0]`
    // off a multi-statement fragment; the flat-object fake kept that green
    // while every real boot threw, so the distinction must materialize here.
    const topLevel = String(sql).replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, "''");
    const statements = topLevel.split(';').filter((part) => part.trim().length > 0);
    if (statements.length > 1) {
      return Promise.resolve(statements.map(() => ({ rows: [], rowCount: 0 })));
    }
    // The growth-budget gauge readback (a single-statement SELECT): seed the
    // counters so the wiring test can assert they reach the observer.
    if (
      String(sql).includes('.bank_ledger_growth_budget') &&
      String(sql).includes('SELECT committed_rows') &&
      String(sql).includes('singleton = TRUE')
    ) {
      return Promise.resolve({
        rows: [{ committed_rows: '7', hard_limit_rows: '10000000' }],
        rowCount: 1,
      });
    }
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
    noticeListeners: [] as Array<(notice: unknown) => void>,
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
      on: vi.fn((event: string, listener: (notice: unknown) => void) => {
        if (event === 'notice') h.noticeListeners.push(listener);
      }),
    };
  }),
}));
// Spy on the growth-budget observer (real behavior preserved) so the wiring
// test can assert the seeded readback counters actually reach the gauge.
vi.mock('../server/bank_ledger_growth_budget', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/bank_ledger_growth_budget')>();
  return {
    ...actual,
    observeBankLedgerGrowthBudget: vi.fn(actual.observeBankLedgerGrowthBudget),
  };
});

import {
  bankLedgerGrowthBudgetReadbackSql,
  observeBankLedgerGrowthBudget,
} from '../server/bank_ledger_growth_budget';
import {
  BANK_LEDGER_ACCOUNT_BROAD_RETIRE_SQL,
  BANK_LEDGER_ACCOUNT_FK_INDEX_SQL,
  BANK_LEDGER_ACCOUNT_FK_INVALID_INDEX_CHECK_SQL,
  BANK_LEDGER_ACCOUNT_FK_INVALID_INDEX_DROP_SQL,
  BANK_LEDGER_ACCOUNT_INDEX_SQL,
  BANK_LEDGER_ACCOUNT_INVALID_INDEX_CHECK_SQL,
  BANK_LEDGER_ACCOUNT_INVALID_INDEX_DROP_SQL,
} from '../server/bank_ledger_indexes';
import { CONCURRENT_INDEX_MIGRATIONS } from '../server/concurrent_indexes';
import {
  closeMarketWriteGateForTests,
  ensureSchema,
  runConcurrentIndexMigrations,
  saveMarketState,
} from '../server/db';
import { RATELIMIT_PRUNE_SQL } from '../server/ratelimit_db';
import type { MarketSave } from '../src/sim/sim';

const emptyMarket: MarketSave = { listings: [], collections: [], nextListingId: 1 };

describe('ensureSchema wires every schema module at boot', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.state.rateLimitsExists = true;
    h.state.invalidMetricsIndexExists = false;
    h.state.failOpenIndexCreate = false;
    h.state.failLargeAccountIndexCreate = false;
    h.state.failReceiptsValidate = false;
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

  it('applies the unstuck reporting schema after the core identity tables', async () => {
    await ensureSchema();
    const coreIndex = h.calls.findIndex((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS accounts'),
    );
    const unstuckIndex = h.calls.findIndex((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS unstuck_reports'),
    );
    expect(coreIndex).toBeGreaterThanOrEqual(0);
    expect(unstuckIndex).toBeGreaterThan(coreIndex);
    const ddl = h.calls[unstuckIndex];
    expect(ddl).toContain('CREATE INDEX IF NOT EXISTS unstuck_reports_realm_id');
    expect(ddl).toContain('attempt_id UUID NOT NULL UNIQUE');
    expect(ddl).toContain('CREATE INDEX IF NOT EXISTS unstuck_reports_created');
    expect(ddl).toContain('ON DELETE SET NULL');
    expect(ddl).not.toMatch(/\b(?:DROP|TRUNCATE|ALTER COLUMN)\b/i);
  });

  it('disables the statement timeout for the boot transaction before the advisory lock', async () => {
    // Boot DDL serializes on the advisory lock across concurrent realm processes and
    // may legitimately wait far past any request budget, so the boot transaction runs
    // with statement_timeout disabled (SET LOCAL, reverts at COMMIT). The pool's own
    // default statement_timeout would otherwise cancel schema setup under a pile-up.
    await ensureSchema();
    const setLocalIdx = h.calls.indexOf('SET LOCAL statement_timeout = 0');
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

  it('applies timed Daily Rewards bans without changing the exclusion-view shape', async () => {
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain(
      'ALTER TABLE daily_reward_bans ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ',
    );
    expect(applied).toContain('CREATE OR REPLACE VIEW daily_reward_excluded_accounts AS');
    expect(applied).toContain('expires_at IS NULL OR expires_at > now()');
    expect(applied).toContain('SELECT account_id, reason');
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
    // The counterparty (payer/payee) half of every guild row, added at boot on
    // existing databases. Pinned BY NAME, not only by the additive-style scan
    // below: deleting either statement would leave the scan perfectly happy
    // while every guild op silently became unauditable.
    expect(applied).toContain(
      'ALTER TABLE bank_ledger ADD COLUMN IF NOT EXISTS counterparty_copper_delta BIGINT',
    );
    expect(applied).toContain(
      'ALTER TABLE bank_ledger ADD COLUMN IF NOT EXISTS counterparty_count INT',
    );
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

  it('applies the content-moderation audit schema (map unpublish, asset block/unblock)', async () => {
    // Regression guard for the same "defined but never wired" failure mode as
    // DISCORD_SCHEMA above: content_moderation_actions backs the admin
    // dashboard's map/asset moderation audit trail (server/content_moderation_db.ts).
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS content_moderation_actions');
    expect(applied).toContain('CREATE INDEX IF NOT EXISTS content_moderation_actions_resource');
  });

  it('applies the economy-oversight schemas (account wealth, suspicion flags) after the accounts table', async () => {
    // ACCOUNT_WEALTH_SCHEMA (server/account_wealth_db.ts) and
    // SUSPICION_FLAGS_SCHEMA (server/suspicion_flags_db.ts) back the admin
    // economy oversight (the rich list, the per-account breakdown, the flag
    // workflow). Pin them by name so neither can regress to defined-but-unwired
    // (the DISCORD_SCHEMA lesson): deleting an ensureSchema line must fail here.
    await ensureSchema();
    const coreIndex = h.calls.findIndex((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS accounts'),
    );
    const wealthIndex = h.calls.findIndex((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS account_wealth'),
    );
    const flagsIndex = h.calls.findIndex((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS account_suspicion_flags'),
    );
    // Both tables reference accounts(id), so they must land after the core schema.
    expect(coreIndex).toBeGreaterThanOrEqual(0);
    expect(wealthIndex).toBeGreaterThan(coreIndex);
    expect(flagsIndex).toBeGreaterThan(coreIndex);

    const wealthDdl = h.calls[wealthIndex];
    expect(wealthDdl).toContain(
      'account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE',
    );
    // The rich-list index: the top-holders read orders by total_copper DESC.
    expect(wealthDdl).toContain(
      'CREATE INDEX IF NOT EXISTS account_wealth_total ON account_wealth (total_copper DESC)',
    );
    expect(wealthDdl).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/i);
    expect(wealthDdl).not.toMatch(/CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/i);
    expect(wealthDdl).not.toMatch(/\b(?:DROP|TRUNCATE|ALTER COLUMN)\b/i);

    const flagsDdl = h.calls[flagsIndex];
    // The partial unique index the whole emitter dedupe rides on: at most one
    // ACTIVE flag per account/source/kind, so a re-detection bumps the row
    // instead of stacking a duplicate, while cleared/actioned history stays.
    // Pinned with its key columns AND its WHERE clause: dropping the partial
    // predicate would refuse the second flag of a cleared kind forever.
    expect(flagsDdl).toContain('CREATE UNIQUE INDEX IF NOT EXISTS suspicion_flags_active_dedupe');
    expect(flagsDdl).toMatch(
      /suspicion_flags_active_dedupe\s+ON account_suspicion_flags \(account_id, source, kind\)\s+WHERE status IN \('new', 'under_review'\)/,
    );
    expect(flagsDdl).toContain('CREATE INDEX IF NOT EXISTS suspicion_flags_status_seen');
    expect(flagsDdl).toContain('CREATE INDEX IF NOT EXISTS suspicion_flags_account');
    expect(flagsDdl).toContain('CREATE TABLE IF NOT EXISTS account_suspicion_flag_events');
    expect(flagsDdl).toContain('CREATE INDEX IF NOT EXISTS suspicion_flag_events_flag');
    expect(flagsDdl).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/i);
    expect(flagsDdl).not.toMatch(/CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/i);
    expect(flagsDdl).not.toMatch(/\b(?:DROP|TRUNCATE|ALTER COLUMN)\b/i);
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

  it('applies the storage pending-purchase schema under the advisory lock', async () => {
    // STORAGE_PURCHASE_SCHEMA (server/storage_purchase_db.ts, Bank Storage
    // phase 11): the whole Claudium storage purchase flow hard-depends on
    // this table (the durable pending row IS the recovery story). Pin it by
    // name so it can never regress to defined-but-unwired (the
    // DISCORD_SCHEMA lesson).
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS storage_purchases');
    expect(applied).toContain('CREATE INDEX IF NOT EXISTS storage_purchases_character');
    expect(applied).toContain('CREATE INDEX IF NOT EXISTS storage_purchases_account');
    expect(applied).toContain('DROP INDEX IF EXISTS storage_purchases_refused');

    // The one new DDL fragment carrying destructive statements. Allowlist each
    // permitted statement EXACTLY, then hold the remainder (SQL comments
    // stripped: prose like "Drop only after..." is not a statement) to the
    // same no-destructive-DDL bar its sibling fragments get above.
    const storageDdl = h.calls.find((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS storage_purchases'),
    );
    expect(storageDdl).toBeDefined();
    const allowedDestructive = [
      "DELETE FROM storage_purchases WHERE status = 'refused';",
      'DROP INDEX IF EXISTS storage_purchases_character_pending;',
      'DROP INDEX IF EXISTS storage_purchases_refused;',
      'DROP INDEX IF EXISTS storage_purchases_one_pending_per_character;',
      'DROP INDEX storage_purchases_one_open_per_character;',
      'ALTER TABLE storage_purchases DROP CONSTRAINT storage_purchases_status_allowed;',
      'ALTER TABLE storage_purchases DROP CONSTRAINT storage_purchases_claim_pair;',
      'DROP TRIGGER IF EXISTS storage_purchase_guard_character_delete ON characters;',
      'DROP TRIGGER IF EXISTS storage_purchase_guard_account_delete ON accounts;',
      'DROP TRIGGER IF EXISTS storage_purchase_guard_consumed_key ON storage_purchases;',
      'DROP TRIGGER IF EXISTS storage_purchase_archive_applied ON storage_purchases;',
    ];
    let remainder = (storageDdl as string).replace(/--[^\n]*/g, '');
    for (const statement of allowedDestructive) {
      // Exactly the allowed count (one each): split-join stripped EVERY copy,
      // so a DUPLICATED destructive statement used to pass this bar. Count on
      // the comment-stripped text and remove only the single allowance.
      const occurrences = remainder.split(statement).length - 1;
      expect(occurrences, `allowlisted destructive statement count: ${statement}`).toBe(1);
      remainder = remainder.replace(statement, '');
    }
    expect(remainder).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN)\b/i);
  });

  it('reads the growth-budget counters back with a dedicated single-statement query', async () => {
    // The fragment ends in a SELECT, but node-postgres answers the whole
    // multi-statement fragment with an ARRAY of results, so ensureSchema must
    // issue the gauge readback as its own query (inside the boot transaction,
    // before COMMIT) and feed the observer from THAT result.
    vi.mocked(observeBankLedgerGrowthBudget).mockClear();
    await ensureSchema();
    const fragmentIndex = h.calls.findIndex(
      (sql) =>
        sql.includes('bank_ledger_growth_budget') && sql.includes('CREATE TABLE IF NOT EXISTS'),
    );
    expect(fragmentIndex).toBeGreaterThanOrEqual(0);
    // Matched through the SAME exported builder db.ts issues (exported beside
    // the schema builder precisely so the two cannot drift).
    const readbackIndex = h.calls.findIndex(
      (sql, index) => index > fragmentIndex && sql === bankLedgerGrowthBudgetReadbackSql(),
    );
    expect(readbackIndex).toBeGreaterThan(fragmentIndex);
    expect(readbackIndex).toBeLessThan(h.calls.indexOf('COMMIT'));
    // The fake answers the single-statement readback with these seeded
    // counters; the observer receiving them proves the wiring end to end.
    expect(observeBankLedgerGrowthBudget).toHaveBeenCalledWith('7', '10000000');
  });

  it('warns when the growth readback cannot seed the gauge', async () => {
    // The monitor refresh backstops the gauge inside a minute, but a missing
    // or malformed singleton right after the fragment ran deserves a name in
    // the boot log rather than silence.
    vi.mocked(observeBankLedgerGrowthBudget).mockReturnValueOnce(false);
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await ensureSchema();
      expect(
        warns.mock.calls.some((call) =>
          String(call[0]).includes('growth budget readback did not seed the gauge'),
        ),
      ).toBe(true);
    } finally {
      warns.mockRestore();
    }
  });

  it('forwards fragment RAISE NOTICE reports to the boot log, filtering the no-op DDL wall', async () => {
    // The schema fragments report through RAISE NOTICE (the storage-purchase
    // refused-row sweep names what it removed); node-postgres discards
    // unconsumed notices, so BOTH dedicated boot clients must register the
    // shared forwarder: the ensureSchema transaction client AND the
    // post-listen concurrent-index client the VALIDATE now rides (notices
    // there were silently discarded before the forwarder moved to
    // schema_notices.ts). The filter must drop the ~400 idempotent-DDL skip
    // notices every steady-state boot emits or the one real report drowns.
    h.noticeListeners.length = 0;
    await ensureSchema();
    const ensureSchemaListeners = h.noticeListeners.length;
    expect(ensureSchemaListeners).toBeGreaterThan(0);
    await runConcurrentIndexMigrations();
    expect(h.noticeListeners.length).toBeGreaterThan(ensureSchemaListeners);
    const listener = h.noticeListeners[h.noticeListeners.length - 1];
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Real steady-state shapes (measured on PG 16). The drop-skips arrive
      // as SQLSTATE 00000, the SAME code a RAISE report carries, so the
      // filter keys them on the server routine; 42710 (duplicate_object)
      // joins the already-exists family the first three codes do not cover.
      listener({ code: '42P07', message: 'relation "accounts" already exists, skipping' });
      listener({ code: '42701', message: 'column "locale" already exists, skipping' });
      listener({ code: '42P06', message: 'schema already exists, skipping' });
      listener({ code: '42710', message: 'extension "pgcrypto" already exists, skipping' });
      listener({
        code: '00000',
        routine: 'DropErrorMsgNonExistent',
        message: 'index "woc_market_settlements_open" does not exist, skipping',
      });
      listener({
        code: '00000',
        routine: 'does_not_exist_skipping',
        message:
          'trigger "storage_purchase_archive_applied" for relation "storage_purchases" does not exist, skipping',
      });
      expect(warns).not.toHaveBeenCalled();
      listener({
        code: '00000',
        routine: 'exec_stmt_raise',
        message:
          'storage_purchases: removed 3 legacy refused row(s) before installing the closed status constraint',
      });
      expect(warns).toHaveBeenCalledTimes(1);
      expect(String(warns.mock.calls[0][0])).toMatch(/^\[schema\] storage_purchases: removed 3/);
    } finally {
      warns.mockRestore();
    }
  });

  it('applies the UA analytics schemas (progress events, attribution, ad spend)', async () => {
    // PROGRESS_EVENTS_SCHEMA (server/progress_events_db.ts),
    // ACCOUNT_ATTRIBUTION_SCHEMA (server/attribution_db.ts), and
    // AD_SPEND_SCHEMA (server/ad_spend_db.ts) back the UA instrumentation.
    // Pin them by name so none can regress to defined-but-unwired (the
    // DISCORD_SCHEMA lesson): deleting an ensureSchema line must fail here.
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS level_up_events');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS ftue_events');
    expect(applied).toContain('CREATE UNIQUE INDEX IF NOT EXISTS ftue_events_first_touch');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS account_attribution');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS ad_spend');
  });

  it('applies the $WOC Exchange schema (listings plus a dependent table)', async () => {
    // WOC_MARKET_SCHEMA (server/woc_market_db.ts) backs every marketplace
    // table. Same defined-but-unwired hazard as the DISCORD_SCHEMA lesson:
    // deleting its ensureSchema line in server/db.ts must fail here, not at
    // the first production listing.
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS woc_market_listings');
    expect(applied).toContain('CREATE TABLE IF NOT EXISTS woc_market_bids');
  });

  it('applies the compact player-metrics schema without a boot backfill', async () => {
    // Both phases, in the order server/main.ts runs them: the schema
    // transaction, then the CONCURRENTLY builds, which are now a SEPARATE call
    // made after listen (see the assertion further down).
    await ensureSchema();
    await runConcurrentIndexMigrations();
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
    // so the concurrent phase must re-disable it session-wide before taking
    // the session lock: the advisory-lock wait and the concurrent build can both
    // outlast an operator-set database- or role-level statement_timeout.
    const postCommitTimeoutOff = h.calls.findIndex(
      (sql, i) => i > commitIndex && sql === 'SET statement_timeout = 0',
    );
    expect(postCommitTimeoutOff).toBeGreaterThan(commitIndex);
    expect(postCommitTimeoutOff).toBeLessThan(sessionLock);

    // The out-of-boot half of the receipts key-shape converge: db.ts must
    // actually ISSUE the VALIDATE fragment here, never inside the boot
    // transaction, or a NOT VALID constraint the boot converge re-added stays
    // unvalidated forever, and it must run INSIDE the session advisory lock:
    // after the unlock, a concurrently booting realm would already hold the
    // lock and be running boot DDL, whose ADD COLUMN / CREATE INDEX IF NOT
    // EXISTS take ACCESS EXCLUSIVE / SHARE locks even when skipping (SHARE
    // conflicts with VALIDATE's SHARE UPDATE EXCLUSIVE), so it would block
    // MID-DDL behind the scan while holding table locks at statement_timeout
    // 0, freezing every login and save; a waiter at pg_advisory_lock holds
    // NOTHING (the pg suite proves the fragment's behavior and the waiter's
    // empty lock set; this pin proves the wiring).
    const receiptsValidate = h.calls.findIndex((sql) =>
      sql.includes('VALIDATE CONSTRAINT bank_ledger_batch_receipts_key_shape'),
    );
    expect(receiptsValidate).toBeGreaterThan(commitIndex);
    expect(receiptsValidate).toBeGreaterThan(sessionLock);
    expect(receiptsValidate).toBeLessThan(sessionUnlock);
    // And the scan is bounded TRANSACTION-LOCALLY: BEGIN, both SET LOCAL
    // bounds, VALIDATE, COMMIT, all inside the lock, so the exported helper
    // can never leave a 60s session setting on a future pooled caller.
    const validateBegin = h.calls.findIndex((sql, i) => i > sessionLock && sql === 'BEGIN');
    const validateTimeout = h.calls.findIndex(
      (sql, i) =>
        i > sessionLock &&
        sql === 'SET LOCAL statement_timeout = 60000; SET LOCAL lock_timeout = 5000',
    );
    const validateCommit = h.calls.findIndex((sql, i) => i > receiptsValidate && sql === 'COMMIT');
    expect(validateBegin).toBeGreaterThan(sessionLock);
    expect(validateBegin).toBeLessThan(validateTimeout);
    expect(validateTimeout).toBeLessThan(receiptsValidate);
    expect(validateCommit).toBeGreaterThan(receiptsValidate);
    expect(validateCommit).toBeLessThan(sessionUnlock);

    // The invalid-carcass check runs under the session lock, before the create
    // it protects; on a healthy boot (no carcass) nothing is dropped. Scoped
    // past the session lock because the boot-DDL schema strings legitimately
    // carry their own validity gates (the woc_market repair gates) inside the
    // boot transaction; a -1 (no post-lock check at all) still fails below.
    const carcassCheck = h.calls.findIndex(
      (sql, i) => i > sessionLock && sql.includes('indisvalid'),
    );
    expect(carcassCheck).toBeGreaterThan(sessionLock);
    expect(carcassCheck).toBeLessThan(concurrentIndex);
    // Healthy entries need no INVALID-carcass drops. In particular, this
    // release keeps the broad account index for mixed-version readers.
    expect(h.calls.some((sql) => sql.includes('DROP INDEX CONCURRENTLY'))).toBe(false);
    const rewardEventsIndex = h.calls.findIndex((sql) =>
      sql.includes(
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS daily_reward_events_account_day_created_id',
      ),
    );
    expect(rewardEventsIndex).toBeGreaterThan(concurrentIndex);
    expect(rewardEventsIndex).toBeLessThan(sessionUnlock);
    expect(h.calls[rewardEventsIndex]).toContain('WHERE points > 0');
    // The open-sessions partial index builds third, still inside the session
    // lock; its partial predicate is what keeps the index tiny (open sessions
    // are a sliver of the table), so pin it alongside the ordering.
    const openIdx = h.calls.findIndex((sql) =>
      sql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS play_sessions_open_character'),
    );
    expect(openIdx).toBeGreaterThan(rewardEventsIndex);
    expect(openIdx).toBeLessThan(sessionUnlock);
    expect(h.calls[openIdx]).toContain('WHERE ended_at IS NULL');
    // The client-perf worst-10s ranking index (packet 0 ruling R7) builds
    // fourth, still inside the session lock and never as boot DDL; its
    // columns must exist by then (the ALTERs ride the committed transaction).
    const worst10sIdx = h.calls.findIndex((sql) =>
      sql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS client_perf_reports_worst10s_created'),
    );
    expect(worst10sIdx).toBeGreaterThan(openIdx);
    expect(worst10sIdx).toBeLessThan(sessionUnlock);
    expect(h.calls[worst10sIdx]).toContain('worst_10s_frame_p95_ms DESC, created_at DESC');

    const broadAccountIdx = h.calls.findIndex((sql) =>
      sql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS bank_ledger_account_recent'),
    );
    const sellerSalesIdx = h.calls.findIndex((sql) =>
      sql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS woc_market_sales_seller'),
    );
    const largeMovementIdx = h.calls.findIndex((sql) =>
      sql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS bank_ledger_account_large_recent'),
    );
    expect(broadAccountIdx).toBeGreaterThan(worst10sIdx);
    expect(h.calls[broadAccountIdx]).toContain('ON bank_ledger(account_id, id DESC)');
    expect(h.calls[broadAccountIdx]).not.toContain('WHERE');
    expect(sellerSalesIdx).toBeGreaterThan(broadAccountIdx);
    expect(largeMovementIdx).toBeGreaterThan(sellerSalesIdx);
    expect(h.calls[largeMovementIdx]).toContain('ON bank_ledger(account_id, id DESC)');
    expect(h.calls[largeMovementIdx]).toContain('WHERE abs(copper_delta) >= 100000');
    expect(largeMovementIdx).toBeLessThan(sessionUnlock);
    expect(h.calls).not.toContain(BANK_LEDGER_ACCOUNT_BROAD_RETIRE_SQL);
  });

  it('keeps the CONCURRENTLY builds OUT of ensureSchema (they run after listen)', async () => {
    // The concurrent phase is its own entry point, deliberately: server/main.ts
    // runs it AFTER listen, because a build on a genuinely large table
    // serializes every realm process on the advisory lock and a slow build must
    // delay the INDEX, not the realm. If it ever slid back into ensureSchema, a
    // rolling restart would pay that stall on every realm at once again.
    await ensureSchema();
    // The literal statements, not the bare word: the boot DDL carries a SQL
    // COMMENT mentioning CONCURRENTLY (unstuck_db.ts), and matching that would
    // make this pin pass or fail for the wrong reason.
    expect(h.calls.some((sql) => sql.includes('CREATE INDEX CONCURRENTLY'))).toBe(false);
    expect(h.calls.some((sql) => sql.includes('DROP INDEX CONCURRENTLY'))).toBe(false);
    // ...nor the SESSION-level lock the concurrent phase takes (boot uses the
    // transaction-scoped pg_advisory_xact_lock).
    expect(h.calls.some((sql) => sql.includes('pg_advisory_lock($1)'))).toBe(false);
    // And the concurrent phase really does issue them, so this is not vacuous.
    h.calls.length = 0;
    await runConcurrentIndexMigrations();
    expect(h.calls.some((sql) => sql.includes('CREATE INDEX CONCURRENTLY'))).toBe(true);
    expect(h.calls.some((sql) => sql.includes('pg_advisory_lock($1)'))).toBe(true);
    expect(h.calls.some((sql) => sql.includes('pg_advisory_unlock($1)'))).toBe(true);
  });

  it('adds the phase 03 client-perf dimension columns as guarded boot DDL', async () => {
    await ensureSchema();
    const applied = h.calls.join('\n');
    expect(applied).toContain(
      "ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS crowd_bucket TEXT NOT NULL DEFAULT ''",
    );
    expect(applied).toContain(
      'ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS sim_entities INT NOT NULL DEFAULT 0',
    );
    expect(applied).toContain(
      'ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS active_views INT NOT NULL DEFAULT 0',
    );
    expect(applied).toContain(
      'ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS visible_views INT NOT NULL DEFAULT 0',
    );
    expect(applied).toContain(
      'ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS worst_10s_frame_p95_ms REAL NOT NULL DEFAULT 0',
    );
    // Phase 05 (ruling R14): the suggestion-ids array rides the same guarded
    // boot-DDL block; NOT NULL DEFAULT '{}' keeps legacy rows array-readable.
    expect(applied).toContain(
      "ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS suggestion_ids TEXT[] NOT NULL DEFAULT '{}'",
    );
    // The worst-10s index must NEVER appear as transactional boot DDL: the
    // only CREATE for it is the post-commit CONCURRENTLY build (ruling R7).
    const commitIndex = h.calls.indexOf('COMMIT');
    const bootCreates = h.calls.filter(
      (sql, i) => i < commitIndex && sql.includes('client_perf_reports_worst10s_created'),
    );
    expect(bootCreates).toEqual([]);
  });

  it('drops an INVALID metrics-index carcass before rebuilding it (a killed CONCURRENTLY build self-heals)', async () => {
    // A CREATE INDEX CONCURRENTLY killed mid-build (a deploy-watchdog restart,
    // a crash) strands an INVALID index that IF NOT EXISTS treats as existing
    // on every later boot: never rebuilt, unusable to the planner, yet
    // maintained on every play_sessions write. Boot must drop the carcass and
    // rebuild.
    h.state.invalidMetricsIndexExists = true;
    await runConcurrentIndexMigrations();
    const sessionLock = h.calls.findIndex((sql) => sql.includes('pg_advisory_lock($1)'));
    const drop = h.calls.findIndex((sql) =>
      sql.includes('DROP INDEX CONCURRENTLY IF EXISTS play_sessions_account_started_id'),
    );
    const create = h.calls.findIndex((sql) =>
      sql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS play_sessions_account_started_id'),
    );
    expect(drop).toBeGreaterThan(sessionLock);
    expect(drop).toBeLessThan(create);
    // The open-sessions entry self-heals the same way: its carcass drop runs
    // under the session lock, before its own rebuild.
    const openDrop = h.calls.findIndex((sql) =>
      sql.includes('DROP INDEX CONCURRENTLY IF EXISTS play_sessions_open_character'),
    );
    const openCreate = h.calls.findIndex((sql) =>
      sql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS play_sessions_open_character'),
    );
    expect(openDrop).toBeGreaterThan(sessionLock);
    expect(openDrop).toBeLessThan(openCreate);
  });

  it('releases the session advisory lock when a concurrent index build fails', async () => {
    // The loop has no per-entry containment (a failed build rejects), but the
    // finally must still release the session lock or every OTHER process's
    // build wedges behind it forever. main.ts catches the rejection loudly and
    // keeps serving: a realm already answering players must not be killed by an
    // index build, and every entry is idempotent so the next boot retries.
    h.state.failOpenIndexCreate = true;
    await expect(runConcurrentIndexMigrations()).rejects.toThrow('index build interrupted');
    const failedCreate = h.calls.findIndex((sql) =>
      sql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS play_sessions_open_character'),
    );
    const unlock = h.calls.findIndex((sql) => sql.includes('pg_advisory_unlock($1)'));
    expect(failedCreate).toBeGreaterThan(-1);
    expect(unlock).toBeGreaterThan(failedCreate);
    // The VALIDATE rides the same try as the builds: an index-build failure
    // skips it for the same next-boot retry, never runs it past the unlock.
    expect(
      h.calls.some((sql) => sql.includes('VALIDATE CONSTRAINT bank_ledger_batch_receipts')),
    ).toBe(false);
  });

  it('a failed receipts VALIDATE reports loudly without failing the migration run', async () => {
    // The VALIDATE has its own try/catch: a shape-violating survivor row (or a
    // deadline expiry at production cardinality) must leave the constraint
    // NOT VALID and the boot GREEN, not reject the whole post-listen phase.
    // The pg suite proves the constraint really stays NOT VALID and enforcing
    // for new writes; this pin proves the isolation wiring.
    h.state.failReceiptsValidate = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(runConcurrentIndexMigrations()).resolves.toBeUndefined();
      expect(
        errors.mock.calls.some((call) => String(call[0]).includes('key-shape VALIDATE failed')),
      ).toBe(true);
    } finally {
      errors.mockRestore();
    }
    // The failure was contained INSIDE the lock: the helper rolled its own
    // transaction back, and the finally still released the session lock, so
    // no realm stays wedged behind a failed VALIDATE and the next boot
    // retries it.
    const validateIdx = h.calls.findIndex((sql) =>
      sql.includes('VALIDATE CONSTRAINT bank_ledger_batch_receipts_key_shape'),
    );
    const rollback = h.calls.findIndex((sql, i) => i > validateIdx && sql === 'ROLLBACK');
    const unlock = h.calls.findIndex((sql) => sql.includes('pg_advisory_unlock($1)'));
    expect(validateIdx).toBeGreaterThan(-1);
    expect(rollback).toBeGreaterThan(validateIdx);
    expect(unlock).toBeGreaterThan(rollback);
  });

  it('keeps the broad account index when its partial replacement build fails', async () => {
    const migration = CONCURRENT_INDEX_MIGRATIONS.find(
      (entry) => entry.name === 'bank_ledger_account_large_recent',
    ) as { retireSql?: string };
    const syntheticRetire = 'SELECT 1 /* synthetic concurrent-index retirement */';
    migration.retireSql = syntheticRetire;
    h.state.failLargeAccountIndexCreate = true;
    try {
      await expect(runConcurrentIndexMigrations()).rejects.toThrow(
        'large account index build interrupted',
      );
      const failedCreate = h.calls.findIndex((sql) =>
        sql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS bank_ledger_account_large_recent'),
      );
      expect(failedCreate).toBeGreaterThan(-1);
      // The generic retirement arm is strictly post-create: an interrupted
      // build must never reach it.
      expect(h.calls).not.toContain(syntheticRetire);
      const unlock = h.calls.findIndex((sql) => sql.includes('pg_advisory_unlock($1)'));
      expect(unlock).toBeGreaterThan(failedCreate);
    } finally {
      delete migration.retireSql;
    }
  });

  it('runs a staged index retirement only after its replacement create succeeds', async () => {
    const migration = CONCURRENT_INDEX_MIGRATIONS.find(
      (entry) => entry.name === 'bank_ledger_account_large_recent',
    ) as { retireSql?: string };
    const syntheticRetire = 'SELECT 1 /* synthetic concurrent-index retirement */';
    migration.retireSql = syntheticRetire;
    try {
      await runConcurrentIndexMigrations();
      const create = h.calls.findIndex((sql) =>
        sql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS bank_ledger_account_large_recent'),
      );
      const retire = h.calls.indexOf(syntheticRetire);
      expect(create).toBeGreaterThan(-1);
      expect(retire).toBeGreaterThan(create);
    } finally {
      delete migration.retireSql;
    }
  });

  it('applies the play-session retention schema after the metrics schema and before the relocated exclusion view', async () => {
    // The exclusion view's association arm reads account_ip_associations, which
    // PLAY_SESSION_RETENTION_SCHEMA creates, so on a FRESH boot the view must be
    // created after the retention schema (the view moved out of the core SCHEMA
    // constant for exactly this dependency). All of it runs before COMMIT, inside
    // the one boot transaction.
    await ensureSchema();
    const metricsIdx = h.calls.findIndex((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS player_account_facts'),
    );
    const retentionIdx = h.calls.findIndex((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS play_session_totals'),
    );
    const viewIdx = h.calls.findIndex((sql) =>
      sql.includes('CREATE OR REPLACE VIEW daily_reward_excluded_accounts'),
    );
    const commitIdx = h.calls.indexOf('COMMIT');
    expect(metricsIdx).toBeGreaterThan(-1);
    expect(retentionIdx).toBeGreaterThan(metricsIdx);
    expect(viewIdx).toBeGreaterThan(retentionIdx);
    expect(commitIdx).toBeGreaterThan(viewIdx);
    // The relocated view actually carries the association arm (not a stale copy
    // that predates the fold-forward retention).
    expect(h.calls[viewIdx]).toContain('account_ip_associations');
    expect(h.calls[viewIdx]).toContain('JOIN daily_reward_ip_bans');
  });

  it('the play-session retention DDL is entirely guarded, additive, and non-destructive', async () => {
    // The retention rollup DDL is applied as one multi-statement query. Scope
    // every scan to that ONE call's SQL string: the joined call log legitimately
    // carries destructive keywords elsewhere (the metrics block's sanctioned
    // DROP CONSTRAINT reconcile), which a broad scan would trip on.
    await ensureSchema();
    const retentionDdl = h.calls.find((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS play_session_totals'),
    );
    expect(retentionDdl).toBeDefined();
    if (retentionDdl) {
      expect(retentionDdl).toContain('CREATE TABLE IF NOT EXISTS play_session_totals');
      expect(retentionDdl).toContain('CREATE TABLE IF NOT EXISTS account_ip_associations');
      // The ban-evasion probe index and the aging prune's batch-predicate index.
      expect(retentionDdl).toContain('CREATE INDEX IF NOT EXISTS account_ip_associations_ip');
      expect(retentionDdl).toContain(
        'CREATE INDEX IF NOT EXISTS account_ip_associations_last_seen',
      );
      // Both rollup tables cascade with their account (the privacy contract).
      expect(retentionDdl.split('REFERENCES accounts(id) ON DELETE CASCADE').length - 1).toBe(2);
      // Guarded-only DDL (the Discord-block negatives): case-insensitive so a
      // future lowercase (or mixed-case) destructive statement cannot slip past.
      expect(retentionDdl).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/i);
      expect(retentionDdl).not.toMatch(/CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/i);
      expect(retentionDdl).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/i);
      expect(retentionDdl).not.toMatch(/\b(?:DROP|TRUNCATE|ALTER COLUMN)\b/i);
    }
  });

  it('keeps guild moderation history for life and indexes both read and FK paths', async () => {
    await ensureSchema();
    const ddl = h.calls.find((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS guild_moderation_actions'),
    );
    expect(ddl).toBeDefined();
    expect(ddl).toContain('guild_id INT NOT NULL');
    expect(ddl).not.toMatch(/guild_id INT[^\n]*REFERENCES guilds/);
    expect(ddl).toContain('admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL');
    expect(ddl).toContain('guild_moderation_actions(realm, guild_id, created_at DESC, id DESC)');
    expect(ddl).toContain('guild_moderation_actions(admin_account_id)');
    expect(ddl).toContain('CREATE OR REPLACE FUNCTION guard_guild_folded_name()');
    expect(ddl).toContain(
      "hashtextextended('guild-name:' || NEW.realm || ':' || lower(NEW.name), 0)",
    );
    expect(ddl).toContain('BEFORE INSERT OR UPDATE OF name, realm ON guilds');
    expect(ddl).toContain("CONSTRAINT = 'guilds_realm_lower_name_guard'");
  });

  it('the concurrent-index migration list pins its entry names and order', () => {
    // Order is load-bearing and deliberate (the boot coordinator builds these
    // post-commit, in list order, under the session advisory lock); new entries
    // append, never reorder.
    expect(CONCURRENT_INDEX_MIGRATIONS.map((m) => m.name)).toEqual([
      'play_sessions_account_started_id',
      'daily_reward_events_account_day_created_id',
      'play_sessions_open_character',
      'client_perf_reports_worst10s_created',
      'play_sessions_ended_account',
      'guilds_realm_lower_name_prefix',
      'guilds_realm_created_id',
      'bank_ledger_container_recent',
      'player_reports_retention_created',
      'chat_violations_retention_created',
      'bank_ledger_account_recent',
      'woc_market_sales_seller',
      'woc_market_ops_closed_created',
      'bank_ledger_account_large_recent',
    ]);
    const guildPrefix = CONCURRENT_INDEX_MIGRATIONS.find(
      (m) => m.name === 'guilds_realm_lower_name_prefix',
    );
    expect(guildPrefix?.createSql).toContain('ON guilds(realm, lower(name) text_pattern_ops)');
    expect(guildPrefix?.checkSql).toContain("to_regclass('guilds_realm_lower_name_prefix')");
    expect(guildPrefix?.dropSql).toBe(
      'DROP INDEX CONCURRENTLY IF EXISTS guilds_realm_lower_name_prefix',
    );
    const guildCreated = CONCURRENT_INDEX_MIGRATIONS.find(
      (m) => m.name === 'guilds_realm_created_id',
    );
    expect(guildCreated?.createSql).toContain('ON guilds(realm, created_at, id)');
    expect(guildCreated?.checkSql).toContain("to_regclass('guilds_realm_created_id')");
    expect(guildCreated?.dropSql).toBe('DROP INDEX CONCURRENTLY IF EXISTS guilds_realm_created_id');
    // The guild bank activity log's reader. Two things are load-bearing and both
    // are pinned: the trailing `id DESC` (without it the "newest 50 rows of one
    // guild" read still sorts that guild's whole keep-forever history), and the
    // PARTIAL predicate (without it the index carries an entry for every
    // personal-bank row, which no reader will ever ask for, as permanent write
    // amplification on a table nothing prunes).
    const bankLedgerContainer = CONCURRENT_INDEX_MIGRATIONS.find(
      (m) => m.name === 'bank_ledger_container_recent',
    );
    expect(bankLedgerContainer?.createSql).toContain('ON bank_ledger(container_id, id DESC)');
    expect(bankLedgerContainer?.createSql).toContain("WHERE container = 'guild'");
    // `op` must NOT be an index column: a ScalarArrayOpExpr on a middle column
    // forfeits the ordering guarantee the trailing id DESC exists for.
    expect(bankLedgerContainer?.createSql).not.toContain('op');
    expect(bankLedgerContainer?.createSql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS');
    expect(bankLedgerContainer?.checkSql).toContain("to_regclass('bank_ledger_container_recent')");
    expect(bankLedgerContainer?.dropSql).toBe(
      'DROP INDEX CONCURRENTLY IF EXISTS bank_ledger_container_recent',
    );
    // The shipped broad account index remains in its original registry slot.
    // Fresh databases need its unqualified key for the account FK, while old
    // binaries need its ordered shape during the rolling-deploy window.
    const bankLedgerBroadAccount = CONCURRENT_INDEX_MIGRATIONS.find(
      (m) => m.name === 'bank_ledger_account_recent',
    );
    expect(bankLedgerBroadAccount?.createSql).toBe(BANK_LEDGER_ACCOUNT_INDEX_SQL);
    expect(bankLedgerBroadAccount?.createSql).toContain('ON bank_ledger(account_id, id DESC)');
    expect(bankLedgerBroadAccount?.createSql).not.toContain('WHERE');
    expect(bankLedgerBroadAccount?.checkSql).toBe(BANK_LEDGER_ACCOUNT_INVALID_INDEX_CHECK_SQL);
    expect(bankLedgerBroadAccount?.dropSql).toBe(BANK_LEDGER_ACCOUNT_INVALID_INDEX_DROP_SQL);
    // The toBe pins above compare against the same constants production
    // assigns, so both sides move together. Pin the load-bearing scraps as
    // LITERALS: losing `AND NOT i.indisvalid` from the carcass check would
    // let the repair path DROP a perfectly VALID index with this suite green.
    expect(bankLedgerBroadAccount?.checkSql).toContain("to_regclass('bank_ledger_account_recent')");
    expect(bankLedgerBroadAccount?.checkSql).toContain('AND NOT i.indisvalid');
    expect(bankLedgerBroadAccount?.dropSql).toContain('DROP INDEX CONCURRENTLY IF EXISTS');
    expect(bankLedgerBroadAccount?.dropSql).toContain('bank_ledger_account_recent');
    expect(bankLedgerBroadAccount?.retireSql).toBeUndefined();
    // The admin economy-oversight per-account bank_ledger reader
    // (largeGoldMovementsForAccount): equality column + trailing id DESC, the
    // same bounded-backwards-scan shape as the guild reader. It is partial on
    // the fixed production threshold so small movements add no permanent
    // write amplification to this keep-forever audit table.
    const bankLedgerLargeAccount = CONCURRENT_INDEX_MIGRATIONS.find(
      (m) => m.name === 'bank_ledger_account_large_recent',
    );
    expect(bankLedgerLargeAccount?.createSql).toContain('ON bank_ledger(account_id, id DESC)');
    expect(bankLedgerLargeAccount?.createSql).toContain('WHERE abs(copper_delta) >= 100000');
    expect(bankLedgerLargeAccount?.createSql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS');
    expect(bankLedgerLargeAccount?.checkSql).toContain(
      "to_regclass('bank_ledger_account_large_recent')",
    );
    expect(bankLedgerLargeAccount?.dropSql).toBe(
      'DROP INDEX CONCURRENTLY IF EXISTS bank_ledger_account_large_recent',
    );
    // Phase two is explicit but deliberately not armed in this release: an
    // old realm's parameterized generic plan still needs the broad ordering
    // index during rolling deploys and the rollback window. That release
    // appends the compact migration and attaches this retirement to IT, never
    // by inserting ahead of today's already-shipped partial migration.
    expect(BANK_LEDGER_ACCOUNT_BROAD_RETIRE_SQL).toBe(
      'DROP INDEX CONCURRENTLY IF EXISTS bank_ledger_account_recent',
    );
    expect(BANK_LEDGER_ACCOUNT_FK_INDEX_SQL).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS bank_ledger_account_fk',
    );
    expect(BANK_LEDGER_ACCOUNT_FK_INDEX_SQL).toContain('ON bank_ledger(account_id)');
    expect(BANK_LEDGER_ACCOUNT_FK_INDEX_SQL).not.toContain('WHERE');
    expect(BANK_LEDGER_ACCOUNT_FK_INVALID_INDEX_CHECK_SQL).toContain(
      "to_regclass('bank_ledger_account_fk')",
    );
    expect(BANK_LEDGER_ACCOUNT_FK_INVALID_INDEX_CHECK_SQL).toContain('AND NOT i.indisvalid');
    expect(BANK_LEDGER_ACCOUNT_FK_INVALID_INDEX_DROP_SQL).toBe(
      'DROP INDEX CONCURRENTLY IF EXISTS bank_ledger_account_fk',
    );
    expect(CONCURRENT_INDEX_MIGRATIONS.some((m) => m.name === 'bank_ledger_account_fk')).toBe(
      false,
    );
    expect(bankLedgerLargeAccount?.retireSql).toBeUndefined();
    // player_reports retention prune (prunePlayerReportsBatch): account-agnostic
    // age scan, so the index leads with created_at rather than either existing
    // account column, and is partial on the resolved-report predicate the
    // prune actually filters (an open report is never pruned).
    const playerReportsRetention = CONCURRENT_INDEX_MIGRATIONS.find(
      (m) => m.name === 'player_reports_retention_created',
    );
    expect(playerReportsRetention?.createSql).toContain(
      'ON player_reports(created_at ASC, id ASC)',
    );
    expect(playerReportsRetention?.createSql).toContain("WHERE status <> 'open'");
    expect(playerReportsRetention?.checkSql).toContain(
      "to_regclass('player_reports_retention_created')",
    );
    expect(playerReportsRetention?.dropSql).toBe(
      'DROP INDEX CONCURRENTLY IF EXISTS player_reports_retention_created',
    );
    // chat_violations retention prune (pruneChatViolationsBatch): same
    // account-agnostic age scan shape, not partial (no status column excludes
    // rows here).
    const chatViolationsRetention = CONCURRENT_INDEX_MIGRATIONS.find(
      (m) => m.name === 'chat_violations_retention_created',
    );
    expect(chatViolationsRetention?.createSql).toContain(
      'ON chat_violations(created_at ASC, id ASC)',
    );
    expect(chatViolationsRetention?.checkSql).toContain(
      "to_regclass('chat_violations_retention_created')",
    );
    expect(chatViolationsRetention?.dropSql).toBe(
      'DROP INDEX CONCURRENTLY IF EXISTS chat_violations_retention_created',
    );
    // The Exchange seller click-through read (salesForSeller): concurrent,
    // never boot DDL, because woc_market_sales is keep-forever and a
    // transactional build would grow into a boot-time write-blocking lock on
    // the money path's insertSale.
    const wocSalesSeller = CONCURRENT_INDEX_MIGRATIONS.find(
      (m) => m.name === 'woc_market_sales_seller',
    );
    expect(wocSalesSeller?.createSql).toContain(
      'ON woc_market_sales(realm, seller_name, created_at DESC)',
    );
    expect(wocSalesSeller?.checkSql).toContain("to_regclass('woc_market_sales_seller')");
    expect(wocSalesSeller?.dropSql).toBe(
      'DROP INDEX CONCURRENTLY IF EXISTS woc_market_sales_seller',
    );
    const wocOpsClosed = CONCURRENT_INDEX_MIGRATIONS.find(
      (m) => m.name === 'woc_market_ops_closed_created',
    );
    expect(wocOpsClosed?.createSql).toContain(
      'ON woc_market_listings(realm, resolution, created_at DESC, id DESC)',
    );
    expect(wocOpsClosed?.createSql).toContain(
      "WHERE directed_buyer_account IS NULL AND status = 'closed'",
    );
    expect(wocOpsClosed?.checkSql).toContain("to_regclass('woc_market_ops_closed_created')");
    expect(wocOpsClosed?.dropSql).toBe(
      'DROP INDEX CONCURRENTLY IF EXISTS woc_market_ops_closed_created',
    );
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
