import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstPaidBatch, firstPaidFeed, grantClaudium } from '../server/referral_economy_delivery';

const fetchMock = vi.fn();
const response = (value: unknown) =>
  fetchMock.mockResolvedValue({ ok: true, json: async () => value });
const setup = () => {
  vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'https://economy.invalid/v1/claudium/');
  vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'unit-test-only');
  vi.stubGlobal('fetch', fetchMock);
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('referral economy wire identity', () => {
  it('reads offline receipt feed cursors losslessly and validates ordered progress', async () => {
    setup();
    const after = '9007199254740992';
    const receipt = { cursor: '9007199254740993', accountId: 1, firstPaid: null };
    response({ available: true, after, nextCursor: receipt.cursor, receipts: [receipt] });
    expect(await firstPaidFeed(after)).toEqual({ nextCursor: receipt.cursor, receipts: [receipt] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ after, limit: 25 });
    for (const patch of [
      { after: '0' },
      { nextCursor: '9007199254740994' },
      { receipts: [{ ...receipt, cursor: after }] },
      { receipts: [receipt, receipt] },
      { receipts: [{ ...receipt, accountId: 0 }] },
      { receipts: [{ ...receipt, firstPaid: {} }] },
    ]) {
      response({
        available: true,
        after,
        nextCursor: receipt.cursor,
        receipts: [receipt],
        ...patch,
      });
      expect(await firstPaidFeed(after)).toBeNull();
    }
    response({ available: true, after, nextCursor: after, receipts: [] });
    expect(await firstPaidFeed(after)).toEqual({ nextCursor: after, receipts: [] });
    fetchMock.mockClear();
    expect(await firstPaidFeed('00')).toBeNull();
    expect(await firstPaidFeed('9223372036854775808')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('accepts exact paid evidence and preserves reversed tombstones', async () => {
    setup();
    const paid = {
      receiptId: 'first_paid_receipt_0001',
      paidAtMs: 1000,
      plan: 'game_monthly',
      reversed: true,
    };
    response({
      available: true,
      memberships: [
        { accountId: 2, firstPaid: null },
        { accountId: 1, firstPaid: paid },
      ],
    });
    expect(await firstPaidBatch([1, 2])).toEqual(
      new Map([
        [2, null],
        [1, paid],
      ]),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ accountIds: [1, 2] });
  });
  it('rejects missing, duplicate and foreign identities and malformed proof', async () => {
    setup();
    for (const memberships of [
      [],
      [{ accountId: 9, firstPaid: null }],
      [
        {
          accountId: 1,
          firstPaid: {
            receiptId: 'first_paid_receipt_0001',
            paidAtMs: 1000,
            plan: 'game_monthly',
            reversed: 'false',
          },
        },
      ],
    ]) {
      response({ available: true, memberships });
      expect(await firstPaidBatch([1])).toBeNull();
    }
    response({
      available: true,
      memberships: [
        { accountId: 1, firstPaid: null },
        { accountId: 1, firstPaid: null },
      ],
    });
    expect(await firstPaidBatch([1, 2])).toBeNull();
    fetchMock.mockClear();
    expect(await firstPaidBatch([1, 1])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('accepts exact credit replay and leaves mismatches and outage pending', async () => {
    setup();
    const proof = {
      granted: true,
      accountId: 1,
      cardNumber: 3,
      completionId: 'referral_completion_3',
      amount: 1000,
      entryId: '123',
      alreadyApplied: true,
    };
    response(proof);
    expect(await grantClaudium(1, 3, proof.completionId)).toBe(true);
    for (const patch of [
      { accountId: 2 },
      { cardNumber: 4 },
      { amount: 2000 },
      { completionId: 'different_completion' },
      { granted: 'true' },
      { entryId: null },
    ]) {
      response({ ...proof, ...patch });
      expect(await grantClaudium(1, 3, proof.completionId)).toBe(false);
    }
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await grantClaudium(1, 3, proof.completionId)).toBe(false);
  });
});
