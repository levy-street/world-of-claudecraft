import { describe, expect, it } from 'vitest';
import {
  MEMBERSHIP_TOKEN_PRICE,
  MEMBERSHIP_TOKEN_SKU,
  membershipTokenOffer,
} from '../src/membership_token_contract';

describe('membership token offer', () => {
  it('requires the exact one-time 30-day fiat offer', () => {
    const value = {
      available: true,
      canCheckout: true,
      sku: MEMBERSHIP_TOKEN_SKU,
      days: 30,
      price: MEMBERSHIP_TOKEN_PRICE,
    };
    expect(membershipTokenOffer(value).canCheckout).toBe(true);
    for (const patch of [
      { days: 31 },
      { sku: 'game_monthly' },
      { price: { ...MEMBERSHIP_TOKEN_PRICE, interval: 'month' } },
      { price: { currency: 'usd', unitAmount: 499 } },
    ])
      expect(membershipTokenOffer({ ...value, ...patch }).available).toBe(false);
  });
});
