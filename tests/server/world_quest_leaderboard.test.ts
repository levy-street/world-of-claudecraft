// The world-quest scoreboards' server half (server/world_quest_leaderboard.ts +
// server/world_quest_scores_db.ts): the fire-and-forget observer with its
// best-row semantics and cache bust, the per-board cached ladder behind the
// public route, and the SQL boundary's load-bearing clauses. The pool never
// connects: the db seam is swapped through configureWorldQuestScoreDbForTests
// and the SQL module is driven with a fake Pool that records queries.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_wq_leaderboard';

import type * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The ranked read runs under runWithStatementTimeout, which checks out a real
// pooled client: hand the refresh a fake query instead so the pool never connects.
vi.mock('../../server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db')>();
  return {
    ...actual,
    runWithStatementTimeout: async (
      _timeoutMs: number,
      fn: (query: (text: string, values?: unknown[]) => Promise<unknown>) => Promise<unknown>,
    ) => fn(async () => ({ rows: [], rowCount: 0 })),
  };
});

import type { Pool } from 'pg';
import { ELIGIBLE_ACCOUNT_SQL } from '../../server/db';
import { resetPublicReadRateLimits } from '../../server/ratelimit';
import {
  bustWorldQuestLeaderboardCaches,
  configureWorldQuestScoreDbForTests,
  MAX_PENDING_WORLD_QUEST_SCORES,
  recordWorldQuestScore,
  recordWorldQuestScoreEvent,
  routes,
  worldQuestScoresIdle,
  worldQuestScoresPending,
  worldQuestScoresShedCount,
} from '../../server/world_quest_leaderboard';
import {
  pruneWorldQuestScoresBatch,
  upsertWorldQuestScore,
  WORLD_QUEST_SCORES_SCHEMA,
  type WorldQuestScoreRow,
  worldQuestScoreboardRows,
} from '../../server/world_quest_scores_db';
import { LEADERBOARD_PAGE_SIZE } from '../../src/sim/leaderboard_page';
import {
  worldQuestScoreboard,
  worldQuestScoreSortKey,
} from '../../src/sim/world_quest_scoreboards';
import { type FakeRes, fakeCtx } from './helpers';

function captured(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

const handler = routes[0].handler;
const who = { accountId: 7, characterId: 42 };

afterEach(() => {
  configureWorldQuestScoreDbForTests(null);
  resetPublicReadRateLimits();
  vi.restoreAllMocks();
});

describe('recordWorldQuestScore', () => {
  it('writes the best-row upsert with the shared sort key and realm-scoped identity', async () => {
    const upsert = vi.fn<typeof upsertWorldQuestScore>(async () => true);
    configureWorldQuestScoreDbForTests({
      upsert,
      rows: vi.fn<typeof worldQuestScoreboardRows>(async () => []),
    });
    recordWorldQuestScore(who, { board: 'forge', medal: 'silver', metric: 48.5 });
    await worldQuestScoresIdle();
    const forge = worldQuestScoreboard('forge');
    if (!forge) throw new Error('forge board');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][1]).toEqual({
      realm: expect.any(String),
      board: 'forge',
      characterId: 42,
      accountId: 7,
      medal: 'silver',
      metric: 48.5,
      sortKey: worldQuestScoreSortKey(forge, 'silver', 48.5),
    });
  });

  it('drops an unknown board and a non-finite number without touching the database', async () => {
    const upsert = vi.fn<typeof upsertWorldQuestScore>(async () => true);
    configureWorldQuestScoreDbForTests({
      upsert,
      rows: vi.fn<typeof worldQuestScoreboardRows>(async () => []),
    });
    recordWorldQuestScore(who, { board: 'nope', medal: 'gold', metric: 1 });
    recordWorldQuestScore(who, { board: 'forge', medal: 'gold', metric: Number.NaN });
    await worldQuestScoresIdle();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('never throws on a failed write and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    configureWorldQuestScoreDbForTests({
      upsert: vi.fn<typeof upsertWorldQuestScore>(async () => {
        throw new Error('boom');
      }),
      rows: vi.fn<typeof worldQuestScoreboardRows>(async () => []),
    });
    expect(() =>
      recordWorldQuestScore(who, { board: 'slalom', medal: 'gold', metric: 900 }),
    ).not.toThrow();
    await worldQuestScoresIdle();
    expect(error).toHaveBeenCalledWith('world quest score write failed:', expect.any(Error));
    expect(worldQuestScoresPending()).toBe(0);
  });

  it('sheds rows past the pending ceiling instead of growing a backlog', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const upsert = vi.fn<typeof upsertWorldQuestScore>(async () => {
      await gate;
      return false;
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    configureWorldQuestScoreDbForTests({
      upsert,
      rows: vi.fn<typeof worldQuestScoreboardRows>(async () => []),
    });
    for (let i = 0; i < MAX_PENDING_WORLD_QUEST_SCORES + 3; i++)
      recordWorldQuestScore(who, { board: 'forge', medal: 'bronze', metric: i });
    await Promise.resolve();
    // ONE write in flight (the FIFO tail), the rest queued up to the bound, 3 shed.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(worldQuestScoresPending()).toBe(MAX_PENDING_WORLD_QUEST_SCORES);
    expect(worldQuestScoresShedCount()).toBe(3);
    release!();
    await worldQuestScoresIdle();
    expect(upsert).toHaveBeenCalledTimes(MAX_PENDING_WORLD_QUEST_SCORES);
    expect(worldQuestScoresPending()).toBe(0);
  });
});

describe('GET /api/world-quests/leaderboard', () => {
  const rowsOf = (n: number): WorldQuestScoreRow[] =>
    Array.from({ length: n }, (_, i) => ({
      characterId: i + 1,
      name: `p${i + 1}`,
      medal: i % 3 === 0 ? 'gold' : null,
      metric: 100 - i,
    }));

  it('registers one anonymous public GET on the api surface', () => {
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      method: 'GET',
      path: '/api/world-quests/leaderboard',
      surface: 'api',
    });
    expect(routes[0].middleware).toBeUndefined();
  });

  it('rejects an unknown or missing board with the board list', async () => {
    configureWorldQuestScoreDbForTests({
      upsert: vi.fn<typeof upsertWorldQuestScore>(),
      rows: vi.fn<typeof worldQuestScoreboardRows>(async () => []),
    });
    const ctx = fakeCtx({ query: { board: 'nope' } });
    await handler(ctx);
    expect(captured(ctx.res)).toEqual({
      status: 400,
      body: {
        error: 'unknown board',
        code: 'world_quests.unknown_board',
        boards: expect.arrayContaining(['forge', 'slalom']),
      },
    });
    const missing = fakeCtx({});
    await handler(missing);
    expect(captured(missing.res).status).toBe(400);
  });

  it('ranks the cached ladder and pages it with the shared paginator', async () => {
    const rows = vi.fn<typeof worldQuestScoreboardRows>(async () => rowsOf(120));
    configureWorldQuestScoreDbForTests({ upsert: vi.fn<typeof upsertWorldQuestScore>(), rows });
    const ctx = fakeCtx({ query: { board: 'forge', page: '1', pageSize: '50' } });
    await handler(ctx);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    expect(body).toMatchObject({ board: 'forge', page: 1, pageCount: 3, total: 120, pageSize: 50 });
    const leaders = (body as { leaders: { rank: number; name: string }[] }).leaders;
    expect(leaders).toHaveLength(50);
    expect(leaders[0]).toEqual({ rank: 51, name: 'p51', medal: null, metric: 50 });
    // The query carried the realm, the board, and the eligibility clause.
    expect(rows).toHaveBeenCalledTimes(1);
    expect(rows.mock.calls[0].slice(1)).toEqual([
      expect.any(String),
      'forge',
      ELIGIBLE_ACCOUNT_SQL,
    ]);
    expect(typeof rows.mock.calls[0][0].query).toBe('function');
    // A second read within the TTL is served from memory.
    const again = fakeCtx({ query: { board: 'forge' } });
    await handler(again);
    expect(rows).toHaveBeenCalledTimes(1);
    expect(captured(again.res).body).toMatchObject({ page: 0, pageSize: LEADERBOARD_PAGE_SIZE });
  });

  it('busts only the written board after an accepted write, not after a no-op', async () => {
    const rows = vi.fn<typeof worldQuestScoreboardRows>(async () => rowsOf(3));
    const upsert = vi.fn<typeof upsertWorldQuestScore>(async () => false);
    configureWorldQuestScoreDbForTests({ upsert, rows });
    await handler(fakeCtx({ query: { board: 'forge' } }));
    await handler(fakeCtx({ query: { board: 'slalom' } }));
    expect(rows).toHaveBeenCalledTimes(2);
    recordWorldQuestScore(who, { board: 'forge', medal: 'gold', metric: 30 });
    await worldQuestScoresIdle();
    await handler(fakeCtx({ query: { board: 'forge' } }));
    expect(rows).toHaveBeenCalledTimes(2);
    upsert.mockResolvedValue(true);
    recordWorldQuestScore(who, { board: 'forge', medal: 'gold', metric: 20 });
    await worldQuestScoresIdle();
    await handler(fakeCtx({ query: { board: 'forge' } }));
    await handler(fakeCtx({ query: { board: 'slalom' } }));
    expect(rows).toHaveBeenCalledTimes(3);
    expect(rows.mock.calls[2][2]).toBe('forge');
  });

  it('drops every board on a moderation bust', async () => {
    const rows = vi.fn<typeof worldQuestScoreboardRows>(async () => rowsOf(2));
    configureWorldQuestScoreDbForTests({ upsert: vi.fn<typeof upsertWorldQuestScore>(), rows });
    await handler(fakeCtx({ query: { board: 'forge' } }));
    await handler(fakeCtx({ query: { board: 'slalom' } }));
    bustWorldQuestLeaderboardCaches();
    await handler(fakeCtx({ query: { board: 'forge' } }));
    await handler(fakeCtx({ query: { board: 'slalom' } }));
    expect(rows).toHaveBeenCalledTimes(4);
  });

  it('answers 429 under the public-read budget', async () => {
    configureWorldQuestScoreDbForTests({
      upsert: vi.fn<typeof upsertWorldQuestScore>(),
      rows: vi.fn<typeof worldQuestScoreboardRows>(async () => []),
    });
    let status = 200;
    for (let i = 0; i < 400 && status === 200; i++) {
      const ctx = fakeCtx({ query: { board: 'forge' } });
      await handler(ctx);
      status = captured(ctx.res).status;
    }
    expect(status).toBe(429);
  });

  it('resolves the viewer standing from the whole cached ladder, case-insensitively', async () => {
    const rows = vi.fn<typeof worldQuestScoreboardRows>(async () => rowsOf(120));
    configureWorldQuestScoreDbForTests({ upsert: vi.fn<typeof upsertWorldQuestScore>(), rows });
    // Page 0 holds ranks 1..50; the viewer sits at rank 97, two pages away.
    const ctx = fakeCtx({ query: { board: 'forge', page: '0', pageSize: '50', viewer: 'P97' } });
    await handler(ctx);
    const body = captured(ctx.res).body as {
      leaders: { rank: number }[];
      self: unknown;
    };
    expect(body.leaders.at(-1)?.rank).toBe(50);
    expect(body.self).toEqual({ rank: 97, name: 'p97', medal: 'gold', metric: 4 });
    expect(rows).toHaveBeenCalledTimes(1);
  });

  it('answers self null for an absent, omitted, or oversized viewer without another read', async () => {
    const rows = vi.fn<typeof worldQuestScoreboardRows>(async () => rowsOf(5));
    configureWorldQuestScoreDbForTests({ upsert: vi.fn<typeof upsertWorldQuestScore>(), rows });
    for (const query of <Record<string, string>[]>[
      { board: 'forge', viewer: 'nobody' },
      { board: 'forge' },
      { board: 'forge', viewer: '   ' },
      { board: 'forge', viewer: 'p1'.padEnd(80, 'x') },
    ]) {
      const ctx = fakeCtx({ query });
      await handler(ctx);
      const { status, body } = captured(ctx.res);
      expect(status).toBe(200);
      expect((body as { self: unknown }).self).toBeNull();
    }
    expect(rows).toHaveBeenCalledTimes(1);
  });
});

describe('world_quest_scores SQL boundary', () => {
  function fakePool(rowCount = 1, rows: Record<string, unknown>[] = []) {
    const query = vi.fn(async () => ({ rowCount, rows }));
    return { pool: { query } as unknown as Pool, query };
  }

  it('declares a bounded best-row table keyed per realm, board and character', () => {
    expect(WORLD_QUEST_SCORES_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS world_quest_scores');
    expect(WORLD_QUEST_SCORES_SCHEMA).toContain('PRIMARY KEY (realm, board, character_id)');
    expect(WORLD_QUEST_SCORES_SCHEMA).toContain('REFERENCES characters(id) ON DELETE CASCADE');
    expect(WORLD_QUEST_SCORES_SCHEMA).toContain('REFERENCES accounts(id) ON DELETE CASCADE');
    expect(WORLD_QUEST_SCORES_SCHEMA).toContain(
      'ON world_quest_scores (realm, board, sort_key DESC, updated_at ASC, character_id ASC)',
    );
    // Each cascading FK carries its own index so a delete never scans the table.
    expect(WORLD_QUEST_SCORES_SCHEMA).toContain(
      'world_quest_scores_character ON world_quest_scores (character_id)',
    );
    expect(WORLD_QUEST_SCORES_SCHEMA).toContain(
      'world_quest_scores_account ON world_quest_scores (account_id)',
    );
  });

  it('upserts only when the new sort key beats the standing row', async () => {
    const { pool, query } = fakePool(1);
    const changed = await upsertWorldQuestScore(pool, {
      realm: 'Testrealm',
      board: 'forge',
      characterId: 42,
      accountId: 7,
      medal: 'gold',
      metric: 33,
      sortKey: 123,
    });
    expect(changed).toBe(true);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT (realm, board, character_id) DO UPDATE');
    expect(sql).toContain('WHERE EXCLUDED.sort_key > world_quest_scores.sort_key');
    expect(params).toEqual(['Testrealm', 'forge', 42, 7, 'gold', 33, 123]);
    const { pool: held } = fakePool(0);
    expect(
      await upsertWorldQuestScore(held, {
        ...{ realm: 'r', board: 'forge' },
        characterId: 1,
        accountId: 1,
        medal: null,
        metric: 0,
        sortKey: 0,
      }),
    ).toBe(false);
  });

  it('reads the ladder best-first, eligibility-filtered, capped at the exposed depth', async () => {
    const { pool, query } = fakePool(2, [
      { character_id: '9', name: 'Ann', medal: 'gold', metric: '41.5' },
      { character_id: '4', name: 'Bob', medal: null, metric: '70' },
    ]);
    const rows = await worldQuestScoreboardRows(pool, 'Testrealm', 'forge', ELIGIBLE_ACCOUNT_SQL);
    expect(rows).toEqual([
      { characterId: 9, name: 'Ann', medal: 'gold', metric: 41.5 },
      { characterId: 4, name: 'Bob', medal: null, metric: 70 },
    ]);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('JOIN characters c ON c.id = s.character_id');
    expect(sql).toContain('JOIN accounts a ON a.id = s.account_id');
    expect(sql).toContain(ELIGIBLE_ACCOUNT_SQL);
    expect(sql).toContain('ORDER BY s.sort_key DESC, s.updated_at ASC, s.character_id ASC');
    expect(params).toEqual(['Testrealm', 'forge', 1000]);
  });

  it('prunes in bounded batches by age and keeps forever on 0', async () => {
    const { pool, query } = fakePool(5);
    expect(await pruneWorldQuestScoresBatch(pool, 0, 100)).toBe(0);
    expect(query).not.toHaveBeenCalled();
    expect(await pruneWorldQuestScoresBatch(pool, 365, 100)).toBe(5);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('DELETE FROM world_quest_scores');
    expect(sql).toContain('WHERE ctid IN (');
    expect(sql).toContain('SELECT ctid FROM world_quest_scores');
    expect(sql).toContain("updated_at < now() - ($1::int * INTERVAL '1 day')");
    expect(params).toEqual([365, 100]);
  });
});

describe('recordWorldQuestScoreEvent', () => {
  it('records a worldQuestScore event for its connected scorer only', async () => {
    const upsert = vi.fn<typeof upsertWorldQuestScore>(async () => true);
    configureWorldQuestScoreDbForTests({
      upsert,
      rows: vi.fn<typeof worldQuestScoreboardRows>(async () => []),
    });
    const clients = new Map([[3, who]]);
    const score = { type: 'worldQuestScore', board: 'forge', medal: 'gold', metric: 30 };
    recordWorldQuestScoreEvent(clients, { ...score, pid: 3 });
    recordWorldQuestScoreEvent(clients, { ...score, pid: 4 });
    recordWorldQuestScoreEvent(clients, score);
    recordWorldQuestScoreEvent(clients, { ...score, type: 'worldQuestDone', pid: 3 });
    await worldQuestScoresIdle();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][1]).toMatchObject({
      board: 'forge',
      medal: 'gold',
      metric: 30,
      accountId: 7,
      characterId: 42,
    });
  });
});
