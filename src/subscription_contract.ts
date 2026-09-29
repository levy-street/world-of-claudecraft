// Shared wire contract only. Billing and entitlement authority live in the economy service.
export const GAME_SUBSCRIPTION_PLAN = 'game_monthly';
export const GAME_SUBSCRIPTION_PRICE = {
  currency: 'usd',
  unitAmount: 500,
  interval: 'month',
} as const;
export const SUBSCRIPTION_STATUSES = [
  'none',
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export interface SubscriptionSnapshot {
  available: boolean;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number | null;
  canCheckout: boolean;
  canManage: boolean;
}
export const SUBSCRIPTION_OFF: SubscriptionSnapshot = {
  available: false,
  status: 'none',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  canCheckout: false,
  canManage: false,
};
export interface SubscriptionLink {
  ok: boolean;
  url: string | null;
}
export const SUBSCRIPTION_LINK_OFF: SubscriptionLink = { ok: false, url: null };
export type SubscriptionAction = 'checkout' | 'portal';
export interface SubscriptionStoreHooks {
  snapshot(): Promise<SubscriptionSnapshot>;
  link(action: SubscriptionAction, idempotencyKey: string): Promise<SubscriptionLink>;
}
export function subscriptionSnapshot(value: unknown): SubscriptionSnapshot {
  if (!value || typeof value !== 'object') return { ...SUBSCRIPTION_OFF };
  const v = value as Record<string, unknown>;
  const price = v.price as Record<string, unknown> | undefined;
  if (
    v.available !== true ||
    v.plan !== GAME_SUBSCRIPTION_PLAN ||
    !price ||
    price.currency !== 'usd' ||
    price.unitAmount !== 500 ||
    price.interval !== 'month' ||
    !SUBSCRIPTION_STATUSES.includes(v.status as SubscriptionStatus) ||
    typeof v.cancelAtPeriodEnd !== 'boolean' ||
    typeof v.canCheckout !== 'boolean' ||
    typeof v.canManage !== 'boolean' ||
    !(
      v.currentPeriodEnd === null ||
      (Number.isSafeInteger(v.currentPeriodEnd) && Number(v.currentPeriodEnd) > 0)
    )
  ) {
    return { ...SUBSCRIPTION_OFF };
  }
  return {
    available: true,
    status: v.status as SubscriptionStatus,
    cancelAtPeriodEnd: v.cancelAtPeriodEnd,
    currentPeriodEnd: v.currentPeriodEnd as number | null,
    canCheckout:
      v.canCheckout && ['none', 'canceled', 'incomplete_expired'].includes(String(v.status)),
    canManage: v.canManage,
  };
}
export function subscriptionLink(value: unknown, action: SubscriptionAction): SubscriptionLink {
  if (!value || typeof value !== 'object') return { ...SUBSCRIPTION_LINK_OFF };
  const v = value as Record<string, unknown>;
  if (v.ok !== true || typeof v.url !== 'string') return { ...SUBSCRIPTION_LINK_OFF };
  try {
    const url = new URL(v.url);
    const host = action === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com';
    if (
      url.protocol === 'https:' &&
      url.hostname === host &&
      !url.port &&
      !url.username &&
      !url.password
    ) {
      return { ok: true, url: url.href };
    }
  } catch {
    /* Invalid upstream URL fails closed. */
  }
  return { ...SUBSCRIPTION_LINK_OFF };
}
