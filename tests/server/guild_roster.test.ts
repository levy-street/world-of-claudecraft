// The public guild roster read (server/guild_roster.ts): the route table
// shape, the handler's status envelope, and the cache policy (TTL
// serve-from-memory, single-flight, and the null-result-never-cached rule
// that keeps unknown-name probing from growing the map).

import type * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  DB_HEAVY_STATEMENT_TIMEOUT_MS: 60_000,
  ELIGIBLE_ACCOUNT_SQL: 'TRUE',
  runWithStatementTimeout: vi.fn(),
}));

import { runWithStatementTimeout } from '../../server/db';
import {
  guildRosterCached,
  readGuildRoster,
  resetGuildRosterCacheForTests,
  routes,
} from '../../server/guild_roster';
import { resetPublicReadRateLimits } from '../../server/ratelimit';
import { type FakeRes, fakeCtx, makeReq } from './helpers';

const runMock = vi.mocked(runWithStatementTimeout);

const ROWS = [
  {
    guild_name: 'Stormcallers',
    name: 'Boss',
    rank: 'leader',
    cls: 'warrior',
    level: 20,
    lifetime_xp: '900000',
  },
  {
    guild_name: 'Stormcallers',
    name: 'Aide',
    rank: 'officer',
    cls: 'priest',
    level: 19,
    lifetime_xp: '500000',
  },
  {
    guild_name: 'Stormcallers',
    name: 'Newbie',
    rank: 'member',
    cls: 'rogue',
    level: 3,
    lifetime_xp: '9000',
  },
];

function answerRows(rows: unknown[]): void {
  runMock.mockImplementation((async (_ms: number, run: (q: unknown) => Promise<unknown>) =>
    run(async () => ({ rows }))) as never);
}

function captured(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

afterEach(() => {
  resetGuildRosterCacheForTests();
  resetPublicReadRateLimits();
  runMock.mockReset();
});

describe('guild roster route table', () => {
  it('registers exactly the anonymous GET read', () => {
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe('GET');
    expect(routes[0].path).toBe('/api/guilds/roster');
    expect(routes[0].surface).toBe('api');
    expect(routes[0].middleware).toBeUndefined(); // anonymous; the budget guard is in-handler
  });
});

describe('readGuildRoster', () => {
  it('maps the rank-ordered rows onto the wire shape', async () => {
    // Arrange
    answerRows(ROWS);

    // Act
    const info = await readGuildRoster('Stormcallers');

    // Assert
    expect(info).toEqual({
      guild: 'Stormcallers',
      members: [
        { name: 'Boss', rank: 'leader', class: 'warrior', level: 20, lifetimeXp: 900_000 },
        { name: 'Aide', rank: 'officer', class: 'priest', level: 19, lifetimeXp: 500_000 },
        { name: 'Newbie', rank: 'member', class: 'rogue', level: 3, lifetimeXp: 9_000 },
      ],
    });
  });

  it('answers null for an unknown guild', async () => {
    // Arrange
    answerRows([]);

    // Act + Assert
    expect(await readGuildRoster('Ghost')).toBeNull();
  });
});

describe('guildRosterCached', () => {
  it('serves the second read within the TTL from memory (one query total)', async () => {
    // Arrange
    answerRows(ROWS);

    // Act
    const first = await guildRosterCached('Stormcallers');
    const second = await guildRosterCached('stormcallers'); // case-insensitive key

    // Assert
    expect(first?.members).toHaveLength(3);
    expect(second).toBe(first);
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('never caches a null result, so an unknown name is re-read each time', async () => {
    // Arrange
    answerRows([]);

    // Act
    await guildRosterCached('Ghost');
    await guildRosterCached('Ghost');

    // Assert
    expect(runMock).toHaveBeenCalledTimes(2);
  });

  it('single-flights concurrent reads of the same guild', async () => {
    // Arrange
    answerRows(ROWS);

    // Act
    const [a, b] = await Promise.all([
      guildRosterCached('Stormcallers'),
      guildRosterCached('Stormcallers'),
    ]);

    // Assert
    expect(a?.guild).toBe('Stormcallers');
    expect(b).toBe(a);
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('answers null (never throws) when the read fails', async () => {
    // Arrange
    runMock.mockImplementation((async () => {
      throw new Error('db down');
    }) as never);

    // Act + Assert
    expect(await guildRosterCached('Stormcallers')).toBeNull();
  });
});

describe('rosterHandler', () => {
  async function drive(query: Record<string, string>): Promise<{ status: number; body: unknown }> {
    const handler = routes[0].handler;
    const ctx = fakeCtx({ req: makeReq({ url: '/api/guilds/roster' }), query });
    await handler(ctx);
    return captured(ctx.res);
  }

  it('answers 400 on a missing or oversized name', async () => {
    // Arrange
    answerRows(ROWS);

    // Act + Assert
    expect((await drive({})).status).toBe(400);
    expect((await drive({ name: 'x'.repeat(65) })).status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('answers 404 with the stable code for an unknown guild', async () => {
    // Arrange
    answerRows([]);

    // Act
    const { status, body } = await drive({ name: 'Ghost' });

    // Assert
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'unknown guild', code: 'guilds.unknown' });
  });

  it('answers 200 with the roster for a known guild', async () => {
    // Arrange
    answerRows(ROWS);

    // Act
    const { status, body } = await drive({ name: 'Stormcallers' });

    // Assert
    expect(status).toBe(200);
    expect((body as { guild: string }).guild).toBe('Stormcallers');
    expect((body as { members: unknown[] }).members).toHaveLength(3);
  });
});
