// Board integrity: every player-derived public board delists banned and
// currently-suspended accounts, and a moderation action busts the board
// caches so delisting is immediate.
//
// The exclusion lives in SQL (one shared fragment, db.ts ELIGIBLE_ACCOUNT_SQL,
// embedded VERBATIM by every ranked board query), so this file pins the
// MECHANISM: the fragment literal itself (banned ABSENT via banned_at IS
// NULL; clean PRESENT via the NULL arms; an EXPIRED suspension PRESENT via
// suspended_until <= now()), and then, per board and per arm, that the query
// text a read hands to pool.query embeds that exact literal with the right
// account join. Postgres enforces the row-level semantics; the recommended
// db-backed manual check (seed, ban via the admin route, curl the board)
// drives it live. The JS-observable arms are driven behaviorally below: the
// moderateAccount bust hook (success fires, failure does not) and the
// main.ts wiring that nulls every cached board scope. The deeds aggregation
// itself is behaviorally covered in tests/server/deeds_board.test.ts.
//
// The developer board (github_contributors.ts topContributors) is DELIBERATELY
// exempt: it ranks GitHub identities with no game-account linkage.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_board_moderation';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolClient, QueryResult } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PgDailyRewardDb } from '../../server/daily_rewards_db';
import {
  deedsBoardRanked,
  ELIGIBLE_ACCOUNT_SQL,
  lifetimeXpRankForCharacter,
  lifetimeXpStanding,
  pool,
  topArenaRatings,
  topGuilds,
  topLifetimeXp,
} from '../../server/db';
import { moderateAccount, setOnAccountModerated } from '../../server/moderation_db';

// The one eligibility predicate, pinned as a LITERAL (never the exported
// constant compared to itself): a banned account (banned_at set) fails the
// first arm; a currently-suspended one fails the second; a clean account and
// one whose suspension has EXPIRED (suspended_until <= now()) pass.
const ELIGIBLE_LITERAL =
  'a.banned_at IS NULL AND (a.suspended_until IS NULL OR a.suspended_until <= now())';

function emptyResult(): QueryResult {
  return { command: '', rowCount: 0, oid: 0, fields: [], rows: [] };
}

/** Spy pool.query, run the read, and return every captured SQL text. */
async function capturedSql(run: () => Promise<unknown>): Promise<string[]> {
  const spy = vi
    .spyOn(pool, 'query')
    .mockImplementation(() => Promise.resolve(emptyResult()) as never);
  // The heavy board reads (topArenaRatings / topLifetimeXp / topGuilds /
  // deedsBoardRanked) run inside runWithStatementTimeout (server/db.ts): a
  // dedicated pooled client issues BEGIN, SET LOCAL statement_timeout, the real
  // read(s), then COMMIT. Route the control statements past the spy and forward the
  // real reads through the spied pool.query, so the captured list is exactly the
  // real reads (in order). Non-transacted reads (lifetimeXpStanding, ...) still hit
  // pool.query directly and are unaffected.
  const connectSpy = vi.spyOn(pool, 'connect').mockImplementation(
    async () =>
      ({
        query: (text: string, values?: unknown[]) =>
          text === 'BEGIN' ||
          text === 'COMMIT' ||
          text === 'ROLLBACK' ||
          text.startsWith('SET LOCAL')
            ? Promise.resolve(emptyResult())
            : (pool.query as (t: string, v?: unknown[]) => Promise<unknown>)(text, values),
        release() {},
      }) as unknown as PoolClient,
  );
  try {
    await run();
    return spy.mock.calls.map((call) => String(call[0]));
  } finally {
    connectSpy.mockRestore();
    spy.mockRestore();
  }
}

/** Assert exactly one query was captured and it embeds the fragment + join. */
async function expectExcludes(run: () => Promise<unknown>, joinText: string): Promise<void> {
  const sql = await capturedSql(run);
  expect(sql).toHaveLength(1);
  expect(sql[0]).toContain(ELIGIBLE_LITERAL);
  expect(sql[0]).toContain(joinText);
}

afterEach(() => {
  setOnAccountModerated(null);
  vi.restoreAllMocks();
});

describe('the shared eligibility fragment', () => {
  it('is exactly the pinned literal', () => {
    expect(ELIGIBLE_ACCOUNT_SQL).toBe(ELIGIBLE_LITERAL);
  });
});

describe('every ranked board query embeds the fragment', () => {
  it('players, realm arm', async () => {
    await expectExcludes(() => topLifetimeXp(10), 'a.id = characters.account_id');
  });

  it('players, global arm', async () => {
    await expectExcludes(() => topLifetimeXp(10, { global: true }), 'a.id = characters.account_id');
  });

  it('arena', async () => {
    await expectExcludes(() => topArenaRatings(10), 'a.id = characters.account_id');
  });

  it('guilds, realm arm (member-level: a banned member stops inflating the sum)', async () => {
    await expectExcludes(() => topGuilds(10), 'a.id = c.account_id');
  });

  it('guilds, global arm', async () => {
    await expectExcludes(() => topGuilds(10, { global: true }), 'a.id = c.account_id');
  });

  it('deeds (the Renown roll-up aggregation embeds the fragment at BOTH eligibility sites)', async () => {
    // deedsBoardRanked issues two queries: the ranked aggregation and a cheap
    // unknown-deed side read. The aggregation carries the fragment at BOTH the
    // per-deed and per-character roll-up joins; the side read has no accounts join.
    const sql = await capturedSql(() => deedsBoardRanked(['d50'], [50], 50));
    const agg = sql.find((s) => s.includes(ELIGIBLE_LITERAL));
    if (!agg) throw new Error('deedsBoardRanked aggregation query was not captured');
    // Lands TWICE, once per eligibility site (per-deed earliest earn, per-character sum).
    expect(agg.split(ELIGIBLE_LITERAL).length).toBe(3);
    expect(agg).toContain('a.id = cd.account_id');
    // The roll-up reads only rows whose character still exists (belt over the
    // ON DELETE CASCADE braces).
    expect(agg).toContain('JOIN characters c ON c.id = cd.character_id');
    // The unknown-deed side read hunts removed content, never gates eligibility.
    const side = sql.find((s) => !s.includes(ELIGIBLE_LITERAL));
    expect(side).toContain('deed_id <> ALL($1::text[])');
  });

  it('realm-rank reads gate both count arms; the public read ALSO gates its own subquery', async () => {
    // Both count `ahead` and `total` over the ELIGIBLE realm, so the fragment
    // lands at least twice per query (once per count arm) or a delisted higher-XP
    // account still inflates rank and total though it appears on no board.
    // lifetimeXpStanding is the BEARER-authenticated self-view, so its `own`
    // subquery stays UNGATED (an owner sees their own rank even when delisted):
    // exactly two occurrences. lifetimeXpRankForCharacter feeds UNAUTHENTICATED
    // public surfaces, so its `own` subquery is ALSO gated (a banned account shows
    // no public rank at all): three occurrences, plus the eligibility flag it
    // returns null on.
    const occurrences = (haystack: string, needle: string): number =>
      haystack.split(needle).length - 1;
    const standingSql = await capturedSql(() => lifetimeXpStanding(1, 42));
    expect(standingSql).toHaveLength(1);
    expect(occurrences(standingSql[0], ELIGIBLE_LITERAL)).toBe(2);
    expect(occurrences(standingSql[0], 'a.id = characters.account_id')).toBe(2);
    expect(standingSql[0]).not.toContain('AS eligible');
    const publicSql = await capturedSql(() => lifetimeXpRankForCharacter(42));
    expect(publicSql).toHaveLength(1);
    expect(occurrences(publicSql[0], ELIGIBLE_LITERAL)).toBe(3);
    expect(occurrences(publicSql[0], 'a.id = characters.account_id')).toBe(3);
    expect(publicSql[0]).toContain('AS eligible');
  });

  it('the public rank read resolves null for a delisted subject and the rank for an eligible one', async () => {
    // The SQL pins above prove the eligible flag is SELECTed; this drives the
    // JS gate on it, so deleting the `if (!eligible) return null` arm reds here.
    const rankRow = (eligible: boolean): QueryResult => ({
      ...emptyResult(),
      rowCount: 1,
      rows: [{ ahead: 5, total: 10, eligible }],
    });
    const spy = vi.spyOn(pool, 'query');
    spy.mockImplementation(() => Promise.resolve(rankRow(false)) as never);
    await expect(lifetimeXpRankForCharacter(42)).resolves.toBeNull();
    spy.mockImplementation(() => Promise.resolve(rankRow(true)) as never);
    await expect(lifetimeXpRankForCharacter(42)).resolves.toEqual({ rank: 6, total: 10 });
  });

  it('daily rewards: all five ranked reads agree on one population', async () => {
    const db = new PgDailyRewardDb();
    const day = '2026-07-08';
    for (const read of [
      () => db.leaderboard(day, 1, 10),
      () => db.leaderboardRowForAccount(day, 1),
      () => db.leaderboardTotal(day),
      () => db.rankForAccount(day, 1),
    ]) {
      const sql = await capturedSql(read);
      expect(sql).toHaveLength(1);
      expect(sql[0]).toContain(ELIGIBLE_LITERAL);
      expect(sql[0]).toContain('a.id = s.account_id');
    }
    // leaderboardPage issues the total read then the page read; both embed it.
    const pageSql = await capturedSql(() => db.leaderboardPage(day, 0, 10));
    expect(pageSql).toHaveLength(2);
    for (const text of pageSql) {
      expect(text).toContain(ELIGIBLE_LITERAL);
      expect(text).toContain('a.id = s.account_id');
    }
  });
});

// ---------------------------------------------------------------------------
// The cache-bust hook: moderateAccount fires it after a successful commit of
// ANY action kind and never on failure, so a ban delists (and an unban
// relists) without waiting out a board TTL.
// ---------------------------------------------------------------------------

function clientStub(overrides?: { failOn?: RegExp; unsuspendRowCount?: number }): PoolClient {
  const query = vi.fn((text: string) => {
    if (overrides?.failOn?.test(text)) return Promise.reject(new Error('boom'));
    const rowCount = /suspended_until > now\(\)/.test(text)
      ? (overrides?.unsuspendRowCount ?? 1)
      : 1;
    return Promise.resolve({ command: '', rowCount, oid: 0, fields: [], rows: [] });
  });
  return { query, release: vi.fn() } as unknown as PoolClient;
}

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe('the moderation bust hook', () => {
  it('fires exactly once per successful action, for every action kind', async () => {
    const hook = vi.fn();
    setOnAccountModerated(hook);
    vi.spyOn(pool, 'connect').mockImplementation(() => Promise.resolve(clientStub()) as never);
    const base = { accountId: 7, adminAccountId: 1, reason: 'test' };
    // Asserted after EACH action, so a kind that never fires and a kind that
    // double-fires both redden (a running 4-total could mask one with the other).
    await moderateAccount({ ...base, action: 'ban' });
    expect(hook).toHaveBeenCalledTimes(1);
    await moderateAccount({ ...base, action: 'unban' });
    expect(hook).toHaveBeenCalledTimes(2);
    await moderateAccount({ ...base, action: 'suspend', expiresAt: FUTURE });
    expect(hook).toHaveBeenCalledTimes(3);
    await moderateAccount({ ...base, action: 'unsuspend' });
    expect(hook).toHaveBeenCalledTimes(4);
  });

  it('does not fire when unsuspend finds no standing suspension', async () => {
    const hook = vi.fn();
    setOnAccountModerated(hook);
    vi.spyOn(pool, 'connect').mockImplementation(
      () => Promise.resolve(clientStub({ unsuspendRowCount: 0 })) as never,
    );
    await expect(
      moderateAccount({ accountId: 7, adminAccountId: 1, action: 'unsuspend', reason: 'test' }),
    ).rejects.toThrow(/not suspended/);
    expect(hook).not.toHaveBeenCalled();
  });

  it('does not fire when the transaction fails', async () => {
    const hook = vi.fn();
    setOnAccountModerated(hook);
    vi.spyOn(pool, 'connect').mockImplementation(
      () => Promise.resolve(clientStub({ failOn: /UPDATE accounts/ })) as never,
    );
    await expect(
      moderateAccount({ accountId: 7, adminAccountId: 1, action: 'ban', reason: 'test' }),
    ).rejects.toThrow('boom');
    expect(hook).not.toHaveBeenCalled();
  });

  it('does not fire when validation rejects before any write', async () => {
    const hook = vi.fn();
    setOnAccountModerated(hook);
    const connect = vi.spyOn(pool, 'connect');
    await expect(
      moderateAccount({ accountId: 7, adminAccountId: 1, action: 'ban', reason: '' }),
    ).rejects.toThrow(/reason/);
    expect(hook).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('a throwing hook never turns a committed action into an error', async () => {
    setOnAccountModerated(() => {
      throw new Error('hook exploded');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(pool, 'connect').mockImplementation(() => Promise.resolve(clientStub()) as never);
    await expect(
      moderateAccount({ accountId: 7, adminAccountId: 1, action: 'ban', reason: 'test' }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('main.ts wiring', () => {
  it('injects the bust hook and nulls every cached board scope', () => {
    const src = readFileSync(resolve(__dirname, '../../server/main.ts'), 'utf8');
    expect(src).toContain('setOnAccountModerated(bustBoardCaches)');
    const start = src.indexOf('function bustBoardCaches');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('}', start));
    // Players realm + global, guilds realm + global, and the deeds board:
    // every cached scope. Arena is served uncached and the daily-rewards
    // board reads per request, so neither appears here by design.
    expect(body).toContain('leaderboardCache.realm = null');
    expect(body).toContain('leaderboardCache.global = null');
    expect(body).toContain('guildLeaderboardCache.realm = null');
    expect(body).toContain('guildLeaderboardCache.global = null');
    expect(body).toContain('deedsBoardCache = null');
  });

  it('bumps the board epoch so an in-flight refresh cannot reinstall a pre-ban snapshot', () => {
    // The lost-bust race: a ban landing WHILE a board refresh is in flight would
    // be overwritten by that refresh's pre-ban snapshot for up to one TTL cycle.
    // bustBoardCaches bumps a monotonic epoch, and each of the three player-derived
    // refreshes captures the epoch before its first await and installs its result
    // only if the epoch is unchanged, so the stale snapshot is declined.
    const src = readFileSync(resolve(__dirname, '../../server/main.ts'), 'utf8');
    const bustStart = src.indexOf('function bustBoardCaches');
    expect(bustStart).toBeGreaterThan(-1);
    const bustBody = src.slice(bustStart, src.indexOf('}', bustStart));
    expect(bustBody).toContain('boardEpoch++');
    for (const fn of ['refreshLeaderboard', 'refreshGuildLeaderboard', 'refreshDeedsBoard']) {
      const start = src.indexOf(`async function ${fn}(`);
      expect(start, `${fn} not found`).toBeGreaterThan(-1);
      // The function body runs to its column-0 closing brace (every inner brace is
      // indented), so `\n}\n` after the signature bounds it.
      const fnBody = src.slice(start, src.indexOf('\n}\n', start));
      expect(fnBody, `${fn} must capture the epoch before its await`).toContain(
        'const epoch = boardEpoch;',
      );
      expect(fnBody, `${fn} must guard the install on the epoch`).toContain(
        'if (boardEpoch === epoch)',
      );
    }
  });
});
