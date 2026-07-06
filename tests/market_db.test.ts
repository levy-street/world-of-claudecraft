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

import {
  closeMarketWriteGateForTests,
  loadMarketState,
  marketStateKey,
  openMarketWriteGate,
  saveMarketState,
  saveWorldState,
} from '../server/db';
import { REALM } from '../server/realm';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.clientQuery.mockReset();
  dbMock.connect.mockClear();
  // Every test starts from the boot default: the market write gate is CLOSED
  // until ensureSchema's backfill opens it. Tests that need to write open it
  // explicitly.
  closeMarketWriteGateForTests();
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
});

describe('loadMarketState (pure read, backfill owns migration)', () => {
  it('returns the realm-scoped row when it exists, with a single read', async () => {
    const own = { listings: [{ id: 7 }], collections: [], nextListingId: 8 };
    dbMock.query.mockResolvedValueOnce({ rows: [{ data: own }] });

    const loaded = await loadMarketState();

    expect(loaded).toEqual(own);
    // Exactly one read, keyed to this realm: no marker probe, no legacy read,
    // no write-back, no transaction.
    expect(dbMock.query).toHaveBeenCalledTimes(1);
    expect(dbMock.query.mock.calls[0][1][0]).toBe(`market:${REALM}`);
    expect(dbMock.connect).not.toHaveBeenCalled();
  });

  it('returns null when the backfill marker exists and no realm row does (legacy ignored)', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [] }) // SELECT market:<realm> -> absent
      .mockResolvedValueOnce({ rows: [{ data: { backfilledBy: REALM } }] }); // SELECT marker -> present

    const loaded = await loadMarketState();

    // A backfilled database never serves the stale legacy blob: an empty market
    // for this realm is the correct answer.
    expect(loaded).toBeNull();
    // Two reads only: the realm key, then the marker. The bare legacy 'market'
    // row is never read once the marker is present.
    expect(dbMock.query).toHaveBeenCalledTimes(2);
    expect(dbMock.query.mock.calls[0][1][0]).toBe(`market:${REALM}`);
    expect(dbMock.query.mock.calls[1][1][0]).toBe('market_backfill_done');
    const keysRead = dbMock.query.mock.calls.map((c) => c[1][0]);
    expect(keysRead).not.toContain('market');
    expect(dbMock.connect).not.toHaveBeenCalled();
  });

  it('falls back to the retained legacy row on a pre-backfill database (no marker), reading only', async () => {
    const legacy = { listings: [{ id: 3 }], collections: [], nextListingId: 4 };
    dbMock.query
      .mockResolvedValueOnce({ rows: [] }) // SELECT market:<realm> -> absent
      .mockResolvedValueOnce({ rows: [] }) // SELECT marker -> absent
      .mockResolvedValueOnce({ rows: [{ data: legacy }] }); // SELECT market (legacy) -> present

    const loaded = await loadMarketState();

    expect(loaded).toEqual(legacy);
    // Three plain reads: realm, marker, then the bare legacy 'market' key.
    expect(dbMock.query).toHaveBeenCalledTimes(3);
    expect(dbMock.query.mock.calls[2][1][0]).toBe('market');
    // The legacy row is READ-ONLY on this path: no adoption INSERT, no DELETE,
    // and no transaction (the backfill owns adoption, not loadMarketState).
    const sqls = dbMock.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.every((s) => s.trimStart().startsWith('SELECT'))).toBe(true);
    expect(sqls.some((s) => /INSERT/i.test(s))).toBe(false);
    expect(sqls.some((s) => /DELETE/i.test(s))).toBe(false);
    expect(dbMock.connect).not.toHaveBeenCalled();
  });
});

describe('market write gate', () => {
  it('saveMarketState writes the realm-scoped key when the gate is open', async () => {
    openMarketWriteGate();
    dbMock.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const save = { listings: [], collections: [], nextListingId: 1 } as never;
    await saveMarketState(save);

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('INTO world_state');
    expect(params[0]).toBe(`market:${REALM}`);
  });

  it('blocks a market write when the gate is closed, issuing no SQL', async () => {
    closeMarketWriteGateForTests();
    const save = { listings: [], collections: [], nextListingId: 1 } as never;

    await expect(saveMarketState(save)).rejects.toThrow(/market write blocked/);
    // A direct saveWorldState to a realm-market key is gated identically.
    await expect(saveWorldState('market:Ironforge', save)).rejects.toThrow(/market write blocked/);

    expect(dbMock.query).not.toHaveBeenCalled();
    expect(dbMock.connect).not.toHaveBeenCalled();
  });

  it('rejects a write to the bare legacy "market" key even with the gate open', async () => {
    openMarketWriteGate();

    // The retained legacy row is a rollback artifact: it must never be written,
    // gate open or not.
    await expect(saveWorldState('market', { listings: [] })).rejects.toThrow(
      /legacy market key is read-only/,
    );
    expect(dbMock.query).not.toHaveBeenCalled();
  });
});
