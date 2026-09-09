// The queue-pop DM opt-in toggle: the /api/discord/queue-pings route pair
// (server/discord_queue_pings.ts) and the SQL boundary behind it
// (server/discord_queue_pings_db.ts). The deeds broadcasts suite's shape.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_queue_pings_units';

import type * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] as unknown[] })),
}));
// Partial mock: the route module's bearer middleware reaches the real db
// module's token helpers, so only the pool the SQL boundary spends is faked.
vi.mock('../../server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/db')>()),
  pool: dbMock,
}));
vi.mock('../../server/discord_queue_ping_cache', () => ({ bustQueuePingCache: vi.fn() }));

import { bustQueuePingCache } from '../../server/discord_queue_ping_cache';
import {
  QUEUE_PINGS_INVALID_INPUT_CODE,
  QUEUE_PINGS_READ_MAX_PER_MINUTE,
  QUEUE_PINGS_WRITE_MAX_PER_MINUTE,
  queuePingsReadIpBucketSizeForTests,
  resetQueuePingsRateLimitsForTests,
  routes,
} from '../../server/discord_queue_pings';
import {
  accountsWithDiscordQueuePings,
  getDiscordQueuePings,
  setDiscordQueuePings,
} from '../../server/discord_queue_pings_db';
import { resetRateLimitClock, setRateLimitClock, WINDOW_MS } from '../../server/ratelimit';
import { type FakeRes, fakeCtx } from './helpers';

const PATH = '/api/discord/queue-pings';

function captured(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

function handlerFor(method: 'GET' | 'POST') {
  const route = routes.find((r) => r.path === PATH && r.method === method);
  if (!route) throw new Error(`no route registered for ${method} ${PATH}`);
  return route.handler;
}

afterEach(() => {
  dbMock.query.mockReset();
  dbMock.query.mockImplementation(async () => ({ rows: [] }));
  vi.mocked(bustQueuePingCache).mockClear();
  resetQueuePingsRateLimitsForTests();
  resetRateLimitClock();
});

describe('queue-pings route table', () => {
  it('registers exactly the read/write pair, read-tier GET and mutation-tier POST with a body', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([`GET ${PATH}`, `POST ${PATH}`]);
    const [get, post] = routes;
    expect(get.middleware).toHaveLength(1);
    expect(post.middleware).toHaveLength(2);
    expect(routes.every((r) => r.surface === 'api')).toBe(true);
  });
});

describe('queue-pings read handler', () => {
  it('serves the AUTHENTICATED account flag, both values', async () => {
    for (const enabled of [true, false]) {
      dbMock.query.mockResolvedValueOnce({ rows: [{ discord_queue_pings: enabled }] });
      const ctx = fakeCtx({ method: 'GET', url: PATH, account: { accountId: 7, scope: 'read' } });
      await handlerFor('GET')(ctx);
      expect(captured(ctx.res)).toEqual({ status: 200, body: { enabled } });
      expect(dbMock.query.mock.calls[0]?.[1]).toEqual([7]);
      dbMock.query.mockClear();
    }
  });

  it('throws (and never reads) on a ctx with no authenticated account', async () => {
    const ctx = fakeCtx({ method: 'GET', url: PATH });
    await expect(handlerFor('GET')(ctx)).rejects.toThrow();
    expect(dbMock.query).not.toHaveBeenCalled();
  });
});

describe('queue-pings toggle handler', () => {
  it('writes the flag for the AUTHENTICATED account, busts the observer cache, and echoes it', async () => {
    for (const enabled of [true, false]) {
      const ctx = fakeCtx({
        method: 'POST',
        url: PATH,
        account: { accountId: 7, scope: 'full' },
        body: { enabled },
      });
      await handlerFor('POST')(ctx);
      expect(captured(ctx.res)).toEqual({ status: 200, body: { enabled } });
      expect(dbMock.query).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE accounts'), [
        7,
        enabled,
      ]);
      expect(bustQueuePingCache).toHaveBeenLastCalledWith(7);
    }
  });

  it('rejects a non-boolean enabled with the stable domain code and writes nothing', async () => {
    for (const enabled of ['true', 1, null, undefined]) {
      const ctx = fakeCtx({
        method: 'POST',
        url: PATH,
        account: { accountId: 7, scope: 'full' },
        body: { enabled },
      });
      await handlerFor('POST')(ctx);
      expect(captured(ctx.res)).toEqual({
        status: 400,
        body: { error: 'invalid input', code: QUEUE_PINGS_INVALID_INPUT_CODE },
      });
    }
    expect(QUEUE_PINGS_INVALID_INPUT_CODE).toBe('discord.invalid_input');
    expect(dbMock.query).not.toHaveBeenCalled();
    expect(bustQueuePingCache).not.toHaveBeenCalled();
  });

  it('throws (and never writes) on a ctx with no authenticated account', async () => {
    const ctx = fakeCtx({ method: 'POST', url: PATH, body: { enabled: true } });
    await expect(handlerFor('POST')(ctx)).rejects.toThrow();
    expect(dbMock.query).not.toHaveBeenCalled();
  });
});

describe('queue-pings rate limiting', () => {
  it('serves up to the read budget then rejects the next GET with the coded 429, reading no further', async () => {
    setRateLimitClock(() => 1_000);
    const ctx = () =>
      fakeCtx({
        method: 'GET',
        url: PATH,
        account: { accountId: 41, scope: 'read' },
        ip: '10.0.0.1',
      });
    for (let i = 0; i < QUEUE_PINGS_READ_MAX_PER_MINUTE; i++) {
      await handlerFor('GET')(ctx());
    }
    expect(dbMock.query).toHaveBeenCalledTimes(QUEUE_PINGS_READ_MAX_PER_MINUTE);

    await expect(handlerFor('GET')(ctx())).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit.exceeded',
      // Real draft-11 rate-limit headers (rateLimit429Headers), not just the
      // Retry-After that HttpError's params-implied-header path alone adds.
      headers: {
        'Retry-After': expect.any(String),
        RateLimit: expect.stringContaining('"discord_queue_pings_read"'),
        'RateLimit-Policy': expect.stringContaining(
          `"discord_queue_pings_read";q=${QUEUE_PINGS_READ_MAX_PER_MINUTE};w=`,
        ),
      },
    });
    expect(dbMock.query).toHaveBeenCalledTimes(QUEUE_PINGS_READ_MAX_PER_MINUTE);
  });

  it('serves up to the write budget then rejects the next POST with the coded 429, writing and busting nothing further', async () => {
    setRateLimitClock(() => 2_000);
    const ctx = () =>
      fakeCtx({
        method: 'POST',
        url: PATH,
        account: { accountId: 42, scope: 'full' },
        ip: '10.0.0.2',
        body: { enabled: true },
      });
    for (let i = 0; i < QUEUE_PINGS_WRITE_MAX_PER_MINUTE; i++) {
      await handlerFor('POST')(ctx());
    }
    expect(dbMock.query).toHaveBeenCalledTimes(QUEUE_PINGS_WRITE_MAX_PER_MINUTE);
    expect(bustQueuePingCache).toHaveBeenCalledTimes(QUEUE_PINGS_WRITE_MAX_PER_MINUTE);

    await expect(handlerFor('POST')(ctx())).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit.exceeded',
      headers: {
        'Retry-After': expect.any(String),
        RateLimit: expect.stringContaining('"discord_queue_pings_write"'),
        'RateLimit-Policy': expect.stringContaining(
          `"discord_queue_pings_write";q=${QUEUE_PINGS_WRITE_MAX_PER_MINUTE};w=`,
        ),
      },
    });
    expect(dbMock.query).toHaveBeenCalledTimes(QUEUE_PINGS_WRITE_MAX_PER_MINUTE);
    expect(bustQueuePingCache).toHaveBeenCalledTimes(QUEUE_PINGS_WRITE_MAX_PER_MINUTE);
  });

  it('keeps the read and write legs, and per-account/per-IP buckets, independent', async () => {
    setRateLimitClock(() => 3_000);
    const exhaustedWriteCtx = () =>
      fakeCtx({
        method: 'POST',
        url: PATH,
        account: { accountId: 51, scope: 'full' },
        ip: '10.0.0.3',
        body: { enabled: true },
      });
    for (let i = 0; i < QUEUE_PINGS_WRITE_MAX_PER_MINUTE; i++) {
      await handlerFor('POST')(exhaustedWriteCtx());
    }
    await expect(handlerFor('POST')(exhaustedWriteCtx())).rejects.toMatchObject({ status: 429 });

    // Same account, same IP, the READ leg: a separate bucket, unaffected by the
    // write leg's exhaustion.
    dbMock.query.mockClear();
    await handlerFor('GET')(
      fakeCtx({
        method: 'GET',
        url: PATH,
        account: { accountId: 51, scope: 'read' },
        ip: '10.0.0.3',
      }),
    );
    expect(dbMock.query).toHaveBeenCalledTimes(1);

    // A different account behind a different IP: unaffected by account 51's
    // exhaustion on both the account and IP arms.
    dbMock.query.mockClear();
    await handlerFor('POST')(
      fakeCtx({
        method: 'POST',
        url: PATH,
        account: { accountId: 52, scope: 'full' },
        ip: '10.0.0.4',
        body: { enabled: true },
      }),
    );
    expect(dbMock.query).toHaveBeenCalledTimes(1);
  });

  it('resets the budget once the sliding window clears', async () => {
    setRateLimitClock(() => 4_000);
    const ctx = () =>
      fakeCtx({
        method: 'GET',
        url: PATH,
        account: { accountId: 61, scope: 'read' },
        ip: '10.0.0.5',
      });
    for (let i = 0; i < QUEUE_PINGS_READ_MAX_PER_MINUTE; i++) {
      await handlerFor('GET')(ctx());
    }
    await expect(handlerFor('GET')(ctx())).rejects.toMatchObject({ status: 429 });

    setRateLimitClock(() => 4_000 + WINDOW_MS);
    dbMock.query.mockClear();
    await handlerFor('GET')(ctx());
    expect(dbMock.query).toHaveBeenCalledTimes(1);
  });

  it('bounds one flooded keys tracked timestamps under sustained flood, despite the distinct-key cap', async () => {
    // A frozen clock means every attempt lands in the SAME instant window,
    // exactly the shape of a real sustained flood: without the fix, each of
    // these calls appends to the per-IP bucket's array and filter/copies the
    // whole (ever-growing) array on every subsequent call.
    setRateLimitClock(() => 5_000);
    const floodIp = '10.0.0.9';
    const ctx = () =>
      fakeCtx({
        method: 'GET',
        url: PATH,
        account: { accountId: 71, scope: 'read' },
        ip: floodIp,
      });
    const FLOOD_ATTEMPTS = 10_000;
    for (let i = 0; i < FLOOD_ATTEMPTS; i++) {
      try {
        await handlerFor('GET')(ctx());
      } catch {
        // Expected once the budget is exhausted; keep flooding the same key.
      }
    }
    expect(dbMock.query).toHaveBeenCalledTimes(QUEUE_PINGS_READ_MAX_PER_MINUTE);
    expect(queuePingsReadIpBucketSizeForTests(floodIp)).toBeLessThanOrEqual(
      QUEUE_PINGS_READ_MAX_PER_MINUTE + 1,
    );
  });

  it('recovers to allow again, with the bucket reset to a single entry, once the window clears after a sustained flood', async () => {
    setRateLimitClock(() => 6_000);
    const floodIp = '10.0.0.10';
    const ctx = () =>
      fakeCtx({
        method: 'GET',
        url: PATH,
        account: { accountId: 72, scope: 'read' },
        ip: floodIp,
      });
    for (let i = 0; i < 10_000; i++) {
      try {
        await handlerFor('GET')(ctx());
      } catch {
        // Expected once the budget is exhausted; keep flooding the same key.
      }
    }
    expect(queuePingsReadIpBucketSizeForTests(floodIp)).toBeLessThanOrEqual(
      QUEUE_PINGS_READ_MAX_PER_MINUTE + 1,
    );

    setRateLimitClock(() => 6_000 + WINDOW_MS);
    dbMock.query.mockClear();
    await handlerFor('GET')(ctx());
    expect(dbMock.query).toHaveBeenCalledTimes(1);
    expect(queuePingsReadIpBucketSizeForTests(floodIp)).toBe(1);
  });
});

describe('discord_queue_pings SQL boundary', () => {
  it('reads the flag by account id and defaults a missing row to FALSE', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [{ discord_queue_pings: true }] });
    expect(await getDiscordQueuePings(7)).toBe(true);
    const [sql, params] = dbMock.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('SELECT discord_queue_pings FROM accounts WHERE id = $1');
    expect(params).toEqual([7]);
    dbMock.query.mockResolvedValueOnce({ rows: [] });
    expect(await getDiscordQueuePings(999)).toBe(false);
  });

  it('writes the flag with a parameterized UPDATE', async () => {
    await setDiscordQueuePings(7, true);
    const [sql, params] = dbMock.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('UPDATE accounts SET discord_queue_pings = $2 WHERE id = $1');
    expect(params).toEqual([7, true]);
  });

  it('answers the opted-in AND linked subset in one statement, deduplicated, and skips an empty ask', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: 2 }, { id: 3 }] })) };
    expect(await accountsWithDiscordQueuePings(pool as never, [3, 2, 3, 4])).toEqual([2, 3]);
    const [sql, params] = pool.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('JOIN discord_links d ON d.account_id = a.id');
    expect(sql).toContain('a.discord_queue_pings');
    expect(params).toEqual([[3, 2, 4]]);
    expect(await accountsWithDiscordQueuePings(pool as never, [])).toEqual([]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
