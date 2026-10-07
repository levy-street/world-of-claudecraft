import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureMembershipAnnualStore,
  gameMembershipAnnualClaim,
  membershipAnnualRecipient,
} from '../../server/membership_annual_store';
import { REALM } from '../../server/realm';

const fetchMock = vi.fn();
const deliver = vi.fn(async () => true);
const key = 'annual-order-123456';
const receipt = {
  settled: true,
  receiptId: 'annual-receipt-123456',
  accountId: 7,
  characterId: 13,
  realm: REALM,
  plan: 'game_annual',
  price: { currency: 'usd', unitAmount: 5000, interval: 'year' },
};
beforeEach(() => {
  vi.stubEnv('WOC_SUBSCRIPTIONS_ENABLED', '1');
  vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'https://economy.example/internal/');
  vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-secret');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  deliver.mockReset().mockResolvedValue(true);
  configureMembershipAnnualStore({
    recipient: () => ({ characterId: 13, name: 'Alice' }),
    deliver,
  });
});
afterEach(() => {
  configureMembershipAnnualStore(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('verified annual membership mount receipt', () => {
  it('discovers the original paid reward on a new device without a local checkout key', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(receipt)));
    expect(await gameMembershipAnnualClaim(7, {})).toEqual({ delivered: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      accountId: 7,
      characterId: 13,
      realm: REALM,
    });
    expect(deliver).toHaveBeenCalledExactlyOnceWith(
      7,
      { characterId: 13, name: 'Alice' },
      receipt.receiptId,
    );
  });
  it.each([{ accountId: 8 }, { characterId: 14 }, { realm: 'foreign' }, { settled: false }])(
    'still rejects a foreign or unpaid receipt during keyless discovery %j',
    async (patch) => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...receipt, ...patch })));
      expect(await gameMembershipAnnualClaim(7, {})).toEqual({ delivered: false });
      expect(deliver).not.toHaveBeenCalled();
    },
  );
  it.each([
    { idempotencyKey: null },
    { idempotencyKey: '' },
    { idempotencyKey: 17 },
    { accountId: 8 },
    { characterId: 14 },
    { realm: 'foreign' },
  ])('does not turn invalid or caller-directed discovery into a lookup %j', async (body) => {
    expect(await gameMembershipAnnualClaim(7, body)).toEqual({ delivered: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('binds receipt lookup and checkout identity to the live server character', async () => {
    expect(membershipAnnualRecipient(7)).toEqual({ characterId: 13, realm: REALM });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(receipt)));
    expect(await gameMembershipAnnualClaim(7, { idempotencyKey: key })).toEqual({
      delivered: true,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      accountId: 7,
      characterId: 13,
      realm: REALM,
      idempotencyKey: key,
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('subscriptions/annual/receipt');
    expect(deliver).toHaveBeenCalledExactlyOnceWith(
      7,
      { characterId: 13, name: 'Alice' },
      receipt.receiptId,
    );
  });
  it.each([
    { settled: false },
    { accountId: 8 },
    { characterId: 14 },
    { realm: 'foreign' },
    { plan: 'game_monthly' },
    { receiptId: 'bad' },
    { price: { currency: 'usd', unitAmount: 0, interval: 'year' } },
    { price: { currency: 'usd', unitAmount: 5000, interval: 'month' } },
    { price: { currency: 'eur', unitAmount: 5000, interval: 'year' } },
  ])('refuses unpaid, trial, foreign or incompatible receipt %j', async (patch) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...receipt, ...patch })));
    expect(await gameMembershipAnnualClaim(7, { idempotencyKey: key })).toEqual({
      delivered: false,
    });
    expect(deliver).not.toHaveBeenCalled();
  });
  it.each([
    { accountId: 8 },
    { characterId: 14 },
    { realm: 'foreign' },
    { itemId: 'membership_token' },
    { receiptId: 'injected' },
  ])('rejects client authority overrides %j', async (patch) => {
    expect(await gameMembershipAnnualClaim(7, { idempotencyKey: key, ...patch })).toEqual({
      delivered: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('fails closed when disabled, unconfigured or switched to another character', async () => {
    vi.stubEnv('WOC_SUBSCRIPTIONS_ENABLED', '0');
    expect(await gameMembershipAnnualClaim(7, { idempotencyKey: key })).toEqual({
      delivered: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv('WOC_SUBSCRIPTIONS_ENABLED', '1');
    let current = 13;
    configureMembershipAnnualStore({
      recipient: () => ({ characterId: current, name: 'Alice' }),
      deliver,
    });
    fetchMock.mockImplementationOnce(async () => {
      current = 14;
      return new Response(JSON.stringify(receipt));
    });
    expect(await gameMembershipAnnualClaim(7, { idempotencyKey: key })).toEqual({
      delivered: false,
    });
    expect(deliver).not.toHaveBeenCalled();
    configureMembershipAnnualStore(null);
    expect(membershipAnnualRecipient(7)).toBeUndefined();
    expect(await gameMembershipAnnualClaim(7, { idempotencyKey: key })).toEqual({
      delivered: false,
    });
  });
  it('caps receipt checks at four and refuses a second check for the same account', async () => {
    const resolve: Array<(v: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((done) => resolve.push(done)));
    const work = [1, 2, 3, 4].map((account) =>
      gameMembershipAnnualClaim(account, { idempotencyKey: key }),
    );
    expect(await gameMembershipAnnualClaim(1, { idempotencyKey: key })).toEqual({
      delivered: false,
    });
    expect(await gameMembershipAnnualClaim(5, { idempotencyKey: key })).toEqual({
      delivered: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const done of resolve) done(new Response(JSON.stringify({ settled: false })));
    await Promise.all(work);
    expect(deliver).not.toHaveBeenCalled();
  });
  it('reports failed durable booking as undelivered', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(receipt)));
    deliver.mockRejectedValueOnce(new Error('database unavailable'));
    expect(await gameMembershipAnnualClaim(7, { idempotencyKey: key })).toEqual({
      delivered: false,
    });
  });
});
