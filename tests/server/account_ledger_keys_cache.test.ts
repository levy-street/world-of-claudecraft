// The public sheet's cached account-ledger view (server/account_ledger_keys_cache.ts):
// one read per account inside the TTL, single-flight on a cold miss, a bust
// from the record observers makes the next read refresh, and the ids-only
// SQL behind it carries no earner detail (server/account_ledger_db.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({ query: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: dbMock.query };
  },
}));

import { loadAccountLedgerKeys } from '../../server/account_ledger_db';
import {
  ACCOUNT_LEDGER_KEYS_TTL_MS,
  accountLedgerKeysFor,
  bustAccountLedgerKeys,
  setAccountLedgerKeysReaderForTests,
} from '../../server/account_ledger_keys_cache';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});
afterEach(() => {
  setAccountLedgerKeysReaderForTests(null);
});

describe('loadAccountLedgerKeys', () => {
  it('reads DISTINCT ids only, no character join, and catalog-bounds both halves', async () => {
    dbMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM character_deeds')) {
        return { rows: [{ key: 'prog_first_steps' }, { key: 'retired_deed' }] };
      }
      return { rows: [{ key: 'item:cryptbone_helm' }, { key: 'item:retired' }] };
    });
    const keys = await loadAccountLedgerKeys(7);
    expect(dbMock.query).toHaveBeenCalledTimes(2);
    for (const [sql, params] of dbMock.query.mock.calls) {
      expect(sql).toContain('SELECT DISTINCT');
      expect(sql).not.toContain('JOIN');
      expect(sql).not.toMatch(/name|class|found_at|earned_at|character_id AS/);
      expect(sql).toContain('WHERE account_id = $1');
      expect(params).toEqual([7]);
    }
    expect([...keys.deeds]).toEqual(['prog_first_steps']);
    expect([...keys.relics]).toEqual(['item:cryptbone_helm']);
  });
});

describe('accountLedgerKeysFor', () => {
  it('serves one read per account inside the TTL, collapses concurrent misses, and refreshes after a bust', async () => {
    let calls = 0;
    setAccountLedgerKeysReaderForTests(async (accountId) => {
      calls += 1;
      return { deeds: new Set([`d${accountId}:${calls}`]), relics: new Set() };
    });
    const [a, b] = await Promise.all([accountLedgerKeysFor(7), accountLedgerKeysFor(7)]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect([...a.deeds]).toEqual(['d7:1']);
    // A warm entry serves without a second read.
    expect(await accountLedgerKeysFor(7)).toBe(a);
    expect(calls).toBe(1);
    // Another account is its own entry.
    await accountLedgerKeysFor(8);
    expect(calls).toBe(2);
    // The record observers bust the account: the next read refreshes.
    bustAccountLedgerKeys(7);
    const c = await accountLedgerKeysFor(7);
    expect(calls).toBe(3);
    expect([...c.deeds]).toEqual(['d7:3']);
    expect(ACCOUNT_LEDGER_KEYS_TTL_MS).toBeGreaterThan(0);
  });

  it('a cold-read failure rejects (the sheet arms degrade to own fills) and does not poison the entry', async () => {
    let fail = true;
    setAccountLedgerKeysReaderForTests(async () => {
      if (fail) throw new Error('db down');
      return { deeds: new Set(['ok']), relics: new Set() };
    });
    await expect(accountLedgerKeysFor(7)).rejects.toThrow('db down');
    fail = false;
    expect([...(await accountLedgerKeysFor(7)).deeds]).toEqual(['ok']);
  });
});
