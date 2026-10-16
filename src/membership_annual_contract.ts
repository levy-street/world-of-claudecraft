/** Fixed annual bundle reward. The provider proves payment, never chooses an item. */
export const MEMBERSHIP_ANNUAL_REWARD_SKU = 'membership_annual_tank';
export const MEMBERSHIP_ANNUAL_MOUNT = 'terrorspark_groundshaker';
export const MEMBERSHIP_ANNUAL_REINS = 'reins_terrorspark_groundshaker';

export function membershipAnnualReceipt(
  value: unknown,
  recipient: { accountId: number; characterId: number; realm: string },
): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const p = v.price as Record<string, unknown> | undefined;
  return v.settled === true &&
    v.accountId === recipient.accountId &&
    v.characterId === recipient.characterId &&
    v.realm === recipient.realm &&
    v.plan === 'game_annual' &&
    p?.currency === 'usd' &&
    p.unitAmount === 5000 &&
    p.interval === 'year' &&
    typeof v.receiptId === 'string' &&
    /^[A-Za-z0-9_-]{16,128}$/.test(v.receiptId)
    ? v.receiptId
    : null;
}
