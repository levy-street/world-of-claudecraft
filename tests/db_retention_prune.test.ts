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

import { EMAIL_CHANGE_TTL_HOURS, PASSWORD_RESET_TTL_HOURS } from '../server/account';
import {
  pruneChatLogsBatch,
  pruneClientPerfReportsBatch,
  pruneEmailChangeRequestsBatch,
  pruneEmailLogBatch,
  prunePasswordResetRequestsBatch,
} from '../server/db';

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

  it('password-reset-request prune deletes one bounded oldest-first batch and reports the row count', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 4 });

    await expect(prunePasswordResetRequestsBatch(30, 500)).resolves.toBe(4);

    const [sql, params] = dbMock.query.mock.calls[0];
    // Same bounded shape: the age predicate rides the dedicated created_at
    // index, oldest-first, id-subselect bounded. This is the retention story
    // the misleading "keeps the table from accumulating dead rows" comment on
    // the per-account supersede DELETE never actually provided: that DELETE
    // only removes duplicate PENDING rows, never a consumed or abandoned one.
    expect(sql).toContain('DELETE FROM password_reset_requests');
    expect(sql).toContain('created_at <');
    expect(sql).toContain('id IN');
    expect(sql).toContain('ORDER BY created_at');
    expect(sql).toContain('LIMIT $2');
    expect(sql).toContain("($1 || ' days')::interval");
    expect(params).toEqual(['30', 500]);
  });

  it('email-change-request prune deletes one bounded oldest-first batch and reports the row count', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 5 });

    await expect(pruneEmailChangeRequestsBatch(30, 500)).resolves.toBe(5);

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('DELETE FROM email_change_requests');
    expect(sql).toContain('created_at <');
    expect(sql).toContain('id IN');
    expect(sql).toContain('ORDER BY created_at');
    expect(sql).toContain('LIMIT $2');
    expect(sql).toContain("($1 || ' days')::interval");
    expect(params).toEqual(['30', 500]);
  });

  it('email-log prune deletes one bounded oldest-first batch on sent_at and reports the row count', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 6 });

    await expect(pruneEmailLogBatch(90, 500)).resolves.toBe(6);

    const [sql, params] = dbMock.query.mock.calls[0];
    // email_log ages on sent_at, not created_at: it has no created_at column.
    expect(sql).toContain('DELETE FROM email_log');
    expect(sql).toContain('sent_at <');
    expect(sql).toContain('id IN');
    expect(sql).toContain('ORDER BY sent_at');
    expect(sql).toContain('LIMIT $2');
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
    await expect(prunePasswordResetRequestsBatch(0, 500)).resolves.toBe(0);
    await expect(prunePasswordResetRequestsBatch(-1, 500)).resolves.toBe(0);
    await expect(pruneEmailChangeRequestsBatch(0, 500)).resolves.toBe(0);
    await expect(pruneEmailChangeRequestsBatch(-1, 500)).resolves.toBe(0);
    await expect(pruneEmailLogBatch(0, 500)).resolves.toBe(0);
    await expect(pruneEmailLogBatch(-1, 500)).resolves.toBe(0);
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it('a zero batch size floors to LIMIT 1, never LIMIT 0, on every prune', async () => {
    dbMock.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await pruneChatLogsBatch(90, 0);
    await pruneClientPerfReportsBatch(14, 0);
    await prunePasswordResetRequestsBatch(30, 0);
    await pruneEmailChangeRequestsBatch(30, 0);
    await pruneEmailLogBatch(90, 0);

    // A LIMIT 0 batch would delete nothing forever while looking healthy; the sweep
    // normalizes its tunable too, so this floor is defense in depth.
    for (let i = 0; i < 5; i++) {
      expect(dbMock.query.mock.calls[i][1][1]).toBe(1);
    }
  });

  it('every prune runs on the default statement timeout, never a SET LOCAL raise', async () => {
    // The behavioral twin of the tunables source pin: a re-wrap in
    // runWithStatementTimeout would surface here as a SET LOCAL statement_timeout
    // control statement on the connected client.
    dbMock.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await pruneChatLogsBatch(30, 100);
    await pruneClientPerfReportsBatch(30, 100);
    await prunePasswordResetRequestsBatch(30, 100);
    await pruneEmailChangeRequestsBatch(30, 100);
    await pruneEmailLogBatch(90, 100);

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

// The token TTLs and the prune floor are ONE coupled contract, owned by two
// files that never import each other. A pending verification token must EXPIRE
// before the earliest instant a prune can legally reach its row: past that
// point the sweep deletes a row whose emailed link is still live, and the
// player's click dies as "invalid or expired" through no fault of their own.
// The earliest legal horizon is 24 hours, because every prune clamps its
// retention with Math.max(1, Math.floor(retentionDays)) (server/db.ts) and rows
// only become prunable at created_at < now() - that interval, so even an
// operator's sub-day setting still keeps a full day.
describe('token TTLs versus the earliest legal prune horizon', () => {
  // Read the horizon out of the REAL prune instead of restating one day: drive
  // the smallest retention that still prunes at all (anything above the
  // keep-forever 0) and take the interval the clamp actually built.
  async function earliestPruneHorizonHours(
    prune: (retentionDays: number, batchSize: number) => Promise<number>,
  ): Promise<number> {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await prune(0.5, 100);
    const [, params] = dbMock.query.mock.calls[0];
    const hours = Number(params[0]) * 24;
    expect(hours).toBeGreaterThan(0);
    return hours;
  }

  it('the email-change TTL expires within the prune horizon', async () => {
    const horizonHours = await earliestPruneHorizonHours(pruneEmailChangeRequestsBatch);
    // EXACTLY at the boundary today (a 24 h TTL against a 24 h horizon), and
    // equality is the accepted edge: the token expires at or before the
    // earliest prunable instant, so no still-valid row can be deleted. Raising
    // EMAIL_CHANGE_TTL_HOURS past the floor (or dropping the floor below the
    // TTL) reds here instead of silently shipping a sweep that eats live links.
    expect(EMAIL_CHANGE_TTL_HOURS).toBeLessThanOrEqual(horizonHours);
  });

  it('the password-reset TTL expires within the prune horizon', async () => {
    const horizonHours = await earliestPruneHorizonHours(prunePasswordResetRequestsBatch);
    // The reset link is deliberately much shorter than the horizon, so this arm
    // carries margin rather than sitting on the edge; the pin exists so a
    // future lengthening (a "give users a day to click it" change) has to
    // notice the prune floor.
    expect(PASSWORD_RESET_TTL_HOURS).toBeLessThanOrEqual(horizonHours);
  });
});
