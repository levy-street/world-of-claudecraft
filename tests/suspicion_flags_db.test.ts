// SQL-shape coverage for server/suspicion_flags_db.ts (the moderation_db.test.ts
// idiom: the pg pool is mocked, calls are scripted, and the assertions pin the
// statement shapes, parameter marshalling, and row mapping).
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
  activeSuspicionFlagCounts,
  addSuspicionFlagNote,
  listSuspicionFlagDataset,
  SUSPICION_FLAG_LIST_MAX,
  suspicionFlagsForAccount,
  transitionSuspicionFlag,
  upsertSuspicionFlag,
} from '../server/suspicion_flags_db';

const { query, connect } = db;

function queryResult<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { command: '', rowCount, oid: 0, fields: [], rows };
}

function rawFlagRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11',
    account_id: 42,
    username: 'suspect',
    banned_at: null,
    suspended_until: null,
    source: 'bot_detector',
    kind: 'session_automation',
    severity: 'high',
    details: 'confirmed',
    status: 'new',
    copper_at_flag: '5000',
    copper_now: '25000',
    occurrences: 3,
    first_seen_at: '2026-08-01T00:00:00Z',
    last_seen_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
    related: [{ accountId: 41, username: 'sibling' }],
    ...overrides,
  };
}

beforeEach(() => {
  query.mockReset();
  connect.mockReset();
});

describe('upsertSuspicionFlag', () => {
  it('dedupes onto the active partial index and captures copper at first flag only', async () => {
    query.mockResolvedValueOnce(queryResult([]));
    await upsertSuspicionFlag({
      accountId: 42,
      source: 'bot_detector',
      kind: 'session_automation',
      severity: 'high',
      details: 'x'.repeat(2_000),
      relatedAccountIds: [41, 42, 0, -3, 41.5],
    });
    const sql = query.mock.calls[0][0];
    const params = (query.mock.calls[0][1] ?? []) as unknown[];
    expect(sql).toMatch(/INSERT INTO account_suspicion_flags/);
    expect(sql).toMatch(/ON CONFLICT \(account_id, source, kind\) WHERE status IN/);
    expect(sql).toMatch(/SELECT total_copper FROM account_wealth/);
    expect(sql).toMatch(/occurrences \+ 1/);
    expect(params[0]).toBe(42);
    // Details capped, related ids sanitized (self, non-positive, and
    // non-integer entries dropped).
    expect((params[4] as string).length).toBe(1000);
    expect(params[5]).toEqual([41]);
  });
});

describe('listSuspicionFlagDataset', () => {
  it('returns rows, per-status counts, and the truncation marker', async () => {
    const overflow = Array.from({ length: SUSPICION_FLAG_LIST_MAX + 1 }, (_, i) =>
      rawFlagRow({ id: String(i + 1) }),
    );
    query.mockResolvedValueOnce(queryResult(overflow)).mockResolvedValueOnce(
      queryResult([
        { status: 'new', n: 400 },
        { status: 'cleared', n: 200 },
      ]),
    );
    const dataset = await listSuspicionFlagDataset();
    expect(dataset.rows).toHaveLength(SUSPICION_FLAG_LIST_MAX);
    expect(dataset.truncated).toBe(true);
    expect(dataset.countsByStatus).toEqual({
      new: 400,
      under_review: 0,
      cleared: 200,
      actioned: 0,
    });
    expect(dataset.rows[0]).toMatchObject({
      id: 1,
      accountId: 42,
      copperAtFlag: 5000,
      copperNow: 25000,
      relatedAccounts: [{ accountId: 41, username: 'sibling' }],
    });
    // Active flags sort ahead of resolved history in the list read.
    expect(query.mock.calls[0][0]).toMatch(/status IN \('new', 'under_review'\)\) DESC/);
  });
});

describe('suspicionFlagsForAccount', () => {
  it('reads the full history plus every flag audit event', async () => {
    query.mockResolvedValueOnce(queryResult([rawFlagRow()])).mockResolvedValueOnce(
      queryResult([
        {
          id: 1,
          flag_id: '11',
          admin_account_id: 7,
          admin_username: 'op',
          from_status: 'new',
          to_status: 'cleared',
          note: 'fine',
          created_at: '2026-08-18T01:00:00Z',
        },
      ]),
    );
    const result = await suspicionFlagsForAccount(42);
    expect(result.flags).toHaveLength(1);
    expect(result.events).toEqual([
      {
        id: 1,
        flagId: 11,
        adminAccountId: 7,
        adminUsername: 'op',
        fromStatus: 'new',
        toStatus: 'cleared',
        note: 'fine',
        createdAt: '2026-08-18T01:00:00Z',
      },
    ]);
    expect(query.mock.calls[1][1]).toEqual([[11]]);
  });

  it('skips the event read entirely for an unflagged account', async () => {
    query.mockResolvedValueOnce(queryResult([]));
    await expect(suspicionFlagsForAccount(9)).resolves.toEqual({ flags: [], events: [] });
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('transitionSuspicionFlag', () => {
  function clientStub(
    currentStatus: string | null,
    options: { activeSibling?: boolean; failUpdateWithActiveDedupe?: boolean } = {},
  ) {
    const cquery = vi.fn<TestQuery>(async (text: string) => {
      if (/SELECT status, account_id, source, kind\s+FROM account_suspicion_flags/.test(text)) {
        return queryResult(
          currentStatus === null
            ? []
            : [
                {
                  status: currentStatus,
                  account_id: 42,
                  source: 'bot_detector',
                  kind: 'session_automation',
                },
              ],
        );
      }
      if (/SELECT id\s+FROM account_suspicion_flags/.test(text)) {
        return queryResult(options.activeSibling ? [{ id: 12 }] : []);
      }
      if (/UPDATE account_suspicion_flags/.test(text) && options.failUpdateWithActiveDedupe) {
        const err = new Error('duplicate active flag') as Error & {
          code: string;
          constraint: string;
        };
        err.code = '23505';
        err.constraint = 'suspicion_flags_active_dedupe';
        throw err;
      }
      return queryResult([]);
    });
    const release = vi.fn();
    connect.mockResolvedValue({ query: cquery, release } as unknown as PoolClient);
    return { cquery, release };
  }

  it('locks the row, validates the move, writes status + audit event atomically', async () => {
    const { cquery, release } = clientStub('new');
    query.mockResolvedValueOnce(queryResult([rawFlagRow({ status: 'under_review' })]));
    const result = await transitionSuspicionFlag({
      flagId: 11,
      adminAccountId: 7,
      to: 'under_review',
      note: 'looking',
    });
    expect(result).toMatchObject({ ok: true, flag: { status: 'under_review' } });
    const statements = cquery.mock.calls.map((call) => call[0]);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toMatch(/FOR UPDATE/);
    expect(statements[2]).toMatch(/UPDATE account_suspicion_flags SET status/);
    expect(statements[3]).toMatch(/INSERT INTO account_suspicion_flag_events/);
    expect(statements[4]).toBe('COMMIT');
    expect(cquery.mock.calls[3][1]).toEqual([11, 7, 'new', 'under_review', 'looking']);
    expect(release).toHaveBeenCalled();
  });

  it('rolls back an invalid transition without writing', async () => {
    const { cquery, release } = clientStub('cleared');
    const result = await transitionSuspicionFlag({
      flagId: 11,
      adminAccountId: 7,
      to: 'actioned',
      note: '',
    });
    expect(result).toEqual({ ok: false, error: 'invalid_transition' });
    const statements = cquery.mock.calls.map((call) => call[0]);
    expect(statements).toContain('ROLLBACK');
    expect(statements.some((s) => /UPDATE account_suspicion_flags/.test(s))).toBe(false);
    expect(release).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses to reopen resolved history when an active sibling owns the dedupe key', async () => {
    const { cquery, release } = clientStub('cleared', { activeSibling: true });
    const result = await transitionSuspicionFlag({
      flagId: 11,
      adminAccountId: 7,
      to: 'under_review',
      note: 'new detector evidence',
    });
    expect(result).toEqual({ ok: false, error: 'invalid_transition' });
    const statements = cquery.mock.calls.map((call) => call[0]);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toMatch(/FOR UPDATE/);
    expect(statements[2]).toMatch(/id <> \$4/);
    expect(statements[2]).toMatch(/status IN \('new', 'under_review'\)/);
    expect(statements).toContain('ROLLBACK');
    expect(statements.some((s) => /UPDATE account_suspicion_flags/.test(s))).toBe(false);
    expect(cquery.mock.calls[2][1]).toEqual([42, 'bot_detector', 'session_automation', 11]);
    expect(release).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('maps an active-dedupe unique violation during reopen to a workflow error', async () => {
    const { cquery, release } = clientStub('cleared', { failUpdateWithActiveDedupe: true });
    await expect(
      transitionSuspicionFlag({
        flagId: 11,
        adminAccountId: 7,
        to: 'under_review',
        note: 'raced detector evidence',
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_transition' });
    const statements = cquery.mock.calls.map((call) => call[0]);
    expect(statements).toContain('ROLLBACK');
    expect(statements.some((s) => /INSERT INTO account_suspicion_flag_events/.test(s))).toBe(false);
    expect(release).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('reports a missing flag as not_found', async () => {
    clientStub(null);
    await expect(
      transitionSuspicionFlag({ flagId: 999, adminAccountId: 7, to: 'cleared', note: '' }),
    ).resolves.toEqual({ ok: false, error: 'not_found' });
  });
});

describe('addSuspicionFlagNote / activeSuspicionFlagCounts', () => {
  it('inserts a note only when the flag exists', async () => {
    query.mockResolvedValueOnce(queryResult([{ id: 5 }]));
    await expect(
      addSuspicionFlagNote({ flagId: 11, adminAccountId: 7, note: 'checked' }),
    ).resolves.toBe(true);
    expect(query.mock.calls[0][0]).toMatch(/WHERE EXISTS/);

    query.mockResolvedValueOnce(queryResult([]));
    await expect(
      addSuspicionFlagNote({ flagId: 999, adminAccountId: 7, note: 'gone' }),
    ).resolves.toBe(false);
  });

  it('short-circuits an empty id page and maps counts per account', async () => {
    await expect(activeSuspicionFlagCounts([])).resolves.toEqual(new Map());
    expect(query).not.toHaveBeenCalled();

    query.mockResolvedValueOnce(queryResult([{ account_id: 42, n: 2 }]));
    const counts = await activeSuspicionFlagCounts([42, 43]);
    expect(counts).toEqual(new Map([[42, 2]]));
    expect(query.mock.calls[0][1]).toEqual([
      [42, 43],
      ['new', 'under_review'],
    ]);
  });
});
