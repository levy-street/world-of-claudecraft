// The Cheater mark's SQL boundary (server/moderation_db.ts): the two audited
// operator writes, setAccountCheaterMark and liftAccountCheaterMark.
//
// Driven against a pinned pool-client stub (the tests/moderation_db.test.ts
// idiom) rather than a live Postgres, because what is being pinned is
// TRANSACTIONAL SHAPE, not query results: that the applied budget is read back
// from the SAME statement that wrote it, that a write matching no row aborts
// before the audit INSERT, and that the two arms agree on refusing a no-op.
//
// The mark is POWER-NEUTRAL by construction (src/sim/moderation/CLAUDE.md);
// nothing here may grow a gameplay effect.

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

vi.mock('../../server/db', () => ({ pool: db }));

import { CheaterMarkRefused } from '../../server/cheater_mark_api';
import { liftAccountCheaterMark, setAccountCheaterMark } from '../../server/moderation_db';
import { CHEATER_MARK_MAX_SECONDS } from '../../src/sim/moderation';

const TARGET_ACCOUNT_ID = 41858;
const ADMIN_ACCOUNT_ID = 7;
const REASON = 'confirmed speed hacking in Thornhollow Fields';

function queryResult<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { command: '', rowCount, oid: 0, fields: [], rows };
}

/** A pinned pooled client, so BEGIN / write / audit / COMMIT are one transaction. */
function clientStub() {
  const query = vi.fn<TestQuery>().mockResolvedValue(queryResult([]));
  const release = vi.fn();
  return { query, release };
}

/** Every statement text the pinned client saw, in order. */
function statements(client: ReturnType<typeof clientStub>): string[] {
  return client.query.mock.calls.map(([text]) => text);
}

/** Did the transaction write an audit row? */
function wroteAuditRow(client: ReturnType<typeof clientStub>): boolean {
  return statements(client).some((sql) => sql.includes('account_moderation_actions'));
}

beforeEach(() => {
  db.query.mockReset();
  db.connect.mockReset();
});

describe('setAccountCheaterMark', () => {
  it('returns what the ROW said, not the value it computed for the write', async () => {
    // Load-bearing for the admin route: a second SELECT after the COMMIT can be
    // overtaken by a save-path burn, which would hand the live push the OLD
    // remaining while the API answered ok. RETURNING inside the transaction
    // cannot be raced that way.
    //
    // The stub deliberately answers a value the INPUT could never produce, so
    // `return normalizeCheaterMarkSeconds(input.seconds)` (the regression that
    // drops RETURNING and still looks right) cannot pass by coincidence.
    const IMPOSSIBLE_FROM_INPUT = 7;
    const client = clientStub();
    client.query.mockImplementation(async (text: string) =>
      text.includes('RETURNING')
        ? queryResult([{ cheater_mark_seconds: IMPOSSIBLE_FROM_INPUT }])
        : queryResult([]),
    );
    db.connect.mockResolvedValue(client as unknown as PoolClient);

    const stored = await setAccountCheaterMark({
      accountId: TARGET_ACCOUNT_ID,
      adminAccountId: ADMIN_ACCOUNT_ID,
      reason: REASON,
      seconds: 10_800,
    });

    expect(stored).toBe(IMPOSSIBLE_FROM_INPUT);
    const sql = statements(client);
    expect(sql[0]).toBe('BEGIN');
    expect(sql.at(-1)).toBe('COMMIT');
    const update = sql.find((s) => s.includes('UPDATE accounts')) ?? '';
    expect(update).toContain('RETURNING cheater_mark_seconds');
    // No standalone read alongside the transaction: the whole point is that the
    // value handed back comes from the write.
    expect(db.query).not.toHaveBeenCalled();
    expect(wroteAuditRow(client)).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it('writes the CLAMPED budget, not the number the operator typed', async () => {
    // The clamp lives here so the ceiling holds for every caller, not only for
    // requests that came through the admin route.
    const client = clientStub();
    client.query.mockImplementation(async (text: string) =>
      text.includes('RETURNING')
        ? queryResult([{ cheater_mark_seconds: CHEATER_MARK_MAX_SECONDS }])
        : queryResult([]),
    );
    db.connect.mockResolvedValue(client as unknown as PoolClient);

    const stored = await setAccountCheaterMark({
      accountId: TARGET_ACCOUNT_ID,
      adminAccountId: ADMIN_ACCOUNT_ID,
      reason: REASON,
      seconds: CHEATER_MARK_MAX_SECONDS + 10_000,
    });

    expect(stored).toBe(CHEATER_MARK_MAX_SECONDS);
    const update = statements(client).find((s) => s.includes('UPDATE accounts')) ?? '';
    const params = client.query.mock.calls.find(([text]) => text.includes('UPDATE accounts'))?.[1];
    expect(update).toContain('UPDATE accounts');
    expect(params).toEqual([TARGET_ACCOUNT_ID, CHEATER_MARK_MAX_SECONDS, REASON]);
  });

  it('refuses with no_account and writes no audit row when the UPDATE matched nothing', async () => {
    // Mirrors the lift arm: an audit row claiming an account was branded, when
    // the write touched nothing, is a false entry in the permanent record.
    // Refusing BEFORE recordModerationAction, and rolling back, is what keeps it
    // out. A mistyped or purged id really does reach here from the admin route
    // (requireAdminTarget only decodes the :id; isAdminAccount answers false for
    // an id with no row), so it is a coded refusal, never an opaque failure.
    const client = clientStub();
    client.query.mockResolvedValue(queryResult([], 0));
    db.connect.mockResolvedValue(client as unknown as PoolClient);

    await expect(
      setAccountCheaterMark({
        accountId: 999_999,
        adminAccountId: ADMIN_ACCOUNT_ID,
        reason: REASON,
        seconds: 600,
      }),
    ).rejects.toThrow(new CheaterMarkRefused('no_account'));

    expect(wroteAuditRow(client)).toBe(false);
    expect(statements(client)).toContain('ROLLBACK');
    expect(statements(client)).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('refuses on EITHER no-match signal alone, so neither arm can be dropped', async () => {
    // Per-dimension negatives. A single `rowCount: 0, rows: []` stub satisfies
    // both guard arms at once, so deleting either one would still pass it. These
    // two split them: a rowCount of 0 carrying a row, and a matched row carrying
    // no RETURNING column (a query rewritten to drop it).
    for (const result of [
      queryResult([{ cheater_mark_seconds: 600 }], 0),
      queryResult<{ cheater_mark_seconds: number }>([], 1),
    ]) {
      const client = clientStub();
      client.query.mockResolvedValue(result);
      db.connect.mockResolvedValue(client as unknown as PoolClient);

      await expect(
        setAccountCheaterMark({
          accountId: 999_999,
          adminAccountId: ADMIN_ACCOUNT_ID,
          reason: REASON,
          seconds: 600,
        }),
      ).rejects.toThrow(new CheaterMarkRefused('no_account'));
      expect(wroteAuditRow(client)).toBe(false);
    }
  });

  it('refuses a blank reason and a non-positive budget before touching the pool', async () => {
    await expect(
      setAccountCheaterMark({
        accountId: TARGET_ACCOUNT_ID,
        adminAccountId: ADMIN_ACCOUNT_ID,
        reason: '   ',
        seconds: 600,
      }),
    ).rejects.toThrow(CheaterMarkRefused);
    await expect(
      setAccountCheaterMark({
        accountId: TARGET_ACCOUNT_ID,
        adminAccountId: ADMIN_ACCOUNT_ID,
        reason: REASON,
        seconds: 0,
      }),
    ).rejects.toThrow(CheaterMarkRefused);
    expect(db.connect).not.toHaveBeenCalled();
  });
});

describe('liftAccountCheaterMark', () => {
  it('refuses an unmarked account with not_marked and writes no audit row', async () => {
    // The sibling shape the set arm above now mirrors.
    const client = clientStub();
    client.query.mockResolvedValue(queryResult([], 0));
    db.connect.mockResolvedValue(client as unknown as PoolClient);

    await expect(
      liftAccountCheaterMark({
        accountId: TARGET_ACCOUNT_ID,
        adminAccountId: ADMIN_ACCOUNT_ID,
        reason: 'appeal upheld',
      }),
    ).rejects.toThrow(new CheaterMarkRefused('not_marked'));

    expect(wroteAuditRow(client)).toBe(false);
    expect(statements(client)).toContain('ROLLBACK');
  });
});
