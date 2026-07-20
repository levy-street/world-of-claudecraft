import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn(), clientStatements: [] as string[] };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    // The batched prunes are plain pool.query calls on the default allowance. A
    // regression that re-wraps one in runWithStatementTimeout would go through
    // connect() and issue BEGIN, SET LOCAL statement_timeout, then COMMIT, so the
    // modeled client records every statement it sees (for the default-tier pin
    // below), answers the control statements itself, and forwards the real query
    // back through the pool's own query so the dbMock spy records it unshifted.
    const poolObj = {
      query: dbMock.query,
      connect: async () => ({
        query: (text: string, values?: unknown[]) => {
          dbMock.clientStatements.push(text);
          return text === 'BEGIN' ||
            text === 'COMMIT' ||
            text === 'ROLLBACK' ||
            text.startsWith('SET LOCAL')
            ? Promise.resolve({ rows: [] })
            : poolObj.query(text, values);
        },
        release() {},
      }),
    };
    return poolObj;
  }),
}));

import { pruneChatLogsBatch, pruneClientPerfReportsBatch } from '../server/db';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.clientStatements.length = 0;
});

describe('retention prune batches', () => {
  it('chat-log prune deletes one bounded oldest-first batch and reports the row count', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 3 });

    await expect(pruneChatLogsBatch(90, 500)).resolves.toBe(3);

    const [sql, params] = dbMock.query.mock.calls[0];
    // The serving index chat_logs_created leads on created_at: the age predicate and
    // the oldest-first ORDER BY both ride it, and the id subselect bounds the DELETE
    // so each call stays a short statement (an interrupted run resumes on the same
    // oldest rows).
    expect(sql).toContain('DELETE FROM chat_logs');
    expect(sql).toContain('created_at <');
    expect(sql).toContain('id IN');
    expect(sql).toContain('ORDER BY created_at');
    expect(sql).toContain('LIMIT $2');
    // The age bound must consume the BOUND days parameter: a hardcoded
    // interval with the params array left intact would red only here (in
    // production Postgres rejects a statement with an unused bind parameter,
    // stalling the nightly prune).
    expect(sql).toContain("($1 || ' days')::interval");
    expect(params).toEqual(['90', 500]);
  });

  it('client-perf prune deletes one bounded oldest-first batch and reports the row count', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 7 });

    await expect(pruneClientPerfReportsBatch(90, 500)).resolves.toBe(7);

    const [sql, params] = dbMock.query.mock.calls[0];
    // Same bounded shape on client_perf_reports: the age predicate and oldest-first
    // ORDER BY ride client_perf_reports_created, and the id subselect caps the batch.
    expect(sql).toContain('DELETE FROM client_perf_reports');
    expect(sql).toContain('created_at <');
    expect(sql).toContain('id IN');
    expect(sql).toContain('ORDER BY created_at');
    expect(sql).toContain('LIMIT $2');
    // The interval must consume the bound days parameter (see the chat-log
    // case above for why).
    expect(sql).toContain("($1 || ' days')::interval");
    expect(params).toEqual(['90', 500]);
  });

  it('client-perf prune normalizes fractional retention days up to one full day', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await pruneClientPerfReportsBatch(0.5, 100);

    // 0.5 is finite and positive so pruning runs, but the interval floor is one day:
    // Math.max(1, Math.floor(0.5)) keeps a sub-day setting from deleting today's rows.
    const [, params] = dbMock.query.mock.calls[0];
    expect(params).toEqual(['1', 100]);
  });

  it('chat-log prune normalizes fractional retention days up to one full day', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await pruneChatLogsBatch(0.5, 100);

    // 0.5 passes the keep-forever guard, but an unclamped floor would build interval
    // '0 days' and delete every chat log older than now on an operator typo.
    const [, params] = dbMock.query.mock.calls[0];
    expect(params).toEqual(['1', 100]);
  });

  it('retention of zero or below keeps rows forever without touching the database', async () => {
    // 0 is the documented keep-forever switch (the safe side); a negative value gets
    // the same treatment, and neither may issue any query at all.
    await expect(pruneChatLogsBatch(0, 500)).resolves.toBe(0);
    await expect(pruneChatLogsBatch(-1, 500)).resolves.toBe(0);
    await expect(pruneClientPerfReportsBatch(0, 500)).resolves.toBe(0);
    await expect(pruneClientPerfReportsBatch(-1, 500)).resolves.toBe(0);
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it('a zero batch size floors to LIMIT 1, never LIMIT 0, on both prunes', async () => {
    dbMock.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await pruneChatLogsBatch(90, 0);
    await pruneClientPerfReportsBatch(14, 0);

    // A LIMIT 0 batch would delete nothing forever while looking healthy; the sweep
    // normalizes its tunable too, so this floor is defense in depth.
    expect(dbMock.query.mock.calls[0][1][1]).toBe(1);
    expect(dbMock.query.mock.calls[1][1][1]).toBe(1);
  });

  it('both prunes run on the default statement timeout, never a SET LOCAL raise', async () => {
    // The behavioral twin of the tunables source pin: a re-wrap in
    // runWithStatementTimeout would surface here as a SET LOCAL statement_timeout
    // control statement on the connected client.
    dbMock.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await pruneChatLogsBatch(30, 100);
    await pruneClientPerfReportsBatch(30, 100);

    const recorded = [
      ...dbMock.clientStatements,
      ...dbMock.query.mock.calls.map(([sql]) => String(sql)),
    ];
    expect(recorded.length).toBeGreaterThan(0);
    for (const sql of recorded) {
      expect(sql.startsWith('SET LOCAL')).toBe(false);
    }
  });
});
