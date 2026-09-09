import { afterEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return dbMock;
  },
}));

import { CHARACTER_SAVE_LEASED_LINE } from '../../server/character_save_statement';
import { clearOfflineItemName } from '../../server/clear_item_name_db';
import { REALM } from '../../server/realm';

const namedState = () => ({
  level: 20,
  questLog: [],
  questsDone: [],
  inventory: [
    {
      itemId: 'wyrmfall_pendant',
      count: 1,
      instance: {
        name: 'Remove this',
        signer: 'Maker',
        boundTo: 'Owner',
        rolled: { quality: 'legendary' },
      },
    },
  ],
});

function transactionClient(
  row: unknown = { level: 20, state: namedState() },
  saved: number | null = 1,
  failAt?: string,
) {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (failAt && sql.startsWith(failAt)) throw new Error('forced SQL failure');
      if (sql.startsWith('SELECT level')) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      if (sql.startsWith('UPDATE characters')) return { rows: [], rowCount: saved };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  dbMock.connect.mockResolvedValue(client);
  return client;
}

afterEach(() => {
  dbMock.query.mockReset();
  dbMock.connect.mockReset();
});

describe('atomic offline name moderation', () => {
  it('locks before reading, invalidates only the expired target nonce, and uses the shared fenced writer', async () => {
    const state = namedState();
    const before = structuredClone(state);
    const client = transactionClient({ level: 20, state });
    expect(
      await clearOfflineItemName(41, { kind: 'bag', bag: 0, itemId: 'wyrmfall_pendant' }),
    ).toEqual({ ok: true, cleared: 1 });
    const calls = client.query.mock.calls as unknown as [string, unknown[]?][];
    expect(calls.slice(0, 6)).toEqual([
      ['BEGIN'],
      ['SET LOCAL statement_timeout = 5000'],
      ['SET LOCAL lock_timeout = 2000', undefined],
      ['SET LOCAL idle_in_transaction_session_timeout = 10000', undefined],
      ['SELECT level, state FROM characters WHERE id = $1 AND realm = $2 FOR UPDATE', [41, REALM]],
      ['DELETE FROM character_leases WHERE character_id = $1 AND expires_at <= now()', [41]],
    ]);
    const update = calls[6];
    expect(update[0]).toContain('NOT EXISTS');
    expect(update[0]).toContain('expires_at > now()');
    expect(update[1]?.[0]).toBe(41);
    expect(update[1]?.[1]).toBe(20);
    expect(update[1]?.[3]).toBe(REALM);
    delete (before.inventory[0].instance as { name?: string }).name;
    expect(JSON.parse(update[1]?.[2] as string)).toEqual(before);
    expect(calls[7]).toEqual(['COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it.each([undefined, { level: 1, state: null }])(
    'refuses absent/null state before any deletion or write',
    async (row) => {
      const client = transactionClient(row ?? null);
      expect(await clearOfflineItemName(42, { kind: 'all' })).toEqual({
        ok: false,
        error: 'character not found',
      });
      expect(client.query.mock.calls.some(([sql]) => /^(DELETE|UPDATE)/.test(sql))).toBe(false);
    },
  );

  it('does not expire a lease when no named copy matches', async () => {
    const client = transactionClient();
    expect(await clearOfflineItemName(41, { kind: 'slot', slot: 'neck' })).toEqual({
      ok: false,
      error: 'no named copy matched that target',
    });
    expect(client.query.mock.calls.some(([sql]) => /^(DELETE|UPDATE)/.test(sql))).toBe(false);
  });

  it.each([0, null])('reports a live lease on a refused fenced update (%s)', async (count) => {
    const client = transactionClient(undefined, count);
    expect(await clearOfflineItemName(41, { kind: 'all' })).toEqual({
      ok: false,
      error: CHARACTER_SAVE_LEASED_LINE,
    });
    expect(client.query.mock.calls.filter(([sql]) => sql.startsWith('SELECT'))).toHaveLength(1);
  });

  it.each(['SELECT level', 'DELETE FROM', 'UPDATE characters'])(
    'rolls back and returns the client after %s failure',
    async (sql) => {
      const client = transactionClient(undefined, 1, sql);
      await expect(clearOfflineItemName(41, { kind: 'all' })).rejects.toThrow('forced SQL failure');
      expect(client.query.mock.calls.map(([text]) => text)).toContain('ROLLBACK');
      expect(client.query.mock.calls.map(([text]) => text)).not.toContain('COMMIT');
      expect(client.release).toHaveBeenCalledTimes(1);
    },
  );
});
