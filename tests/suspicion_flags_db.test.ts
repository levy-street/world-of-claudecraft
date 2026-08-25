// SQL-shape coverage for server/suspicion_flags_db.ts (the moderation_db.test.ts
// idiom: the pg pool is mocked, calls are scripted, and the assertions pin the
// statement shapes, parameter marshalling, and row mapping).
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<QueryResult<Record<string, unknown>>>;

const db = vi.hoisted(() => {
  const query = vi.fn<TestQuery>();
  // The statement handed to a runWithStatementTimeout callback: forwards to the
  // shared query spy through a DISTINCT spy, so a test can tell a bounded
  // statement from a bare pool one.
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
  runWithStatementTimeout: db.runWithStatementTimeout,
}));

import { SUSPICION_FLAG_ACTIVE_STATUSES } from '../server/suspicion_flag_workflow';
import {
  activeSuspicionFlagCounts,
  addSuspicionFlagNote,
  listSuspicionFlagDataset,
  refreshSuspicionFlagDetails,
  SUSPICION_FLAG_LIST_MAX,
  SUSPICION_FLAG_WRITE_TIMEOUT_MS,
  suspicionFlagsForAccount,
  transitionSuspicionFlag,
  upsertSuspicionFlag,
} from '../server/suspicion_flags_db';

const { query, boundedQuery, runWithStatementTimeout, connect } = db;

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
  boundedQuery.mockClear();
  runWithStatementTimeout.mockClear();
});

describe('upsertSuspicionFlag', () => {
  it('dedupes onto the active partial index and captures copper at first flag only', async () => {
    query.mockResolvedValueOnce(queryResult([]));
    await upsertSuspicionFlag({
      accountId: 42,
      source: 'bot_detector',
      kind: 'session_automation',
      severity: 'high',
      details: 'x'.repeat(3_000),
      relatedAccountIds: [41, 42, 0, -3, 41.5],
    });
    // A single-row write rides its own short bound, never the 15 s pool default.
    expect(SUSPICION_FLAG_WRITE_TIMEOUT_MS).toBe(2_000);
    expect(runWithStatementTimeout).toHaveBeenCalledWith(2_000, expect.any(Function));
    expect(boundedQuery).toHaveBeenCalledOnce();
    const sql = query.mock.calls[0][0];
    const params = (query.mock.calls[0][1] ?? []) as unknown[];
    expect(sql).toMatch(/INSERT INTO account_suspicion_flags/);
    expect(sql).toMatch(/ON CONFLICT \(account_id, source, kind\) WHERE status IN/);
    expect(sql).toMatch(/SELECT total_copper FROM account_wealth/);
    expect(sql).toMatch(/occurrences \+ 1/);
    expect(params[0]).toBe(42);
    // Details capped, related ids sanitized (self, non-positive, and
    // non-integer entries dropped).
    expect((params[4] as string).length).toBe(2000);
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

describe('refreshSuspicionFlagDetails', () => {
  it('rewrites the ACTIVE flag details only, never counting an occurrence', async () => {
    query.mockResolvedValueOnce(queryResult([], 1));
    await expect(
      refreshSuspicionFlagDetails({
        accountId: 42,
        source: 'bot_detector',
        kind: 'session_automation',
        details: 'x'.repeat(2500),
      }),
    ).resolves.toBe(true);
    expect(runWithStatementTimeout).toHaveBeenCalledWith(2_000, expect.any(Function));
    expect(boundedQuery).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
    const sql = query.mock.calls[0][0];
    const params = (query.mock.calls[0][1] ?? []) as unknown[];
    expect(sql).toMatch(/UPDATE account_suspicion_flags/);
    expect(sql).toMatch(/SET details = \$4, last_seen_at = now\(\), updated_at = now\(\)/);
    expect(sql).toMatch(/status IN \('new', 'under_review'\)/);
    expect(sql).not.toMatch(/occurrences/);
    expect(sql).not.toMatch(/INSERT/);
    expect(params.slice(0, 3)).toEqual([42, 'bot_detector', 'session_automation']);
    expect((params[3] as string).length).toBe(2000);
  });

  it('resolves false when no active flag was there to refresh (cleared by an admin)', async () => {
    query.mockResolvedValueOnce(queryResult([], 0));
    await expect(
      refreshSuspicionFlagDetails({
        accountId: 42,
        source: 'bot_detector',
        kind: 'session_automation',
        details: 'x',
      }),
    ).resolves.toBe(false);
  });
});

describe('transitionSuspicionFlag', () => {
  function clientStub(
    currentStatus: string | null,
    activeSiblingId: number | null = null,
    updateError: unknown = null,
  ) {
    const cquery = vi.fn<TestQuery>(async (text: string) => {
      if (updateError && /UPDATE account_suspicion_flags SET status/.test(text)) throw updateError;
      if (/SELECT account_id, source, kind, status FROM account_suspicion_flags/.test(text)) {
        return queryResult(
          currentStatus === null
            ? []
            : [
                {
                  account_id: 42,
                  source: 'bot_detector',
                  kind: 'session_automation',
                  status: currentStatus,
                },
              ],
        );
      }
      if (/AND id <> \$4/.test(text)) {
        return queryResult(activeSiblingId === null ? [] : [{ id: activeSiblingId }]);
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
    // Active to active is the one active row the index allows: no sibling read.
    expect(statements[2]).toMatch(/UPDATE account_suspicion_flags SET status/);
    expect(statements[3]).toMatch(/INSERT INTO account_suspicion_flag_events/);
    expect(statements[4]).toBe('COMMIT');
    expect(cquery.mock.calls[3][1]).toEqual([11, 7, 'new', 'under_review', 'looking']);
    expect(release).toHaveBeenCalled();
  });

  it('locks any active sibling before a reopen, on the literal active-status list', async () => {
    const { cquery } = clientStub('cleared');
    query.mockResolvedValueOnce(queryResult([rawFlagRow({ status: 'under_review' })]));
    await transitionSuspicionFlag({ flagId: 11, adminAccountId: 7, to: 'under_review', note: '' });
    const statements = cquery.mock.calls.map((call) => call[0]);
    expect(statements[2]).toMatch(/SELECT id FROM account_suspicion_flags/);
    expect(statements[2]).toMatch(/account_id = \$1 AND source = \$2 AND kind = \$3 AND id <> \$4/);
    // The literal keeps the partial dedupe index usable on a generic plan; pin
    // it against the workflow vocabulary so the two cannot drift.
    expect(statements[2]).toMatch(/status IN \('new', 'under_review'\)/);
    expect([...SUSPICION_FLAG_ACTIVE_STATUSES]).toEqual(['new', 'under_review']);
    expect(statements[2]).toMatch(/LIMIT 1\s+FOR UPDATE/);
    expect(cquery.mock.calls[2][1]).toEqual([42, 'bot_detector', 'session_automation', 11]);
    expect(statements[3]).toMatch(/UPDATE account_suspicion_flags SET status/);
  });

  it('skips the sibling lock when moving to a terminal status', async () => {
    for (const to of ['cleared', 'actioned'] as const) {
      const { cquery } = clientStub('new');
      query.mockResolvedValueOnce(queryResult([rawFlagRow({ status: to })]));
      await transitionSuspicionFlag({ flagId: 11, adminAccountId: 7, to, note: '' });
      const statements = cquery.mock.calls.map((call) => call[0]);
      expect(
        statements.some((s) => /AND id <> \$4/.test(s)),
        to,
      ).toBe(false);
      expect(statements[2], to).toMatch(/UPDATE account_suspicion_flags SET status/);
    }
  });

  it('refuses a reopen that would collide with an active sibling, naming the cause', async () => {
    const { cquery, release } = clientStub('cleared', 12);
    const result = await transitionSuspicionFlag({
      flagId: 11,
      adminAccountId: 7,
      to: 'under_review',
      note: 'second look',
    });
    expect(result).toEqual({ ok: false, error: 'active_flag_exists' });
    const statements = cquery.mock.calls.map((call) => call[0]);
    expect(statements).toContain('ROLLBACK');
    expect(statements.some((s) => /UPDATE account_suspicion_flags/.test(s))).toBe(false);
    expect(statements.some((s) => /INSERT INTO account_suspicion_flag_events/.test(s))).toBe(false);
    expect(release).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('maps the unique violation of a sibling the read could not see to the same refusal', async () => {
    // A sibling inserted or reopened by an uncommitted transaction is invisible
    // to the sibling read; the partial index rejects the UPDATE instead.
    const violation = Object.assign(new Error('duplicate key'), { code: '23505' });
    const { cquery, release } = clientStub('cleared', null, violation);
    const result = await transitionSuspicionFlag({
      flagId: 11,
      adminAccountId: 7,
      to: 'under_review',
      note: '',
    });
    expect(result).toEqual({ ok: false, error: 'active_flag_exists' });
    const statements = cquery.mock.calls.map((call) => call[0]);
    expect(statements[statements.length - 1]).toBe('ROLLBACK');
    expect(statements.some((s) => /INSERT INTO account_suspicion_flag_events/.test(s))).toBe(false);
    expect(release).toHaveBeenCalled();
    // The FLAG_ROW_SQL re-read never runs after a rollback.
    expect(query).not.toHaveBeenCalled();
  });

  it('rethrows any other UPDATE failure after rolling back', async () => {
    const { cquery, release } = clientStub('new', null, new Error('connection reset'));
    await expect(
      transitionSuspicionFlag({ flagId: 11, adminAccountId: 7, to: 'cleared', note: '' }),
    ).rejects.toThrow('connection reset');
    expect(cquery.mock.calls.map((call) => call[0])).toContain('ROLLBACK');
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
