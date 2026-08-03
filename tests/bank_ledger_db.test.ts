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
  it('issues one parameterized INSERT into bank_ledger with all 13 columns', async () => {
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
    expect(sql).toContain('counterparty_copper_delta, counterparty_count');
    // Thirteen bind params, no interpolation: the last placeholder is $13.
    expect(sql).toContain('$13');
    expect(sql).not.toContain('$14');
    // A personal-container row records NO counterparty side, and the two
    // columns bind NULL rather than 0: the audit must skip an unrecorded side,
    // never read it as a balanced op.
    expect(params).toEqual([
      REALM,
      42,
      7,
      'deposit',
      'wolf_fang',
      2,
      null,
      0,
      0,
      'personal',
      null,
      null,
      null,
    ]);
  });

  it('binds the counterparty side when the guild observer supplies it', async () => {
    await insertBankLedgerRow({
      realm: REALM,
      characterId: 42,
      accountId: 7,
      op: 'withdraw_gold',
      itemId: null,
      count: null,
      instance: null,
      copperDelta: -1500,
      purchasedSlotsAfter: 24,
      container: 'guild',
      containerId: 913,
      counterpartyCopperDelta: 1500,
      counterpartyCount: 0,
    });
    const [, params] = dbMock.query.mock.calls[0];
    // The treasury lost 1500 and the acting purse gained exactly that: the two
    // columns are the two halves of one movement, bound as numbers (a 0 count
    // is a RECORDED zero, never a null).
    expect(params[11]).toBe(1500);
    expect(params[12]).toBe(0);
  });

  it('binds an explicit null counterparty side as null, not as zero', async () => {
    await insertBankLedgerRow({
      realm: REALM,
      characterId: 42,
      accountId: 7,
      op: 'escrow_deficit',
      itemId: null,
      count: null,
      instance: null,
      copperDelta: -250,
      purchasedSlotsAfter: 0,
      container: 'guild',
      containerId: 913,
      counterpartyCopperDelta: 250,
      counterpartyCount: null,
    });
    const [, params] = dbMock.query.mock.calls[0];
    expect(params[11]).toBe(250);
    expect(params[12]).toBeNull();
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
      null,
      null,
    ]);
  });
});

describe('insertBankLedgerRow (guild container rows, Guild Bank Phase 3)', () => {
  it('writes a guild deposit_gold row with container=guild and the guild id', async () => {
    await insertBankLedgerRow({
      realm: REALM,
      characterId: 42,
      accountId: 7,
      op: 'deposit_gold',
      itemId: null,
      count: null,
      instance: null,
      copperDelta: 1500,
      purchasedSlotsAfter: 6,
      container: 'guild',
      containerId: 913,
    });
    const [, params] = dbMock.query.mock.calls[0];
    expect(params).toEqual([
      REALM,
      42,
      7,
      'deposit_gold',
      null,
      null,
      null,
      1500,
      6,
      'guild',
      913,
      null,
      null,
    ]);
  });

  it('writes the create_fee row shape (negated fee, zero slots)', async () => {
    await insertBankLedgerRow({
      realm: REALM,
      characterId: 42,
      accountId: 7,
      op: 'create_fee',
      itemId: null,
      count: null,
      instance: null,
      copperDelta: -100000,
      purchasedSlotsAfter: 0,
      container: 'guild',
      containerId: 913,
    });
    const [, params] = dbMock.query.mock.calls[0];
    expect(params).toEqual([
      REALM,
      42,
      7,
      'create_fee',
      null,
      null,
      null,
      -100000,
      0,
      'guild',
      913,
      null,
      null,
    ]);
  });
});
