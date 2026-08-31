// The DURABLE half of the store's purchase-intent ledger: what one open
// purchase intent looks like on disk, and every rule that decides whether a
// stored one may be handed back.
//
// WHY IT IS A SEPARATE MODULE FROM THE LEDGER. src/ui/store_purchase_intent.ts
// is a registered pure core whose determinism scan is what lets a caller inject
// a key minter and unit-test the money rules without a host. It receives DATA.
// Everything that needs a host (the clock, the browser's storage, who the
// player currently is) arrives from outside, and the thin binder that reaches
// those lives in src/ui/purchase_intent_durability.ts. This module sits in the
// middle: it is pure and registered too, and it owns every GUARD, so each one
// is exercised by a Vitest with no browser, no storage and no real time.
//
// EVERY GUARD ANSWERS "ABSENT", NEVER "THROW" AND NEVER "REPAIR". Absent means
// the ledger mints a fresh key, which is exactly today's behaviour, so the
// failure direction is always back toward the pre-durability world and never
// toward a restored value nobody checked. A restored key that the server would
// reject as invalid_request is the dangerous case and it is worth spelling out:
// invalid_request is a member of DEFINITIVE_SPEND_REFUSALS, so the ledger would
// CLOSE the intent on it, and the next click would mint a second key over a
// debit that may still be live. That is why the charset and the cost are
// checked on READ here rather than trusted from storage.
//
// ONE ROW SERVES BOTH LEDGERS. The store sells charters and the banker sells
// single rungs, and the two SKU sets are disjoint by construction (a rung
// carries a ladderIndex and a charter does not, which is the same filter the
// store grid uses), so neither ledger can ever read the other's entry. Sharing
// the row is deliberate: it gives the expiry sweep below a second driver, so an
// intent whose own surface is never opened again is still reaped by a visit to
// the other one. The cost of sharing is stated rather than hidden: a row so
// corrupt that it does not parse loses BOTH surfaces' protection instead of
// one, and both fall back to today's behaviour.

import { BANK_STORAGE_KEY_MAX_LENGTH } from '../sim/bank';
import { STORAGE_SKU_LIST } from '../sim/content/storage_charters';
import type { PurchaseIntent } from './store_purchase_intent';

/** One persisted intent. The key and the cost frozen with it are ONE unit: a
 *  record that restores the key and re-reads the live catalog price walks the
 *  server's four-field identity check straight into a definitive-looking
 *  already_granted over a still-pending row, which is the exact second charge
 *  the ledger exists to prevent. `mintedAtMs` is what the expiry reads. */
export interface StoredPurchaseIntent {
  key: string;
  costClaudium: number;
  mintedAtMs: number;
}

/** The row as it sits in storage. Versioned so a future shape change is ABSENT
 *  to this build rather than half-read by it, and scope-stamped so a row that
 *  somehow outlives its name check is still refused on content. */
interface PurchaseIntentRow {
  v: number;
  scope: string;
  intents: Record<string, StoredPurchaseIntent>;
}

/** Bump when the row's shape changes. An unrecognised version reads as an
 *  EMPTY row, never as an error and never as a partial parse. */
export const PURCHASE_INTENT_ROW_VERSION = 1;

/** The storage row's name prefix. The `<class>_<name>` suffix the binder
 *  appends is the derivation src/ui/deeds_window.ts, src/ui/reliquary_window.ts
 *  and the HUD's emote wheel already write to this origin, reused rather than
 *  reinvented: character names are UNIQUE across the whole database
 *  (`characters.name TEXT UNIQUE NOT NULL`, server/db.ts), so a name determines
 *  the character row and, through its account_id foreign key, the account. That
 *  is the account-and-character scope the money rule needs, in the one field the
 *  client already has. */
export const PURCHASE_INTENT_ROW_PREFIX = 'woc_purchase_intents';

/** The server's own key rule, rebuilt from the SAME shared length constant the
 *  server builds STORAGE_KEY_PATTERN from (server/storage_purchases.ts). Only
 *  the charset is written twice, and a test pins the two sources equal so the
 *  copy cannot drift into a purchase failure. */
export const PURCHASE_INTENT_KEY_PATTERN = new RegExp(
  `^[A-Za-z0-9_.:-]{1,${BANK_STORAGE_KEY_MAX_LENGTH}}$`,
);

/** The declared-cost ceiling, mirroring STORAGE_MAX_EXPECTED_COST_CLAUDIUM. A
 *  stored cost above it would be refused at the wire boundary as
 *  invalid_request, which the ledger reads as DEFINITIVE, so it is caught here
 *  instead. Pinned equal to the server constant by a test. */
export const PURCHASE_INTENT_MAX_COST_CLAUDIUM = 1_000_000;

/** How long an unsettled intent may survive, and it is BORROWED rather than
 *  picked.
 *
 *  A durable intent is the same claim the server's `settling` ladder hold makes:
 *  a purchase whose money may already have moved, and only the service can say.
 *  The server already answers how long that claim may stand, and its answer
 *  (AMBIGUITY_HOLD_MAX_MS, server/storage_ladder_hold.ts) deliberately borrows
 *  its DURATION from the price cache's own staleness bound
 *  (STORAGE_PRICE_MAX_STALE_MS, server/storage_store_cache.ts), the span the
 *  packet has already ruled is long enough that a Claudium rail which has gone
 *  quiet can no longer be treated as live. This borrows the same duration from
 *  the same argument, for two reasons that make it the right number rather than
 *  a convenient one: past it the packet has already ruled the cached PRICE
 *  stale, and a record's entire value is a FROZEN price; and past it the server
 *  has already reopened the GOLD rail for this character, which is the server
 *  saying it has stopped treating the purchase as live.
 *
 *  src/ui may not import from server/, and nothing in the tree does, so the
 *  equality is PINNED by a test that imports both rather than asserted in a
 *  comment. It does not need to be longer for money safety: the service dedupes
 *  on UNIQUE (account_id, idempotency_key) over an append-only ledger with no
 *  retention sweep, so an old key replays rather than re-charges, and the game
 *  server sweeps only `refused` rows, which took no money. The bound is about
 *  what is still worth believing, not about what is safe. */
export const PURCHASE_INTENT_MAX_AGE_MS = 10 * 60_000;

/** How many entries one row may carry. Derived, not picked: a player can hold
 *  at most one open intent per purchasable storage SKU, so the catalog IS the
 *  bound and a row past it did not come from this client. Newest kept on
 *  overflow, because the newest entry is the one most likely to be sitting
 *  behind a live debit. */
export const PURCHASE_INTENT_MAX_ENTRIES = STORAGE_SKU_LIST.length;

/** The storage row's full name for one character. `null` when the scope is not
 *  known yet, which is the caller's signal to do NOTHING: before the first
 *  snapshot ClientWorld answers a blank entity whose name is the empty string,
 *  and a record written under a placeholder scope is one the real character can
 *  never claim and the next character might. */
export function purchaseIntentRowName(scope: string | null): string | null {
  return scope === null || scope === '' ? null : `${PURCHASE_INTENT_ROW_PREFIX}_${scope}`;
}

/** The per-character scope string, from the two reads every window already
 *  makes through IWorld. Empty when identity is not known yet. */
export function purchaseIntentScope(playerClass: string, playerName: string): string {
  return playerName === '' ? '' : `${playerClass}_${playerName}`;
}

/** Would a READ hand this entry back? Exported so the write side can refuse to
 *  persist what the read side would refuse to return, which keeps the row from
 *  collecting entries that are dead on arrival. */
export function isStorablePurchaseIntent(value: unknown, nowMs: number): boolean {
  return isStoredIntent(value, nowMs);
}

function isStoredIntent(value: unknown, nowMs: number): value is StoredPurchaseIntent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<StoredPurchaseIntent>;
  if (typeof v.key !== 'string' || !PURCHASE_INTENT_KEY_PATTERN.test(v.key)) return false;
  if (!Number.isInteger(v.costClaudium)) return false;
  // BOTH ends, and the lower one is not defensive padding: the wire refuses
  // `expectedCostClaudium <= 0` with invalid_request exactly as it refuses an
  // over-cap one (server/claudium.ts), and invalid_request is a member of
  // DEFINITIVE_SPEND_REFUSALS, so a restored zero would spend, come back
  // definitive, close the intent, and let the next click mint a fresh key over
  // a debit that may still be live. A zero is reachable without devtools:
  // daily_rewards_window.ts mints `intentFor(itemId, row?.costClaudium ?? 0)`
  // when the catalog row is missing, and this module now persists that.
  if ((v.costClaudium as number) <= 0) return false;
  if ((v.costClaudium as number) > PURCHASE_INTENT_MAX_COST_CLAUDIUM) return false;
  if (!Number.isFinite(v.mintedAtMs)) return false;
  // A record stamped in the FUTURE is unreadable rather than fresh: a clock that
  // moved backwards, or an edited value, must not buy itself an unbounded life.
  // Fails toward ABSENT like every other guard here.
  if ((v.mintedAtMs as number) > nowMs) return false;
  return nowMs - (v.mintedAtMs as number) < PURCHASE_INTENT_MAX_AGE_MS;
}

/** What one read of the row yielded. */
export interface PurchaseIntentRowRead {
  /** The entries that may be handed back. Bounded by the entry cap. */
  intents: Record<string, StoredPurchaseIntent>;
  /**
   * EVERY entry that survived the guards, cap or no cap, and the ONLY thing a
   * caller may write back.
   *
   * It exists because `intents` and "what the row should now contain" are two
   * different questions and answering both with one object cost live entries.
   * The cap bounds what the LEDGER may hold from a row it did not write; it must
   * never bound what SURVIVES on disk, because a capped write-back deletes
   * entries that passed every other guard, and one of them can be the unsettled
   * key behind a running debit.
   *
   * So the row's real bound is the EXPIRY, not the cap: every entry dies within
   * PURCHASE_INTENT_MAX_AGE_MS, so a foreign over-cap row shrinks on its own
   * while this client adds at most one entry per storage SKU.
   */
  retained: Record<string, StoredPurchaseIntent>;
  /**
   * True when the row was READABLE (right version, right scope) and some of its
   * entries did not survive, so the caller should write the pruned row back.
   *
   * This flag is the reaper for the path with NO further call: a player whose
   * intent nothing will ever settle or abandon, because they never open that
   * surface again. Persisting the ledger removed the accidental bound process
   * death used to provide, so the bound has to be supplied explicitly, and this
   * is where. Any read of the row, from EITHER ledger, reaps every expired entry
   * in it.
   *
   * FALSE for an unreadable row, deliberately: we never rewrite what we cannot
   * read. On a shared browser an unrecognised version may be a newer build's row
   * for this same character, and destroying it would take that build's
   * protection with it. An unreadable row is instead overwritten wholesale by
   * the next save under this scope, which is bounded by the next purchase.
   */
  prunedReadableRow: boolean;
}

/** A FRESH empty answer every time. Not a shared frozen constant: freezing the
 *  outer object leaves `intents` mutable, which is the half a caller would
 *  actually write to, so the constant was aliasable in the one way that
 *  mattered while looking safe. A new object costs nothing on a path that only
 *  runs when a row was unreadable. */
const emptyRead = (): PurchaseIntentRowRead => ({
  intents: {},
  retained: {},
  prunedReadableRow: false,
});

/** Every entry in `raw` that may still be handed back, with the expired, the
 *  malformed and the over-cap dropped, and an unreadable row answered as EMPTY.
 *  Answering rather than throwing is what makes "absent" the one failure mode,
 *  and absent means the ledger mints a fresh key, which is exactly the
 *  behaviour before any of this existed. */
export function readPurchaseIntentRow(
  raw: string | null,
  scope: string,
  nowMs: number,
): PurchaseIntentRowRead {
  if (raw === null || raw === '') return emptyRead();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyRead();
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyRead();
  const row = parsed as Partial<PurchaseIntentRow>;
  if (row.v !== PURCHASE_INTENT_ROW_VERSION) return emptyRead();
  // The scope check is belt AND braces with the row NAME: a different character
  // reads a different row and never sees this one, and if a future change to the
  // derivation ever collided, the stamp still refuses. Refusing is the whole
  // answer here: a key restored across a mismatch fails the server's identity
  // tuple, comes back as a definitive-looking already_granted, closes the intent,
  // and the next click mints a fresh key over a debit that may still be live.
  if (row.scope !== scope) return emptyRead();
  if (typeof row.intents !== 'object' || row.intents === null) return emptyRead();
  const stored = Object.entries(row.intents);
  const live: [string, StoredPurchaseIntent][] = [];
  for (const [itemId, value] of stored) {
    if (itemId === '') continue;
    if (isStoredIntent(value, nowMs)) live.push([itemId, value]);
  }
  // Newest first, then cut to the cap for what is HANDED BACK: an over-cap row is
  // not this client's work, and the entry most likely to be sitting behind a live
  // debit is the most recent one.
  live.sort((a, b) => b[1].mintedAtMs - a[1].mintedAtMs);
  const kept = live.slice(0, PURCHASE_INTENT_MAX_ENTRIES);
  // THE FLAG REPORTS THE REAPER, NOT THE CAP, and the difference is a live key.
  // It used to be `kept.length < stored.length`, which fires when the CAP cut
  // something too, and the binder answers the flag by writing the shortened row
  // back. So one read, possibly from the OTHER ledger and for a DIFFERENT item,
  // permanently deleted the oldest entries of an over-cap row, and those entries
  // are live by every other guard: one of them may be the unsettled key this
  // whole module exists to preserve, and losing it lets the next click mint a
  // fresh key over a debit that may still be running. That is REPAIR, which the
  // header of this file promises in capitals never to do.
  //
  // Reporting only the expiry-and-malformed drop keeps the promise literally: a
  // READ, which is not the player's action and can arrive from the other ledger
  // for a different item, no longer mutates a row merely because it is over-cap.
  //
  // And `retained` is the other half, without which the first is not enough. A
  // corpse in an over-cap row fires the flag for a perfectly good reason, and the
  // write-back that follows would still have written the CAPPED set: with 24 live
  // entries plus one expired, the reaper wrote 16 and eight live keys went off
  // disk forever. Measured, not reasoned about. The caller writes `retained`.
  return {
    intents: Object.fromEntries(kept),
    retained: Object.fromEntries(live),
    prunedReadableRow: live.length < stored.length,
  };
}

/** The row's serialized form. */
export function writePurchaseIntentRow(
  scope: string,
  intents: Record<string, StoredPurchaseIntent>,
): string {
  const row: PurchaseIntentRow = { v: PURCHASE_INTENT_ROW_VERSION, scope, intents };
  return JSON.stringify(row);
}

/** The ledger's view of a stored entry: the key and the cost frozen with it,
 *  and nothing else. The mint time is durability bookkeeping and never reaches
 *  the ledger, which has no clock and must not learn of one. */
export function intentFromStored(stored: StoredPurchaseIntent): PurchaseIntent {
  return Object.freeze({ key: stored.key, costClaudium: stored.costClaudium });
}
