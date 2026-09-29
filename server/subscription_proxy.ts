// Thin game-side integration. The economy service owns Stripe and durable lifecycle state.
import {
  GAME_SUBSCRIPTION_PLAN,
  GAME_SUBSCRIPTION_PRICE,
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
  return subscriptionSnapshot(value);
}
export async function gameSubscriptionLink(
  accountId: number,
  action: SubscriptionAction,
  body: unknown,
) {
  if (process.env.WOC_SUBSCRIPTIONS_ENABLED !== '1') return { ...SUBSCRIPTION_LINK_OFF };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ...SUBSCRIPTION_LINK_OFF };
  const v = body as Record<string, unknown>;
  // Never accept caller-selected accounts, Stripe prices, amounts, or redirect URLs.
  if (
    Object.keys(v).some((k) => !['rail', 'plan', 'idempotencyKey'].includes(k)) ||
    v.rail !== 'stripe' ||
    v.plan !== GAME_SUBSCRIPTION_PLAN ||
    typeof v.idempotencyKey !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(v.idempotencyKey)
  ) {
    return { ...SUBSCRIPTION_LINK_OFF };
  }
  const value = await callService<unknown>({
    method: 'POST',
    path: `subscriptions/${action}`,
    body: {
      accountId,
      plan: GAME_SUBSCRIPTION_PLAN,
      rail: 'stripe',
      price: GAME_SUBSCRIPTION_PRICE,
      idempotencyKey: v.idempotencyKey,
    },
  });
  return subscriptionLink(value, action);
}
