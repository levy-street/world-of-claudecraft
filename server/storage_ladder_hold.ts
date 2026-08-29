// The ladder hold: WHY a character's slot ladder is reserved against a GOLD
// bank_buy_slots, and how long that reservation may stand (Bank Storage phase
// 14). Pure policy, clock injected, so every arm is driven directly by a
// Vitest; server/storage_purchases.ts owns the live table and is the only
// writer.
//
// WHAT THE RESERVATION IS FOR. A Claudium rung SKU is bound to one exact ladder
// index (src/sim/content/storage_charters.ts), and a gold rung always takes the
// next one, so EVERY interleaved gold buy invalidates EVERY in-flight Claudium
// storage purchase. If the money already moved, that is not a refusal, it is a
// paid-for grant settling 'unresolved'. So while a purchase's money may have
// moved, the gold rail stays shut. Nothing here may weaken that.
//
// WHY A REASON AND A LIFETIME. Before phase 14 the gold rail read a bare mutex:
// shut whenever anything held the character, whatever put it there and for
// however long. That conflated a live request (money may move at any instant)
// with a provisional login hold (nothing is known yet) and with an unbounded
// ambiguity retry (money may have moved, and only the service can say). The
// three now carry their reason, and the gold rail applies a bound per reason:
//
//   purchase       a live request between the dry run and the definitive
//                  answer. Bounded BY CONSTRUCTION: one database write plus one
//                  spend capped by the proxy's SERVICE_TIMEOUT_MS, inside a
//                  request that returns or throws into the fail-closed catch.
//   recovery-scan  the provisional hold armed synchronously at a fresh join,
//                  before the pending-row scan says whether a debited but
//                  unapplied purchase is even waiting. Bounded by the scan.
//   recovery-drive a scan that ANSWERED YES, waiting for a drive slot. This is
//                  deliberately NON-YIELDING: the database has proved an open
//                  row whose older attempt may already have debited, and queue
//                  age cannot disprove that debit. The bounded coordinator owns
//                  and eventually releases this hold; opening gold merely
//                  because the queue is slow can force a paid grant unresolved.
//   settling       an AMBIGUOUS outcome handed to the background retry. The
//                  one claim with no internal bound: the service may be
//                  unreachable for hours.
//
// THE TWO BOUNDS, and they are different KINDS of thing:
//
//   WEDGED_HOLD_MAX_MS is a bound on a BUG, not a policy. Every release path in
//   the flow lives in a `finally`, so a hold whose owning promise never settles
//   would close the gold rail forever. It sits far above any real duration (a
//   spend cannot outlive SERVICE_TIMEOUT_MS), so it fires only when something
//   is genuinely stuck and never in normal operation.
//
//   AMBIGUITY_HOLD_MAX_MS is the argued trade for an ACTUAL ambiguous service
//   response, and it is deliberately not a
//   number picked here. It borrows its DURATION from the price cache's
//   staleness bound (server/storage_store_cache.ts), the span the packet has
//   already ruled is long enough that a Claudium rail which has gone quiet for
//   it can no longer be treated as live. Below it, a service blip resolves: the
//   retry ladder reaches its cap inside the first minute and holding is right.
//   Past it, waiting has stopped being about this purchase and started being
//   about an outage, and closing the GOLD rail for the length of an outage is
//   the trade the reservation was never meant to make.
//
//   BE PRECISE ABOUT WHAT THE SHARED CONSTANT DOES AND DOES NOT BUY. It is one
//   DURATION, not one clock: the cache ages from its last successful refresh,
//   this hold ages from the ambiguity handoff. So this does NOT promise that
//   the gold rail reopens at the same instant the Claudium tag leaves the
//   button, and the two orders can genuinely disagree (a service healthy enough
//   to answer the store GET can still leave one spend ambiguous, keeping the
//   tag live while this hold lapses). What sharing the source DOES buy is that
//   a maintainer retuning "how long may a quiet Claudium rail still be believed
//   in" moves both answers together instead of leaving one behind.
//
// THE YIELD OPENS THE GOLD RAIL, NOT THE CLAUDIUM RAIL. This predicate has
// exactly one caller, storagePurchaseInFlight, which only the gold dispatch arm
// reads. The purchase flow's own serialization check reads the table directly,
// so a yielded hold still refuses a NEW Claudium purchase for that character:
// the per-character pending-row count stays exactly what it was, and the yield
// cannot become a way to mint rows during an outage.
//
// The residual risk, stated rather than hidden: if a genuinely ambiguous spend
// DID debit, and the player then buys that rung with gold after the yield, the
// eventual receipt settles 'unresolved'. That is the case scripts/bank_audit.mjs
// now reports, and it is bounded by the window above.

import { STORAGE_PRICE_MAX_STALE_MS } from './storage_store_cache';

export type LadderHoldReason = 'purchase' | 'recovery-scan' | 'recovery-drive' | 'settling';

export interface LadderHold {
  /** The idempotency key holding the ladder, or the provisional scan token. */
  readonly key: string;
  readonly reason: LadderHoldReason;
  /** Wall clock at the moment the claim was taken. */
  readonly sinceMs: number;
}

/** The stuck-promise backstop. Far above a real purchase, which cannot outlive
 *  one database write plus one SERVICE_TIMEOUT_MS spend. */
export const WEDGED_HOLD_MAX_MS = 60_000;

/** The ambiguity yield, tied to the price cache's own staleness bound so the
 *  gold rail reopens exactly when the Claudium rail has aged off the button.
 *  A test pins the equality, so the two cannot drift apart. */
export const AMBIGUITY_HOLD_MAX_MS = STORAGE_PRICE_MAX_STALE_MS;

/** How long a hold of this reason may keep the gold rail shut.
 *
 *  A scanned open row does not yield while queued: elapsed local queue time is
 *  no evidence about whether its older attempt debited. Once a recovery drive
 *  actually calls the service, the normal `purchase`/`settling` transitions
 *  apply. Everything else is bounded by construction or by the explicit
 *  post-response ambiguity policy. */
export function ladderHoldMaxMs(reason: LadderHoldReason): number {
  if (reason === 'recovery-drive') return Number.POSITIVE_INFINITY;
  return reason === 'settling' ? AMBIGUITY_HOLD_MAX_MS : WEDGED_HOLD_MAX_MS;
}

/** Does this hold still refuse a GOLD bank_buy_slots at `nowMs`?
 *
 *  Fails CLOSED on anything it cannot reason about: an unreadable age (a
 *  non-finite clock) and a clock that moved backwards both keep the rail shut,
 *  because the failure it must never produce is a gold buy landing on top of a
 *  live debit. */
export function ladderHoldBlocksGold(hold: LadderHold | undefined, nowMs: number): boolean {
  if (!hold) return false;
  const age = nowMs - hold.sinceMs;
  if (!Number.isFinite(age)) return true;
  return age < ladderHoldMaxMs(hold.reason);
}
