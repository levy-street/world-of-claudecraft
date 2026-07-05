import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  const clientQuery = vi.fn();
  return {
    query: vi.fn(),
    clientQuery,
    connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
  };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  }),
}));

import { loadMarketState, marketStateKey, saveMarketState } from '../server/db';
import { REALM } from '../server/realm';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.clientQuery.mockReset();
  dbMock.connect.mockClear();
});

describe('market state realm scoping', () => {
  it('keys the market on the realm, never the bare shared "market" row', () => {
    // The bare 'market' key is shared across every realm process pointed at the
    // same DATABASE_URL, so two realms would clobber each other. Each realm must
    // get its own namespaced key.
    expect(marketStateKey(REALM)).toBe(`market:${REALM}`);
    expect(marketStateKey('Ironforge')).toBe('market:Ironforge');
    expect(marketStateKey('Stormhaven')).toBe('market:Stormhaven');
    expect(marketStateKey('Ironforge')).not.toBe(marketStateKey('Stormhaven'));
  });

  it('saves under the realm-scoped key', async () => {
    dbMock.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const save = { listings: [], collections: [], nextListingId: 1 } as never;
    await saveMarketState(save);

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('INTO world_state');
    expect(params[0]).toBe(`market:${REALM}`);
  });

  it('loads the realm-scoped row when it exists, untouched', async () => {
    const own = { listings: [{ id: 7 }], collections: [], nextListingId: 8 };
    dbMock.query.mockResolvedValueOnce({ rows: [{ data: own }] });

    const loaded = await loadMarketState();

    expect(loaded).toEqual(own);
    // exactly one read, keyed to this realm; no legacy fallback, no write-back
    expect(dbMock.query).toHaveBeenCalledTimes(1);
    expect(dbMock.query.mock.calls[0][1][0]).toBe(`market:${REALM}`);
  });

  it('migrates the legacy shared "market" row into the realm key on first boot, then deletes it', async () => {
    const legacy = { listings: [{ id: 3 }], collections: [], nextListingId: 4 };
    // realm-scoped key absent
    dbMock.query.mockResolvedValueOnce({ rows: [] }); // SELECT market:<realm>
    // the migration itself runs on a dedicated transactional client
    dbMock.clientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ data: legacy }] }) // SELECT ... FOR UPDATE market
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // INSERT market:<realm>
      .mockResolvedValueOnce({}) // DELETE market
      .mockResolvedValueOnce({}); // COMMIT

    const loaded = await loadMarketState();

    expect(loaded).toEqual(legacy);
    expect(dbMock.connect).toHaveBeenCalledTimes(1);
    // the claiming read targeted the bare shared key, row-locked
    const selectCall = dbMock.clientQuery.mock.calls[1];
    expect(selectCall[0]).toContain('FOR UPDATE');
    expect(selectCall[1][0]).toBe('market');
    // the legacy listings are copied into this realm's key so they are not stranded
    const writeCall = dbMock.clientQuery.mock.calls[2];
    expect(writeCall[0]).toContain('INTO world_state');
    expect(writeCall[1][0]).toBe(`market:${REALM}`);
    expect(writeCall[1][1]).toBe(JSON.stringify(legacy));
    // the legacy row is deleted so a later-added realm can never re-adopt (and
    // duplicate) the same listings
    const deleteCall = dbMock.clientQuery.mock.calls[3];
    expect(deleteCall[0]).toContain('DELETE FROM world_state');
    expect(deleteCall[1][0]).toBe('market');
  });

  it('returns null and writes nothing when neither key exists', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] }); // SELECT market:<realm>
    dbMock.clientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT ... FOR UPDATE market
      .mockResolvedValueOnce({}); // COMMIT

    const loaded = await loadMarketState();

    expect(loaded).toBeNull();
    expect(dbMock.query).toHaveBeenCalledTimes(1); // no write-back on the pool
    // no INSERT/DELETE issued when there is nothing to migrate: just BEGIN, SELECT, COMMIT
    expect(dbMock.clientQuery).toHaveBeenCalledTimes(3);
  });
});
