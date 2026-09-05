// The Realm Builder of the Month endpoints (server/realm_builder.ts): the
// shared admin auth gate, the four handlers through the routes table with the
// data seam faked (no Postgres), the validation surface of realm_builder_db's
// input checks, and the one thing that makes this feature more than CRUD:
// every write RE-PUBLISHES the roll into the sim, so a player standing at the
// plaque sees the new name without a reload.
//
// Real modules, no db module mock: nothing here is allowed to reach the pg pool
// (the ownership_coverage idiom).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAdminDbForTests, setAdminDbForTests } from '../../server/admin';
import {
  PUBLIC_READ_MAX_PER_MINUTE,
  publicReadRateLimited,
  resetPublicReadRateLimits,
} from '../../server/ratelimit';
import { REALM } from '../../server/realm';
import {
  PUBLIC_ROLL_TTL_MS,
  publishRealmBuilderRoll,
  resetRealmBuilderDbForTests,
  routes,
  setRealmBuilderDbForTests,
} from '../../server/realm_builder';
import {
  deleteRealmBuilder,
  REALM_BUILDER_MAX_NAME_LENGTH,
  REALM_BUILDER_MAX_NOTE_LENGTH,
  type RealmBuilderRow,
  upsertRealmBuilder,
} from '../../server/realm_builder_db';
import {
  currentRealmBuilder,
  pastRealmBuilders,
  REALM_BUILDER_PLACEHOLDER_NAME,
  resetRealmBuilderRoll,
} from '../../src/sim/content/realm_builders';
import { fakeCtx, makeReq } from './helpers';

const ADMIN_TOKEN = 'a'.repeat(64);

function handlerFor(method: string, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`route not found: ${method} ${path}`);
  return route;
}

async function runRoute(
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const route = handlerFor(method, path);
  const ctx = fakeCtx({
    method,
    url: path,
    body: opts.body,
    headers: {
      authorization: `Bearer ${opts.token ?? ADMIN_TOKEN}`,
      'content-type': 'application/json',
    },
  });
  const chain = [...(route.middleware ?? [])];
  let i = 0;
  const next = async (): Promise<void> => {
    const mw = chain[i++];
    if (mw) await mw(ctx, next);
    else await route.handler(ctx);
  };
  await next();
  const res = ctx.res as unknown as {
    statusCode: number;
    body?: unknown;
    payload?: unknown;
    written?: string;
  };
  const raw = res.written ?? res.payload ?? res.body;
  return { status: res.statusCode, body: typeof raw === 'string' ? JSON.parse(raw) : raw };
}

const august: RealmBuilderRow = {
  year: 2026,
  month: 8,
  name: 'Wren Ashdown',
  note: 'rebuilt the harbour',
  updatedAt: '2026-08-14T00:00:00.000Z',
};
const july: RealmBuilderRow = {
  year: 2026,
  month: 7,
  name: 'Marek Fell',
  note: '',
  updatedAt: '2026-07-02T00:00:00.000Z',
};

let stored: RealmBuilderRow[] = [];

beforeEach(() => {
  stored = [august, july];
  setAdminDbForTests({
    accountAndScopeForToken: async (token: string) =>
      token === ADMIN_TOKEN ? { accountId: 7, scope: 'full' as const } : null,
    adminRolesForAccount: async () => ({ username: 'ops', roles: ['admin'] }),
  });
  setRealmBuilderDbForTests({
    listRealmBuilders: async () => stored,
    upsertRealmBuilder: async (input) => {
      const row: RealmBuilderRow = {
        year: input.year,
        month: input.month,
        name: input.name,
        note: input.note ?? '',
        updatedAt: '2026-09-01T00:00:00.000Z',
      };
      stored = [row, ...stored.filter((r) => r.year !== row.year || r.month !== row.month)];
      return row;
    },
    deleteRealmBuilder: async (year, month) => {
      const before = stored.length;
      stored = stored.filter((r) => r.year !== year || r.month !== month);
      return stored.length < before;
    },
  });
});

afterEach(() => {
  resetRealmBuilderDbForTests();
  resetAdminDbForTests();
  resetRealmBuilderRoll();
  resetPublicReadRateLimits();
});

describe('auth gate', () => {
  it('rejects an unknown bearer with the admin 401 envelope', async () => {
    const out = await runRoute('GET', '/admin/api/realm-builders', { token: 'f'.repeat(64) });
    expect(out.status).toBe(401);
    expect(out.body).toMatchObject({ success: false, error: 'admin authentication required' });
  });

  it('rejects a staff account without content.moderate on every arm', async () => {
    setAdminDbForTests({
      accountAndScopeForToken: async (token: string) =>
        token === ADMIN_TOKEN ? { accountId: 7, scope: 'full' as const } : null,
      adminRolesForAccount: async () => ({ username: 'viewer', roles: ['viewer'] }),
    });
    // Read is gated too: the roll is not secret, but the dashboard page is
    // behind one grant and the endpoints behind it must agree.
    expect((await runRoute('GET', '/admin/api/realm-builders')).status).toBe(403);
    const write = await runRoute('POST', '/admin/api/realm-builders', {
      body: { year: 2026, month: 9, name: 'Nobody' },
    });
    expect(write.status).toBe(403);
    const remove = await runRoute('POST', '/admin/api/realm-builders/delete', {
      body: { year: 2026, month: 7 },
    });
    expect(remove.status).toBe(403);
  });

  it('leaves the public read open, because the game itself calls it', async () => {
    const route = handlerFor('GET', '/api/realm-builder');
    expect(route.surface).toBe('api');
    // No auth middleware at all: an unauthenticated browser boots the world.
    expect(route.middleware ?? []).toHaveLength(0);
    const out = await runRoute('GET', '/api/realm-builder', { token: 'f'.repeat(64) });
    expect(out.status).toBe(200);
    // EXACT shape: the calendar month and the name, nothing else. `note` is
    // an operator's remark for the dashboard and `updatedAt` is audit; neither
    // belongs on an anonymous endpoint, and toMatchObject would let them leak.
    expect(out.body).toEqual({
      realm: REALM,
      entries: [
        { year: 2026, month: 8, name: 'Wren Ashdown' },
        { year: 2026, month: 7, name: 'Marek Fell' },
      ],
    });
  });

  it('serves the public read from a cache, busted by every write', async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(async () => stored);
      setRealmBuilderDbForTests({ listRealmBuilders: read });
      // The answer is viewer-identical, so a cold-start burst of world loads
      // is one query, not one per player.
      await runRoute('GET', '/api/realm-builder');
      await runRoute('GET', '/api/realm-builder');
      expect(read).toHaveBeenCalledTimes(1);
      // A write must reach the next reader immediately (the plaque's promise
      // that no client waits for a restart, or for a TTL).
      const save = await runRoute('POST', '/admin/api/realm-builders', {
        body: { year: 2026, month: 9, name: 'Isolde Vane' },
      });
      expect(save.status).toBe(200);
      const after = await runRoute('GET', '/api/realm-builder');
      expect((after.body as { entries: { name: string }[] }).entries[0].name).toBe('Isolde Vane');
      // And the TTL alone refreshes it, for a row a PEER process wrote.
      const calls = read.mock.calls.length;
      vi.advanceTimersByTime(PUBLIC_ROLL_TTL_MS + 1);
      await runRoute('GET', '/api/realm-builder');
      expect(read.mock.calls.length).toBe(calls + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('collapses concurrent cold reads into one query (single flight)', async () => {
    // The property the cache is there for: a cold-start burst of world loads
    // racing the same miss shares ONE refresh rather than each reaching
    // Postgres. Two reads started before either resolves, one query.
    let release: (() => void) | null = null;
    const read = vi.fn(
      () =>
        new Promise<RealmBuilderRow[]>((resolve) => {
          release = () => resolve(stored);
        }),
    );
    setRealmBuilderDbForTests({ listRealmBuilders: read });
    const first = runRoute('GET', '/api/realm-builder');
    const second = runRoute('GET', '/api/realm-builder');
    await vi.waitFor(() => expect(release).not.toBeNull());
    (release as unknown as () => void)();
    const [a, b] = await Promise.all([first, second]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
  });
});

describe('the public read takes the shared per-IP budget', () => {
  it('answers 429 { error } once the budget is spent, BEFORE touching the db', async () => {
    // Anonymous and db-backed, like the deed rarity aggregate and the guild
    // roster. Every client asks once while the world loads; nothing legitimate
    // polls it, so an exhausted budget is abuse and must not reach Postgres.
    const read = vi.fn(async () => stored);
    setRealmBuilderDbForTests({ listRealmBuilders: read });
    for (let i = 0; i < PUBLIC_READ_MAX_PER_MINUTE + 1; i++) {
      publicReadRateLimited(makeReq({ method: 'GET', url: '/api/realm-builder' }));
    }
    const out = await runRoute('GET', '/api/realm-builder');
    expect(out.status).toBe(429);
    expect(out.body).toEqual({ error: 'rate limited' });
    expect(read).not.toHaveBeenCalled();
  });
});

describe('publishing to the live world', () => {
  it('hands the roll to the sim, newest first, on boot', async () => {
    expect(currentRealmBuilder().name).toBe(REALM_BUILDER_PLACEHOLDER_NAME);
    await publishRealmBuilderRoll();
    expect(currentRealmBuilder()).toEqual({ year: 2026, month: 8, name: 'Wren Ashdown' });
    expect(pastRealmBuilders()).toEqual([{ year: 2026, month: 7, name: 'Marek Fell' }]);
  });

  it('republishes on save, so the plaque does not wait for a restart', async () => {
    await publishRealmBuilderRoll();
    const out = await runRoute('POST', '/admin/api/realm-builders', {
      body: { year: 2026, month: 9, name: 'Isolde Vane', note: 'the lantern walk' },
    });
    expect(out.status).toBe(200);
    // The name a player would see, without anyone reloading anything.
    expect(currentRealmBuilder().name).toBe('Isolde Vane');
    expect(pastRealmBuilders().map((h) => h.name)).toEqual(['Wren Ashdown', 'Marek Fell']);
  });

  it('republishes on delete too', async () => {
    await publishRealmBuilderRoll();
    const out = await runRoute('POST', '/admin/api/realm-builders/delete', {
      body: { year: 2026, month: 8 },
    });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ success: true, data: { deleted: true } });
    expect(currentRealmBuilder().name).toBe('Marek Fell');
  });

  it('lets a read failure reach its caller, without wiping the roll', async () => {
    await publishRealmBuilderRoll();
    setRealmBuilderDbForTests({
      listRealmBuilders: async () => {
        throw new Error('pool timeout');
      },
    });
    // main.ts catches this and boots anyway: one cosmetic name is not worth a
    // realm's boot. What must NOT happen is the failure blanking a good roll.
    await expect(publishRealmBuilderRoll()).rejects.toThrow('pool timeout');
    expect(currentRealmBuilder().name).toBe('Wren Ashdown');
  });

  it('falls back to the shipped placeholder when the realm has named nobody', async () => {
    stored = [];
    await publishRealmBuilderRoll();
    // An empty table is not an error: it is a plaque waiting for its first name.
    expect(currentRealmBuilder().name).toBe(REALM_BUILDER_PLACEHOLDER_NAME);
    expect(pastRealmBuilders()).toEqual([]);
  });
});

describe('input validation', () => {
  const reject = async (body: unknown): Promise<number> =>
    (await runRoute('POST', '/admin/api/realm-builders', { body })).status;

  it('refuses a bad month, year or name with a 400 rather than a 500', async () => {
    // The db seam is faked here, so these are the handler's own TypeError arm
    // exercised through realm_builder_db's real validators below.
    setRealmBuilderDbForTests({
      upsertRealmBuilder: async (input) => {
        // Route through the REAL validators by calling them with a fake pool.
        const pool = { query: async () => ({ rows: [{ ...input, note: '', updated_at: 0 }] }) };
        return upsertRealmBuilder(pool as never, 'test', input);
      },
    });
    expect(await reject({ year: 2026, month: 13, name: 'x' })).toBe(400);
    expect(await reject({ year: 1900, month: 1, name: 'x' })).toBe(400);
    expect(await reject({ year: 2026, month: 1, name: '   ' })).toBe(400);
    expect(await reject({ year: 2026, month: 1, name: 'x'.repeat(200) })).toBe(400);
    expect(await reject({ year: 2026, month: 1, name: 'x', note: 'y'.repeat(400) })).toBe(400);
    // Control and bidi-override characters are not part of anybody's name;
    // they are how a name is made to render as something else on the plate.
    expect(await reject({ year: 2026, month: 1, name: 'Wren\u0000Ashdown' })).toBe(400);
    expect(await reject({ year: 2026, month: 1, name: 'Wren\u202eAshdown' })).toBe(400);
    expect(await reject({ year: 2026, month: 1, name: 'Wren\nAshdown' })).toBe(400);
    // The zero-width set can mint a name that renders empty or as a look-alike
    // of an existing honouree.
    expect(await reject({ year: 2026, month: 1, name: 'Wren\u200bAshdown' })).toBe(400);
    // (A LEADING BOM is whitespace to trim() and goes quietly; only one
    // inside the name is a refusal.)
    expect(await reject({ year: 2026, month: 1, name: 'Wren\ufeffAshdown' })).toBe(400);
    expect(await reject({ year: 2026, month: 1, name: 'Wren\u2060Ashdown' })).toBe(400);
  });

  it('accepts a name in any script, accents and all', async () => {
    // The refusal above is narrow on purpose: a name is a name. This guards
    // against a later tightening of NAME_FORBIDDEN sweeping real people out.
    const pool = {
      query: async (_sql: string, params: unknown[]) => ({
        rows: [
          { year: params[1], month: params[2], name: params[3], note: params[4], updated_at: 0 },
        ],
      }),
    };
    for (const name of [
      'Zoë Ní Bhriain',
      'Søren Ærø',
      '王小明',
      'Ελένη Παπαδοπούλου',
      'Đặng Thị Lan',
      // ZWNJ is orthography in Persian (and Urdu): this is Ali-Reza written
      // the way its bearer writes it, not a trick. The joiner (U+200D) is the
      // same story for Sinhala, Malayalam, Tamil and Kannada conjuncts.
      'علی\u200cرضا',
      'ශ්\u200dරී ලංකා',
    ]) {
      const row = await upsertRealmBuilder(pool as never, 'test', { year: 2026, month: 9, name });
      expect(row.name).toBe(name);
    }
  });

  it('echoes a non-Latin name through the route, body parsing and envelope included', async () => {
    // The validator accepting a name is not the same as the name surviving
    // the request: this drives the REAL validators through the route, so the
    // body decode and the success envelope are on the hook too.
    setRealmBuilderDbForTests({
      upsertRealmBuilder: async (input) => {
        const pool = {
          query: async (_sql: string, params: unknown[]) => ({
            rows: [
              {
                year: params[1],
                month: params[2],
                name: params[3],
                note: params[4],
                updated_at: 0,
              },
            ],
          }),
        };
        return upsertRealmBuilder(pool as never, 'test', input);
      },
    });
    for (const name of ['王小明', 'علی\u200cرضا']) {
      const out = await runRoute('POST', '/admin/api/realm-builders', {
        body: { year: 2026, month: 10, name },
      });
      expect(out.status).toBe(200);
      expect(out.body).toMatchObject({ success: true, data: { row: { name } } });
    }
  });

  it('trims a name but never escapes it', async () => {
    const pool = {
      query: async (_sql: string, params: unknown[]) => ({
        rows: [
          { year: params[1], month: params[2], name: params[3], note: params[4], updated_at: 0 },
        ],
      }),
    };
    // An honouree's name is a community member's own name and splices verbatim,
    // exactly like a player name: every surface writes it as text. Mangling it
    // here would mean an operator seeing their entry come back wrong.
    const row = await upsertRealmBuilder(pool as never, 'test', {
      year: 2026,
      month: 9,
      name: "  Ada O'Hare-Vance <the Third>  ",
    });
    expect(row.name).toBe("Ada O'Hare-Vance <the Third>");
  });

  it('answers whether a delete actually removed anything', async () => {
    const pool = { query: async () => ({ rowCount: 0 }) };
    expect(await deleteRealmBuilder(pool as never, 'test', 2026, 5)).toBe(false);
    const hit = { query: async () => ({ rowCount: 1 }) };
    expect(await deleteRealmBuilder(hit as never, 'test', 2026, 5)).toBe(true);
    await expect(deleteRealmBuilder(hit as never, 'test', 2026, 0)).rejects.toThrow(TypeError);
  });

  it('keeps its length caps where the dashboard can mirror them', () => {
    expect(REALM_BUILDER_MAX_NAME_LENGTH).toBeGreaterThan(0);
    expect(REALM_BUILDER_MAX_NOTE_LENGTH).toBeGreaterThan(REALM_BUILDER_MAX_NAME_LENGTH);
  });
});
