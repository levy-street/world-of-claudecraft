// A handshake can hold SQL rows while awaiting leases and other auth work.
// Fence those rows across final character saves without retaining tombstones
// for every account that has ever logged in. Rows are tagged only in a WeakMap.

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
const stamps = new WeakMap<object, Stamp>();

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
): <T extends object>(rows: T[]) => T[] {
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
  rows: readonly object[],
): boolean {
  const stamp = stamps.get(rows);
  return (
    !stamp ||
    (stamp.accountId === accountId && stamp.token.valid && stamp.token.revision === stamp.revision)
  );
}
