// Unit + parity-shape coverage for the public-read domain
// (server/leaderboard.ts). The pure decoders and response builders are tested
// directly; the db-touching read functions are tested against the shared FakeDb
// (FakeCharactersDb / FakeLeaderboardDb); and the runtime-only handlers (status,
// perf, leaderboard, releases) are driven through the exported `routes` array with
// a fakeCtx + an injected fake runtime, which is where the two labeled deviations
// (the /api/status name-list trim and the anonymous-friendly search/realms gate)
// and the dev-gate are asserted. The full old-vs-new byte parity lives in the
// dual-path harness (tests/server/http/parity.test.ts); this file pins the units.

// server/db.ts constructs a pg Pool at module load and throws if DATABASE_URL is
// unset; leaderboard.ts imports it, so set a dummy URL. The pool never connects:
// every read function under test is called with a FakeDb, and the handler tests
// exercised here touch only the injected runtime, never the real db reads.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase10_units';

import type * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SheetRank } from '../../server/character_sheet';
import type { ArenaLeaderRow, CharacterRow, CharacterSearchRow } from '../../server/db';
import {
  ARENA_LEADERBOARD_LIMIT,
  buildDevBoard,
  buildGuildBoard,
  buildLegacyLimitBoard,
  buildStandardBoard,
  configureLeaderboardRuntime,
  decodeArenaFormat,
  decodeLegacyLimit,
  decodePage,
  decodePageSize,
  decodeReleasesLimit,
  decodeScope,
  firstQueryValue,
  LEADERBOARD_LEGACY_LIMIT_MAX,
  type LeaderboardRuntime,
  type ReleaseEntry,
  readArenaLeaderboard,
  readProjectStats,
  readPublicSheet,
  readRealms,
  readSearch,
  resetLeaderboardDbForTests,
  resetLeaderboardRuntimeForTests,
  routes,
  SEARCH_RESULT_LIMIT,
  setLeaderboardDbForTests,
} from '../../server/leaderboard';
import {
  PUBLIC_READ_MAX_PER_MINUTE,
  publicReadRateLimited,
  resetPublicReadRateLimits,
} from '../../server/ratelimit';
import { LEADERBOARD_PAGE_SIZE } from '../../src/sim/leaderboard_page';
import type {
  DevLeaderboardEntry,
  GuildLeaderboardEntry,
  LeaderboardEntry,
} from '../../src/world_api';
import { FakeCharactersDb, FakeLeaderboardDb, type FakeRes, fakeCtx, makeReq } from './helpers';

// ---------------------------------------------------------------------------
// Local builders for seed data + a fake runtime.
// ---------------------------------------------------------------------------

function leaderRow(rank: number): LeaderboardEntry {
  return {
    rank,
    name: `Hero${rank}`,
    cls: 'warrior',
    level: 60,
    virtualLevel: 60,
    lifetimeXp: 1_000_000 - rank,
    prestigeRank: 0,
  } as unknown as LeaderboardEntry;
}

function guildRow(rank: number): GuildLeaderboardEntry {
  return {
    rank,
    name: `Guild${rank}`,
    memberCount: 10,
    totalLifetimeXp: 5_000_000 - rank,
    topLevel: 60,
  } as unknown as GuildLeaderboardEntry;
}

function devRow(rank: number): DevLeaderboardEntry {
  return { rank, login: `dev${rank}`, mergedPrs: 100 - rank, devTier: 5 };
}

function arenaRow(name: string): ArenaLeaderRow {
  return { name, class: 'mage', level: 60, rating: 1800, wins: 20, losses: 5 };
}

function characterRow(id: number, name: string): CharacterRow {
  return {
    id,
    account_id: 1,
    name,
    class: 'warrior',
    level: 42,
    state: null,
    is_gm: false,
    force_rename: false,
  };
}

const REALM_NAME = 'Claudemoon';

function fakeRuntime(overrides: Partial<LeaderboardRuntime> = {}): LeaderboardRuntime {
  return {
    playersOnline: () => 0,
    perfProfile: () => ({ ticks: 0 }),
    getLeaderboard: async () => [],
    getGuildLeaderboard: async () => [],
    getDevLeaderboard: async () => [],
    getReleases: async () => [],
    githubRepo: 'levy-street/world-of-claudecraft',
    releasesMaxLimit: 20,
    publicOrigin: () => 'https://worldofclaudecraft.com',
    toSheetRank: (rank) => (rank ? { scope: 'realm', rank: rank.rank, total: rank.total } : null),
    ...overrides,
  };
}

/** Read a handler's response off the fakeCtx's FakeRes. */
function captured(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

/** Grab a registered handler by its route path. */
function handlerFor(path: string) {
  const route = routes.find((r) => r.path === path);
  if (!route) throw new Error(`no route registered for ${path}`);
  return route.handler;
}

afterEach(() => {
  resetLeaderboardRuntimeForTests();
  resetLeaderboardDbForTests();
  resetPublicReadRateLimits();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Query decoders (pure; lenient coerce-and-default to stay parity-clean).
// ---------------------------------------------------------------------------

describe('query decoders', () => {
  it('firstQueryValue returns the first of a repeated key, mirroring URLSearchParams.get', () => {
    expect(firstQueryValue(undefined)).toBeUndefined();
    expect(firstQueryValue('one')).toBe('one');
    expect(firstQueryValue(['first', 'second'])).toBe('first');
  });

  it('decodeScope maps only the exact "global" keyword to global, else realm', () => {
    expect(decodeScope('global')).toBe('global');
    expect(decodeScope('realm')).toBe('realm');
    expect(decodeScope(undefined)).toBe('realm');
    expect(decodeScope('GLOBAL')).toBe('realm');
    expect(decodeScope('anything')).toBe('realm');
  });

  it('decodePage coerces like Number(x) || 0 (absent/junk -> 0, keeps negatives for the paginator)', () => {
    expect(decodePage(undefined)).toBe(0);
    expect(decodePage('abc')).toBe(0);
    expect(decodePage('0')).toBe(0);
    expect(decodePage('3')).toBe(3);
    expect(decodePage('-5')).toBe(-5);
  });

  it('decodePageSize coerces like Number(x) || default (absent/junk/zero -> default)', () => {
    expect(decodePageSize(undefined)).toBe(LEADERBOARD_PAGE_SIZE);
    expect(decodePageSize('abc')).toBe(LEADERBOARD_PAGE_SIZE);
    expect(decodePageSize('0')).toBe(LEADERBOARD_PAGE_SIZE);
    expect(decodePageSize('25')).toBe(25);
  });

  it('decodeLegacyLimit clamps to [1, LEADERBOARD_MAX] with the max as default', () => {
    expect(decodeLegacyLimit(undefined)).toBe(LEADERBOARD_LEGACY_LIMIT_MAX);
    expect(decodeLegacyLimit('0')).toBe(LEADERBOARD_LEGACY_LIMIT_MAX);
    expect(decodeLegacyLimit('5')).toBe(5);
    expect(decodeLegacyLimit('-3')).toBe(1);
    expect(decodeLegacyLimit('999999')).toBe(LEADERBOARD_LEGACY_LIMIT_MAX);
  });

  it('decodeArenaFormat maps only the exact "2v2" to 2v2, else 1v1', () => {
    expect(decodeArenaFormat('2v2')).toBe('2v2');
    expect(decodeArenaFormat('1v1')).toBe('1v1');
    expect(decodeArenaFormat(undefined)).toBe('1v1');
    expect(decodeArenaFormat('3v3')).toBe('1v1');
  });

  it('decodeReleasesLimit clamps to [1, max] with max as default', () => {
    expect(decodeReleasesLimit(undefined, 20)).toBe(20);
    expect(decodeReleasesLimit('5', 20)).toBe(5);
    expect(decodeReleasesLimit('0', 20)).toBe(20);
    expect(decodeReleasesLimit('999', 20)).toBe(20);
    expect(decodeReleasesLimit('-1', 20)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Response builders (pure). Convention B was NOT adopted: the `leaders` key is
// preserved (every live client reads it).
// ---------------------------------------------------------------------------

describe('response builders (convention B deferred: leaders key preserved)', () => {
  it('buildStandardBoard keeps the leaders key and the paged envelope, no items key', () => {
    const entries = [leaderRow(1), leaderRow(2), leaderRow(3)];
    const body = buildStandardBoard(REALM_NAME, 'realm', entries, 0, 2) as Record<string, unknown>;
    expect(body.realm).toBe(REALM_NAME);
    expect(body.scope).toBe('realm');
    expect(body.metric).toBe('lifetimeXp');
    expect(Array.isArray(body.leaders)).toBe(true);
    expect((body.leaders as unknown[]).length).toBe(2); // pageSize 2
    expect(body.total).toBe(3);
    expect(body.page).toBe(0);
    expect(body.pageSize).toBe(2);
    expect('items' in body).toBe(false);
  });

  it('buildLegacyLimitBoard returns a single page with total = leaders.length', () => {
    const entries = [leaderRow(1), leaderRow(2), leaderRow(3), leaderRow(4)];
    const body = buildLegacyLimitBoard(REALM_NAME, 'global', entries, 2) as Record<string, unknown>;
    expect((body.leaders as unknown[]).length).toBe(2);
    expect(body.page).toBe(0);
    expect(body.pageCount).toBe(1);
    expect(body.total).toBe(2);
    expect(body.pageSize).toBe(2);
    expect(body.metric).toBe('lifetimeXp');
  });

  it('buildGuildBoard tags board=guilds and the guild metric', () => {
    const body = buildGuildBoard(REALM_NAME, 'realm', [guildRow(1)], 0, 50) as Record<
      string,
      unknown
    >;
    expect(body.board).toBe('guilds');
    expect(body.metric).toBe('guildLifetimeXp');
    expect(Array.isArray(body.leaders)).toBe(true);
    expect(body.total).toBe(1);
  });

  it('buildDevBoard tags board=devs and the contributor metric (matches the legacy arm)', () => {
    const body = buildDevBoard(REALM_NAME, 'realm', [devRow(1), devRow(2)], 0, 50) as Record<
      string,
      unknown
    >;
    expect(body.board).toBe('devs');
    expect(body.metric).toBe('landedCommits');
    expect(Array.isArray(body.leaders)).toBe(true);
    expect(body.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Read functions via the shared FakeDb.
// ---------------------------------------------------------------------------

describe('readArenaLeaderboard (FakeLeaderboardDb)', () => {
  it('decodes the format and reads the top ARENA_LEADERBOARD_LIMIT rows', async () => {
    const db = new FakeLeaderboardDb();
    db.seedArena([arenaRow('A'), arenaRow('B')]);
    const spy = vi.spyOn(db, 'topArenaRatings');
    const out = await readArenaLeaderboard(db, '2v2');
    expect(out.format).toBe('2v2');
    expect(out.leaders.map((r) => r.name)).toEqual(['A', 'B']);
    expect(spy).toHaveBeenCalledWith(ARENA_LEADERBOARD_LIMIT, '2v2');
  });

  it('defaults an unknown format to 1v1', async () => {
    const db = new FakeLeaderboardDb();
    const out = await readArenaLeaderboard(db, 'nonsense');
    expect(out.format).toBe('1v1');
  });
});

describe('readSearch (FakeCharactersDb)', () => {
  it('returns results for a non-trivial query, capped at SEARCH_RESULT_LIMIT', async () => {
    const db = new FakeCharactersDb();
    db.seed(characterRow(1, 'Aragorn'));
    db.seed(characterRow(2, 'Aramis'));
    const spy = vi.spyOn(db, 'searchCharacters');
    const out = await readSearch(db, 'ar');
    expect(out.results.map((r: CharacterSearchRow) => r.name)).toEqual(['Aragorn', 'Aramis']);
    expect(spy).toHaveBeenCalledWith('ar', SEARCH_RESULT_LIMIT);
  });

  it('short-circuits an empty or whitespace query to [] with no db call', async () => {
    const db = new FakeCharactersDb();
    const spy = vi.spyOn(db, 'searchCharacters');
    expect((await readSearch(db, '')).results).toEqual([]);
    expect((await readSearch(db, '   ')).results).toEqual([]);
    expect((await readSearch(db, undefined)).results).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('readRealms (FakeCharactersDb)', () => {
  it('returns empty counts for an anonymous (null accountId) caller, no db call', async () => {
    const db = new FakeCharactersDb();
    const spy = vi.spyOn(db, 'characterCountsByRealm');
    const out = await readRealms(db, null, REALM_NAME, ['dir']);
    expect(out).toEqual({ current: REALM_NAME, realms: ['dir'], characters: {} });
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns per-realm counts for an authenticated caller', async () => {
    const db = new FakeCharactersDb();
    db.seed(characterRow(1, 'One'));
    db.seed(characterRow(2, 'Two'));
    const out = await readRealms(db, 1, REALM_NAME, ['dir']);
    expect(out.current).toBe(REALM_NAME);
    expect(Object.values(out.characters).reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe('readProjectStats', () => {
  it('reports accounts_created from the db, players_online from the arg, and the realm', async () => {
    const out = await readProjectStats({ getAccountsCount: async () => 123 }, 7, REALM_NAME);
    expect(out).toEqual({ accounts_created: 123, players_online: 7, realm: REALM_NAME });
  });
});

describe('readPublicSheet (FakeCharactersDb, resolved by name)', () => {
  const sheetDeps = {
    realm: REALM_NAME,
    origin: 'https://worldofclaudecraft.com',
    toSheetRank: (rank: { rank: number; total: number } | null): SheetRank | null =>
      rank ? { scope: 'realm', rank: rank.rank, total: rank.total } : null,
  };

  it('404s an unknown name (never reaching getCharacterById)', async () => {
    const db = new FakeCharactersDb();
    const spy = vi.spyOn(db, 'getCharacterById');
    const out = await readPublicSheet(db, 'Nobody', sheetDeps);
    expect(out).toEqual({ status: 404, body: { error: 'character not found' } });
    expect(spy).not.toHaveBeenCalled();
  });

  it('resolves by name (case-insensitively) and returns a 200 public sheet with guild + rank', async () => {
    const db = new FakeCharactersDb();
    db.seed(characterRow(11, 'Zealot'));
    db.seedGuildName(11, 'Wolfpack');
    db.seedStanding(11, { rank: 3, total: 100 });
    // Lower-cased name still resolves (findCharacterReportTargetByName is case-insensitive).
    const out = await readPublicSheet(db, 'zealot', sheetDeps);
    expect(out.status).toBe(200);
    const body = out.body as Record<string, unknown>;
    expect(body.name).toBe('Zealot');
    expect(body.realm).toBe(REALM_NAME);
    expect(body.visibility).toBe('public');
    expect(body.guild).toBe('Wolfpack');
    expect(body.rank).toEqual({ scope: 'realm', rank: 3, total: 100 });
  });

  it('404s when the name resolves but the row read returns null (delete race)', async () => {
    const db = new FakeCharactersDb();
    db.seed(characterRow(21, 'Ghost'));
    // The name resolves to a target, but the row read returns null (deleted between
    // the two reads): the second 404 branch, after getCharacterById.
    vi.spyOn(db, 'getCharacterById').mockResolvedValue(null);
    const out = await readPublicSheet(db, 'Ghost', sheetDeps);
    expect(out).toEqual({ status: 404, body: { error: 'character not found' } });
  });

  it('returns a 200 sheet with a null rank when the character has no lifetime-XP standing', async () => {
    const db = new FakeCharactersDb();
    db.seed(characterRow(22, 'Unranked'));
    db.seedGuildName(22, 'Nomads');
    // No seedStanding: lifetimeXpRankForCharacter -> null -> toSheetRank(null) -> null.
    const out = await readPublicSheet(db, 'Unranked', sheetDeps);
    expect(out.status).toBe(200);
    const body = out.body as Record<string, unknown>;
    expect(body.guild).toBe('Nomads');
    expect(body.rank).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Runtime-only handlers via the exported routes + fakeCtx. This is where the two
// deviations and the dev-gate are pinned.
// ---------------------------------------------------------------------------

describe('status handler (name-list trim deviation)', () => {
  it('returns counts only: { ok, realm, players_online } with NO names list', async () => {
    configureLeaderboardRuntime(fakeRuntime({ playersOnline: () => 4 }));
    const ctx = fakeCtx({ method: 'GET', url: '/api/status' });
    await handlerFor('/api/status')(ctx);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, realm: REALM_NAME, players_online: 4 });
    expect('names' in (body as object)).toBe(false);
  });
});

describe('perf handler (ALLOW_DEV_COMMANDS gate)', () => {
  it('is unreachable without the dev flag: 404 unknown endpoint', async () => {
    const saved = process.env.ALLOW_DEV_COMMANDS;
    process.env.ALLOW_DEV_COMMANDS = '0';
    try {
      configureLeaderboardRuntime(fakeRuntime());
      const ctx = fakeCtx({ method: 'GET', url: '/api/perf' });
      await handlerFor('/api/perf')(ctx);
      expect(captured(ctx.res)).toEqual({ status: 404, body: { error: 'unknown endpoint' } });
    } finally {
      if (saved === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = saved;
    }
  });

  it('serves the perf profile when the dev flag is set', async () => {
    const saved = process.env.ALLOW_DEV_COMMANDS;
    process.env.ALLOW_DEV_COMMANDS = '1';
    try {
      configureLeaderboardRuntime(fakeRuntime({ perfProfile: () => ({ p95: 3 }) }));
      const ctx = fakeCtx({ method: 'GET', url: '/api/perf' });
      await handlerFor('/api/perf')(ctx);
      expect(captured(ctx.res)).toEqual({ status: 200, body: { p95: 3 } });
    } finally {
      if (saved === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = saved;
    }
  });
});

describe('leaderboard handler (through the injected cache-fronted runtime)', () => {
  it('serves the default paged player board (leaders key preserved)', async () => {
    configureLeaderboardRuntime(fakeRuntime({ getLeaderboard: async () => [leaderRow(1)] }));
    const ctx = fakeCtx({ method: 'GET', url: '/api/leaderboard', query: {} });
    await handlerFor('/api/leaderboard')(ctx);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.metric).toBe('lifetimeXp');
    expect(Array.isArray(b.leaders)).toBe(true);
    expect((b.leaders as unknown[]).length).toBe(1);
    expect('board' in b).toBe(false);
  });

  it('serves the guild fork when board=guilds', async () => {
    configureLeaderboardRuntime(
      fakeRuntime({ getGuildLeaderboard: async () => [guildRow(1), guildRow(2)] }),
    );
    const ctx = fakeCtx({ method: 'GET', url: '/api/leaderboard', query: { board: 'guilds' } });
    await handlerFor('/api/leaderboard')(ctx);
    const b = captured(ctx.res).body as Record<string, unknown>;
    expect(b.board).toBe('guilds');
    expect(b.metric).toBe('guildLifetimeXp');
    expect(b.total).toBe(2);
  });

  it('serves the developer fork when board=devs (mirrors the legacy ?board=devs arm)', async () => {
    configureLeaderboardRuntime(
      fakeRuntime({ getDevLeaderboard: async () => [devRow(1), devRow(2), devRow(3)] }),
    );
    const ctx = fakeCtx({ method: 'GET', url: '/api/leaderboard', query: { board: 'devs' } });
    await handlerFor('/api/leaderboard')(ctx);
    const b = captured(ctx.res).body as Record<string, unknown>;
    expect(b.board).toBe('devs');
    expect(b.metric).toBe('landedCommits');
    expect(b.total).toBe(3);
    expect(Array.isArray(b.leaders)).toBe(true);
  });

  it('serves the legacy single-page board when ?limit is present', async () => {
    configureLeaderboardRuntime(
      fakeRuntime({ getLeaderboard: async () => [leaderRow(1), leaderRow(2), leaderRow(3)] }),
    );
    const ctx = fakeCtx({ method: 'GET', url: '/api/leaderboard', query: { limit: '2' } });
    await handlerFor('/api/leaderboard')(ctx);
    const b = captured(ctx.res).body as Record<string, unknown>;
    expect(b.pageCount).toBe(1);
    expect(b.pageSize).toBe(2);
    expect((b.leaders as unknown[]).length).toBe(2);
  });

  it('passes ?scope=global through to the cache-fronted read', async () => {
    const scopes: string[] = [];
    configureLeaderboardRuntime(
      fakeRuntime({
        getLeaderboard: async (scope) => {
          scopes.push(scope);
          return [];
        },
      }),
    );
    const ctx = fakeCtx({ method: 'GET', url: '/api/leaderboard', query: { scope: 'global' } });
    await handlerFor('/api/leaderboard')(ctx);
    expect(scopes).toEqual(['global']);
    expect((captured(ctx.res).body as Record<string, unknown>).scope).toBe('global');
  });
});

describe('arena leaderboard handler (through the injected db reads)', () => {
  it('decodes ?format and serves { format, leaders } from the db read', async () => {
    setLeaderboardDbForTests({
      topArenaRatings: async (_limit, format) => [arenaRow(`Champ-${format}`)],
    });
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/arena/leaderboard',
      query: { format: '2v2' },
    });
    await handlerFor('/api/arena/leaderboard')(ctx);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    const b = body as { format: string; leaders: { name: string }[] };
    expect(b.format).toBe('2v2');
    expect(b.leaders.map((r) => r.name)).toEqual(['Champ-2v2']);
  });
});

describe('project-stats handler (through the injected db reads)', () => {
  it('serves accounts_created from the db, players_online from the runtime, and the realm', async () => {
    configureLeaderboardRuntime(fakeRuntime({ playersOnline: () => 9 }));
    setLeaderboardDbForTests({ getAccountsCount: async () => 123 });
    const ctx = fakeCtx({ method: 'GET', url: '/api/project-stats' });
    await handlerFor('/api/project-stats')(ctx);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    expect(body).toEqual({ accounts_created: 123, players_online: 9, realm: REALM_NAME });
  });
});

describe('releases handler', () => {
  it('serves { repo, releases } sliced to the ?limit', async () => {
    const entries: ReleaseEntry[] = [1, 2, 3].map((n) => ({
      id: n,
      tag: `v${n}`,
      name: `Release ${n}`,
      body: '',
      url: '',
      prerelease: false,
      publishedAt: '2026-01-01T00:00:00Z',
    }));
    configureLeaderboardRuntime(
      fakeRuntime({ getReleases: async () => entries, githubRepo: 'owner/repo' }),
    );
    const ctx = fakeCtx({ method: 'GET', url: '/api/releases', query: { limit: '2' } });
    await handlerFor('/api/releases')(ctx);
    const b = captured(ctx.res).body as { repo: string; releases: unknown[] };
    expect(b.repo).toBe('owner/repo');
    expect(b.releases.length).toBe(2);
  });
});

describe('search handler (anonymous DB read is rate-limited)', () => {
  it('serves 200 under the per-IP public-read budget, then 429 { error } once exhausted, and resets', async () => {
    resetPublicReadRateLimits();
    configureLeaderboardRuntime(fakeRuntime());
    const search = handlerFor('/api/search');
    let firstStatus = 0;
    let saw429 = false;
    // The public-read limiter is per-IP; fakeCtx's makeReq shares 127.0.0.1, so a
    // tight loop past PUBLIC_READ_MAX_PER_MINUTE exhausts the same bucket.
    for (let i = 0; i < PUBLIC_READ_MAX_PER_MINUTE + 5; i++) {
      const ctx = fakeCtx({ method: 'GET', url: '/api/search' });
      await search(ctx);
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
    const ctx = fakeCtx({ method: 'GET', url: '/api/search' });
    await search(ctx);
    expect(captured(ctx.res).status).toBe(200);
  });
});

describe('public sheet handler (rate-limited before any DB read)', () => {
  it('returns 429 { error } once the public-read budget is exhausted, before any db read', async () => {
    resetPublicReadRateLimits();
    configureLeaderboardRuntime(fakeRuntime());
    // Exhaust the per-IP public-read bucket directly (the same 127.0.0.1 IP fakeCtx
    // uses), so the sheet's in-handler guard trips BEFORE its db reads (which would
    // otherwise reach the pool-less test db).
    for (let i = 0; i < PUBLIC_READ_MAX_PER_MINUTE + 1; i++) {
      publicReadRateLimited(makeReq({ method: 'GET', url: '/api/public/characters/x/sheet' }));
    }
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/public/characters/anyone/sheet',
      params: { name: 'anyone' },
    });
    await handlerFor('/api/public/characters/:name/sheet')(ctx);
    expect(captured(ctx.res)).toEqual({ status: 429, body: { error: 'rate limited' } });
  });
});

// ---------------------------------------------------------------------------
// The route table contract.
// ---------------------------------------------------------------------------

describe('routes table', () => {
  it('registers all nine public-read GET routes on the api surface', () => {
    expect(routes).toHaveLength(9);
    for (const r of routes) {
      expect(r.method).toBe('GET');
      expect(r.surface).toBe('api');
      expect(typeof r.handler).toBe('function');
    }
  });

  it('marks the public :name sheet route publicRead so the BOLA coverage helper skips it', () => {
    const sheet = routes.find((r) => r.path === '/api/public/characters/:name/sheet');
    expect(sheet?.meta?.publicRead).toBe(true);
  });

  it('mounts the anonymous-friendly resolver only on the authz-gap-close routes', () => {
    for (const path of ['/api/search', '/api/realms']) {
      const route = routes.find((r) => r.path === path);
      expect(route?.middleware?.length).toBe(1);
    }
    // A plain public read carries no auth middleware.
    expect(routes.find((r) => r.path === '/api/leaderboard')?.middleware).toBeUndefined();
  });
});
