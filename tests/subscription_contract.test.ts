import { describe, expect, it } from 'vitest';
import {
  GAME_SUBSCRIPTION_PLANS,
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
  it('accepts a new-intent marker only for a definite closed checkout response', () => {
    const closed = { ok: false, url: null, retryWithNewKey: true };
    expect(subscriptionLink(closed, 'checkout')).toEqual(closed);
    for (const value of [
      { ...closed, retryWithNewKey: 'true' },
      { ...closed, ok: true },
      { ...closed, url: 'https://evil.invalid' },
      null,
    ])
      expect(subscriptionLink(value, 'checkout')).toEqual({ ok: false, url: null });
    expect(subscriptionLink(closed, 'portal')).toEqual({ ok: false, url: null });
  });
  it('carries only a valid optional authenticated account scope, including legacy monthly responses', () => {
    expect(subscriptionSnapshot({ ...valid, accountId: 41 }).accountId).toBe(41);
    for (const accountId of [0, -1, 1.5, '41', null, Number.MAX_SAFE_INTEGER + 1])
      expect(subscriptionSnapshot({ ...valid, accountId })).toEqual(SUBSCRIPTION_OFF);
    expect(subscriptionSnapshot(valid).accountId).toBeUndefined();
  });
  it('requires exact advertised annual prices and lifetime trial metadata', () => {
    const annual = {
      ...valid,
      ...GAME_SUBSCRIPTION_PLANS.game_annual,
      plans: Object.values(GAME_SUBSCRIPTION_PLANS),
      trialEligible: true,
      trialDays: 7,
    };
    expect(subscriptionSnapshot(annual)).toMatchObject({
      plan: 'game_annual',
      trialEligible: true,
      plans: annual.plans,
    });
    for (const patch of [
      { price: { ...annual.price, unitAmount: 6000 } },
      { plans: [GAME_SUBSCRIPTION_PLANS.game_monthly] },
      { plans: [GAME_SUBSCRIPTION_PLANS.game_annual, GAME_SUBSCRIPTION_PLANS.game_annual] },
      { plans: [] },
      { plans: undefined },
      { trialDays: 14 },
      { trialEligible: 'true' },
    ])
      expect(subscriptionSnapshot({ ...annual, ...patch })).toEqual(SUBSCRIPTION_OFF);
    const legacy = subscriptionSnapshot(valid);
    expect(legacy.plans).toBeUndefined();
    expect(legacy.trialEligible).toBeUndefined();
    expect(subscriptionSnapshot({ ...valid, trialEligible: true, trialDays: 7 })).toEqual(
      SUBSCRIPTION_OFF,
    );
  });
  it('strips legacy currency rewards while retaining validated prices and trial offers', () => {
    const snapshot = subscriptionSnapshot({
      ...valid,
      plans: [
        { ...GAME_SUBSCRIPTION_PLANS.game_monthly, claudium: 500 },
        { ...GAME_SUBSCRIPTION_PLANS.game_annual, claudium: 6000 },
      ],
      trialEligible: true,
      trialDays: 7,
    });
    expect(snapshot.available).toBe(true);
    expect(snapshot.plans).toEqual(Object.values(GAME_SUBSCRIPTION_PLANS));
    for (const offer of snapshot.plans!) expect(offer).not.toHaveProperty('claudium');
  });
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
