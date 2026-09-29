import { describe, expect, it } from 'vitest';
import {
  GAME_SUBSCRIPTION_PRICE,
  SUBSCRIPTION_OFF,
  subscriptionLink,
  subscriptionSnapshot,
} from '../src/subscription_contract';

const valid = {
  plan: 'game_monthly',
  price: GAME_SUBSCRIPTION_PRICE,
  available: true,
  status: 'none',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  canCheckout: true,
  canManage: false,
};
describe('subscription wire contract', () => {
  it('requires exactly the USD 5 monthly plan before offering billing', () => {
    expect(subscriptionSnapshot(valid).canCheckout).toBe(true);
    for (const patch of [
      { plan: 'claudium_500' },
      { price: { ...valid.price, currency: 'usdc' } },
      { price: { ...valid.price, unitAmount: 499 } },
      { price: { ...valid.price, interval: 'year' } },
      { status: 'unknown' },
      { currentPeriodEnd: -1 },
      { available: 'true' },
    ]) {
      expect(subscriptionSnapshot({ ...valid, ...patch })).toEqual(SUBSCRIPTION_OFF);
    }
    for (const value of [null, [], {}, 'bad'])
      expect(subscriptionSnapshot(value)).toEqual(SUBSCRIPTION_OFF);
  });
  it('never offers another checkout for a live or unresolved subscription', () => {
    for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']) {
      const result = subscriptionSnapshot({ ...valid, status, canManage: true });
      expect(result.canCheckout).toBe(false);
      expect(result.canManage).toBe(true);
    }
  });
  it('allows only HTTPS links on the correct Stripe host', () => {
    expect(
      subscriptionLink({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_1' }, 'checkout')
        .ok,
    ).toBe(true);
    expect(
      subscriptionLink({ ok: true, url: 'https://billing.stripe.com/p/session/test_1' }, 'portal')
        .ok,
    ).toBe(true);
    for (const url of [
      'javascript:alert(1)',
      'https://checkout.stripe.com.evil.test/',
      'http://checkout.stripe.com/',
      'https://checkout.stripe.com:8443/',
      'https://user:pass@checkout.stripe.com/',
      'https://billing.stripe.com/p/session/x',
    ]) {
      expect(subscriptionLink({ ok: true, url }, 'checkout')).toEqual({ ok: false, url: null });
    }
  });
});
