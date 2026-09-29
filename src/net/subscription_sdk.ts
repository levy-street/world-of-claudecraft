import {
  GAME_SUBSCRIPTION_PLAN,
  SUBSCRIPTION_LINK_OFF,
  SUBSCRIPTION_OFF,
  type SubscriptionStoreHooks,
  subscriptionLink,
  subscriptionSnapshot,
} from '../subscription_contract';
import { apiUrl } from './online';

/** Same-origin account API only. No Stripe key, price ID, or wallet reaches this client. */
export function createSubscriptionStoreHooks(cfg: {
  token(): string | null;
  base?: string;
}): SubscriptionStoreHooks {
  async function request(path: string, body?: unknown): Promise<unknown> {
    const token = cfg.token();
    if (!token) return null;
    try {
      const response = await fetch(apiUrl(`/api/claudium/subscription${path}`, cfg.base ?? ''), {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(7000),
      });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }
  return {
    async snapshot() {
      return subscriptionSnapshot(await request('')) ?? { ...SUBSCRIPTION_OFF };
    },
    async link(action, idempotencyKey) {
      return (
        subscriptionLink(
          await request(`/${action}`, {
            plan: GAME_SUBSCRIPTION_PLAN,
            rail: 'stripe',
            idempotencyKey,
          }),
          action,
        ) ?? { ...SUBSCRIPTION_LINK_OFF }
      );
    },
  };
}

/** Existing store snapshot adapter, kept outside the entry-point coordinator. */
export async function storeSnapshotForHud(economy: {
  storeSnapshot(): Promise<{
    available: boolean;
    balance: number | null;
    items: import('./economy_sdk').ClaudiumStoreItem[];
  }>;
}) {
  const snapshot = await economy.storeSnapshot();
  return { available: snapshot.available, balance: snapshot.balance, storeItems: snapshot.items };
}
