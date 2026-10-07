import type { CustodyParcelRow } from './mail_custody_overlay';
import { MembershipTokenCommitUncertain } from './membership_token_delivery_db';
import type { MembershipTokenRecipient } from './membership_token_store';

export const TOKEN_DELIVERY_MAX_IN_FLIGHT = 4;
export const TOKEN_DELIVERY_MAX_RECOVERY = 64;
export const TOKEN_DELIVERY_QUEUE_WAIT_MS = 5_000;

export interface MembershipTokenDeliveryHost {
  mailWrite<T>(job: () => Promise<T>, signal: AbortSignal): Promise<T>;
  database<T>(job: () => Promise<T>, signal: AbortSignal): Promise<T>;
  persist(
    accountId: number,
    recipient: MembershipTokenRecipient,
    receiptId: string,
  ): Promise<CustodyParcelRow | null>;
  /** Synchronous booking; false means definitely not booked. A throw is ambiguous. */
  book(parcel: CustodyParcelRow): boolean;
}

/** One active attempt per account, at most four queued/running in the realm.
 * Proofs are retained only for parcels this process definitely never booked.
 * No expiry/eviction: forgetting uncertain receipts would falsely report delivery. */
export function createMembershipTokenDelivery(host: MembershipTokenDeliveryHost) {
  const inFlight = new Map<number, { key: string; result: Promise<boolean> }>();
  const unbooked = new Map<string, CustodyParcelRow>();
  const keyFor = (accountId: number, recipient: MembershipTokenRecipient, receiptId: string) =>
    `${accountId}:${recipient.characterId}:${receiptId}`;

  return (
    accountId: number,
    recipient: MembershipTokenRecipient,
    receiptId: string,
  ): Promise<boolean> => {
    const key = keyFor(accountId, recipient, receiptId);
    const pending = inFlight.get(accountId);
    if (pending) return pending.key === key ? pending.result : Promise.resolve(false);
    if (
      inFlight.size >= TOKEN_DELIVERY_MAX_IN_FLIGHT ||
      (!unbooked.has(key) && unbooked.size + inFlight.size >= TOKEN_DELIVERY_MAX_RECOVERY)
    )
      return Promise.resolve(false);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TOKEN_DELIVERY_QUEUE_WAIT_MS);
    const result = Promise.resolve()
      .then(() =>
        host.mailWrite(async () => {
          if (controller.signal.aborted) return false;
          let parcel: CustodyParcelRow | null;
          try {
            parcel = await host.database(
              () => host.persist(accountId, recipient, receiptId),
              controller.signal,
            );
          } catch (error) {
            if (error instanceof MembershipTokenCommitUncertain) unbooked.set(key, error.parcel);
            return false;
          }
          // A returned null has rechecked the immutable receipt identity in Postgres.
          // It is safe to recover only with proof that THIS process never live-booked it.
          parcel ??= unbooked.get(key) ?? null;
          if (!parcel) return true;
          // Remove proof before touching the live book. A throw may happen after a
          // side effect, so it must never authorize replay after subsequent collection.
          unbooked.delete(key);
          if (!host.book(parcel)) {
            unbooked.set(key, parcel);
            return false;
          }
          return true;
        }, controller.signal),
      )
      .catch(() => false)
      .finally(() => {
        clearTimeout(timer);
        // Admission remains held until queued or active work really settles.
        inFlight.delete(accountId);
      });
    inFlight.set(accountId, { key, result });
    return result;
  };
}
