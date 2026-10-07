// Account membership wire policy. All decisions are stamped by the server.
export const BASE_CHARACTER_SLOTS = 10;
export const MEMBERSHIP_CHARACTER_SLOTS = 10;
export const MEMBERSHIP_ITEM_DAYS = 30;
export const MEMBERSHIP_ITEM_DURATION_MS = MEMBERSHIP_ITEM_DAYS * 24 * 60 * 60 * 1000;

export interface MembershipSnapshot {
  active: boolean;
  /** Absolute expiry in Unix milliseconds, or null when no entitlement exists. */
  expiresAt: number | null;
}

export const MEMBERSHIP_OFF: MembershipSnapshot = { active: false, expiresAt: null };

export function membershipActive(snapshot: MembershipSnapshot, nowMs: number): boolean {
  return (
    snapshot.active && Number.isFinite(snapshot.expiresAt) && Number(snapshot.expiresAt) > nowMs
  );
}

export function membershipCharacterLimit(snapshot: MembershipSnapshot, nowMs: number): number {
  return (
    BASE_CHARACTER_SLOTS + (membershipActive(snapshot, nowMs) ? MEMBERSHIP_CHARACTER_SLOTS : 0)
  );
}

/** Slot identity survives deletions: a premium character never becomes a base character. */
export function membershipCharacterLocked(
  membershipSlot: boolean | undefined,
  snapshot: MembershipSnapshot,
  nowMs: number,
): boolean {
  return membershipSlot === true && !membershipActive(snapshot, nowMs);
}
