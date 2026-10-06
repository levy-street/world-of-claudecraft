// A handshake can hold SQL rows while awaiting leases and other auth work.
// Fence those rows across final character saves without retaining tombstones
// for every account that has ever logged in. Rows are tagged only in a WeakMap.
import type { AccountMountItemsRow } from './account_mount_items_core';

export const ACCOUNT_MOUNT_ITEMS_MAX_HYDRATION_TOKENS = 4_096;
interface Token {
  revision: number;
  valid: boolean;
}
interface Stamp {
  accountId: number;
  token: Token;
  revision: number;
}
const tokens = new Map<number, Token>();
const stamps = new WeakMap<AccountMountItemsRow[], Stamp>();

function tokenFor(accountId: number): Token {
  const current = tokens.get(accountId);
  if (current) {
    tokens.delete(accountId);
    tokens.set(accountId, current);
    return current;
  }
  if (tokens.size >= ACCOUNT_MOUNT_ITEMS_MAX_HYDRATION_TOKENS) {
    const oldest = tokens.entries().next().value;
    if (oldest) {
      oldest[1].valid = false;
      tokens.delete(oldest[0]);
    }
  }
  const token = { revision: 0, valid: true };
  tokens.set(accountId, token);
  return token;
}

/** Capture BEFORE SQL begins, stamp the exact returned array upon completion. */
export function captureAccountMountItemsHydration(
  accountId: number,
): (rows: AccountMountItemsRow[]) => AccountMountItemsRow[] {
  const token = tokenFor(accountId);
  const revision = token.revision;
  return (rows) => {
    stamps.set(rows, { accountId, token, revision });
    return rows;
  };
}

export function invalidateAccountMountItemsHydration(accountId: number): void {
  tokenFor(accountId).revision++;
}

/** Untagged rows preserve the existing direct-join/test fixture contract. */
export function accountMountItemsHydrationFresh(
  accountId: number,
  rows: readonly AccountMountItemsRow[],
): boolean {
  const stamp = stamps.get(rows as AccountMountItemsRow[]);
  return (
    !stamp ||
    (stamp.accountId === accountId && stamp.token.valid && stamp.token.revision === stamp.revision)
  );
}
