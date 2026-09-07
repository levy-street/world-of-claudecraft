// The account Reliquary ledger: the pure half of account-wide relic ownership.
//
// The Reliquary counts for the ACCOUNT, not the character: a relic any
// character on the account has filled fills the silhouette for every
// character on it (a warrior's honor plate fills the Warfare Armory for the
// mage on the same account, who could never wear it). The ledger is the
// account's union of catalogued fills by kind. It is ownership only: the
// first-find stamp, the obtain tally, and the recent ring stay per character
// (they are history, not ownership), and so does every clear meter.
//
// Hosts: the server folds each character's live fills into the ledger at join
// and on the standing sweep (server/account_reliquary.ts), persists growth in
// `account_relics`, and hands the ledger to the sim as a live-only PlayerMeta
// field plus to the client on the `cosmetics` self key. The offline Sim is one
// character on one account and carries an empty ledger. Nothing here draws
// rng, reads a clock, or writes sim state.

import type { AccountReliquaryLedger } from '../world_api/cosmetics';
import {
  isCataloguedRelicItem,
  isCataloguedRelicMark,
  RELIQUARY_PAGES,
  type ReliquaryPageDef,
} from './content/reliquary';
import { catalogIndexFor, type ReliquaryOwnershipSurfaces } from './reliquary';

export const LEDGER_KINDS = ['items', 'marks', 'mounts', 'titles'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** The empty ledger, one fresh object per call so a holder can never share
 *  (and mutate) a module-global container. */
export function emptyAccountReliquaryLedger(): AccountReliquaryLedger {
  return { items: [], marks: [], mounts: [], titles: [] };
}

function sortedUnique(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort();
}

/** True when every list is empty. */
export function isAccountReliquaryLedgerEmpty(ledger: AccountReliquaryLedger | undefined): boolean {
  if (!ledger) return true;
  return LEDGER_KINDS.every((kind) => ledger[kind].length === 0);
}

/** Total catalogued ids the ledger holds across every kind. */
export function accountReliquaryLedgerSize(ledger: AccountReliquaryLedger | undefined): number {
  if (!ledger) return 0;
  let n = 0;
  for (const kind of LEDGER_KINDS) n += ledger[kind].length;
  return n;
}

/**
 * Decode an untrusted ledger (a stored row set, a wire payload, a hand-edited
 * fixture) into a catalogue-bounded one: only ids the live catalog knows for
 * that kind survive, sorted and de-duped, so a stale or hostile input can
 * never grow membership past the catalog. Missing or malformed input yields
 * the empty ledger rather than throwing (the online decode idiom).
 */
export function normalizeAccountReliquaryLedger(
  value: unknown,
  pages: readonly ReliquaryPageDef[] = RELIQUARY_PAGES,
): AccountReliquaryLedger {
  const src =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const index = catalogIndexFor(pages);
  const mounts = new Set(index.mounts);
  const titles = new Set(index.titles);
  const known: Record<LedgerKind, (id: string) => boolean> = {
    items: isCataloguedRelicItem,
    marks: isCataloguedRelicMark,
    mounts: (id) => mounts.has(id),
    titles: (id) => titles.has(id),
  };
  const out = emptyAccountReliquaryLedger();
  for (const kind of LEDGER_KINDS) {
    const list = src[kind];
    if (!Array.isArray(list)) continue;
    out[kind] = sortedUnique(
      list.filter((id): id is string => typeof id === 'string' && known[kind](id)),
    );
  }
  return out;
}

/**
 * The ledger a character's live ownership surfaces would contribute: every
 * catalogued id (per kind) the character owns right now. The server folds this
 * into the account ledger; the walk is one catalog index pass, no inventory
 * scan (ownedMounts is already a resolved surface).
 */
export function accountReliquaryLedgerFromOwnership(
  surfaces: ReliquaryOwnershipSurfaces,
  pages: readonly ReliquaryPageDef[] = RELIQUARY_PAGES,
): AccountReliquaryLedger {
  const index = catalogIndexFor(pages);
  return {
    items: index.items.filter((id) => surfaces.itemsDiscovered.has(id)),
    marks: index.marks.filter((id) => surfaces.marks.has(id)),
    mounts: index.mounts.filter((id) => surfaces.ownedMounts.has(id)),
    titles: index.titles.filter((id) => surfaces.deedsEarned.has(id)),
  };
}

/**
 * Union two ledgers. `grew` is true when the result holds an id `base` did
 * not, which is the ONLY case a host persists or re-broadcasts: ownership is
 * additive (a relic filled is never un-filled), so a merge that adds nothing
 * is a no-op by construction and the returned object is `base` itself.
 */
export function mergeAccountReliquaryLedger(
  base: AccountReliquaryLedger,
  add: AccountReliquaryLedger,
): { ledger: AccountReliquaryLedger; grew: boolean; added: AccountReliquaryLedger } {
  const added = emptyAccountReliquaryLedger();
  let grew = false;
  for (const kind of LEDGER_KINDS) {
    const have = new Set(base[kind]);
    for (const id of add[kind]) {
      if (!have.has(id)) added[kind].push(id);
    }
    if (added[kind].length > 0) grew = true;
  }
  if (!grew) return { ledger: base, grew: false, added };
  const ledger = emptyAccountReliquaryLedger();
  for (const kind of LEDGER_KINDS) ledger[kind] = sortedUnique([...base[kind], ...added[kind]]);
  return { ledger, grew: true, added };
}

/** Merge two OPTIONAL ledgers for the AccountCosmetics carrier: absent on both
 *  sides stays absent (the pre-ledger wire shape), otherwise the union. */
export function mergeOptionalAccountReliquaryLedgers(
  a: AccountReliquaryLedger | undefined,
  b: AccountReliquaryLedger | undefined,
): AccountReliquaryLedger | undefined {
  if (!a) return b;
  if (!b) return a;
  return mergeAccountReliquaryLedger(a, b).ledger;
}

export { withAccountRelics } from './reliquary';
