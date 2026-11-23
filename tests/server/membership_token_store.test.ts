import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureMembershipTokenStore,
  gameMembershipTokenCheckout,
  gameMembershipTokenClaim,
  gameMembershipTokenOffer,
} from '../../server/membership_token_store';
import { REALM } from '../../server/realm';
import { MEMBERSHIP_TOKEN_PRICE, MEMBERSHIP_TOKEN_SKU } from '../../src/membership_token_contract';

const fetchMock = vi.fn();
const deliver = vi.fn(async () => true);
const intent = 'membership-order-123456';
const receipt = {
  settled: true,
  receiptId: 'membership-receipt-123456',
  accountId: 7,
  characterId: 13,
  realm: REALM,
  sku: MEMBERSHIP_TOKEN_SKU,
  quantity: 1,
  days: 30,
  price: MEMBERSHIP_TOKEN_PRICE,
};
beforeEach(() => {
  vi.stubEnv('WOC_SUBSCRIPTIONS_ENABLED', '1');
  vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'https://economy.example/internal/');
  vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-secret');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  deliver.mockClear();
  configureMembershipTokenStore({ recipient: () => ({ characterId: 13, name: 'Alice' }), deliver });
});
afterEach(() => {
  configureMembershipTokenStore(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function reply(body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
}
describe('membership token trusted purchase boundary', () => {
  it('requires the enabled service and a live delivery host before offering checkout', async () => {
    configureMembershipTokenStore(null);
    expect((await gameMembershipTokenOffer(7)).available).toBe(false);
    expect(
      (await gameMembershipTokenCheckout(7, { rail: 'stripe', idempotencyKey: intent })).ok,
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('pins the one-time price and server-selected character when opening Stripe', async () => {
    reply({ ok: true, url: 'https://checkout.stripe.com/c/pay/test' });
    expect(
      (await gameMembershipTokenCheckout(7, { rail: 'stripe', idempotencyKey: intent })).ok,
    ).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      accountId: 7,
      characterId: 13,
      realm: REALM,
      rail: 'stripe',
      sku: MEMBERSHIP_TOKEN_SKU,
      quantity: 1,
      days: 30,
      price: MEMBERSHIP_TOKEN_PRICE,
      idempotencyKey: intent,
    });
    expect(deliver).not.toHaveBeenCalled();
  });
  it.each([
    { accountId: 8 },
    { characterId: 17 },
    { price: 1 },
    { quantity: 5 },
    { url: 'https://evil.test' },
  ])('refuses caller authority overrides %j', async (patch) => {
    expect(
      (await gameMembershipTokenCheckout(7, { rail: 'stripe', idempotencyKey: intent, ...patch }))
        .ok,
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { settled: false },
    { accountId: 8 },
    { characterId: 17 },
    { realm: 'Other' },
    { sku: 'arbitrary-item' },
    { quantity: 2 },
    { days: 60 },
    { receiptId: 'bad' },
    { price: { ...MEMBERSHIP_TOKEN_PRICE, interval: 'month' } },
  ])('rejects invalid service receipt %j', async (patch) => {
    reply({ ...receipt, ...patch });
    expect(await gameMembershipTokenClaim(7, { idempotencyKey: intent })).toEqual({
      delivered: false,
    });
    expect(deliver).not.toHaveBeenCalled();
  });
  it('delivers only a verified paid receipt and fails closed when persistence fails', async () => {
    reply(receipt);
    expect(await gameMembershipTokenClaim(7, { idempotencyKey: intent })).toEqual({
      delivered: true,
    });
    expect(deliver).toHaveBeenCalledWith(7, { characterId: 13, name: 'Alice' }, receipt.receiptId);
    deliver.mockRejectedValueOnce(new Error('database unavailable'));
    reply(receipt);
    expect(await gameMembershipTokenClaim(7, { idempotencyKey: intent })).toEqual({
      delivered: false,
    });
  });
  it('rejects a character switch while the receipt is in flight', async () => {
    let current = 13;
    configureMembershipTokenStore({
      recipient: () => ({ characterId: current, name: 'Alice' }),
      deliver,
    });
    fetchMock.mockImplementationOnce(async () => {
      current = 14;
      return new Response(JSON.stringify(receipt));
    });
    expect(await gameMembershipTokenClaim(7, { idempotencyKey: intent })).toEqual({
      delivered: false,
    });
    expect(deliver).not.toHaveBeenCalled();
  });
  it('shares one immutable offer read across accounts and refreshes after the TTL', async () => {
    vi.useFakeTimers();
    try {
      reply({
        available: true,
        canCheckout: true,
        sku: MEMBERSHIP_TOKEN_SKU,
        days: 30,
        price: MEMBERSHIP_TOKEN_PRICE,
      });
      const [one, two] = await Promise.all([
        gameMembershipTokenOffer(7),
        gameMembershipTokenOffer(8),
      ]);
      expect(one).toBe(two);
      expect(Object.isFrozen(one.price)).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await gameMembershipTokenOffer(9);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_001);
      reply({ available: false });
      expect((await gameMembershipTokenOffer(7)).available).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
