import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn() };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query };
  }),
}));

import { topCharacters, characterRank } from '../server/db';
import { REALM } from '../server/realm';
import { Api } from '../src/net/online';

beforeEach(() => {
  dbMock.query.mockReset();
});

describe('player leaderboard', () => {
  it('scopes the board to the current realm', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await topCharacters();

    const [sql, params] = dbMock.query.mock.calls[0];
    // Like the arena ladder, the board reads from the shared `characters`
    // table; without a realm predicate it would leak every other realm's
    // characters into this realm's rankings.
    expect(sql).toContain('WHERE realm = $1');
    expect(params[0]).toBe(REALM);
  });

  it('orders by level then xp then name', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await topCharacters();

    const [sql] = dbMock.query.mock.calls[0];
    expect(sql).toContain('ORDER BY level DESC, xp DESC, name ASC');
  });

  it('clamps the limit and binds it as the last parameter when no class filter', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await topCharacters(999);

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual([REALM, 100]);
  });

  it('clamps a too-small limit up to 1', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await topCharacters(0);

    const [, params] = dbMock.query.mock.calls[0];
    expect(params[1]).toBe(1);
  });

  it('adds a class predicate and shifts the limit placeholder for a valid class', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await topCharacters(20, 'mage');

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('AND class = $2');
    expect(sql).toContain('LIMIT $3');
    expect(params).toEqual([REALM, 'mage', 20]);
  });

  it('ignores an unknown class value and falls back to the full board', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    // Cast through unknown — an unrecognized class should not add a predicate.
    await topCharacters(20, 'sorcerer' as unknown as Parameters<typeof topCharacters>[1]);

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).not.toContain('AND class =');
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual([REALM, 20]);
  });

  it('coerces the numeric xp field from a JSONB string', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [{ name: 'Jaina', class: 'mage', level: 60, xp: '14200' }],
    });

    await expect(topCharacters(5)).resolves.toEqual([
      { name: 'Jaina', class: 'mage', level: 60, xp: 14200 },
    ]);
  });
});

describe('characterRank', () => {
  it('returns rank = (characters strictly ahead) + 1', async () => {
    // 1st query: find the target character. 2nd query: count those ahead.
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ id: 11, name: 'Thrall', class: 'shaman', level: 42, xp: '900' }] })
      .mockResolvedValueOnce({ rows: [{ ahead: 7 }] });

    await expect(characterRank('thrall')).resolves.toEqual({
      name: 'Thrall', class: 'shaman', level: 42, xp: 900, rank: 8,
    });
  });

  it('reports rank 1 when no character is ahead (ties broken by the board ordering)', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Arthas', class: 'paladin', level: 60, xp: '50000' }] })
      .mockResolvedValueOnce({ rows: [{ ahead: 0 }] });

    await expect(characterRank('Arthas')).resolves.toEqual({
      name: 'Arthas', class: 'paladin', level: 60, xp: 50000, rank: 1,
    });
  });

  it('counts ahead using the same ordering as the board (level, then xp, then name)', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ id: 7, name: 'Sylvanas', class: 'hunter', level: 50, xp: '1200' }] })
      .mockResolvedValueOnce({ rows: [{ ahead: 3 }] });

    await characterRank('Sylvanas');

    const [aheadSql, aheadParams] = dbMock.query.mock.calls[1];
    // strictly-ahead predicate mirrors topCharacters' ORDER BY level DESC, xp
    // DESC, name ASC: higher level, or equal level + higher xp, or equal
    // level + equal xp + earlier name (the name lives at $5 now that $4 is the
    // target's id, used to exclude the target row from its own count).
    expect(aheadSql).toContain('level > $2');
    expect(aheadSql).toContain("COALESCE((state->>'xp')::int, 0) > $3");
    expect(aheadSql).toContain('name < $5');
    expect(aheadParams).toEqual([REALM, 50, 1200, 7, 'Sylvanas']);
  });

  it('excludes the target row from its own ahead-count by primary id', async () => {
    // Guards the READ COMMITTED race: if the online target autosaves a higher
    // level/xp between the two queries, excluding by id keeps it from being
    // counted as ahead of its own captured anchor (which would yield rank+1).
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ id: 42, name: 'Jaina', class: 'mage', level: 60, xp: '14200' }] })
      .mockResolvedValueOnce({ rows: [{ ahead: 0 }] });

    await characterRank('Jaina');

    const [aheadSql, aheadParams] = dbMock.query.mock.calls[1];
    expect(aheadSql).toContain('AND id <> $4');
    // $4 is the target id (42), not its name — the name moved to $5.
    expect(aheadParams).toEqual([REALM, 60, 14200, 42, 'Jaina']);
  });

  it('looks the character up case-insensitively and realm-scoped', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ id: 5, name: 'Jaina', class: 'mage', level: 60, xp: '14200' }] })
      .mockResolvedValueOnce({ rows: [{ ahead: 0 }] });

    await characterRank('JAINA');

    const [findSql, findParams] = dbMock.query.mock.calls[0];
    expect(findSql).toContain('WHERE realm = $1');
    expect(findSql).toContain('lower(name) = lower($2)');
    expect(findParams[0]).toBe(REALM);
    expect(findParams[1]).toBe('JAINA');
  });

  it('returns null for an unknown character without running the count query', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await expect(characterRank('Nobody')).resolves.toBeNull();
    // only the find query ran — no point counting who's ahead of nobody
    expect(dbMock.query).toHaveBeenCalledTimes(1);
  });

  it('returns null for a blank name without touching the database', async () => {
    await expect(characterRank('   ')).resolves.toBeNull();
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it('scopes the ranking pool to a valid class on both queries', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ id: 5, name: 'Jaina', class: 'mage', level: 60, xp: '14200' }] })
      .mockResolvedValueOnce({ rows: [{ ahead: 2 }] });

    await characterRank('Jaina', 'mage');

    const [findSql, findParams] = dbMock.query.mock.calls[0];
    expect(findSql).toContain('AND class = $3');
    expect(findParams).toEqual([REALM, 'Jaina', 'mage']);

    // The class predicate shifts to $6 on the ahead query: $4 is the target id
    // (self-exclusion) and $5 is the target name (tiebreak).
    const [aheadSql, aheadParams] = dbMock.query.mock.calls[1];
    expect(aheadSql).toContain('AND class = $6');
    expect(aheadParams).toEqual([REALM, 60, 14200, 5, 'Jaina', 'mage']);
  });

  it('ignores an unknown class value and ranks against the full board', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ id: 5, name: 'Jaina', class: 'mage', level: 60, xp: '14200' }] })
      .mockResolvedValueOnce({ rows: [{ ahead: 4 }] });

    await characterRank('Jaina', 'sorcerer' as unknown as Parameters<typeof characterRank>[1]);

    const [findSql, findParams] = dbMock.query.mock.calls[0];
    expect(findSql).not.toContain('AND class =');
    expect(findParams).toEqual([REALM, 'Jaina']);
  });

  it('coerces the numeric xp field from a JSONB string', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ id: 5, name: 'Jaina', class: 'mage', level: 60, xp: '14200' }] })
      .mockResolvedValueOnce({ rows: [{ ahead: '5' }] });

    const res = await characterRank('Jaina');
    expect(res?.xp).toBe(14200);
    expect(res?.rank).toBe(6);
  });
});

describe('Api.leaderboard', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('fetches the unfiltered board when no class is given', async () => {
    const payload = { leaders: [{ name: 'Jaina', class: 'mage', level: 60, xp: 14200 }], class: null };
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => payload } as Response);

    const api = new Api();
    const res = await api.leaderboard();

    expect(fetchSpy).toHaveBeenCalledWith('/api/leaderboard', expect.any(Object));
    expect(res).toEqual(payload);
  });

  it('passes the class as a query parameter when filtering', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ leaders: [], class: 'rogue' }) } as Response);

    const api = new Api();
    await api.leaderboard('rogue');

    expect(fetchSpy).toHaveBeenCalledWith('/api/leaderboard?class=rogue', expect.any(Object));
  });

  it('throws when the request fails', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal Server Error' }),
    } as Response);

    const api = new Api();
    await expect(api.leaderboard()).rejects.toThrow('Internal Server Error');
  });
});

describe('Api.rank', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('encodes the character name as a query parameter', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ rank: null, class: null }) } as Response);

    const api = new Api();
    await api.rank('Lady Vashj');

    expect(fetchSpy).toHaveBeenCalledWith('/api/leaderboard/rank?character=Lady+Vashj', expect.any(Object));
  });

  it('adds the class when filtering the ranking pool', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ rank: null, class: 'mage' }) } as Response);

    const api = new Api();
    await api.rank('Jaina', 'mage');

    expect(fetchSpy).toHaveBeenCalledWith('/api/leaderboard/rank?character=Jaina&class=mage', expect.any(Object));
  });

  it('returns the rank entry payload', async () => {
    const payload = { rank: { name: 'Jaina', class: 'mage', level: 60, xp: 14200, rank: 3 }, class: null };
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => payload } as Response);

    const api = new Api();
    await expect(api.rank('Jaina')).resolves.toEqual(payload);
  });

  it('throws when the request fails', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'character name is required' }),
    } as Response);

    const api = new Api();
    await expect(api.rank('')).rejects.toThrow('character name is required');
  });
});
