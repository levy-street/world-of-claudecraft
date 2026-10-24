import { type SubscriptionSnapshot, subscriptionSnapshot } from '../src/subscription_contract';
import { callService } from './claudium_proxy';
import { pool } from './db';

export const MEMBERSHIP_REFRESH_BATCH_SIZE = 250;
export const MEMBERSHIP_BATCH_REMOTE_TIMEOUT_MS = 5000;
export interface MembershipBatchSource {
  prepaid: number | null;
  recurring: SubscriptionSnapshot | null;
}
type DatabaseAdmission = <T>(job: () => Promise<T>) => Promise<T>;
let database: DatabaseAdmission | null = null;

/** Boot wiring must supply the realm's shared background database admission gate. */
export function configureMembershipBatchDatabase(next: DatabaseAdmission | null): void {
  database = next;
}

export function membershipBatchAccountIds(accountIds: readonly number[]): number[] {
  if (
    accountIds.length > MEMBERSHIP_REFRESH_BATCH_SIZE ||
    accountIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new Error('invalid membership account batch');
  }
  return [...new Set(accountIds)];
}

/** Exact account matching prevents an upstream mix-up granting another account's time. */
export function parseMembershipSubscriptionBatch(
  value: unknown,
  accountIds: readonly number[],
): Map<number, SubscriptionSnapshot> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.available !== true ||
    !Array.isArray(record.subscriptions) ||
    record.subscriptions.length !== accountIds.length
  )
    return null;
  const requested = new Set(accountIds);
  const result = new Map<number, SubscriptionSnapshot>();
  for (const entry of record.subscriptions) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (
      !Number.isSafeInteger(row.accountId) ||
      !requested.has(Number(row.accountId)) ||
      result.has(Number(row.accountId))
    )
      return null;
    result.set(Number(row.accountId), subscriptionSnapshot(row));
  }
  return result;
}

/** One indexed, bounded local read and one bounded remote request, never N reads. */
export async function loadMembershipBatch(
  accountIds: readonly number[],
): Promise<Map<number, MembershipBatchSource>> {
  const ids = membershipBatchAccountIds(accountIds);
  if (ids.length === 0) return new Map();
  if (!database) throw new Error('membership batch database admission is not configured');
  const [prepaid, remote] = await Promise.all([
    database(() =>
      pool.query(
        'SELECT account_id, prepaid_until FROM account_memberships WHERE account_id = ANY($1::int[])',
        [ids],
      ),
    ),
    process.env.WOC_SUBSCRIPTIONS_ENABLED === '1'
      ? callService<unknown>({
          method: 'POST',
          path: 'subscriptions/batch',
          body: { accountIds: ids },
          timeoutMs: MEMBERSHIP_BATCH_REMOTE_TIMEOUT_MS,
        })
      : Promise.resolve(null),
  ]);
  const recurring = parseMembershipSubscriptionBatch(remote, ids);
  const local = new Map<number, number>();
  for (const row of prepaid.rows) {
    const value =
      row.prepaid_until instanceof Date
        ? row.prepaid_until.getTime()
        : Date.parse(String(row.prepaid_until));
    if (Number.isFinite(value)) local.set(Number(row.account_id), value);
  }
  return new Map(
    ids.map((id) => [
      id,
      { prepaid: local.get(id) ?? null, recurring: recurring?.get(id) ?? null },
    ]),
  );
}
