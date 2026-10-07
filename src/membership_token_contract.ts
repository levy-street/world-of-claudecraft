import type { SubscriptionLink } from './subscription_contract';

export const MEMBERSHIP_TOKEN_SKU = 'membership_token_30d';
export const MEMBERSHIP_TOKEN_PRICE = { currency: 'usd', unitAmount: 500 } as const;
export interface MembershipTokenOffer {
  available: boolean;
  canCheckout: boolean;
  days: 30;
  price: typeof MEMBERSHIP_TOKEN_PRICE;
}
export const MEMBERSHIP_TOKEN_OFF: MembershipTokenOffer = {
  available: false,
  canCheckout: false,
  days: 30,
  price: MEMBERSHIP_TOKEN_PRICE,
};
export interface MembershipTokenStoreHooks {
  tokenOffer?(): Promise<MembershipTokenOffer>;
  tokenCheckout?(idempotencyKey: string): Promise<SubscriptionLink>;
  tokenClaim?(idempotencyKey: string): Promise<{ delivered: boolean }>;
}
export function membershipTokenOffer(value: unknown): MembershipTokenOffer {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ...MEMBERSHIP_TOKEN_OFF };
  const v = value as Record<string, unknown>;
  const p = v.price as Record<string, unknown> | undefined;
  if (
    v.available !== true ||
    v.sku !== MEMBERSHIP_TOKEN_SKU ||
    v.days !== 30 ||
    typeof v.canCheckout !== 'boolean' ||
    !p ||
    p.currency !== 'usd' ||
    p.unitAmount !== 500 ||
    'interval' in p
  )
    return { ...MEMBERSHIP_TOKEN_OFF };
  return { available: true, canCheckout: v.canCheckout, days: 30, price: MEMBERSHIP_TOKEN_PRICE };
}
