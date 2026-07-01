import { beforeEach, describe, expect, it, vi } from 'vitest';

// db.ts builds a pg Pool and requires DATABASE_URL at import time; stub both so
// the module loads and every query goes through a spy we can assert against.
const dbMock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  },
}));

import { saveCharacterAndMarketState } from '../server/db';
import { REALM } from '../server/realm';
import type { CharacterState, MarketSave } from '../src/sim/sim';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.connect.mockReset();
});

function clientStub() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as any);
  const release = vi.fn();
  return { query, release };
}

const STATE = {
  level: 7,
  questLog: [],
  questsDone: [],
  inventory: [],
} as unknown as CharacterState;
const MARKET = { listings: [], collections: {} } as unknown as MarketSave;

describe('saveCharacterAndMarketState', () => {
  it('writes the character row and the market row in ONE transaction (atomic escrow)', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValueOnce(client as any);

    await saveCharacterAndMarketState(42, 7, STATE, MARKET);

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    // Single transaction: BEGIN first, COMMIT last, no ROLLBACK.
    expect(sqls[0]).toMatch(/^BEGIN/);
    expect(sqls[sqls.length - 1]).toMatch(/^COMMIT/);
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(false);
    // Both rows are written on the same client (so they commit or fail together).
    expect(sqls.some((s) => /UPDATE characters/i.test(s))).toBe(true);
    expect(sqls.some((s) => /world_state/i.test(s))).toBe(true);
    // Nothing leaks onto the bare pool — atomicity would be lost otherwise.
    expect(dbMock.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('targets the realm-scoped market world_state key and the right character id', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValueOnce(client as any);

    await saveCharacterAndMarketState(99, 12, STATE, MARKET);

    const charCall = client.query.mock.calls.find((c) => /UPDATE characters/i.test(String(c[0])));
    expect(charCall?.[1]).toEqual(expect.arrayContaining([99, 12]));
    const marketCall = client.query.mock.calls.find((c) => /world_state/i.test(String(c[0])));
    // The leave-flush market write must use the SAME realm-scoped key that
    // loadMarketState/saveMarketState use, never the bare shared 'market' row,
    // or the escrowed listing lands in a key nothing reads back on next boot.
    expect(marketCall?.[1][0]).toBe(`market:${REALM}`);
    expect(marketCall?.[1]).not.toContain('market');
  });

  it('rolls back and rethrows if either write fails, leaving no half-commit', async () => {
    const client = clientStub();
    client.query.mockImplementation((sql: string) => {
      if (/UPDATE characters/i.test(sql)) throw new Error('boom');
      return Promise.resolve({ rows: [], rowCount: 0 } as any);
    });
    dbMock.connect.mockResolvedValueOnce(client as any);

    await expect(saveCharacterAndMarketState(1, 1, STATE, MARKET)).rejects.toThrow('boom');

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(sqls.some((s) => /^COMMIT/.test(s))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });
});
