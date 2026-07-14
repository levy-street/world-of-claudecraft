import { beforeEach, describe, expect, it, vi } from 'vitest';

// db.ts builds a pg Pool and requires DATABASE_URL at import time; stub both so the
// real module loads and every query goes through a spy (the save_character_and_market
// idiom). This pins the actual SQL insertBankLedgerRow issues, not a mock of it.
const dbMock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  },
}));

import { insertBankLedgerRow } from '../server/db';
import { REALM } from '../server/realm';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.query.mockResolvedValue({ rows: [], rowCount: 0 } as any);
});

describe('insertBankLedgerRow', () => {
  it('issues one parameterized INSERT into bank_ledger with all 11 columns', async () => {
    await insertBankLedgerRow({
      realm: REALM,
      characterId: 42,
      accountId: 7,
      op: 'deposit',
      itemId: 'wolf_fang',
      count: 2,
      instance: null,
      copperDelta: 0,
      purchasedSlotsAfter: 0,
      container: 'personal',
      containerId: null,
    });

    expect(dbMock.query).toHaveBeenCalledTimes(1);
    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO bank_ledger');
    expect(sql).toContain('realm, character_id, account_id, op, item_id, count, instance');
    expect(sql).toContain('copper_delta, purchased_slots_after, container, container_id');
    // Eleven bind params, no interpolation: the last placeholder is $11.
    expect(sql).toContain('$11');
    expect(sql).not.toContain('$12');
    expect(params).toEqual([REALM, 42, 7, 'deposit', 'wolf_fang', 2, null, 0, 0, 'personal', null]);
  });

  it('serializes the instance payload as JSON for the JSONB column', async () => {
    const instance = { signer: 'Vaulta', rolled: { quality: 'rare' } };
    await insertBankLedgerRow({
      realm: REALM,
      characterId: 42,
      accountId: 7,
      op: 'deposit',
      itemId: 'signed_blade',
      count: 1,
      instance,
      copperDelta: 0,
      purchasedSlotsAfter: 6,
      container: 'personal',
      containerId: null,
    });
    const [, params] = dbMock.query.mock.calls[0];
    // The characters.state idiom: JSONB params are JSON.stringify'd strings.
    expect(params[6]).toBe(JSON.stringify(instance));
  });

  it('writes a buy_slots row with null item fields and the negated cost', async () => {
    await insertBankLedgerRow({
      realm: REALM,
      characterId: 42,
      accountId: 7,
      op: 'buy_slots',
      itemId: null,
      count: null,
      instance: null,
      copperDelta: -500,
      purchasedSlotsAfter: 6,
      container: 'personal',
      containerId: null,
    });
    const [, params] = dbMock.query.mock.calls[0];
    expect(params).toEqual([
      REALM,
      42,
      7,
      'buy_slots',
      null,
      null,
      null,
      -500,
      6,
      'personal',
      null,
    ]);
  });
});
