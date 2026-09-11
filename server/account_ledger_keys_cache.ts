// The public sheet's view of the account ledger: ids only, TTL-cached per
// account. The /c/ page, the public JSON sheet, and the owner sheet need the
// account-wide Reliquary PAIR (owned, total, rank), which is a membership
// question over deed ids and relic keys; none of them needs the earner detail
// (names, classes, ids, days) the join-time ledger carries, so the anonymous
// handlers never load it. server/CLAUDE.md classes a per-request
// viewer-identical read as a defect: the sheet is the scrape target and the
// read grows with account age, so every arm goes through this keyed
// single-flight cache (the character_rank_cache shape), and the two record
// observers bust the account's entry when a row lands, so a fresh find shows
// on the next sheet read instead of waiting out the TTL.

import { type AccountLedgerKeys, loadAccountLedgerKeys } from './account_ledger_db';
import { KeyedCachedRead } from './cached_read';

/** How long a public-sheet ledger read may serve before it refreshes. The
 *  busts below make growth visible sooner; the TTL only bounds staleness when
 *  a bust is lost (another realm process wrote the row). */
export const ACCOUNT_LEDGER_KEYS_TTL_MS = 60_000;
/** Entry bound: one entry per account that had a sheet read inside the TTL. */
export const ACCOUNT_LEDGER_KEYS_MAX_ENTRIES = 5000;

let cache: KeyedCachedRead<AccountLedgerKeys, number> | null = null;
let reader: (accountId: number) => Promise<AccountLedgerKeys> = loadAccountLedgerKeys;

function active(): KeyedCachedRead<AccountLedgerKeys, number> {
  cache ??= new KeyedCachedRead<AccountLedgerKeys, number>((accountId) => reader(accountId), {
    ttlMs: ACCOUNT_LEDGER_KEYS_TTL_MS,
    maxEntries: ACCOUNT_LEDGER_KEYS_MAX_ENTRIES,
  });
  return cache;
}

/** The account's deed ids and relic keys, cached; rejects only when the cold
 *  read fails (a warm entry stale-serves). Callers degrade to own fills. */
export function accountLedgerKeysFor(accountId: number): Promise<AccountLedgerKeys> {
  return active().read(accountId);
}

/** Drop the account's entry: called by the deed and relic record observers
 *  after an insert lands, so the next sheet read sees the new row. */
export function bustAccountLedgerKeys(accountId: number): void {
  cache?.bust(accountId);
}

/** Test seam: swap the reader and start from an empty cache. */
export function setAccountLedgerKeysReaderForTests(
  next: ((accountId: number) => Promise<AccountLedgerKeys>) | null,
): void {
  reader = next ?? loadAccountLedgerKeys;
  cache = null;
}
