import { membershipAnnualReceipt } from '../src/membership_annual_contract';
import { callService } from './claudium_proxy';
import {
  configureMembershipTokenStore,
  type MembershipTokenStoreRuntime,
} from './membership_token_store';
import { REALM } from './realm';

let runtime: MembershipTokenStoreRuntime | null = null;
export function configureMembershipAnnualStore(value: MembershipTokenStoreRuntime | null): void {
  runtime = value;
}

export function configureMembershipRewardStores(
  live: () => {
    recipient: MembershipTokenStoreRuntime['recipient'];
    deliverToken: MembershipTokenStoreRuntime['deliver'];
    deliverAnnualReward: MembershipTokenStoreRuntime['deliver'];
  },
): void {
  configureMembershipTokenStore({
    recipient: (account) => live().recipient(account),
    deliver: (account, recipient, receipt) => live().deliverToken(account, recipient, receipt),
  });
  configureMembershipAnnualStore({
    recipient: (account) => live().recipient(account),
    deliver: (account, recipient, receipt) =>
      live().deliverAnnualReward(account, recipient, receipt),
  });
}
export function membershipAnnualRecipient(accountId: number) {
  const recipient = runtime?.recipient(accountId);
  return recipient ? { characterId: recipient.characterId, realm: REALM } : undefined;
}

/** Only one receipt lookup per account, with a fixed realm-wide admission bound. */
const pending = new Set<number>();
export async function gameMembershipAnnualClaim(
  accountId: number,
  body: unknown,
): Promise<{ delivered: boolean }> {
  const host = runtime;
  const recipient = host?.recipient(accountId);
  if (
    process.env.WOC_SUBSCRIPTIONS_ENABLED !== '1' ||
    !host ||
    !recipient ||
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body)
  )
    return { delivered: false };
  const v = body as Record<string, unknown>;
  if (
    Object.keys(v).some((key) => key !== 'idempotencyKey') ||
    ('idempotencyKey' in v &&
      (typeof v.idempotencyKey !== 'string' ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(v.idempotencyKey))) ||
    pending.has(accountId) ||
    pending.size >= 4
  )
    return { delivered: false };
  pending.add(accountId);
  try {
    const raw = await callService<unknown>({
      method: 'POST',
      path: 'subscriptions/annual/receipt',
      body: {
        accountId,
        characterId: recipient.characterId,
        realm: REALM,
        ...(v.idempotencyKey === undefined ? {} : { idempotencyKey: v.idempotencyKey }),
      },
    });
    const receipt = membershipAnnualReceipt(raw, {
      accountId,
      characterId: recipient.characterId,
      realm: REALM,
    });
    if (
      !receipt ||
      host !== runtime ||
      host.recipient(accountId)?.characterId !== recipient.characterId
    )
      return { delivered: false };
    return { delivered: await host.deliver(accountId, recipient, receipt) };
  } catch {
    return { delivered: false };
  } finally {
    pending.delete(accountId);
  }
}
