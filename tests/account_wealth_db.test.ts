// SQL-shape coverage for server/account_wealth_db.ts (mocked pool; statement
// shapes, parameter marshalling, and row mapping).
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<QueryResult<Record<string, unknown>>>;

const db = vi.hoisted(() => ({
  query: vi.fn<TestQuery>(),
  connect: vi.fn<() => Promise<PoolClient>>(),
}));

vi.mock('../server/db', () => ({
  pool: db,
}));

import {
  ACCOUNT_WEALTH_SWEEP_LOCK_KEY,
  accountWealthBreakdown,
  applyEscrowTotals,
  largeGoldMovementsForAccount,
  listEscrowStateRows,
  refreshAccountPurseTotals,
  topWealthHolders,
  withAccountWealthSweepLock,
} from '../server/account_wealth_db';

const { query, connect } = db;

function queryResult<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { command: '', rowCount, oid: 0, fields: [], rows };
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue(queryResult([]));
});

describe('refreshAccountPurseTotals', () => {
  it('upserts every purse sum, preserving escrow in the conflict arm, then zeroes orphans', async () => {
    await refreshAccountPurseTotals();
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
});

describe('listEscrowStateRows', () => {
  it('reads only the realm-scoped mail/market blobs (never the legacy bare row)', async () => {
    query.mockResolvedValueOnce(queryResult([{ key: 'mail:eastbrook', data: { mail: [] } }]));
    const rows = await listEscrowStateRows();
    expect(rows).toEqual([{ key: 'mail:eastbrook', data: { mail: [] } }]);
    expect(query.mock.calls[0][0]).toMatch(/key LIKE 'mail:%' OR key LIKE 'market:%'/);
  });
});

describe('applyEscrowTotals', () => {
  it('marshals the totals into parallel unnest arrays and zeroes stale escrow', async () => {
    await applyEscrowTotals([
      { characterId: 12, characterName: null, realm: null, mailCopper: 750, marketCopper: 0 },
      {
        characterId: null,
        characterName: 'Oldname',
        realm: 'eastbrook',
        mailCopper: 0,
        marketCopper: 300,
      },
    ]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/unnest\(/);
    expect(sql).toMatch(/ON CONFLICT \(account_id\) DO UPDATE/);
    expect(sql).toMatch(/mail_copper = 0/); // the stale-escrow zeroing arm
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
    const rows = await largeGoldMovementsForAccount(42, 100_000, 25);
    expect(query.mock.calls[0][0]).toMatch(/abs\(l\.copper_delta\) >= \$2/);
    expect(query.mock.calls[0][1]).toEqual([42, 100_000, 25]);
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
  function clientStub(acquired: boolean | 'error') {
    const cquery = vi.fn(async (text: string, _values?: unknown[]) => {
      if (/pg_try_advisory_lock/.test(text)) {
        if (acquired === 'error') throw new Error('lock query failed');
        return queryResult([{ acquired }]);
      }
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
    expect(cquery.mock.calls[0][1]).toEqual([ACCOUNT_WEALTH_SWEEP_LOCK_KEY]);
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
});
