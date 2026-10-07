// Shared wire contract only. Billing and entitlement authority live in the economy service.
import type { MembershipTokenStoreHooks } from './membership_token_contract';
export const GAME_SUBSCRIPTION_PLAN = 'game_monthly';
export const GAME_SUBSCRIPTION_PRICE = {
  currency: 'usd',
  unitAmount: 500,
  interval: 'month',
} as const;
export const GAME_SUBSCRIPTION_PLANS = {
  game_monthly: { plan: 'game_monthly', price: GAME_SUBSCRIPTION_PRICE },
  game_annual: {
    plan: 'game_annual',
    price: { currency: 'usd', unitAmount: 5000, interval: 'year' },
  },
} as const;
export type GameSubscriptionPlan = keyof typeof GAME_SUBSCRIPTION_PLANS;
export type SubscriptionOffer = (typeof GAME_SUBSCRIPTION_PLANS)[GameSubscriptionPlan];
export function isGameSubscriptionPlan(value: unknown): value is GameSubscriptionPlan {
  return value === 'game_monthly' || value === 'game_annual';
}
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
  /** Authenticated game account, used only to isolate local checkout reminders. */
  accountId?: number;
  plan?: GameSubscriptionPlan;
  price?: SubscriptionOffer['price'];
  plans?: SubscriptionOffer[];
  trialEligible?: boolean;
  trialDays?: 7;
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
  /** Exact owned checkout is definitively closed and has no reward left to claim. */
  retryWithNewKey?: true;
}
export const SUBSCRIPTION_LINK_OFF: SubscriptionLink = { ok: false, url: null };
export type SubscriptionAction = 'checkout' | 'portal';
export interface SubscriptionStoreHooks extends MembershipTokenStoreHooks {
  snapshot(): Promise<SubscriptionSnapshot>;
  link(
    action: SubscriptionAction,
    idempotencyKey: string,
    plan?: GameSubscriptionPlan,
  ): Promise<SubscriptionLink>;
  annualMountClaim?(idempotencyKey?: string): Promise<{ delivered: boolean }>;
}
function validOffer(plan: unknown, price: unknown): plan is GameSubscriptionPlan {
  if (!isGameSubscriptionPlan(plan) || !price || typeof price !== 'object') return false;
  const expected = GAME_SUBSCRIPTION_PLANS[plan].price;
  const received = price as Record<string, unknown>;
  return (
    received.currency === expected.currency &&
    received.unitAmount === expected.unitAmount &&
    received.interval === expected.interval
  );
}
export function subscriptionSnapshot(value: unknown): SubscriptionSnapshot {
  if (!value || typeof value !== 'object') return { ...SUBSCRIPTION_OFF };
  const v = value as Record<string, unknown>;
  const price = v.price as Record<string, unknown> | undefined;
  if (
    v.available !== true ||
    (v.accountId !== undefined &&
      (!Number.isSafeInteger(v.accountId) || Number(v.accountId) <= 0)) ||
    !validOffer(v.plan, price) ||
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
  // A legacy service only advertises monthly billing. Never manufacture annual or trial offers.
  const plans: SubscriptionOffer[] = [];
  if (v.plans !== undefined) {
    if (!Array.isArray(v.plans) || v.plans.length < 1 || v.plans.length > 2)
      return { ...SUBSCRIPTION_OFF };
    for (const offer of v.plans) {
      if (!offer || typeof offer !== 'object' || Array.isArray(offer))
        return { ...SUBSCRIPTION_OFF };
      const candidate = offer as Record<string, unknown>;
      const plan = candidate.plan;
      if (!validOffer(plan, candidate.price) || plans.some((row) => row.plan === plan))
        return { ...SUBSCRIPTION_OFF };
      plans.push(GAME_SUBSCRIPTION_PLANS[plan]);
    }
    if (
      !plans.some((offer) => offer.plan === v.plan) ||
      typeof v.trialEligible !== 'boolean' ||
      v.trialDays !== 7
    )
      return { ...SUBSCRIPTION_OFF };
  } else if (
    v.plan !== GAME_SUBSCRIPTION_PLAN ||
    v.trialEligible !== undefined ||
    v.trialDays !== undefined
  )
    return { ...SUBSCRIPTION_OFF };
  return {
    ...(v.accountId === undefined ? {} : { accountId: v.accountId as number }),
    ...(v.plans === undefined
      ? {}
      : {
          plan: v.plan as GameSubscriptionPlan,
          price: GAME_SUBSCRIPTION_PLANS[v.plan as GameSubscriptionPlan].price,
          plans,
          trialEligible: v.trialEligible as boolean,
          trialDays: 7 as const,
        }),
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
  if (action === 'checkout' && v.ok === false && v.url === null && v.retryWithNewKey === true)
    return { ok: false, url: null, retryWithNewKey: true };
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
