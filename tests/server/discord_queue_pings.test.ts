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

import { QUEUE_PINGS_INVALID_INPUT_CODE, routes } from '../../server/discord_queue_pings';
import {
  accountsWithDiscordQueuePings,
  getDiscordQueuePings,
  setDiscordQueuePings,
} from '../../server/discord_queue_pings_db';
import { bustQueuePingCache } from '../../server/discord_queue_ping_cache';
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
