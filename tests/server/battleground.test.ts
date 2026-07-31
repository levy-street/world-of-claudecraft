// Unit coverage for the Thornhollow Fields REST domain (server/battleground.ts) plus the
// SQL-convention pins for its db.ts read (topBgRatings), mirrored from the
// public-read exemplar suites (tests/server/leaderboard.test.ts for the handler
// rungs, tests/arena_db.test.ts for the ladder-SQL pins). The handler is driven
// through the exported `routes` array with a fakeCtx + an injected fake runtime;
// the db read is driven against a mocked pg Pool so the exact SQL text and bind
// parameters are asserted without Postgres.

const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn() };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    // topBgRatings runs inside runWithStatementTimeout (server/db.ts): a
    // dedicated pooled client issues BEGIN, SET LOCAL statement_timeout, the
    // real query, then COMMIT. Model connect() as a client that answers the
    // control statements itself and forwards the real query back through the
    // pool's own query, so the dbMock spy still records exactly the real read.
    const poolObj = {
      query: dbMock.query,
      connect: async () => ({
        query: (text: string, values?: unknown[]) =>
          text === 'BEGIN' ||
          text === 'COMMIT' ||
          text === 'ROLLBACK' ||
          text.startsWith('SET LOCAL')
            ? Promise.resolve({ rows: [] })
            : poolObj.query(text, values),
        release() {},
      }),
    };
    return poolObj;
  }),
}));

import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BattlegroundRuntime,
  BG_LEADERBOARD_LIMIT,
  configureBattlegroundRuntime,
  readBgLeaderboard,
  resetBattlegroundRuntimeForTests,
  routes,
} from '../../server/battleground';
import { type BgLeaderRow, ELIGIBLE_ACCOUNT_SQL, topBgRatings } from '../../server/db';
import {
  PUBLIC_READ_MAX_PER_MINUTE,
  publicReadRateLimited,
  resetPublicReadRateLimits,
} from '../../server/ratelimit';
import { REALM } from '../../server/realm';
import { type FakeRes, fakeCtx, makeReq } from './helpers';

function bgRow(name: string): BgLeaderRow {
  return { name, class: 'warrior', level: 60, rating: 1650, wins: 9, losses: 4 };
}

function fakeRuntime(overrides: Partial<BattlegroundRuntime> = {}): BattlegroundRuntime {
  return { getBgLeaderboard: async () => [], ...overrides };
}

/** Read a handler's response off the fakeCtx's FakeRes. */
function captured(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

/** The one registered handler, grabbed by its route path. */
function bgHandler() {
  const route = routes.find((r) => r.path === '/api/battleground/leaderboard');
  if (!route) throw new Error('no route registered for /api/battleground/leaderboard');
  return route.handler;
}

beforeEach(() => {
  dbMock.query.mockReset();
});

afterEach(() => {
  resetBattlegroundRuntimeForTests();
  resetPublicReadRateLimits();
});

// ---------------------------------------------------------------------------
// The route table contract.
// ---------------------------------------------------------------------------

describe('routes table', () => {
  it('registers exactly the one public ladder GET on the api surface', () => {
    expect(routes).toHaveLength(1);
    const route = routes[0];
    expect(route.method).toBe('GET');
    expect(route.path).toBe('/api/battleground/leaderboard');
    expect(route.surface).toBe('api');
    expect(typeof route.handler).toBe('function');
    // A plain public read: no auth middleware, no ownership meta.
    expect(route.middleware).toBeUndefined();
    expect(route.meta).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The inner read (host-agnostic, the main.ts cache's INNER read).
// ---------------------------------------------------------------------------

describe('readBgLeaderboard', () => {
  it('reads the top BG_LEADERBOARD_LIMIT rows and wraps them under leaders', async () => {
    const reads: (number | undefined)[] = [];
    const out = await readBgLeaderboard({
      topBgRatings: async (limit) => {
        reads.push(limit);
        return [bgRow('Riftlord'), bgRow('Bannerette')];
      },
    });
    expect(reads).toEqual([BG_LEADERBOARD_LIMIT]);
    expect(out.leaders.map((r) => r.name)).toEqual(['Riftlord', 'Bannerette']);
  });
});

// ---------------------------------------------------------------------------
// The handler via the exported routes + fakeCtx + injected fake runtime.
// ---------------------------------------------------------------------------

describe('battleground leaderboard handler (through the injected cache-fronted runtime)', () => {
  it('serves 200 { leaders } from the runtime getter', async () => {
    configureBattlegroundRuntime(
      fakeRuntime({ getBgLeaderboard: async () => [bgRow('Riftlord')] }),
    );
    const ctx = fakeCtx({ method: 'GET', url: '/api/battleground/leaderboard' });
    await bgHandler()(ctx);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    expect(body).toEqual({
      leaders: [
        { name: 'Riftlord', class: 'warrior', level: 60, rating: 1650, wins: 9, losses: 4 },
      ],
    });
  });

  it('fails loud when a request somehow beats the boot wiring', async () => {
    // No configureBattlegroundRuntime call: the injection seam must throw, not
    // silently serve an empty board.
    const ctx = fakeCtx({ method: 'GET', url: '/api/battleground/leaderboard' });
    await expect(bgHandler()(ctx)).rejects.toThrow(/battleground runtime is not configured/);
  });

  it('serves 200 under the per-IP public-read budget, then 429 { error } once exhausted, and resets', async () => {
    resetPublicReadRateLimits();
    configureBattlegroundRuntime(fakeRuntime());
    const handler = bgHandler();
    let firstStatus = 0;
    let saw429 = false;
    // The public-read limiter is per-IP; fakeCtx's makeReq shares 127.0.0.1, so a
    // tight loop past PUBLIC_READ_MAX_PER_MINUTE exhausts the same bucket.
    for (let i = 0; i < PUBLIC_READ_MAX_PER_MINUTE + 5; i++) {
      const ctx = fakeCtx({ method: 'GET', url: '/api/battleground/leaderboard' });
      await handler(ctx);
      const { status, body } = captured(ctx.res);
      if (i === 0) firstStatus = status;
      if (status === 429) {
        saw429 = true;
        expect(body).toEqual({ error: 'rate limited' });
        break;
      }
    }
    expect(firstStatus).toBe(200);
    expect(saw429).toBe(true);
    // Resetting the limiter restores service.
    resetPublicReadRateLimits();
    const ctx = fakeCtx({ method: 'GET', url: '/api/battleground/leaderboard' });
    await handler(ctx);
    expect(captured(ctx.res).status).toBe(200);
  });

  it('does not spend a cached getter call on a rate-limited request', async () => {
    // Mirrors the arena ladder's "before any DB read" ordering pin: the limiter
    // must short-circuit BEFORE the cached read, so a 429 never reaches the getter.
    resetPublicReadRateLimits();
    const getBg = vi.fn(async () => [] as BgLeaderRow[]);
    configureBattlegroundRuntime(fakeRuntime({ getBgLeaderboard: getBg }));
    // Exhaust the per-IP bucket externally so the very next handler call is a 429.
    for (let i = 0; i < PUBLIC_READ_MAX_PER_MINUTE + 1; i++) {
      publicReadRateLimited(makeReq({ method: 'GET', url: '/api/battleground/leaderboard' }));
    }
    const ctx = fakeCtx({ method: 'GET', url: '/api/battleground/leaderboard' });
    await bgHandler()(ctx);
    expect(captured(ctx.res)).toEqual({ status: 429, body: { error: 'rate limited' } });
    expect(getBg).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SQL-convention pins for the db.ts ladder read (the arena_db.test.ts approach).
// ---------------------------------------------------------------------------

describe('topBgRatings SQL conventions', () => {
  it('scopes the ladder to the current realm', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });
    await topBgRatings();
    const [sql, params] = dbMock.query.mock.calls[0];
    // The ladder reads from the shared `characters` table; without a realm
    // predicate it would leak rankings from every other realm's process.
    expect(sql).toContain('WHERE realm = $1');
    expect(params[0]).toBe(REALM);
  });

  it('embeds the moderation eligibility EXISTS clause verbatim', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });
    await topBgRatings();
    const [sql] = dbMock.query.mock.calls[0];
    // Banned / currently-suspended accounts are delisted from every public
    // board; the shared fragment keeps this ladder on the same predicate.
    expect(sql).toContain(ELIGIBLE_ACCOUNT_SQL);
    expect(sql).toContain('EXISTS (SELECT 1 FROM accounts a');
  });

  it('reads the bg state fields with the 1500 rating default and a fought-a-match filter', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });
    await topBgRatings();
    const [sql] = dbMock.query.mock.calls[0];
    expect(sql).toContain("COALESCE((state->>'bgRating')::int, 1500)");
    expect(sql).toContain("state->>'bgWins'");
    expect(sql).toContain("state->>'bgLosses'");
    // Only characters with at least one result appear (absent fields COALESCE
    // to 0, so a never-queued character never rides the board at 1500).
    expect(sql).toContain(
      "COALESCE((state->>'bgWins')::int, 0) + COALESCE((state->>'bgLosses')::int, 0) > 0",
    );
    expect(sql).toContain('ORDER BY rating DESC, wins DESC, name ASC');
  });

  it('clamps the limit and binds it after the realm parameter', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });
    await topBgRatings(999);
    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual([REALM, 100]);
  });

  it('coerces numeric rating/record fields from JSONB strings', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        { name: 'Riftlord', class: 'paladin', level: 60, rating: '1712', wins: '8', losses: '2' },
      ],
    });
    await expect(topBgRatings(5)).resolves.toEqual([
      { name: 'Riftlord', class: 'paladin', level: 60, rating: 1712, wins: 8, losses: 2 },
    ]);
  });
});
