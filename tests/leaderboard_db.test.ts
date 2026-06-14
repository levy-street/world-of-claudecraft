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

import { topCharacters } from '../server/db';
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
