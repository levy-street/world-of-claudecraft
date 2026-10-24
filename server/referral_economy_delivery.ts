import { callService } from './claudium_proxy';

export interface FirstPaidMembership {
  receiptId: string;
  paidAtMs: number;
  plan: 'game_monthly' | 'game_annual';
  reversed: boolean;
}
export interface FirstPaidFeedReceipt {
  cursor: string;
  accountId: number;
  firstPaid: FirstPaidMembership | null;
}
const validId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const validKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const validCursor = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(0|[1-9]\d{0,18})$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;
function paidMembership(value: unknown): FirstPaidMembership | null | undefined {
  if (value === null) return null;
  if (
    !record(value) ||
    !validKey(value.receiptId) ||
    !validId(value.paidAtMs) ||
    (value.plan !== 'game_monthly' && value.plan !== 'game_annual') ||
    typeof value.reversed !== 'boolean'
  )
    return undefined;
  return {
    receiptId: value.receiptId,
    paidAtMs: value.paidAtMs,
    plan: value.plan,
    reversed: value.reversed,
  };
}

/** Global paid evidence discovery, independent of referee presence. Advance the
 * durable consumer cursor only in the transaction that records matching rewards. */
export async function firstPaidFeed(
  after: string,
  limit = 25,
): Promise<{
  nextCursor: string;
  receipts: FirstPaidFeedReceipt[];
} | null> {
  if (!validCursor(after) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return null;
  const raw = await callService<unknown>({
    method: 'POST',
    path: 'subscriptions/first-paid/feed',
    body: { after, limit },
  });
  if (
    !record(raw) ||
    raw.available !== true ||
    raw.after !== after ||
    !validCursor(raw.nextCursor) ||
    !Array.isArray(raw.receipts) ||
    raw.receipts.length > limit
  )
    return null;
  let previous = after;
  const receipts: FirstPaidFeedReceipt[] = [];
  for (const row of raw.receipts) {
    if (
      !record(row) ||
      !validCursor(row.cursor) ||
      BigInt(row.cursor) <= BigInt(previous) ||
      !validId(row.accountId)
    )
      return null;
    const firstPaid = paidMembership(row.firstPaid);
    if (firstPaid === undefined) return null;
    receipts.push({ cursor: row.cursor, accountId: row.accountId, firstPaid });
    previous = row.cursor;
  }
  return raw.nextCursor === previous ? { nextCursor: previous, receipts } : null;
}

/** An unavailable or malformed batch is never evidence of an unpaid account. */
export async function firstPaidBatch(
  accountIds: readonly number[],
): Promise<Map<number, FirstPaidMembership | null> | null> {
  if (
    accountIds.length < 1 ||
    accountIds.length > 100 ||
    accountIds.some((id) => !validId(id)) ||
    new Set(accountIds).size !== accountIds.length
  )
    return null;
  const raw = await callService<unknown>({
    method: 'POST',
    path: 'subscriptions/first-paid/batch',
    body: { accountIds },
  });
  if (
    !record(raw) ||
    raw.available !== true ||
    !Array.isArray(raw.memberships) ||
    raw.memberships.length !== accountIds.length
  )
    return null;
  const wanted = new Set(accountIds);
  const result = new Map<number, FirstPaidMembership | null>();
  for (const row of raw.memberships) {
    if (!record(row) || !validId(row.accountId) || !wanted.delete(row.accountId)) return null;
    const paid = paidMembership(row.firstPaid);
    if (paid === undefined) return null;
    result.set(row.accountId, paid);
  }
  return wanted.size === 0 ? result : null;
}

/** A false/unknown outcome leaves the durable game outbox pending. Retries must
 * retain the same completion ID, including across a lost response or restart. */
export async function grantClaudium(
  accountId: number,
  cardNumber: 3 | 4,
  receipt: string,
): Promise<boolean> {
  if (!validId(accountId) || (cardNumber !== 3 && cardNumber !== 4) || !validKey(receipt))
    return false;
  const raw = await callService<unknown>({
    method: 'POST',
    path: 'referrals/card-credit',
    body: { accountId, cardNumber, completionId: receipt },
  });
  return (
    record(raw) &&
    raw.granted === true &&
    raw.accountId === accountId &&
    raw.cardNumber === cardNumber &&
    raw.completionId === receipt &&
    raw.amount === 1000 &&
    typeof raw.entryId === 'string' &&
    /^[1-9]\d{0,19}$/.test(raw.entryId) &&
    typeof raw.alreadyApplied === 'boolean'
  );
}
