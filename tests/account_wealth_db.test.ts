// SQL-shape coverage for server/account_wealth_db.ts (mocked pool; statement
// shapes, parameter marshalling, and row mapping).
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<QueryResult<Record<string, unknown>>>;

const db = vi.hoisted(() => {
  const query = vi.fn<TestQuery>();
  // The statement handed to a runWithStatementTimeout callback: forwards to the
  // shared query spy (so every test's result chain keeps its order) through a
  // DISTINCT spy, so a test can tell a bounded statement from a bare pool one.
  const boundedQuery = vi.fn<TestQuery>((text, values) => query(text, values));
  const runWithStatementTimeout = vi.fn(
    (_timeoutMs: number, fn: (q: TestQuery) => Promise<unknown>) => fn(boundedQuery),
  );
  return {
    query,
    boundedQuery,
    runWithStatementTimeout,
    connect: vi.fn<() => Promise<PoolClient>>(),
  };
});

vi.mock('../server/db', () => ({
  pool: { query: db.query, connect: db.connect },
  DB_HEAVY_STATEMENT_TIMEOUT_MS: 60_000,
  runWithStatementTimeout: db.runWithStatementTimeout,
}));

import {
  ACCOUNT_WEALTH_SWEEP_LOCK_KEY,
  accountWealthBreakdown,
  aggregateEscrowTotals,
  applyEscrowTotals,
  LARGE_GOLD_MOVEMENTS_TIMEOUT_MS,
  largeGoldMovementsForAccount,
  listEscrowStateRows,
  refreshAccountPurseTotals,
  topWealthHolders,
  withAccountWealthSweepLock,
} from '../server/account_wealth_db';

const { query, boundedQuery, runWithStatementTimeout, connect } = db;

function queryResult<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { command: '', rowCount, oid: 0, fields: [], rows };
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue(queryResult([]));
  // mockClear only: the pass-through implementations must survive resets.
  boundedQuery.mockClear();
  runWithStatementTimeout.mockClear();
});

describe('refreshAccountPurseTotals', () => {
  it('upserts every purse sum, preserving escrow in the conflict arm, then zeroes orphans', async () => {
    query.mockResolvedValueOnce(queryResult([], 7)).mockResolvedValueOnce(queryResult([], 2));
    await expect(refreshAccountPurseTotals()).resolves.toEqual({
      rowsChanged: 7,
      orphansZeroed: 2,
    });
    expect(query).toHaveBeenCalledTimes(2);
    const [upsert] = query.mock.calls[0];
    expect(upsert).toMatch(/INSERT INTO account_wealth/);
    expect(upsert).toMatch(/\(c\.state->>'copper'\)::bigint/);
    expect(upsert).toMatch(/ON CONFLICT \(account_id\) DO UPDATE/);
    expect(upsert).toMatch(/\+ account_wealth\.mail_copper \+ account_wealth\.market_copper/);
    // The conflict arm is CONDITIONAL: an unchanged purse must not rewrite the
    // row (one dead tuple per account per minute, forever, otherwise).
    expect(upsert).toMatch(
      /WHERE account_wealth\.purse_copper IS DISTINCT FROM EXCLUDED\.purse_copper/,
    );
    const [zero] = query.mock.calls[1];
    expect(zero).toMatch(/purse_copper = 0/);
    expect(zero).toMatch(/NOT EXISTS \(SELECT 1 FROM characters/);
  });

  it('runs each full-scan statement on its own heavy allowance, never bare on the pool', async () => {
    await refreshAccountPurseTotals();
    // Each statement detoasts every characters.state blob; on the 15 s pool
    // default a scan that outgrows it would be cancelled and retried, doomed,
    // every tick. One transaction PER statement: the upsert's ON CONFLICT row
    // locks must release at its own commit, not be held through the second
    // full scan.
    expect(runWithStatementTimeout).toHaveBeenCalledTimes(2);
    for (const [timeoutMs] of runWithStatementTimeout.mock.calls) expect(timeoutMs).toBe(60_000);
    expect(boundedQuery).toHaveBeenCalledTimes(2);
    expect(boundedQuery.mock.calls[0][0]).toMatch(/INSERT INTO account_wealth/);
    expect(boundedQuery.mock.calls[1][0]).toMatch(/purse_copper = 0/);
  });

  it('reports a missing rowCount as zero', async () => {
    query.mockResolvedValue(queryResult([], null as unknown as number));
    await expect(refreshAccountPurseTotals()).resolves.toEqual({
      rowsChanged: 0,
      orphansZeroed: 0,
    });
  });
});

describe('listEscrowStateRows', () => {
  it('reads only the realm-scoped mail/market blobs (never the legacy bare row)', async () => {
    query.mockResolvedValueOnce(queryResult([{ key: 'mail:eastbrook', data: { mail: [] } }]));
    const rows = await listEscrowStateRows();
    expect(rows).toEqual([{ key: 'mail:eastbrook', data: { mail: [] } }]);
    expect(query.mock.calls[0][0]).toMatch(/key LIKE 'mail:%' OR key LIKE 'market:%'/);
    expect(query.mock.calls[0][0]).toMatch(/key LIKE 'mail_partition_done:%'/);
  });
});

describe('aggregateEscrowTotals', () => {
  it('aggregates inside Postgres on the heavy allowance, never shipping a blob to Node', async () => {
    // First statement under the transaction is the work_mem raise.
    query.mockResolvedValueOnce(queryResult([]));
    query.mockResolvedValueOnce(
      queryResult([
        {
          character_id: '12',
          character_name: null,
          realm: null,
          mail_copper: '750',
          market_copper: '0',
        },
        {
          character_id: null,
          character_name: 'Oldname',
          realm: 'eastbrook',
          mail_copper: '0',
          market_copper: '300',
        },
      ]),
    );
    const totals = await aggregateEscrowTotals();
    expect(totals).toEqual([
      { characterId: 12, characterName: null, realm: null, mailCopper: 750, marketCopper: 0 },
      {
        characterId: null,
        characterName: 'Oldname',
        realm: 'eastbrook',
        mailCopper: 0,
        marketCopper: 300,
      },
    ]);
    // Rides the heavy allowance like the purse scan (the expansion detoasts
    // every realm's blobs), never the bare pool default.
    expect(runWithStatementTimeout).toHaveBeenCalledTimes(1);
    expect(runWithStatementTimeout.mock.calls[0][0]).toBe(60_000);
    // Two statements under the one transaction: the per-statement work_mem
    // raise (at the stock 4 MB the production-size expansion spills ~145 MB
    // of temp file per pass; see ESCROW_AGGREGATE_WORK_MEM), then the
    // aggregate itself.
    expect(boundedQuery).toHaveBeenCalledTimes(2);
    expect(boundedQuery.mock.calls[0][0]).toBe("SET LOCAL work_mem = '256MB'");
    const sql = boundedQuery.mock.calls[1][0];
    // The core of the fix: the data column is expanded in SQL, never selected
    // whole for a Node-side parse.
    expect(sql).not.toMatch(/SELECT key, data/);
    expect(sql).toMatch(/jsonb_array_elements/);
    // Realm scoping matches the retired Node fold: realm-keyed blobs only,
    // never the bare legacy 'market' rollback row.
    expect(sql).toMatch(/key LIKE 'mail:%'/);
    expect(sql).toMatch(/key LIKE 'market:%'/);
    expect(sql).toMatch(/mail_partition_done:%/);
    expect(sql).toMatch(/:r:/);
    expect(sql).toMatch(/migrated_mail_realms/);
    // The single-detoast barrier: each blob's array datum is computed once
    // inside an OFFSET 0 subquery, then guarded; inlining the -> into both
    // the typeof and the value would detoast the 89 MB blob twice.
    expect(sql).toMatch(
      /SELECT substr\(w\.key, strpos\(w\.key, ':'\) \+ 1\) AS rest, w\.data\s+FROM world_state w WHERE w\.key LIKE 'mail:%' OFFSET 0/,
    );
    expect(sql).toMatch(/data->'mail' AS arr/);
    expect(sql).toMatch(
      /w\.data->'collections' AS arr\s+FROM world_state w WHERE w\.key LIKE 'market:%' OFFSET 0/,
    );
    // The malformed-blob guard: the lateral input is CASE-guarded on
    // jsonb_typeof so a non-array 'mail'/'collections' yields zero rows
    // instead of failing the whole sweep statement.
    expect(sql).toMatch(/CASE WHEN jsonb_typeof\(arr\) = 'array' THEN arr END/);
    // Entry guards mirror positiveCopper + the string-key requirement, with
    // the absurd-copper upper bound that keeps the bigint pipeline alive.
    // The ::numeric cast on copper is CASE-armored behind the jsonb_typeof
    // check (PostgreSQL guarantees no AND evaluation order, so a bare AND
    // chain could cast a non-number copper and abort the sweep), and that
    // guarded expression is the ONLY place the cast appears.
    expect(sql).toMatch(
      /CASE WHEN jsonb_typeof\(elem->'copper'\) = 'number'\s+THEN \(elem->>'copper'\)::numeric END AS copper_numeric/,
    );
    expect(sql.match(/\(elem->>'copper'\)::numeric/g)).toHaveLength(1);
    expect(sql).toMatch(/cn\.copper_numeric >= 1/);
    expect(sql).toMatch(/cn\.copper_numeric < 9007199254740992/);
    // The id-key line: a digit-bounding regex runs BEFORE the ::numeric cast
    // in a NESTED CASE (PostgreSQL guarantees no AND short-circuit order),
    // the bound is Number.MAX_SAFE_INTEGER like the oracle's isSafeInteger,
    // and the house-stock '' key is skipped.
    expect(sql).toMatch(/raw_key ~ '\^0\*\[0-9\]\{1,16\}\$'/);
    expect(sql).toMatch(
      /CASE WHEN raw_key ~ [\s\S]*THEN\s+CASE WHEN raw_key::numeric <= 9007199254740991/,
    );
    expect(sql).toMatch(/raw_key <> ''/);
  });
});

describe('applyEscrowTotals', () => {
  it('marshals the totals into parallel unnest arrays and zeroes stale escrow', async () => {
    query.mockResolvedValueOnce(queryResult([], 3));
    const zeroed = await applyEscrowTotals([
      { characterId: 12, characterName: null, realm: null, mailCopper: 750, marketCopper: 0 },
      {
        characterId: null,
        characterName: 'Oldname',
        realm: 'eastbrook',
        mailCopper: 0,
        marketCopper: 300,
      },
    ]);
    // The outer UPDATE's count: the stale escrow rows this pass zeroed.
    expect(zeroed).toBe(3);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/unnest\(/);
    expect(sql).toMatch(/ON CONFLICT \(account_id\) DO UPDATE/);
    expect(sql).toMatch(/mail_copper = 0/); // the stale-escrow zeroing arm
    // The upsert CTE feeds nothing downstream (the outer UPDATE reads
    // `resolved`), so it must not carry a dead RETURNING clause.
    expect(sql).not.toMatch(/RETURNING/);
    // Conditional, like the purse arm: unchanged escrow must not rewrite rows.
    expect(sql).toMatch(
      /WHERE account_wealth\.mail_copper IS DISTINCT FROM EXCLUDED\.mail_copper\s+OR account_wealth\.market_copper IS DISTINCT FROM EXCLUDED\.market_copper/,
    );
    expect(params).toEqual([
      [12, -1],
      ['', 'Oldname'],
      ['', 'eastbrook'],
      ['750', '0'],
      ['0', '300'],
    ]);
  });

  it('reports a missing rowCount as zero stale rows', async () => {
    query.mockResolvedValueOnce(queryResult([], null as unknown as number));
    await expect(applyEscrowTotals([])).resolves.toBe(0);
  });
});

describe('topWealthHolders', () => {
  it('orders by the materialised total and stamps the active-flag count', async () => {
    query.mockResolvedValueOnce(
      queryResult([
        {
          account_id: 1,
          username: 'rich',
          purse_copper: '90',
          mail_copper: '5',
          market_copper: '5',
          total_copper: '100',
          last_login: null,
          banned_at: null,
          suspended_until: null,
          updated_at: '2026-08-18T00:00:00Z',
          max_level: 60,
          active_flag_count: 1,
        },
      ]),
    );
    const rows = await topWealthHolders(100);
    expect(query.mock.calls[0][0]).toMatch(/ORDER BY w\.total_copper DESC/);
    expect(query.mock.calls[0][0]).toMatch(/account_suspicion_flags/);
    expect(query.mock.calls[0][1]).toEqual([100]);
    expect(rows).toEqual([
      {
        accountId: 1,
        username: 'rich',
        purseCopper: 90,
        mailCopper: 5,
        marketCopper: 5,
        totalCopper: 100,
        maxLevel: 60,
        lastLogin: null,
        bannedAt: null,
        suspendedUntil: null,
        activeFlagCount: 1,
        updatedAt: '2026-08-18T00:00:00Z',
      },
    ]);
  });
});

describe('accountWealthBreakdown', () => {
  it('returns null for a missing account', async () => {
    query.mockResolvedValue(queryResult([]));
    await expect(accountWealthBreakdown(404)).resolves.toBeNull();
  });

  it('maps the per-character purse rows with guild treasury context', async () => {
    query.mockImplementation(async (text: string) => {
      if (/SELECT id FROM accounts/.test(text)) return queryResult([{ id: 42 }]);
      if (/FROM account_wealth/.test(text)) {
        return queryResult([
          {
            purse_copper: '100',
            mail_copper: '10',
            market_copper: '5',
            total_copper: '115',
            updated_at: '2026-08-18T00:00:00Z',
          },
        ]);
      }
      return queryResult([
        {
          id: 12,
          name: 'Main',
          realm: 'eastbrook',
          level: 60,
          copper: '100',
          guild_id: 3,
          guild_name: 'The Rich',
          guild_treasury: '5000',
          guild_member_count: 8,
        },
        {
          id: 13,
          name: 'Alt',
          realm: 'eastbrook',
          level: 10,
          copper: '0',
          guild_id: null,
          guild_name: null,
          guild_treasury: '0',
          guild_member_count: 0,
        },
      ]);
    });
    const breakdown = await accountWealthBreakdown(42);
    expect(breakdown).toEqual({
      accountId: 42,
      purseCopper: 100,
      mailCopper: 10,
      marketCopper: 5,
      totalCopper: 115,
      updatedAt: '2026-08-18T00:00:00Z',
      characters: [
        {
          characterId: 12,
          name: 'Main',
          realm: 'eastbrook',
          level: 60,
          copper: 100,
          guildId: 3,
          guildName: 'The Rich',
          guildTreasuryCopper: 5000,
          guildMemberCount: 8,
        },
        {
          characterId: 13,
          name: 'Alt',
          realm: 'eastbrook',
          level: 10,
          copper: 0,
          guildId: null,
          guildName: null,
          guildTreasuryCopper: null,
          guildMemberCount: null,
        },
      ],
    });
  });
});

describe('largeGoldMovementsForAccount', () => {
  it('filters the bank ledger by absolute delta and bounds the page', async () => {
    query.mockResolvedValueOnce(
      queryResult([
        {
          id: '9',
          character_id: 12,
          character_name: 'Main',
          op: 'withdraw_gold',
          container: 'guild',
          copper_delta: '-200000',
          created_at: '2026-08-18T00:00:00Z',
        },
      ]),
    );
    const rows = await largeGoldMovementsForAccount(42, 25);
    const sql = query.mock.calls[0][0];
    // The threshold is a production-fixed literal, not a bind parameter. That
    // lets PostgreSQL prove the query implies the matching partial-index
    // predicate even when the driver/server selects a generic prepared plan.
    expect(sql).toMatch(/abs\(copper_delta\) >= 100000/);
    expect(sql).not.toMatch(/abs\(copper_delta\) >= \$\d/);
    expect(sql).toMatch(/LIMIT \$2/);
    expect(query.mock.calls[0][1]).toEqual([42, 25]);
    // The read depends on the CONCURRENTLY-built partial account index, which
    // a realm can serve before it exists (server/db.ts, the
    // runConcurrentIndexMigrations rule): it carries its own bound, far below
    // the 15 s pool default, so a full ledger scan fails this one read instead
    // of pinning pooled clients.
    expect(LARGE_GOLD_MOVEMENTS_TIMEOUT_MS).toBe(2_000);
    expect(LARGE_GOLD_MOVEMENTS_TIMEOUT_MS).toBeLessThan(15_000);
    expect(runWithStatementTimeout).toHaveBeenCalledTimes(1);
    expect(runWithStatementTimeout).toHaveBeenCalledWith(
      LARGE_GOLD_MOVEMENTS_TIMEOUT_MS,
      expect.any(Function),
    );
    expect(boundedQuery).toHaveBeenCalledTimes(1);
    expect(boundedQuery.mock.calls[0][0]).toMatch(/FROM bank_ledger l/);
    expect(rows).toEqual([
      {
        id: 9,
        characterId: 12,
        characterName: 'Main',
        op: 'withdraw_gold',
        container: 'guild',
        copperDelta: -200_000,
        createdAt: '2026-08-18T00:00:00Z',
      },
    ]);
  });
});

describe('withAccountWealthSweepLock', () => {
  function clientStub(acquired: boolean | 'error', opts: { failUnlock?: Error } = {}) {
    const cquery = vi.fn(async (text: string, _params?: unknown[]) => {
      if (/pg_try_advisory_lock/.test(text)) {
        if (acquired === 'error') throw new Error('lock query failed');
        return queryResult([{ acquired }]);
      }
      if (/pg_advisory_unlock/.test(text) && opts.failUnlock) throw opts.failUnlock;
      return queryResult([]);
    });
    const release = vi.fn();
    connect.mockResolvedValue({ query: cquery, release } as unknown as PoolClient);
    return { cquery, release };
  }

  it('runs the pass under the lock, unlocks on the SAME client, and pools it back', async () => {
    const { cquery, release } = clientStub(true);
    const run = vi.fn(async () => {});
    await expect(withAccountWealthSweepLock(run)).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    const statements = cquery.mock.calls.map((call) => call[0] as string);
    expect(statements.some((s) => /pg_try_advisory_lock/.test(s))).toBe(true);
    expect(statements.some((s) => /pg_advisory_unlock/.test(s))).toBe(true);
    const firstCall = cquery.mock.calls[0] as Parameters<TestQuery> | undefined;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[1]).toEqual([ACCOUNT_WEALTH_SWEEP_LOCK_KEY]);
    // A healthy pass pools the client back (no destroy argument).
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it('stands down without running when a peer holds the lock', async () => {
    const { release } = clientStub(false);
    const run = vi.fn(async () => {});
    await expect(withAccountWealthSweepLock(run)).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it('still unlocks when the pass throws, and DESTROYS a client whose lock state is unknown', async () => {
    const { cquery, release } = clientStub(true);
    await expect(
      withAccountWealthSweepLock(async () => {
        throw new Error('pass failed');
      }),
    ).rejects.toThrow('pass failed');
    expect(
      cquery.mock.calls.map((c) => c[0] as string).some((s) => /pg_advisory_unlock/.test(s)),
    ).toBe(true);
    expect(release).toHaveBeenCalledWith(undefined);

    // A failed try-lock query leaves the lock state unknown: destroy, never pool.
    const failed = clientStub('error');
    await expect(withAccountWealthSweepLock(async () => {})).rejects.toThrow('lock query failed');
    expect(failed.release).toHaveBeenCalledWith(true);
  });

  it('an unlock failure is reported, then DESTROYS the client (the pass itself still counts)', async () => {
    const boom = new Error('unlock failed');
    const { release } = clientStub(true, { failUnlock: boom });
    const onError = vi.fn();
    const run = vi.fn(async () => {});
    // The pass completed; only the cleanup misfired, so the caller still sees
    // a run (true), not a stand-down and not a throw.
    await expect(withAccountWealthSweepLock(run, onError)).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    // The header's catastrophic arm must speak: a leaked session lock on a
    // pooled connection would silently stop every future pass in every process.
    expect(onError).toHaveBeenCalledWith('unlock', boom);
    expect(release).toHaveBeenCalledWith(true);
  });

  it('defaults the unlock-failure report to console.error', async () => {
    const boom = new Error('unlock failed');
    const { release } = clientStub(true, { failUnlock: boom });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(withAccountWealthSweepLock(async () => {})).resolves.toBe(true);
      expect(consoleError).toHaveBeenCalledWith('account wealth sweep unlock failed:', boom);
      expect(release).toHaveBeenCalledWith(true);
    } finally {
      consoleError.mockRestore();
    }
  });
});
