// Thin game-side integration. The economy service owns Stripe and durable lifecycle state.
import {
  GAME_SUBSCRIPTION_PLANS,
  isGameSubscriptionPlan,
  SUBSCRIPTION_LINK_OFF,
  SUBSCRIPTION_OFF,
  type SubscriptionAction,
  subscriptionLink,
  subscriptionSnapshot,
} from '../src/subscription_contract';
import { callService } from './claudium_proxy';

export async function gameSubscriptionSnapshot(accountId: number) {
  if (process.env.WOC_SUBSCRIPTIONS_ENABLED !== '1') return { ...SUBSCRIPTION_OFF };
  const value = await callService<unknown>({ method: 'GET', path: `subscriptions/${accountId}` });
  const snapshot = subscriptionSnapshot(value);
  return snapshot.available ? { ...snapshot, accountId } : snapshot;
}
export async function gameSubscriptionLink(
  accountId: number,
  action: SubscriptionAction,
  body: unknown,
  recipient?: { characterId: number; realm: string } | null,
) {
  if (process.env.WOC_SUBSCRIPTIONS_ENABLED !== '1') return { ...SUBSCRIPTION_LINK_OFF };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ...SUBSCRIPTION_LINK_OFF };
  const v = body as Record<string, unknown>;
  // Never accept caller-selected accounts, Stripe prices, amounts, or redirect URLs.
  if (
    Object.keys(v).some((k) => !['rail', 'plan', 'idempotencyKey'].includes(k)) ||
    v.rail !== 'stripe' ||
    !isGameSubscriptionPlan(v.plan) ||
    typeof v.idempotencyKey !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(v.idempotencyKey)
  ) {
    return { ...SUBSCRIPTION_LINK_OFF };
  }
  const annualCheckout = action === 'checkout' && v.plan === 'game_annual';
  if (
    annualCheckout &&
    (!recipient ||
      !Number.isSafeInteger(recipient.characterId) ||
      recipient.characterId <= 0 ||
      !/^[a-z0-9_-]{1,64}$/.test(recipient.realm))
  )
    return { ...SUBSCRIPTION_LINK_OFF };
  const value = await callService<unknown>({
    method: 'POST',
    path: `subscriptions/${action}`,
    body: {
      accountId,
      plan: v.plan,
      rail: 'stripe',
      price: GAME_SUBSCRIPTION_PLANS[v.plan].price,
      idempotencyKey: v.idempotencyKey,
      ...(annualCheckout ? recipient : {}),
    },
  });
  return subscriptionLink(value, action);
}
