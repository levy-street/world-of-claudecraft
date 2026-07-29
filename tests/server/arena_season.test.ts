// The Arena season API surface: the public readout handler, the pure row
// grouping behind it, and the DDL pins for the four season tables.
//
// The handler's contract has one non-obvious half worth pinning: the season
// NUMBER must survive a database failure, because the countdown is what a player
// sees every time they open the window and it needs no database at all.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_arena_season_units';

import type * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The readout reads through the season SQL boundary; mock it so no case reaches
// the pool-less test database.
vi.mock('../../server/arena_season_db', async () => {
  const actual = await vi.importActual<typeof import('../../server/arena_season_db')>(
    '../../server/arena_season_db',
  );
  return { ...actual, arenaSeasonChampions: vi.fn(async () => []) };
});

import {
  ARENA_SEASON_HISTORY_DEPTH,
  buildArenaSeasonHistory,
  resetArenaSeasonCacheForTests,
  routes,
} from '../../server/arena_season';
import { ARENA_SEASON_SCHEMA, arenaSeasonChampions } from '../../server/arena_season_db';
import {
  PUBLIC_READ_MAX_PER_MINUTE,
  publicReadRateLimited,
  resetPublicReadRateLimits,
} from '../../server/ratelimit';
import { ARENA_SEASON_COUNT } from '../../src/sim/content/arena_seasons';
import { type FakeRes, fakeCtx, makeReq } from './helpers';

const championsMock = vi.mocked(arenaSeasonChampions);

const seasonsRoute = routes.find((r) => r.method === 'GET' && r.path === '/api/arena/seasons');

function captured(res: http.ServerResponse): { status: number; body: any } {
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

async function callSeasons() {
  const ctx = fakeCtx({ method: 'GET', url: '/api/arena/seasons' });
  await seasonsRoute?.handler(ctx);
  return captured(ctx.res);
}

afterEach(() => {
  resetPublicReadRateLimits();
  // The handler's champions view is TTL-cached (a season boundary is half a year
  // away), so each case starts cold or it would silently assert on the previous
  // case's snapshot instead of its own mock.
  resetArenaSeasonCacheForTests();
  championsMock.mockReset();
  championsMock.mockResolvedValue([]);
});

describe('buildArenaSeasonHistory', () => {
  const row = (over: Partial<Parameters<typeof buildArenaSeasonHistory>[0][number]> = {}) => ({
    season: 1,
    bracket: '1v1',
    name: 'Kaevar',
    cls: 'warrior' as const,
    rating: 1900,
    ...over,
  });

  it('groups award rows into one entry per season, newest first', () => {
    const history = buildArenaSeasonHistory([
      row({ season: 1 }),
      row({ season: 2, name: 'Vela', rating: 1950 }),
      row({ season: 2, bracket: '2v2', name: 'Duo', rating: 1880 }),
    ]);
    expect(history.map((h) => h.season)).toEqual([2, 1]);
    expect(history[0].deedId).toBe('feat_arena_season_2_glorious');
    expect(history[0].champions.map((c) => c.name)).toEqual(['Vela', 'Duo']);
    expect(history[1].champions).toHaveLength(1);
  });

  it('drops rows that cannot render, each for its own reason', () => {
    const history = buildArenaSeasonHistory([
      // Past the authored roster: no title exists to label the entry with.
      row({ season: ARENA_SEASON_COUNT + 5 }),
      // An unranked bracket can never crown a champion.
      row({ season: 1, bracket: 'fiesta' }),
      // A row whose character join produced no name or class.
      row({ season: 1, name: undefined }),
      row({ season: 1, cls: undefined }),
      // The one good row.
      row({ season: 1, name: 'Kaevar' }),
    ]);
    expect(history).toHaveLength(1);
    expect(history[0].season).toBe(1);
    expect(history[0].champions.map((c) => c.name)).toEqual(['Kaevar']);
  });

  it('returns nothing for an empty ledger', () => {
    expect(buildArenaSeasonHistory([])).toEqual([]);
  });
});

describe('GET /api/arena/seasons', () => {
  it('is registered as an anonymous read', () => {
    expect(seasonsRoute).toBeDefined();
    expect(seasonsRoute?.surface).toBe('api');
    // No middleware: the readout is public, like the deeds rarity aggregate.
    expect(seasonsRoute?.middleware ?? []).toEqual([]);
  });

  it('serves the live season number, the authored count, and the settled tail', async () => {
    championsMock.mockResolvedValue([
      {
        season: 1,
        bracket: '1v1',
        characterId: 7,
        accountId: 70,
        deedId: 'feat_arena_season_1_warmaster',
        rating: 1900,
        name: 'Kaevar',
        cls: 'warrior',
      },
    ]);
    const { status, body } = await callSeasons();
    expect(status).toBe(200);
    expect(body.authored).toBe(ARENA_SEASON_COUNT);
    expect(typeof body.season).toBe('number');
    expect(body.settled).toHaveLength(1);
    expect(body.settled[0].champions[0].name).toBe('Kaevar');
    // The ledger read is bounded to the history depth, never the whole table.
    expect(championsMock).toHaveBeenCalledWith(expect.any(String), ARENA_SEASON_HISTORY_DEPTH);
  });

  it('still serves the season number when the champions read fails', async () => {
    championsMock.mockRejectedValue(new Error('database unavailable'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status, body } = await callSeasons();
    errors.mockRestore();
    expect(status).toBe(200);
    expect(body.authored).toBe(ARENA_SEASON_COUNT);
    expect(body.settled).toEqual([]);
  });

  it('answers 429 once the shared public-read budget is exhausted, before the read', async () => {
    for (let i = 0; i < PUBLIC_READ_MAX_PER_MINUTE + 1; i++) {
      publicReadRateLimited(makeReq({ method: 'GET', url: '/api/arena/seasons' }));
    }
    const { status, body } = await callSeasons();
    expect(status).toBe(429);
    expect(body).toEqual({ error: 'rate limited' });
    // The budget is checked BEFORE the ledger read, so a flood costs no queries.
    expect(championsMock).not.toHaveBeenCalled();
  });
});

describe('the season schema', () => {
  it('creates the four tables idempotently', () => {
    for (const table of [
      'arena_season_entrants',
      'arena_season_partners',
      'arena_season_titles',
      'arena_season_settlements',
    ]) {
      expect(ARENA_SEASON_SCHEMA, table).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    // Additive and re-appliable at every boot: no DROP TABLE, no ALTER that
    // could fail on a database that already has these.
    expect(ARENA_SEASON_SCHEMA).not.toMatch(/DROP\s+TABLE/i);
  });

  it('keys the ledgers so a season settles once and a duo counts once', () => {
    // The settlement marker's primary key IS the exactly-once guarantee.
    expect(ARENA_SEASON_SCHEMA).toContain('PRIMARY KEY (realm, season)');
    // A duo is one row however the teams were built, enforced in the database
    // and not only by the writer's Math.min/Math.max.
    expect(ARENA_SEASON_SCHEMA).toContain('PRIMARY KEY (realm, season, character_a, character_b)');
    expect(ARENA_SEASON_SCHEMA).toContain('CHECK (character_a < character_b)');
    // The award ledger's hot read is the per-character replay at join.
    expect(ARENA_SEASON_SCHEMA).toContain(
      'CREATE INDEX IF NOT EXISTS arena_season_titles_character',
    );
  });

  it('cascades every character and account reference', () => {
    // A deleted character must not strand rows that the settlement would then
    // try to join against.
    const references = ARENA_SEASON_SCHEMA.match(/REFERENCES\s+\w+\(id\)[^,\n]*/g) ?? [];
    expect(references.length).toBeGreaterThanOrEqual(5);
    for (const ref of references) expect(ref, ref).toContain('ON DELETE CASCADE');
  });
});
