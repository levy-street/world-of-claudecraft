import {
  MEMBERSHIP_TOKEN_OFF,
  MEMBERSHIP_TOKEN_PRICE,
  MEMBERSHIP_TOKEN_SKU,
  membershipTokenOffer,
} from '../src/membership_token_contract';
import { SUBSCRIPTION_LINK_OFF, subscriptionLink } from '../src/subscription_contract';
import { createCachedRead, deepFreezeSnapshot } from './cached_read';
import { callService } from './claudium_proxy';
import { REALM } from './realm';

export interface MembershipTokenRecipient {
  characterId: number;
  name: string;
}
export interface MembershipTokenStoreRuntime {
  /** Server-owned live character identity; never accept this from the HTTP body. */
  recipient(accountId: number): MembershipTokenRecipient | null;
  /** Must durably deduplicate receipts after their mail has been collected. */
  deliver(
    accountId: number,
    recipient: MembershipTokenRecipient,
    receiptId: string,
  ): Promise<boolean>;
}
let runtime: MembershipTokenStoreRuntime | null = null;
export const MEMBERSHIP_TOKEN_OFFER_TTL_MS = 30_000;
// One viewer-identical service read per freshness window, including unavailable
// results. No account entitlement lives in this cache; checkout revalidates upstream.
const offerCache = createCachedRead(
  async () =>
    deepFreezeSnapshot(
      membershipTokenOffer(
        await callService<unknown>({ method: 'GET', path: 'membership-tokens/offer' }),
      ),
    ),
  { ttlMs: MEMBERSHIP_TOKEN_OFFER_TTL_MS, now: () => Date.now() },
);
export function configureMembershipTokenStore(value: MembershipTokenStoreRuntime | null): void {
  runtime = value;
  offerCache.bust();
}
function keyFrom(body: unknown, checkout: boolean): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const v = body as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) => !(checkout ? ['rail', 'idempotencyKey'] : ['idempotencyKey']).includes(k),
    ) ||
    (checkout && v.rail !== 'stripe') ||
    typeof v.idempotencyKey !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(v.idempotencyKey)
  )
    return null;
  return v.idempotencyKey;
}
export async function gameMembershipTokenOffer(accountId: number) {
  if (process.env.WOC_SUBSCRIPTIONS_ENABLED !== '1' || !runtime?.recipient(accountId))
    return { ...MEMBERSHIP_TOKEN_OFF };
  return offerCache.read();
}
export async function gameMembershipTokenCheckout(accountId: number, body: unknown) {
  const key = keyFrom(body, true);
  const recipient = runtime?.recipient(accountId);
  if (process.env.WOC_SUBSCRIPTIONS_ENABLED !== '1' || !key || !recipient)
    return { ...SUBSCRIPTION_LINK_OFF };
  return subscriptionLink(
    await callService<unknown>({
      method: 'POST',
      path: 'membership-tokens/checkout',
      body: {
        accountId,
        characterId: recipient.characterId,
        realm: REALM,
        rail: 'stripe',
        sku: MEMBERSHIP_TOKEN_SKU,
        quantity: 1,
        days: 30,
        price: MEMBERSHIP_TOKEN_PRICE,
        idempotencyKey: key,
      },
    }),
    'checkout',
  );
}
export async function gameMembershipTokenClaim(
  accountId: number,
  body: unknown,
): Promise<{ delivered: boolean }> {
  const key = keyFrom(body, false);
  const host = runtime;
  const recipient = host?.recipient(accountId);
  if (process.env.WOC_SUBSCRIPTIONS_ENABLED !== '1' || !key || !host || !recipient)
    return { delivered: false };
  const raw = await callService<unknown>({
    method: 'POST',
    path: 'membership-tokens/receipt',
    body: { accountId, characterId: recipient.characterId, realm: REALM, idempotencyKey: key },
  });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { delivered: false };
  const v = raw as Record<string, unknown>;
  const p = v.price as Record<string, unknown> | undefined;
  if (
    v.settled !== true ||
    v.accountId !== accountId ||
    v.characterId !== recipient.characterId ||
    v.realm !== REALM ||
    v.sku !== MEMBERSHIP_TOKEN_SKU ||
    v.quantity !== 1 ||
    v.days !== 30 ||
    typeof v.receiptId !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(v.receiptId) ||
    !p ||
    p.currency !== 'usd' ||
    p.unitAmount !== 500 ||
    'interval' in p ||
    host !== runtime ||
    host.recipient(accountId)?.characterId !== recipient.characterId
  )
    return { delivered: false };
  try {
    return { delivered: await host.deliver(accountId, recipient, v.receiptId) };
  } catch {
    return { delivered: false };
  }
}
