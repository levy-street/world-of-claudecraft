import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));

// Partial-mock server/db: swap the pool for the capture mock but keep the real
// ELIGIBLE_ACCOUNT_SQL fragment the board reads embed alongside the ban filter.
vi.mock('../server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/db')>();
  return { ...actual, pool: mocks };
});
vi.mock('../server/realm', () => ({ REALM: 'test-realm' }));

import { PgDailyRewardDb, pruneDailyRewardEventsBatch } from '../server/daily_rewards_db';
import { DAILY_REWARD_EXCLUDED_ACCOUNTS_VIEW_SQL, ELIGIBLE_ACCOUNT_SQL } from '../server/db';

describe('Daily Rewards ban query enforcement', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.connect.mockReset();
  });

  it('resolves active account and IP restrictions with account-ban expiry', async () => {
    mocks.query.mockResolvedValue({
      rows: [{ reason: 'shared IP abuse', expires_at: '2026-07-16T03:00:00.000Z' }],
    });
    await expect(new PgDailyRewardDb().banForAccount(9)).resolves.toEqual({
      reason: 'shared IP abuse',
      expiresAt: '2026-07-16T03:00:00.000Z',
    });
    const sql = String(mocks.query.mock.calls[0][0]);
    expect(sql).toContain('daily_reward_bans');
    expect(sql).toContain('expires_at > now()');
    expect(sql).toContain('daily_reward_ip_bans');
    // The eligibility read runs on every status, spin, and point-recorder call:
    // the OR-free arm split is what keeps it off a nested-loop re-probed
    // subquery once the first IP ban row lands. Every IP probe is its own
    // UNION ALL arm behind the priority pick; an OR joined back into any
    // arm reintroduces the re-probe. The association arm keeps an ip-banned
    // account excluded after its raw sessions age out of retention.
    expect(sql).not.toContain('OR EXISTS');
    expect(sql).toContain('ib.ip_address = a.last_login_ip');
    expect(sql).toContain('ib.ip_address = ps.ip_address');
    expect(sql).toContain('ib.ip_address = assoc.ip_address');
    expect(sql).toContain('account_ip_associations');
    expect(sql.split('UNION ALL').length - 1).toBe(3);
    expect(sql).toContain('ORDER BY priority');
  });

  it('keeps the exclusion view as OR-free UNION arms', () => {
    // The daily_reward_excluded_accounts view gates every daily-rewards read
    // and write call site in this module; an OR reintroduced into a join arm
    // regresses them all at the first IP ban row. Assert on the imported
    // (evaluated) view constant, never on raw db.ts source text: the raw
    // source carries unrelated UNION ALLs outside the view literal that a
    // source-text count would wrongly include. Strip SQL line comments first
    // so the counts measure statement structure, not prose.
    const view = DAILY_REWARD_EXCLUDED_ACCOUNTS_VIEW_SQL.replace(/--[^\n]*/g, ' ').replace(
      /\s+/g,
      ' ',
    );
    expect(view).toContain(
      'SELECT account_id, reason FROM daily_reward_bans WHERE expires_at IS NULL OR expires_at > now()',
    );
    expect(view).toContain(
      'SELECT a.id AS account_id, ib.reason FROM accounts a JOIN daily_reward_ip_bans ib ON ib.ip_address = a.last_login_ip',
    );
    expect(view).toContain(
      'SELECT ps.account_id, ib.reason FROM play_sessions ps JOIN daily_reward_ip_bans ib ON ib.ip_address = ps.ip_address',
    );
    expect(view).toContain(
      'SELECT assoc.account_id, ib.reason FROM account_ip_associations assoc JOIN daily_reward_ip_bans ib ON ib.ip_address = assoc.ip_address',
    );
    // Four arms joined by plain UNION (the dedup is load-bearing: one account
    // with many sessions from a banned IP collapses to one row). UNION ALL
    // would also satisfy a bare keyword count, so pin its absence explicitly:
    // nothing in the view legitimately uses it.
    expect(view.match(/\bUNION\b/g)).toHaveLength(3);
    expect(view).not.toContain('UNION ALL');
    expect(view).not.toContain('OR EXISTS');
  });

  it('filters banned accounts from current leaderboard reads and pending payouts', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const db = new PgDailyRewardDb();

    await db.leaderboardTotal('2026-07-11');
    await db.pendingPayouts(20);

    expect(mocks.query.mock.calls[0][0]).toContain('NOT EXISTS');
    expect(mocks.query.mock.calls[0][0]).toContain('daily_reward_excluded_accounts');
    expect(mocks.query.mock.calls[1][0]).toContain('NOT EXISTS');
    expect(mocks.query.mock.calls[1][0]).toContain('daily_reward_excluded_accounts');
    // Pay-time recheck: a ban or suspension landing after finalization still
    // blocks the payout row.
    expect(mocks.query.mock.calls[1][0]).toContain(ELIGIBLE_ACCOUNT_SQL);
    expect(mocks.query.mock.calls[1][0]).toContain('a.id = p.account_id');
  });

  it('filters banned accounts from the board-cache snapshot read', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await new PgDailyRewardDb().leaderboardSnapshot('2026-07-11');

    const sql = String(mocks.query.mock.calls[0][0]);
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('daily_reward_excluded_accounts');
    // ELIGIBLE_ACCOUNT_SQL's full literal is pinned in
    // tests/server/leaderboard_moderation.test.ts; the constant-based
    // assertions here anchor to that pin, so never delete it as redundant.
    expect(sql).toContain(ELIGIBLE_ACCOUNT_SQL);
    expect(sql).toContain('points > 0');
    // The whole eligible positive-scorer population, no LIMIT: the cache
    // derives the board total from the snapshot's row count.
    expect(sql).not.toContain('LIMIT');
    expect(mocks.query.mock.calls[0][1]).toEqual(['2026-07-11', 'test-realm']);
  });

  it('orders the snapshot exactly like the live page read, tiebreaks included', async () => {
    // Rank parity depends on identical ordering: the cached board's ranks
    // come from the snapshot's row_number() while the ops page ranks live,
    // so a dropped or flipped updated_at tiebreak on either side silently
    // desyncs cached ranks from the page. Pin BOTH occurrences (the window
    // function and the outer ORDER BY) on both reads to one literal.
    mocks.query.mockResolvedValue({ rows: [] });
    const ORDERING = 's.points DESC, s.updated_at ASC, s.account_id ASC';
    const occurrences = (text: string) => text.split(ORDERING).length - 1;

    const db = new PgDailyRewardDb();
    await db.leaderboardSnapshot('2026-07-11');
    const snapshotSql = String(mocks.query.mock.calls[0][0]);
    expect(occurrences(snapshotSql)).toBe(2);

    await db.leaderboardPage('2026-07-11', 0, 10);
    // leaderboardPage issues the total read then the page read.
    const pageSql = String(mocks.query.mock.calls[2][0]);
    expect(occurrences(pageSql)).toBe(2);
  });

  it('filters banned accounts while selecting end-of-day winners', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });
    const release = vi.fn();
    mocks.connect.mockResolvedValue({ query, release });

    await new PgDailyRewardDb().finalizeDay('2026-07-11', 150, [1]);

    const winnerQuery = query.mock.calls.find(([sql]) =>
      String(sql).includes('FROM daily_reward_scores s'),
    );
    expect(winnerQuery?.[0]).toContain('NOT EXISTS');
    expect(winnerQuery?.[0]).toContain('daily_reward_excluded_accounts');
    // Winner selection uses the same account-eligibility predicate as the
    // displayed board, so the payout ranks match what players see.
    expect(winnerQuery?.[0]).toContain(ELIGIBLE_ACCOUNT_SQL);
    expect(winnerQuery?.[0]).toContain('a.id = s.account_id');
    expect(release).toHaveBeenCalledOnce();
  });

  it('prevents point and spin writes after a ban races an eligibility check', async () => {
    const transactionQuery = vi.fn(async (sql: string) => {
      if (String(sql).includes('SELECT finalized_at')) {
        return { rows: [{ finalized_at: null }], rowCount: 1 };
      }
      if (String(sql).includes('INSERT INTO daily_reward_spins')) return { rows: [], rowCount: 1 };
      if (String(sql).includes('INSERT INTO daily_reward_events')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    mocks.connect.mockResolvedValue({ query: transactionQuery, release: vi.fn() });
    const db = new PgDailyRewardDb();

    await db.recordSpin('2026-07-11', 9, 's20', 20);
    await db.addPoints('2026-07-11', 9, 'task', 10, 'task:1');

    const statements = transactionQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements.find((sql) => sql.includes('daily_reward_spins'))).toContain(
      'WHERE NOT EXISTS',
    );
    expect(
      statements.some(
        (sql) => sql.includes('daily_reward_events') && sql.includes('WHERE NOT EXISTS'),
      ),
    ).toBe(true);
  });
});

describe('Daily Rewards finalize read and score writes', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.connect.mockReset();
  });

  it('commits a spin claim, event, and score as one transaction', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ finalized_at: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    mocks.connect.mockResolvedValue({ query, release });

    await expect(new PgDailyRewardDb().recordSpin('2026-07-11', 9, 's20', 20)).resolves.toBe(true);

    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toContain('SELECT finalized_at');
    expect(statements[2]).toContain('INSERT INTO daily_reward_spins');
    expect(statements[3]).toContain('INSERT INTO daily_reward_events');
    expect(statements[4]).toContain('INSERT INTO daily_reward_scores');
    expect(statements[5]).toBe('COMMIT');
    expect(statements).not.toContain('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back the spin claim when the event insert is rejected', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ finalized_at: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] });
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });

    await expect(new PgDailyRewardDb().recordSpin('2026-07-11', 9, 's20', 20)).resolves.toBe(false);

    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements.some((sql) => sql.includes('INSERT INTO daily_reward_scores'))).toBe(false);
    expect(statements).not.toContain('COMMIT');
  });

  it('rejects a finalized day before creating any spin state', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ finalized_at: new Date() }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });

    await expect(new PgDailyRewardDb().recordSpin('2026-07-11', 9, 's20', 20)).resolves.toBe(false);

    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toHaveLength(3);
    expect(statements[2]).toBe('ROLLBACK');
    expect(statements.some((sql) => sql.includes('daily_reward_spins'))).toBe(false);
  });

  it('reads the finalized flag using the realm argument, not the module realm', async () => {
    mocks.query.mockResolvedValue({ rows: [{ ok: 1 }], rowCount: 1 });

    const finalized = await new PgDailyRewardDb().dayFinalized('2026-07-01', 'other-realm');

    expect(finalized).toBe(true);
    expect(mocks.query.mock.calls[0][0]).toContain('finalized_at IS NOT NULL');
    // The bound params come from the arguments, never the mocked module REALM
    // ('test-realm'), so the guard's realm and the query's realm cannot diverge.
    expect(mocks.query.mock.calls[0][1]).toEqual(['2026-07-01', 'other-realm']);
  });

  it('reports a day with no finalized row as not finalized', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(new PgDailyRewardDb().dayFinalized('2026-07-01', 'test-realm')).resolves.toBe(
      false,
    );
  });

  it('refreshes the score updated_at only when the incoming points are nonzero', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ finalized_at: null }], rowCount: 1 }) // open day lock
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // event insert proceeds
      .mockResolvedValueOnce({ rows: [] }) // score UPSERT
      .mockResolvedValue({ rows: [] }); // COMMIT
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });

    await new PgDailyRewardDb().addPoints('2026-07-11', 9, 'task', 10, 'task:1');

    const scoreUpsert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO daily_reward_scores'),
    );
    // The bump is conditioned on positive points and preserves the prior
    // timestamp otherwise; it is never an unconditional updated_at = now().
    expect(scoreUpsert?.[0]).toContain('WHEN EXCLUDED.points > 0 THEN now()');
    expect(scoreUpsert?.[0]).toContain('ELSE daily_reward_scores.updated_at');
    expect(scoreUpsert?.[0]).not.toMatch(/updated_at = now\(\)/);
  });

  it('skips the score write entirely for zero-point events', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ finalized_at: null }], rowCount: 1 }) // open day lock
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // event insert proceeds
      .mockResolvedValue({ rows: [] }); // COMMIT
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });

    const recorded = await new PgDailyRewardDb().addPoints(
      '2026-07-11',
      9,
      'online',
      0,
      'online:2026-07-11T12:00',
    );

    // The event row still lands (it is the online-minutes ledger and the
    // idempotency gate), but no daily_reward_scores statement is issued at all:
    // nothing reads a zero score row (every ranked read filters points > 0 and
    // scoreForAccount defaults to 0), so the skip removes one score-row write
    // per online player per minute.
    expect(recorded).toBe(true);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes('daily_reward_events'))).toBe(true);
    expect(statements.some((sql) => sql.includes('daily_reward_scores'))).toBe(false);
    expect(statements).toContain('COMMIT');
  });

  it('stops rewriting the prize pool once the day is finalized', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await new PgDailyRewardDb().ensureDay('2026-07-11', 150, 0.5);

    const sql = String(mocks.query.mock.calls[0][0]);
    // The conflict update is fenced on the unfinalized day: after finalizeDay
    // stamps finalized_at, a straggler previous-day event can no longer drift
    // the announced prize pool away from its finalize-time value.
    expect(sql).toContain('ON CONFLICT (day, realm) DO UPDATE');
    expect(sql).toContain('WHERE daily_reward_days.finalized_at IS NULL');
    expect(mocks.query.mock.calls[0][1]).toEqual(['2026-07-11', 'test-realm', 150, 0.5]);
  });

  it('makes finalization a conditional one-time database transition', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // already finalized
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });

    await expect(new PgDailyRewardDb().finalizeDay('2026-07-11', 150, [1])).resolves.toBe(
      'already_finalized',
    );
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements[1]).toContain('finalized_at IS NULL');
    expect(statements[1]).toContain('RETURNING 1');
    expect(statements.some((sql) => sql.includes('FROM daily_reward_scores'))).toBe(false);
  });

  it('rejects score writes after the day has finalized', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ finalized_at: new Date() }], rowCount: 1 }) // closed day
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });

    await expect(
      new PgDailyRewardDb().addPoints('2026-07-11', 9, 'task', 10, 'task:late'),
    ).resolves.toBe(false);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements[1]).toContain('FOR SHARE');
    expect(statements.some((sql) => sql.includes('daily_reward_events'))).toBe(false);
    expect(statements).toContain('ROLLBACK');
  });
});

describe('pruneDailyRewardEventsBatch', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.connect.mockReset();
  });

  it('prunes with a bounded id-batch DELETE ordered onto the oldest days', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await pruneDailyRewardEventsBatch('2025-06-11', 250);

    const sql = String(mocks.query.mock.calls[0][0]);
    expect(sql).toContain('DELETE FROM daily_reward_events');
    // day leads the UNIQUE (day, realm, account_id, idempotency_key) index,
    // so the cutoff predicate is index-served with no new DDL.
    expect(sql).toContain('day < $1');
    // The id-subquery LIMIT bounds each call to one batch, oldest days first.
    expect(sql).toContain('id IN');
    expect(sql).toContain('LIMIT $2');
    expect(sql).toContain('ORDER BY day');
  });

  it('passes the cutoff day and batch size through as the bind params', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await pruneDailyRewardEventsBatch('2025-06-11', 250);
    // The cutoff is caller-computed reward-clock day text; this module never
    // derives or reshapes it.
    expect(mocks.query.mock.calls[0][1]).toEqual(['2025-06-11', 250]);
  });

  it('deletes nothing for a malformed cutoff day', async () => {
    // day is TEXT and compares lexicographically, so a stray non-day string
    // could match every row; the guard must return before any query is issued.
    // The prefixed and suffixed forms pin BOTH regex anchors: a suffixed
    // string that slipped an unanchored guard would shift the lexicographic
    // cutoff past the intended day.
    for (const cutoff of ['2025-6-1', '', 'zzzz', 'not-a-day', '2025-06-11x', 'x2025-06-11']) {
      await expect(pruneDailyRewardEventsBatch(cutoff, 250)).resolves.toBe(0);
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('floors a non-positive batch size to one row', async () => {
    // LIMIT 0 would turn the sweep into a silent no-op that never advances.
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await pruneDailyRewardEventsBatch('2025-06-11', 0);
    expect(mocks.query.mock.calls[0][1]).toEqual(['2025-06-11', 1]);
  });

  it('never touches the score or spin tables', async () => {
    // Scores and spins are never pruned, so a payout winner stays
    // reconstructible after the raw events age out.
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await pruneDailyRewardEventsBatch('2025-06-11', 250);
    const sql = String(mocks.query.mock.calls[0][0]);
    expect(sql).not.toContain('daily_reward_scores');
    expect(sql).not.toContain('daily_reward_spins');
  });

  it('resolves to the deleted-row count', async () => {
    // The sweep iterates until a batch comes back short; the count is its
    // only progress signal.
    mocks.query.mockResolvedValue({ rows: [], rowCount: 37 });
    await expect(pruneDailyRewardEventsBatch('2025-06-11', 250)).resolves.toBe(37);
  });
});
