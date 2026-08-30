// $WOC Exchange service: the server-side marketplace's lifecycle logic
// (docs/prd/woc/marketplace.md), behind injected seams so tests run with an
// in-memory WocMarketDb and a scripted economy, the SocialService/SocialDb
// split. Pure decisions live in woc_market_rules.ts; SQL in woc_market_db.ts;
// the economy-service client in woc_market_proxy.ts; item custody crosses
// into the Sim only through the WocMarketCustody bridge (game.ts wiring).
//
// Money model: every stored value is INTEGER USD CENTS. Token amounts exist
// only inside economy-service quotes (base-unit strings plus display token
// numbers the service computed); this module never converts between the two.
//
// Fail-closed: with the feature flag off, the wallet unlinked, or the economy
// service unavailable/unhealthy, every mutating flow refuses with a typed
// reason and no custody or database action. Existing auctions keep counting
// down while paused; only irreversible steps (new bids, buy-now, quotes,
// confirmations) suspend, per the PRD's "Price source and health".

import { createHash } from 'node:crypto';
import { ITEMS } from '../src/sim/data';
import { exchangeBrowseCategory, exchangeBrowseSubcategory } from '../src/sim/exchange_eligibility';
import type { ExtractRef, ExtractRefusal } from '../src/sim/inventory_extract';
import { itemCopyPin } from '../src/sim/item_copy_ref';
import type { InvSlot, ItemInstancePayload } from '../src/sim/types';
import { throwProvedRollback } from './pg_rollback_proof';
import {
  BOND_PAYOUT_BUDGET_MS,
  SWEEP_BATCH,
  WOC_MARKET_ME_READOUT_DEADLINE_MS,
} from './woc_market_budgets';
import type { CharacterSaveArgs } from './woc_market_character_save';
import { createWocMarketDeliveryArms, type WocMarketDeliveryArms } from './woc_market_delivery';
import {
  registerWocQuoteHandoff,
  registerWocStepUpHandoff,
  type WocDesktopHandoffRegistrar,
} from './woc_market_desktop_handoff';
import { logSafe, WocWireDriftWarner } from './woc_market_drift_warn';
import type {
  WocEstimate,
  WocMarketEconomy,
  WocPriceInfo,
  WocQuoteIntent,
} from './woc_market_economy_types';
import { pruneWocLocalLedgers, wocBackedOffIds, wocParkRow } from './woc_market_local_ledgers';
import type { WocStuckCustodyClasses } from './woc_market_monitor_types';
import type * as WocOps from './woc_market_ops';
import type { WocMarketReadCache } from './woc_market_read_cache';
import { WOC_MARKET_BROWSE_CACHE_MAX_PAGE } from './woc_market_read_cache';
import {
  resolveReviewSettlement,
  type WocReviewResolution,
  type WocReviewVerdict,
} from './woc_market_review_resolution';
import {
  adoptableBondCents,
  antiSnipeExtendedEndMs,
  bondCents,
  type ListingParamsRefusal,
  listingEligibility,
  listingSoldNoticeCustodyRef,
  minNextBidCents,
  settlementCustodyRef,
  strikeSuspensionMs,
  validListingParams,
  WOC_MARKET_ABANDON_EXEMPT_FAIL_REASONS,
  WOC_MARKET_BOND_PENDING_TTL_SECONDS,
  WOC_MARKET_BOND_POLL_PARK_SECONDS,
  WOC_MARKET_BUY_NOW_LOCK_SECONDS,
  WOC_MARKET_DIRECTED_HOLD_SECONDS,
  WOC_MARKET_DIRECTED_OFFER_TTL_SECONDS,
  WOC_MARKET_DURATION_HOURS,
  WOC_MARKET_LEDGER_MATCHED_REASON,
  WOC_MARKET_MAX_ACTIVE_LISTINGS,
  WOC_MARKET_OFFER_CONVERGE_MAX_AGE_SECONDS,
  WOC_MARKET_OFFER_CONVERGE_SECONDS,
  WOC_MARKET_QUOTE_TTL_SECONDS,
  WOC_MARKET_SETTLEMENT_WINDOW_SECONDS,
  WOC_MARKET_STRANDED_RECLAIM_SECONDS,
  type WocBidStatus,
  type WocEligibilityPolicy,
  type WocEligibilityRefusal,
  type WocListingFormat,
  type WocListingParams,
  type WocSettlementState,
} from './woc_market_rules';
import type {
  NewWocStepUpChallenge,
  WocStepUpBinding,
  WocStepUpChallengeRow,
  WocStepUpProof,
  WocStepUpRefusal,
} from './woc_market_stepup';
import {
  issueStepUpChallengeFlow,
  stepUpProofRefusal,
  type WocStepUpFlowCtx,
} from './woc_market_stepup_flow';
import type {
  WocDeliveryScope,
  WocSweepErrorTag,
  WocSweepPassStats,
} from './woc_market_sweep_types';

// ---------------------------------------------------------------------------
// Row shapes (persisted by woc_market_db.ts)
// ---------------------------------------------------------------------------

export type WocListingLifecycle = 'active' | 'ending' | 'settling' | 'closed';
export type WocListingResolution =
  | 'sold'
  | 'no_bids'
  | 'reserve_not_met'
  | 'unsettled'
  | 'cancelled'
  | 'suspended';

export interface WocListingRow {
  id: number;
  realm: string;
  sellerAccount: number;
  sellerCharacter: number;
  sellerName: string;
  sellerWallet: string;
  item: InvSlot;
  itemId: string;
  quality: string;
  format: WocListingFormat;
  startCents: number;
  reserveCents: number | null;
  buyNowCents: number | null;
  offerNext: boolean;
  status: WocListingLifecycle;
  resolution: WocListingResolution | null;
  itemDisposed: boolean;
  currentBidCents: number | null;
  currentBidId: number | null;
  /** The price the sale actually closed at, joined from the sales provenance
   *  table. Populated ONLY by listingsBySeller (the activity read); every
   *  other listing read leaves it null. The listing row itself keeps
   *  current_bid_cents forever, which for a buy-now that outran the bidding
   *  is the losing high bid, not the sale. */
  soldCents: number | null;
  endsAtMs: number;
  baseEndsAtMs: number;
  buyNowLockAccount: number | null;
  buyNowLockExpiresMs: number | null;
  createdAtMs: number;
  /** The one account this sale is addressed to, or null for a public listing.
   *  A non-null value means the row is invisible to browse and buyable only by
   *  that account (docs/prd/woc/p2p-woc-trade.md). */
  directedBuyerAccount: number | null;
  /** Seller cancel-intent stamped on a LOCKED listing: no new lock claims or
   *  bids from that moment; an unpaid lock expiry closes the listing
   *  cancelled (the converge arm), a paid window proceeds to settlement. */
  cancelRequestedAtMs: number | null;
}

export type WocDirectedOfferStatus =
  | 'pending' // awaiting resolution by either side
  | 'accepted' // became a directed listing; the item is now in escrow
  | 'declined' // the SELLER said no to the incoming offer
  | 'withdrawn' // the BUYER pulled the offer they had made
  | 'expired'; // the TTL elapsed unanswered

export interface WocDirectedOfferRow {
  id: number;
  realm: string;
  sellerAccount: number;
  sellerCharacter: number;
  sellerName: string;
  buyerAccount: number;
  buyerName: string;
  /** The copy the SELLER named when accepting, or null until they do. */
  itemRef: ExtractRef | null;
  /** The agreed item's id, stamped at CREATION since H10 (legacy rows: at
   *  acceptance, or null). */
  itemId: string | null;
  /** The agreed copy's fingerprint (itemCopyPin), stamped at CREATION: the
   *  buyer opens the deal naming the exact copy they saw, and acceptance
   *  escrows only a copy whose pin matches (H10). Null on rows that predate
   *  the pin, whose acceptance refuses item_mismatch (safe direction). */
  itemPin: string | null;
  usdCents: number;
  status: WocDirectedOfferStatus;
  listingId: number | null;
  createdAtMs: number;
  expiresAtMs: number;
  /** Each side agrees through the trade window's ordinary Accept button; the
   *  SECOND acceptance is what escrows. */
  buyerAccepted: boolean;
  sellerAccepted: boolean;
  /** The directed listing's own state, once one exists. Lets the seller tell
   *  "waiting for payment" from "paid" without a second round trip. */
  listingStatus: string | null;
  listingResolution: string | null;
  /**
   * The latest settlement's state for this listing, or null while none exists.
   *
   * This is what lets the SELLER see that a payment is in flight. Without it
   * their window shows "waiting for payment" from the moment they accept until
   * the item silently vanishes, so a buyer signing in their wallet and a buyer
   * who walked away look identical for as long as confirmation takes.
   */
  settlementState: string | null;
}

export type WocBondState =
  | 'pending' // intent issued, transfer unconfirmed
  | 'held' // confirmed, refund owed on outbid/close/cancel
  | 'void' // never confirmed (lapsed bid); nothing to move
  | 'refund_due'
  | 'refunded'
  | 'forfeit_due'
  | 'forfeited';

export interface WocBidRow {
  id: number;
  listingId: number;
  account: number;
  characterId: number;
  characterName: string;
  wallet: string;
  amountCents: number;
  status: WocBidStatus;
  bondCents: number;
  bondState: WocBondState;
  bondReference: string | null;
  bondQuoteExpiresAtMs: number | null;
  /** The signature the bidder handed back, recorded before the chain decides so
   *  an undecided bond can be re-checked instead of refused. */
  bondSignature: string | null;
  /** When the signature was recorded (null on legacy rows: age falls back
   *  to placedAtMs). The poll park axis and nothing else. */
  bondSignatureAtMs: number | null;
  placedAtMs: number;
}

export interface WocSettlementRow {
  id: number;
  listingId: number;
  bidId: number | null; // null on a buy-now settlement
  attempt: number; // 0 buy-now, 1 close winner, 2.. cascade offers
  buyerAccount: number;
  buyerCharacter: number;
  buyerName: string;
  buyerWallet: string;
  amountCents: number;
  state: WocSettlementState;
  quoteReference: string | null;
  quoteExpiresAtMs: number | null;
  txSignature: string | null;
  failReason: string | null;
  /** Base-unit token amount from the confirmed quote, for sale provenance. */
  settledAmountBase: string | null;
  deadlineAtMs: number;
  createdAtMs: number;
}

/** The Activity tab's bid row: the bid plus the listed item's id, joined at
 *  read time so a pay row can NAME what the money is for (a bare "$4.00
 *  Active" told the player nothing once they held two bids). */
export type WocActivityBidRow = WocBidRow & { itemId: string };

/** The Activity tab's settlement row, item-named for the same reason. */
export type WocActivitySettlementRow = WocSettlementRow & { itemId: string };

export interface WocSaleRow {
  id: number;
  realm: string;
  listingId: number;
  itemId: string;
  item: InvSlot;
  priceCents: number;
  amountBase: string | null;
  sellerAccount: number;
  buyerAccount: number;
  sellerName: string;
  buyerName: string;
  excluded: boolean;
  atMs: number;
}

export interface WocStrikeRow {
  accountId: number;
  strikes: number;
  suspendedUntilMs: number | null;
}

export interface WocBrowseQuery {
  page: number;
  pageSize: number;
  quality: string | null;
  format: WocListingFormat | null;
  /** The stamped category axes (exchangeBrowseCategory /
   *  exchangeBrowseSubcategory): closed vocabularies, validated at the
   *  route. Legacy rows carry NULL stamps and sit outside filtered results
   *  (pre-enable data only; no backfill by decision). */
  category: string | null;
  subcategory: string | null;
  /** Client-resolved item ids for a name search (the server stays
   *  language-agnostic; the client owns localized names). */
  itemIds: readonly string[] | null;
  sort: 'ending' | 'newest' | 'price_asc' | 'price_desc';
}

// ---------------------------------------------------------------------------
// Injected seams
// ---------------------------------------------------------------------------

export interface NewWocListing {
  realm: string;
  sellerAccount: number;
  sellerCharacter: number;
  sellerName: string;
  sellerWallet: string;
  item: InvSlot;
  itemId: string;
  quality: string;
  /** The Browse filter's category axes, derived once at escrow from the def
   *  (the sim helpers); null when the catalog no longer names the def, which
   *  the filter then simply cannot reach. */
  category: string | null;
  subcategory: string | null;
  params: WocListingParams;
  endsAtMs: number;
  /** The directed offer this listing consummates, or null for a public
   *  listing. Non-null makes the escrow transaction stamp the offer's
   *  listing_id atomically with the insert (listing exists IFF the offer is
   *  stamped), the invariant the accepted-offer converge arm proves rollback
   *  by; a zero-row stamp CAS aborts the whole transaction 'not_pending'. */
  directedOfferId: number | null;
}

/** The seller click-through's public profile line: only facts the game
 *  already shows in the world (the guild tag on nameplates and rosters).
 *  Derived per read, never stored on sale rows. The character's creation
 *  date was dropped: it is account-age data the world does not otherwise
 *  surface and no PRD authorizes disclosing (a deliberate re-add is a PRD
 *  decision, not a default). */
export interface WocSellerProfile {
  guildName: string | null;
}

/** The seller click-through's one cached readout: sales plus profile. */
export interface WocSellerHistoryReadout {
  sales: WocSaleRow[];
  profile: WocSellerProfile | null;
}

export type { CharacterSaveArgs } from './woc_market_character_save';

export interface WocMarketDb {
  // Listing custody edge: character UPDATE (the bags just lost the copy) and
  // the listing INSERT commit in ONE transaction, with the per-account active
  // cap enforced under a lock (the insertAssetCapped shape). 'contended' is
  // the bounded lock-wait / deadlock-victim / idle-kill refusal (55P03,
  // 40P01, 25P03): the transaction provably rolled back and the caller
  // restores the copy and answers the typed retry refusal.
  escrowInsertListing(
    save: CharacterSaveArgs,
    listing: NewWocListing,
  ): Promise<
    | { ok: true; id: number }
    | { ok: false; reason: 'lease_lost' | 'cap_reached' | 'contended' | 'not_pending' }
  >;
  listingById(realm: string, id: number): Promise<WocListingRow | null>;
  /** A has-more PROBE, never a full count: the window count forced a read of
   *  every live listing per page (measured as a parallel seq scan plus an
   *  external merge sort at a realm's listing cap). */
  browseListings(
    realm: string,
    q: WocBrowseQuery,
  ): Promise<{ rows: WocListingRow[]; hasMore: boolean }>;
  listingsBySeller(realm: string, account: number): Promise<WocListingRow[]>;
  countActiveBySeller(realm: string, account: number): Promise<number>;

  // --- Directed p2p offers (pre-escrow; acceptance is what creates a listing) --
  insertDirectedOffer(offer: {
    realm: string;
    sellerAccount: number;
    sellerCharacter: number;
    sellerName: string;
    buyerAccount: number;
    buyerName: string;
    usdCents: number;
    expiresAtMs: number;
    itemId: string;
    itemPin: string;
  }): Promise<WocDirectedOfferRow | 'offer_pending'>;
  directedOfferById(realm: string, id: number): Promise<WocDirectedOfferRow | null>;

  // --- Step-up challenges (single-use custody authorization; semantics in
  // server/woc_market_stepup.ts, R1) ---
  createStepUpChallenge(row: NewWocStepUpChallenge): Promise<void>;
  /** Atomic single-use consume: DELETE under the nonce key scoped to the
   *  account, returning the row WITHOUT judging expiry (the verifier answers
   *  expired honestly from the returned row). */
  consumeStepUpChallenge(
    realm: string,
    nonce: string,
    accountId: number,
  ): Promise<WocStepUpChallengeRow | null>;
  /** Delete expired challenges; every issue runs this first (bounded growth). */
  pruneStepUpChallenges(realm: string, nowMs: number): Promise<number>;
  /** The offers this account may act on or must still observe, both
   *  directions: pending and accepted rows, plus just-resolved rows and
   *  closed listings inside the grace window measured from nowMs (the
   *  service clock, so a travelled test clock drives Pg and fake alike). */
  directedOffersForAccount(
    realm: string,
    account: number,
    nowMs: number,
  ): Promise<WocDirectedOfferRow[]>;
  /**
   * Move a PENDING offer to a terminal status, atomically.
   *
   * Returns the row on success and null when it was not pending, which is what
   * makes accept idempotent under a double-click: the second call loses the
   * compare-and-set and never reaches the escrow path, so one offer can never
   * extract two copies.
   */
  resolveDirectedOffer(
    realm: string,
    id: number,
    to: Exclude<WocDirectedOfferStatus, 'pending'>,
  ): Promise<WocDirectedOfferRow | null>;
  /** Expire pending offers past their TTL. Returns how many were expired. */
  expireDueDirectedOffers(realm: string, nowMs: number, limit: number): Promise<number>;
  /** The converge arm's read: 'accepted' offers with NO stamped listing,
   *  inside the two-sided age window (older than the in-flight bound, newer
   *  than the max age past which an un-stamp is prune fallout rather than
   *  rollback evidence). Ordered oldest-first, batch-bounded; projects only
   *  the id and the TTL verdict input. */
  acceptedUnstampedOffers(
    realm: string,
    olderThanMs: number,
    oldestAllowedMs: number,
    limit: number,
  ): Promise<{ id: number; expiresAtMs: number }[]>;
  /** The converge arm's terminal write for a proven-rolled-back offer already
   *  past its TTL: same accepted-and-unstamped CAS as reopenDirectedOffer. */
  expireDirectedOfferIfUnstamped(realm: string, id: number): Promise<boolean>;
  /** Whether ANY settlement row (open OR terminal) was ever opened against
   *  this listing: the directed close arm's strike gate. 'failed' is not an
   *  OPEN state, so gating the never-claimed strike on the open probe alone
   *  double-strikes a buyer the overdue arm also strikes. */
  everSettledForListing(listingId: number): Promise<boolean>;
  /**
   * Resolve a character NAME to its character and owning account, or null.
   *
   * A directed offer names its counterparty by NAME, because that is the only
   * stable handle the trade window has: TradeInfo carries a sim entity id
   * (`otherPid`), which is not a character id, plus the display name.
   * `characters.name` is globally UNIQUE, so the name identifies exactly one
   * character, and resolving here means no account id ever crosses the wire.
   */
  characterByName(
    realm: string,
    name: string,
  ): Promise<{ characterId: number; accountId: number; name: string } | null>;
  /**
   * Put an 'accepted' offer back to pending after its escrow failed.
   *
   * The compensating half of the claim-then-escrow ordering: the status flip has
   * to happen first (it is the lock that stops a double accept extracting twice),
   * so a failed escrow must undo it or the deal is silently dead while both
   * players still believe it is live. Narrowed to 'accepted' with no listing, so
   * it can never resurrect an offer that really did become a listing.
   */
  acceptDirectedOfferSide(
    realm: string,
    id: number,
    side: 'buyer' | 'seller',
    itemRef: ExtractRef | null,
  ): Promise<WocDirectedOfferRow | null>;
  /** True when the row really flipped back to pending; false when the CAS
   *  missed or the pair bound blocked it, so the converge stat never counts
   *  a blocked no-op as progress. */
  reopenDirectedOffer(realm: string, id: number): Promise<boolean>;
  /** Cancel iff still active with no pending/active bid and no open
   *  settlement, all checked atomically under the listing row lock. An
   *  UNEXPIRED buy-now lock over an unpaid window stamps CANCEL-INTENT
   *  instead of refusing ('cancel_pending': no new claims or bids; the
   *  converge arm closes the listing once the window ends unpaid); a paid
   *  window still refuses 'settlement_live'. A leftover 'failed' settlement
   *  is expired in the same transaction so its retry arm cannot revive a
   *  payment against a cancelled listing. Returns the row for the return
   *  flight. */
  cancelListingIfUnbid(
    realm: string,
    id: number,
    sellerAccount: number,
    nowMs: number,
  ): Promise<
    | WocListingRow
    | 'not_found'
    | 'not_yours'
    | 'has_bids'
    | 'not_active'
    | 'cancel_pending'
    | 'settlement_live'
    | 'contended'
  >;
  /** The cancel-intent converge read: stamped, active listings whose lock
   *  window ended, on the shared rotation order; excludeIds are the caller's
   *  backing-off skipped rows. */
  cancelPendingListings(
    realm: string,
    nowMs: number,
    limit: number,
    excludeIds: readonly number[],
  ): Promise<WocListingRow[]>;
  /** Close one cancel-pending listing whose window ended unpaid (the converge
   *  arm); 'skip' when anything still rides it. Returns the closed row for
   *  the return flight. */
  closeCancelPendingListing(
    realm: string,
    id: number,
    nowMs: number,
  ): Promise<WocListingRow | 'skip' | 'contended'>;
  /** Admin suspend, atomically and only while no payment can be moving: an
   *  unexpired buy-now lock, a settlement in 'confirming' or beyond (a
   *  signature exists, so the chain may still land it), or an 'offered'
   *  settlement holding a live quote (the buyer may already have broadcast
   *  the transfer; the signature only reaches us at confirm) refuses the
   *  suspend. A settlement no payment can be riding ('failed', or 'offered'
   *  with no live quote) is expired, open bids cancel with held bonds queued
   *  for refund, and the listing closes 'suspended', all in one transaction.
   *  'contended' is the bounded-lock-wait refusal (55P03/40P01). */
  suspendListingIfSafe(
    realm: string,
    id: number,
    nowMs: number,
  ): Promise<
    WocListingRow | 'not_found' | 'not_active' | 'buy_now_pending' | 'settlement_live' | 'contended'
  >;
  /** Claim due auctions: active AND endsAt <= now become 'ending' (SKIP
   *  LOCKED), returned for resolution. */
  claimDueListings(realm: string, nowMs: number, limit: number): Promise<WocListingRow[]>;
  closeListing(id: number, resolution: WocListingResolution): Promise<void>;
  /** The no-winner close arms ride this guard: lock the listing, refuse
   *  (false) when an open settlement rides it, close otherwise. The caller
   *  parks a refused listing 'settling'. */
  closeListingIfNoOpenSettlement(id: number, resolution: WocListingResolution): Promise<boolean>;
  markListingSettling(id: number): Promise<void>;
  /** closed && !itemDisposed && resolution != 'sold': the return-flight
   *  reconciliation backlog. excludeIds are rows inside their in-process
   *  park backoff, excluded in the QUERY (see deliveringSettlements). */
  undisposedClosedListings(
    realm: string,
    limit: number,
    excludeIds: readonly number[],
  ): Promise<WocListingRow[]>;
  /** Listings stuck mid-resolution ('ending' / 'settling') past a grace. */
  strandedListings(realm: string, olderThanMs: number, limit: number): Promise<WocListingRow[]>;
  /** Re-open a stranded listing so the ordinary close arm resolves it;
   *  fail-closed no-op while an open OR retry-eligible 'failed' settlement
   *  rides the listing (the failed row belongs to the overdue sweep's
   *  default/forfeit/strike/cascade pass, never to a reopen). */
  reopenListing(id: number): Promise<void>;
  markItemDisposed(id: number): Promise<void>;
  /** Durable book-once claim: true only for the FIRST claim of this ref. */
  claimCustodyRef(realm: string, custodyRef: string): Promise<boolean>;
  markCustodyRefBooked(custodyRef: string): Promise<void>;
  opsListings(q: {
    realm: string;
    status: WocOps.WocOpsListingStatus;
    fromMs: number;
    toMs: number;
    page: number;
    pageSize: number;
  }): Promise<{ rows: WocOps.WocOpsListingRow[]; hasMore: boolean }>;
  opsP2pTrades(q: {
    realm: string;
    status: WocDirectedOfferStatus | 'all';
    fromMs: number;
    toMs: number;
    page: number;
    pageSize: number;
  }): Promise<{ rows: WocOps.WocOpsP2pTradeRow[]; hasMore: boolean }>;
  /** The claim row for a ref (booked flag plus rail intents), or null when
   *  no claim exists. What the resume paths consult when a claim is not fresh:
   *  booked means done; a grant intent parks; a mail intent may resume only
   *  with evidence the parcel was not already collected (B2b/B2c). */
  custodyRefState(custodyRef: string): Promise<WocCustodyRefState | null>;
  /** Stamp the durable grant intent on an UNBOOKED claim before the in-memory
   *  bag grant. False means the claim vanished or booked under us; the caller
   *  parks rather than granting against a ref it no longer holds. */
  markCustodyGrantIntent(custodyRef: string, characterId: number): Promise<boolean>;
  /** Stamp the mail-rail intent on an UNBOOKED claim before the parcel is
   *  handed to the post office, withdrawing any grant intent in the same
   *  statement (legal only after a grantCopy refusal, which provably left
   *  nothing in the bags). False parks the caller. */
  markCustodyMailIntent(custodyRef: string): Promise<boolean>;
  /** Persist a buyer's bags after a hand-to-hand delivery AND book the custody
   *  ref in one transaction: the granted bags and the delivered record cannot
   *  tear apart, so an ambiguous throw is resolvable afterwards from
   *  booked_at. 'lease_lost': the fence rejected the write (this process no
   *  longer owns the character; nothing landed). 'claim_missing': the claim
   *  row was gone or already booked (hand intervention); the save rolled back
   *  with it. */
  saveDeliveredCharacterBooked(
    save: CharacterSaveArgs,
    custodyRef: string,
  ): Promise<'booked' | 'lease_lost' | 'claim_missing'>;
  /** The delivery close tail as one transaction (delivered CAS, sale row,
   *  listing close + dispose, bond flips). 'stale': the settlement left
   *  delivering/delivered, or the listing row is gone; nothing was written.
   *  'already_final': the listing was already closed AND disposed, so this
   *  run converged nothing new (do not count it, do not re-notify).
   *  'contended': the bounded lock wait expired, retry on a later pass.
   *  Re-running it converges (every write is a compare-and-set and the sale
   *  insert dedupes on woc_market_sales_listing_once). */
  finalizeDeliveredSettlement(args: {
    settlementId: number;
    listingId: number;
    bidId: number | null;
    sale: Omit<WocSaleRow, 'id' | 'excluded' | 'atMs'>;
  }): Promise<'finalized' | 'already_final' | 'stale' | 'contended'>;
  /** The stuck classes for the ops monitor (unbooked claims, stuck
   *  'delivering' settlements, closed-but-undisposed listings, 'review'
   *  settlements, and over-aged paid-but-undecided bonds). Counts SATURATE at
   *  countCap and samples are capped, so the read is O(cap) even at
   *  incident-sized backlogs. The monitor stamps asOfMs on top.
   *  bondOlderThanMs is the stuck-bond age cutoff (the H15-scale bound). */
  stuckCustodyReadout(
    realm: string,
    olderThanMs: number,
    sampleLimit: number,
    countCap: number,
    bondOlderThanMs: number,
  ): Promise<WocStuckCustodyClasses>;
  claimBuyNowLock(
    realm: string,
    id: number,
    account: number,
    nowMs: number,
    expiresAtMs: number,
  ): Promise<
    | WocListingRow
    | 'not_found'
    | 'not_active'
    | 'locked'
    | 'no_buy_now'
    | 'own_listing'
    | 'cancel_pending'
    // The abandon cooldown, with WHEN a retry can first succeed (the later of
    // the per-listing re-claim cooldown and the hourly-cap drain), so the
    // refusal can name a remaining time instead of a bare "later".
    | { refusal: 'claim_cooldown'; retryAtMs: number }
    | 'contended'
  >;
  /** Release a lock, HOLDER-guarded: only holderAccount's lock clears. */
  clearBuyNowLock(id: number, holderAccount: number): Promise<void>;
  /** Record a public buy-now abandonment (the overdue sweep's recorder;
   *  dedupes with the steal-time recorder on the lock_expires window key). */
  recordBuyNowAbandon(
    realm: string,
    listingId: number,
    account: number,
    lockExpiresAtMs: number,
  ): Promise<void>;

  // Bids
  insertPendingBid(args: {
    realm: string;
    listingId: number;
    account: number;
    characterId: number;
    characterName: string;
    wallet: string;
    amountCents: number;
    bondCents: number;
    nowMs: number;
    minNext: (row: WocListingRow) => number;
  }): Promise<
    | { ok: true; bid: WocBidRow }
    | {
        ok: false;
        reason:
          | 'not_found'
          | 'not_active'
          | 'cancel_pending'
          | 'own_listing'
          | 'bid_too_low'
          | 'already_pending'
          // The bounded-wait refusal (the idle kill, or any future lock
          // bound): typed so a bid under contention answers 409, never 500.
          | 'contended';
      }
  >;
  /** Anti-snipe at bond progress: extend the auction end for a bid whose
   *  signature was just recorded. Best-effort (see PgWocMarketDb). */
  extendAuctionForBondProgress(
    realm: string,
    listingId: number,
    extendEndsToMs: (row: WocListingRow) => number | null,
  ): Promise<'extended' | 'skip' | 'contended'>;
  /** CAS: applies only to an unpaid quote (status pending_bond AND no
   *  recorded signature); false = nothing written. See PgWocMarketDb. */
  setBidBondQuote(
    bidId: number,
    reference: string,
    expiresAtMs: number,
    bondCents: number,
  ): Promise<boolean>;
  /** Record the bidder's signature while the chain is still deciding;
   *  nowMs stamps bond_signature_at (first recording wins). Success returns
   *  the STAMPED moment (the first arrival, not this retry), the extension
   *  anchor; 'not_pending' also covers a DIFFERENT signature against a
   *  signed pending bond (the caller re-reads for the precise refusal). */
  submitBondSignature(
    bidId: number,
    signature: string,
    nowMs: number,
  ): Promise<{ signatureAtMs: number } | 'not_pending' | 'signature_reused' | 'contended'>;
  /** Paid-but-undecided bonds, for the sweep to re-check, on the poll
   *  rotation order; excludeIds are the caller's backing-off parked rows. */
  confirmingBonds(
    realm: string,
    limit: number,
    excludeIds: readonly number[],
  ): Promise<WocBidRow[]>;
  /** Rotate one bond to the poll tail (writes poll_parked_at only). */
  touchBidPollRow(id: number): Promise<void>;
  /** A bond the chain decided against: the bid lapses and the bond voids.
   *  Returns false without writing on a HELD bond (see PgWocMarketDb: a
   *  reorg-flipped verdict must never void held money into an unreachable
   *  state); the poll parks such a row instead of letting it re-own the
   *  batch head every pass. */
  lapseBid(bidId: number): Promise<boolean>;
  bidById(id: number): Promise<WocBidRow | null>;
  /** pending_bond -> cancelled for the bidder who never funded it. */
  abandonPendingBid(realm: string, bidId: number, account: number): Promise<boolean>;
  /** pending_bond -> active; the previous active bid (if any) flips to
   *  'outbid' with bond refund_due, and the listing's standing bid updates.
   *  Refuses when the listing is no longer active or the amount no longer
   *  clears the standing bid (the racer arm: bid -> outbid, bond refund_due
   *  when held). */
  activateBid(
    bidId: number,
    nowMs: number,
  ): Promise<'activated' | 'superseded' | 'listing_closed' | 'not_pending' | 'contended'>;
  markBondHeld(bidId: number): Promise<void>;
  lapsePendingBids(realm: string, cutoffMs: number, limit: number): Promise<number>;
  /** The Activity surface's read: each row also names the listing's item so
   *  the client can say WHAT a bid or payment is for, not just how much. */
  bidsByAccount(realm: string, account: number, limit: number): Promise<WocActivityBidRow[]>;
  bidsForListing(listingId: number): Promise<WocBidRow[]>;
  /** Cascade pick: the highest 'outbid' bid meeting `minCents` whose account
   *  has NO 'won' or 'defaulted' bid on the listing (prior winners had their
   *  chance; the exclusion is derived store-side, bounded per candidate).
   *  Selection only; the 'won' stamp rides the settlement insert
   *  (insertSettlement winnerBidId). */
  nextCascadeBidder(listingId: number, minCents: number): Promise<WocBidRow | null>;
  /** With `from`, a compare-and-set (no-op when the bid left those states). */
  markBidStatus(bidId: number, status: WocBidStatus, from?: WocBidStatus[]): Promise<void>;
  /** Atomic loser demote: outbid + queue the held bond for refund in one
   *  statement, compare-and-set from 'active' (a bid a concurrent suspend
   *  already cancelled is left alone). */
  markBidOutbidQueueRefund(bidId: number): Promise<void>;
  setBondState(bidId: number, from: WocBondState[], to: WocBondState): Promise<boolean>;
  bondsDue(realm: string, limit: number): Promise<WocBidRow[]>;

  // Settlements
  /** Insert the one open settlement for a listing, serialized on the listing
   *  row lock (bid stamp first, then the listing: the file-wide lock order).
   *  When `winnerBidId` is set, that bid is stamped 'won' in the same
   *  transaction as the insert, compare-and-set from `winnerFrom` (default
   *  active/outbid): a conflict rolls both back, so no bid can sit 'won' with
   *  no settlement, and a winner that left the pickable states aborts as
   *  'winner_gone' (treated like 'live_settlement_exists' by every caller).
   *  'listing_closed' means a cancel or suspend closed the listing first
   *  (callers answer not_active); a missing listing keeps the historical
   *  'live_settlement_exists' conflation; 'contended' is the bounded
   *  lock-wait refusal. */
  insertSettlement(args: {
    listingId: number;
    bidId: number | null;
    attempt: number;
    buyerAccount: number;
    buyerCharacter: number;
    buyerName: string;
    buyerWallet: string;
    amountCents: number;
    deadlineAtMs: number;
    nowMs: number;
    winnerBidId?: number;
    winnerFrom?: WocBidStatus[];
  }): Promise<
    WocSettlementRow | 'live_settlement_exists' | 'listing_closed' | 'winner_gone' | 'contended'
  >;
  settlementById(id: number): Promise<WocSettlementRow | null>;
  /** Activity read, item-named like bidsByAccount (same rationale). */
  settlementsByAccount(
    realm: string,
    account: number,
    limit: number,
  ): Promise<WocActivitySettlementRow[]>;
  liveSettlementForListing(listingId: number): Promise<WocSettlementRow | null>;
  setSettlementQuote(
    id: number,
    reference: string,
    expiresAtMs: number,
    amountBase: string | null,
  ): Promise<boolean>;
  /** offered -> confirming with the signature recorded (unique). */
  submitSettlementSignature(
    id: number,
    signature: string,
  ): Promise<'ok' | 'not_offered' | 'signature_reused' | 'contended'>;
  /** False on a CAS miss AND on a 23505 from the one-open-settlement index
   *  (the failed -> offered revival racing a second open settlement): callers
   *  must treat false as a typed refusal, never assume the row moved. */
  transitionSettlement(
    id: number,
    from: WocSettlementState[],
    to: WocSettlementState,
    failReason?: string,
  ): Promise<boolean>;
  /** The parked-review operator arm's realm-scoped pair (the arm must not
   *  rule another realm's row; see woc_market_review_resolution.ts). */
  transitionSettlementInRealm(
    realm: string,
    id: number,
    from: WocSettlementState[],
    to: WocSettlementState,
    failReason?: string,
  ): Promise<boolean>;
  settlementStateInRealm(realm: string, id: number): Promise<{ state: WocSettlementState } | null>;
  confirmingSettlements(realm: string, limit: number): Promise<WocSettlementRow[]>;
  /** confirmed -> delivering (SKIP LOCKED claim). */
  claimDeliverableSettlements(realm: string, limit: number): Promise<WocSettlementRow[]>;
  /** Stuck 'delivering' rows (crash recovery). excludeIds are rows inside
   *  their in-process park backoff: excluded in the QUERY so a standing
   *  parked set costs no batch slots and no per-pass writes. */
  deliveringSettlements(
    realm: string,
    limit: number,
    excludeIds: readonly number[],
  ): Promise<WocSettlementRow[]>;
  /** One page of 'delivered' settlements whose LISTING never closed: the
   *  residue an older binary's separately-committed close tail leaves behind.
   *  Cursor-paged over open listing ids so the cost is O(page) regardless of
   *  the planner; the residue fetch is bounded by maxSettlements (each row
   *  costs the caller a finalize transaction plus a mail-book write), and a
   *  truncated fetch returns the last RETURNED row's listing as the cursor.
   *  lastListingId null means the cycle is exhausted. */
  deliveredUnclosedSettlementsPage(
    realm: string,
    afterListingId: number,
    pageSize: number,
    maxSettlements: number,
  ): Promise<{ settlements: WocSettlementRow[]; lastListingId: number | null }>;
  /** Dispose closed sold listings that carry a STANDING sale row (an older
   *  binary's crash residue between its close and dispose statements);
   *  returns how many converged. Sold rows with no sale stay parked; a row a
   *  concurrent transaction holds is skipped (never waited on). */
  disposeSoldResidueListings(realm: string, limit: number): Promise<number>;
  /** Rotate a parked settlement to the back of the sweep batch queue. Writes
   *  the dedicated rotation column ONLY: the stuck readout's age signals
   *  (updated_at) must never move on a park, or the parked row can never age
   *  past the stuck threshold and the monitor is blind to it. */
  touchSettlementRow(id: number): Promise<void>;
  /** The listing twin, for a parked return in the undisposed backlog. */
  touchListingRow(id: number): Promise<void>;
  /** Deadline-overdue offered/failed rows, in deadline order. */
  overdueSettlements(realm: string, nowMs: number, limit: number): Promise<WocSettlementRow[]>;
  /** 'confirming' rows older than cutoffMs (the H15 bound; aged on
   *  updated_at, which nothing re-stamps while the poll returns undecided),
   *  oldest first. Its OWN read on purpose: sharing the overdue batch let a
   *  confirming backlog (oldest deadlines by construction) occupy the whole
   *  batch head and starve the offered/failed expiry work behind it. */
  confirmingOverdueSettlements(
    realm: string,
    cutoffMs: number,
    limit: number,
  ): Promise<WocSettlementRow[]>;

  // Sales, strikes, terms
  /** Raw provenance insert; throws 23505 on a standing non-excluded row for
   *  the listing (woc_market_sales_listing_once). The delivery path itself
   *  writes its sale inside finalizeDeliveredSettlement (which dedupes on
   *  that index); this stays the primitive for corrections and tests. */
  insertSale(args: Omit<WocSaleRow, 'id' | 'excluded' | 'atMs'>): Promise<number>;
  salesForItem(realm: string, itemId: string, limit: number): Promise<WocSaleRow[]>;
  salesForSeller(realm: string, sellerName: string, limit: number): Promise<WocSaleRow[]>;
  /** The seller pane's public profile line, or null when the name no longer
   *  resolves to a character on this realm. */
  sellerProfile(realm: string, sellerName: string): Promise<WocSellerProfile | null>;
  /** The category-stamp backfill pair (woc_market_backfill.ts): the item ids
   *  on rows the stamps predate, and the stamp write itself. */
  listingItemIdsMissingCategory(): Promise<string[]>;
  stampListingCategory(
    itemId: string,
    category: string,
    subcategory: string | null,
  ): Promise<number>;
  /** 'conflict': re-including a voided row while a standing non-excluded row
   *  holds the listing's slot (woc_market_sales_listing_once). */
  setSaleExcluded(id: number, excluded: boolean): Promise<'ok' | 'miss' | 'conflict'>;
  strikeInfo(account: number): Promise<WocStrikeRow | null>;
  addStrike(account: number, suspendedUntilMs: number | null): Promise<WocStrikeRow>;
  clearStrikes(account: number): Promise<void>;
  termsAcceptedAt(account: number): Promise<number | null>;
  recordTermsAccepted(account: number, nowMs: number): Promise<void>;
  /** The buyer's delivery character, revalidated at delivery time: the stored
   *  character when it still exists on this realm under this account, else
   *  any character of the account on the realm, else null (hold and retry). */
  deliveryTarget(
    realm: string,
    account: number,
    preferredCharacter: number,
  ): Promise<{ characterId: number; name: string } | null>;
}

// The economy vocabulary lives in its own leaf module (the monitor-types
// pattern); re-exported so every existing importer keeps this one home.
export type {
  WocEstimate,
  WocEstimateSplit,
  WocMarketEconomy,
  WocPriceInfo,
  WocQuoteIntent,
  WocQuoteLeg,
} from './woc_market_economy_types';

export type WocCustodyExtract =
  | {
      ok: true;
      /** The live pid the extraction mutated: the compensation paths restore
       *  through it, never through a session lookup (a mid-leave session
       *  resolves to null while its player entity still holds the bags). */
      pid: number;
      extracted: InvSlot;
      characterName: string;
      save: CharacterSaveArgs;
    }
  | { ok: false; reason: ExtractRefusal | 'offline' | 'not_yours' };

/**
 * The result of handing a held copy straight to a live buyer.
 *
 * Every refusal is ORDINARY, not an error: the buyer logged out, or their bags
 * are full, or the character is not theirs. The caller mails the parcel instead,
 * so the item is never dropped and never duplicated.
 */
export type WocCustodyGrant =
  | { ok: true; save: CharacterSaveArgs }
  /** 'ambiguous' is the one refusal that is NOT clean: the grant already
   *  mutated the live bags and the session state is unprovable, so the
   *  caller must PARK (never convert to mail; that is a second copy). */
  | { ok: false; reason: 'offline' | 'not_yours' | 'no_space' | 'ambiguous' };

/** The durable claim row for a custody ref (see custodyRefState). */
export interface WocCustodyRefState {
  booked: boolean;
  /** Non-null while a direct bag grant is (or may be) in flight under this
   *  ref: the character it was granted to. See the DDL comment on
   *  woc_market_custody_claims.grant_character_id. */
  grantCharacterId: number | null;
  /** True once the mail rail durably recorded its intent for this ref;
   *  a claim with NEITHER intent and no booking is unattributable and parks. */
  mailIntent: boolean;
}

// The stuck-custody monitor vocabulary lives in woc_market_monitor_types.ts
// (the ratchet's sibling pattern); the pair keeps this import path.
export type {
  WocStuckCustodyClasses,
  WocStuckCustodyReadout,
} from './woc_market_monitor_types';

/** The one bridge into the live Sim (game.ts wiring). Every method is
 *  synchronous-in-memory except persistMailParcel, which books at most once
 *  by custodyRef and then persists the realm mail blob. */
export interface WocMarketCustody {
  /** Run the escrow critical section (extract, re-check, durable write,
   *  compensation) as ONE job on the character's per-character save FIFO, so
   *  no autosave snapshot can interleave anywhere inside it: a snapshot
   *  serialized in-job is fresher than every previously committed one, and a
   *  stale pre-extraction autosave always commits BEFORE the job runs (H5).
   *  'contended' means the job never started (another escrow job was queued
   *  for this character, the wait deadline fired first, or the seller's
   *  dirty guild books could not be flushed clear): nothing was extracted
   *  and the request simply retries. The job must not await another
   *  character write for the same character (FIFO self-deadlock). The
   *  refusal is a string sentinel sharing the job's return channel, and the
   *  implementation races an internal 'timeout' sentinel on the same
   *  channel: safe while every caller's T is an object (as here), so a
   *  future caller whose T could itself be a string (either literal) must
   *  wrap its result first. */
  runSerialized<T>(characterId: number, job: () => Promise<T>): Promise<T | 'contended'>;
  /** Ownership probe with ZERO side effects, consulted before runSerialized:
   *  a foreign character id must never reach the flush or the depth cap. */
  ownsLiveCharacter(accountId: number, characterId: number): boolean;
  /** Terminal escrow-job signals: 'fenced' kicks the displaced zombie,
   *  'ambiguous' quarantines so the durable row decides. The pid is the
   *  extraction identity; a turned-over session is left alone. Fire and
   *  forget. */
  escrowSessionLost(pid: number, characterId: number, kind: 'fenced' | 'ambiguous'): void;
  extractCopy(accountId: number, characterId: number, ref: ExtractRef): WocCustodyExtract;
  /** Hand a held copy straight to a live buyer's bags. Returns the save the
   *  caller must persist before treating the delivery as done. */
  grantCopy(accountId: number, characterId: number, slot: InvSlot): WocCustodyGrant;
  /** Re-serialize after an ambiguous hand-off; retrying the held grant cannot mint. */
  snapshotCopy(accountId: number, characterId: number): WocCustodyGrant;
  acknowledgeCharacterSave?(save: CharacterSaveArgs): void;
  /** The delivered-save FIFO entry (the write-path rider closed the
   *  commitGrant carve-out): run `persist` with a snapshot serialized INSIDE
   *  the character's save-FIFO slot, so the grant's blob orders against the
   *  buyer's autosaves exactly like the escrow write orders against the
   *  seller's. 'busy' is the head-of-line bound (the FIFO stayed wedged past
   *  the wait deadline; nothing serialized or written, the caller parks and
   *  retries off its durable claim); 'session_lost' means the session left
   *  or its lease rotated during the wait (park; only the operator can
   *  attribute the earlier grant). Every caller's T must stay an object or
   *  a literal distinct from these two sentinels. */
  persistGrantSerialized<T>(
    accountId: number,
    characterId: number,
    expectedNonce: string | undefined,
    persist: (save: CharacterSaveArgs) => Promise<T>,
  ): Promise<T | 'busy' | 'session_lost'>;
  /** Compensation for a failed escrow persist: the copy goes back into the
   *  extraction pid's live bags while that player exists (a queued teardown
   *  flush then persists it), or home by return parcel once it is gone. */
  restoreCopy(pid: number, characterId: number, slot: InvSlot): void;
  /** Book-once (by custodyRef) + persist. 'booked' covers the already-booked
   *  reconciliation case too: after this resolves, the parcel is durably in
   *  the realm mail blob. */
  persistMailParcel(
    recipient: { key: string; name: string },
    letter: 'delivery' | 'return' | 'sold_notice',
    items: InvSlot[],
    custodyRef: string,
  ): Promise<void>;
  /** Whether the LIVE mail book still holds a parcel under this ref. Advisory
   *  (a collected letter can be deleted), which is exactly why the resume
   *  paths treat presence as permission and absence as ambiguity. */
  hasParcel(custodyRef: string): boolean;
}

export interface WocMarketConfig {
  enabled: boolean;
  realm: string;
  policy: WocEligibilityPolicy;
  /** H15 bound: how long a settlement may sit in 'confirming' before the
   *  overdue sweep parks it in the operator 'review' state. Config-read
   *  (WOC_MARKET_CONFIRMING_REVIEW_HOURS via wocMarketConfig); hours-scale by
   *  design, so a routine finality delay or a short economy outage self-heals
   *  through the poll before an operator is ever paged. */
  confirmingReviewMs: number;
}

export interface WocMarketDeps {
  db: WocMarketDb;
  economy: WocMarketEconomy;
  custody: WocMarketCustody;
  verifiedWallet(account: number): Promise<string | null>;
  balanceTokens(pubkey: string): Promise<number | null>;
  /** True ONLY when the in-memory dev economy is live (the double-gated
   *  ALLOW_DEV_COMMANDS + WOC_MARKET_DEV_SERVICE switch): step-up challenges
   *  then answer signatureRequired false and accept the devsig form. In
   *  production this is false and every proof is a real ed25519 signature. */
  stepUpDevSig: boolean;
  /** Desktop browser-signing registrar (the process handoff store). OPTIONAL:
   *  absent (the rigs), nothing is desktop-signable; never widens behavior. */
  desktopHandoff?: WocDesktopHandoffRegistrar;
  config: WocMarketConfig;
  /** The hot-read cache (H11). OPTIONAL: absent, every read is uncached (the
   *  service-test rigs and the sweep-only constructions), which is also why
   *  its absence can never widen behavior, only cost. main.ts wires the SAME
   *  instance here and onto the routes runtime, whose mutation handlers own
   *  the busts. */
  readCache?: WocMarketReadCache;
  /** True once the process began its shutdown drain (main.ts wires the
   *  health module's flag). OPTIONAL: absent means never draining (the test
   *  rigs and sweep-only constructions), which cannot widen behavior, only
   *  skip one refusal. Consulted by createListing alone (the escrow
   *  sequence's honest tail is what outlives the grace window; the other
   *  guards are 2s-bounded, judged at the write-path rider). */
  draining?: () => boolean;
  /** True while the realm escrow gate is at cap (main.ts wires the gate's
   *  live stats). OPTIONAL like draining: absent means never saturated (the
   *  rigs). Consulted by the two escrow entries BEFORE a single-use step-up
   *  proof is consumed, so realm saturation refuses without burning an
   *  honest seller's signature; the custody entry stays the authoritative
   *  check. */
  escrowSaturated?: () => boolean;
  now?: () => number;
  /** Per-pass observability sink (main.ts logs it). `saturated` names every arm
   *  that came back with a FULL batch, i.e. a backlog that is not draining.
   *  `elapsedMs` is the pass wall-clock through the injected now() (zero under
   *  a fixed test clock), so a slow pass is measurable before it becomes pool
   *  contention. */
  onSweepPass?(stats: WocSweepPassStats, saturated: readonly string[], elapsedMs: number): void;
  /** Per-arm failure sink: one poisoned row or one failing arm is reported
   *  here and the REST of the pass still runs (per-arm isolation). Defaults
   *  to console.error when absent. */
  onSweepError?(arm: string, err: unknown): void;
}

// ---------------------------------------------------------------------------
// Service results
// ---------------------------------------------------------------------------

export type WocMarketRefusal =
  | 'disabled'
  | 'market_paused' // economy service down or oracle unhealthy
  | 'wallet_required'
  | 'terms_required'
  | 'account_suspended'
  | 'character_invalid'
  | 'not_found'
  | 'not_yours'
  | 'not_active'
  | 'own_listing'
  | 'has_bids'
  | 'bid_too_low'
  | 'already_pending'
  | 'insufficient_balance'
  | 'quote_unavailable'
  | 'quote_expired'
  | 'bond_window_closed'
  | 'not_pending'
  | 'confirm_failed'
  // A recorded signature is awaiting the chain's verdict: quote refreshes and
  // abandons must wait for it rather than orphan or void money in flight.
  | 'confirm_in_flight'
  | 'buy_now_locked'
  // The seller stamped cancel-intent on this listing: no new lock claims or
  // bids; the current window resolves and then the listing closes.
  | 'cancel_pending'
  // The claimer recently abandoned a buy-now window (this listing's re-claim
  // cooldown, or the account-wide abandons-per-hour cap).
  | 'claim_cooldown'
  // A payment for the listing is past 'offered' (or delivered but unclosed):
  // cancel and suspend must wait for it to resolve, never race it.
  | 'settlement_in_flight'
  // The bounded lock wait on a guard transaction expired (55P03) or the
  // transaction was a deadlock victim (40P01): plain contention, retryable.
  | 'contended'
  // An admin sale correction is blocked by a standing non-excluded sale row
  // for the same listing (woc_market_sales_listing_once).
  | 'sale_conflict'
  | 'no_buy_now'
  | 'cap_reached'
  | 'lease_lost'
  | 'signature_reused'
  | 'stale_copy'
  // Directed p2p offers
  | 'recipient_wallet_required' // the named buyer has no verified wallet
  | 'self_offer' // seller and buyer are the same account OR the same wallet
  | 'offer_pending' // one live directed deal per pair (the strike-farming bound)
  | 'item_mismatch' // the copy offered at acceptance is not the pinned agreed copy
  | 'offer_expired'
  | ExtractRefusal
  | WocEligibilityRefusal
  | ListingParamsRefusal
  // Wallet step-up on the custody movers (B6/R1): stepup_required is the
  // bearer-only arm; the rest come out of the challenge verifier
  // (server/woc_market_stepup.ts).
  | WocStepUpRefusal;

/** Optional per-refusal values for the route's error envelope. The code's
 *  declared placeholder list in server/http/error_codes.ts is the contract;
 *  a refusal carrying params only renders them when the route passes them
 *  through (throwRefusal's params arm). */
export type Refused = {
  ok: false;
  reason: WocMarketRefusal;
  params?: Record<string, string | number>;
};
const refuse = (reason: WocMarketRefusal, params?: Record<string, string | number>): Refused =>
  params === undefined ? { ok: false, reason } : { ok: false, reason, params };

// The pass budgets and deadlines live in woc_market_budgets.ts (the ratchet's
// sibling-module pattern); the public pair keeps this import path.
export { BOND_PAYOUT_BUDGET_MS, WOC_MARKET_ME_READOUT_DEADLINE_MS } from './woc_market_budgets';

/** Per-arm counts for one sweep pass, so a wedged marketplace is visible: a
 *  silent idle pass and a permanently starved backlog look identical without
 *  it. An arm returning a FULL batch is the "backlog is not draining" signal. */
// The sweep's pass-accounting vocabulary lives in woc_market_sweep_types.ts
// (the ratchet's leaf-types pattern); the trio keeps this import path.
export type {
  WocDeliveryScope,
  WocSweepErrorTag,
  WocSweepPassStats,
} from './woc_market_sweep_types';

export class WocMarketService {
  constructor(private readonly deps: WocMarketDeps) {}

  /** Direct grants THIS process applied to a live session whose atomic
   *  save-and-book has not committed yet: custodyRef to the session identity
   *  the grant landed in. Process-local ON PURPOSE: the in-memory grant lives
   *  exactly as long as this process and this session, so a marker that
   *  outlived either would authorize a resume against reloaded bags that may
   *  not hold the item. After a restart (or a session change) an unbooked
   *  grant claim parks for the operator instead (handToBuyer). */
  private readonly pendingGrants = new Map<
    string,
    { characterId: number; leaseNonce: string | undefined; stampMs: number }
  >();

  /** Mail attempts THIS process has stamped an intent for. `written` flips
   *  the moment an attempt REACHES the post office (set before the call, so
   *  a throw anywhere inside still counts): an unwritten entry proves no
   *  parcel can exist yet and authorizes the first write; a WRITTEN entry
   *  proves nothing about collection, so from then on only the parcel still
   *  being IN the book authorizes a re-attempt (a collected letter re-mails
   *  a second copy otherwise). Lost on restart, at which point the in-book
   *  check is the only evidence (bookCustodyOnce). */
  private readonly pendingMail = new Map<string, { stampMs: number; written: boolean }>();

  /** Parked deliveries and their next-retry time: a parked settlement rotates
   *  ONCE (at park time) onto the sweep_parked_at batch order and is then
   *  EXCLUDED from the batch reads until its retry, so a standing parked set
   *  costs no batch slots, no per-pass writes, and cannot starve fresh rows. */
  private readonly parkedDeliveries = new Map<number, number>();

  /** Parked returns, same shape, keyed by listing id: the return backlog
   *  shares the rotation order, so a permanently refused return would
   *  otherwise own the head of its batch and busy-loop exactly like a
   *  parked delivery. */
  private readonly parkedReturns = new Map<number, number>();

  /** Parked cancel-intent converges, same shape, keyed by listing id: a
   *  stamped listing whose buyer PAID skips the converge until that
   *  settlement resolves, which can take operator-scale time. */
  private readonly parkedCancelIntents = new Map<number, number>();

  /** Parked bond polls, keyed by bid id: a signed bond the chain leaves
   *  undecided past the poll park delay (WOC_MARKET_BOND_POLL_PARK_SECONDS,
   *  deliberately its own tunable, not the pending TTL) rotates out of the
   *  poll head (60s backoff) instead of occupying one of the batch's slots
   *  every pass forever; young confirming bonds keep the full poll cadence. */
  private readonly parkedBondPolls = new Map<number, number>();

  /** Service vocabulary drift channel (woc_market_drift_warn.ts): judged
   *  through the same exported Sets the wire screens use. */
  private readonly driftWarn = new WocWireDriftWarner();

  private static readonly PARK_RETRY_MS = 60_000;

  private pruneLocalLedgers(nowMs: number): void {
    pruneWocLocalLedgers(
      nowMs,
      [this.pendingGrants, this.pendingMail],
      [this.parkedDeliveries, this.parkedCancelIntents, this.parkedBondPolls, this.parkedReturns],
    );
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private get cfg(): WocMarketConfig {
    return this.deps.config;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async status(): Promise<{
    enabled: boolean;
    price: WocPriceInfo;
    maxActiveListings: number;
  }> {
    const price = this.cfg.enabled
      ? await this.deps.economy.price()
      : { available: false, healthy: false, reason: 'disabled', tokensPerUsd: null, asOfMs: null };
    return {
      enabled: this.cfg.enabled,
      price,
      maxActiveListings: WOC_MARKET_MAX_ACTIVE_LISTINGS,
    };
  }

  async browse(q: WocBrowseQuery): Promise<{ rows: WocListingRow[]; hasMore: boolean }> {
    if (!this.cfg.enabled) return { rows: [], hasMore: false };
    // Viewer-identical per query tuple (the SQL excludes directed listings and
    // carries nothing viewer-scoped), so the page is shared through the read
    // cache; listingView's `mine` is computed per request over the shared rows.
    // EVERY filtered search AND every deep page BYPASSES the cache on
    // purpose: the cached set is exactly the unfiltered shallow pages, the
    // one view every browsing player shares and the client poll re-asks.
    // Filter axes multiply the key space (quality x format x category x
    // subcategory x itemIds spans thousands of combinations), so caching
    // them would let one account's distinct keys evict the hot shared pages
    // while each eviction re-buys an OFFSET-walk read. A filtered browse is
    // a per-user, click-driven lookup (the client keeps it OUT of its poll);
    // the limiter is its bound.
    const refresh = () => this.deps.db.browseListings(this.cfg.realm, q);
    const unfiltered =
      q.itemIds === null &&
      q.quality === null &&
      q.format === null &&
      q.category === null &&
      q.subcategory === null;
    return this.deps.readCache && unfiltered && q.page <= WOC_MARKET_BROWSE_CACHE_MAX_PAGE
      ? this.deps.readCache.browse(q, refresh)
      : refresh();
  }

  /**
   * One listing, for the detail pane.
   *
   * `viewerAccount` is REQUIRED rather than optional, even though a public
   * listing ignores it. A directed sale is visible only to its two parties, and
   * an optional parameter is a defence a caller can forget to pass: making it
   * required means a new call site cannot silently become a leak. Absent or
   * unmatched, a directed row reads as `null`, the same answer a missing id
   * gives, so the two are indistinguishable to a caller probing ids.
   */
  async listingDetail(
    id: number,
    viewerAccount: number | null,
  ): Promise<{ listing: WocListingRow; estimate: WocEstimate | null } | null> {
    if (!this.cfg.enabled) return null;
    // The ROW is shared through the read cache; the directed-sale party gate
    // below runs per request over it, so a warm cache never widens who sees a
    // directed listing (the cache-key anti-enumeration rule).
    const rowRefresh = () => this.deps.db.listingById(this.cfg.realm, id);
    const listing = await (this.deps.readCache
      ? this.deps.readCache.listingRow(id, rowRefresh)
      : rowRefresh());
    if (!listing) return null;
    if (listing.directedBuyerAccount !== null) {
      const isParty =
        viewerAccount !== null &&
        (viewerAccount === listing.directedBuyerAccount || viewerAccount === listing.sellerAccount);
      if (!isParty) return null;
    }
    const estimateCents = listing.currentBidCents ?? listing.startCents;
    const estimate = await this.deps.economy.estimate(estimateCents).catch(() => null);
    return { listing, estimate };
  }

  async estimate(usdCents: number): Promise<WocEstimate> {
    if (!this.cfg.enabled || !Number.isInteger(usdCents) || usdCents <= 0) {
      return { available: false, usdCents, amount: null, asOfMs: null, split: null };
    }
    return this.deps.economy.estimate(usdCents);
  }

  async myActivity(account: number): Promise<{
    listings: WocListingRow[];
    bids: WocActivityBidRow[];
    settlements: WocActivitySettlementRow[];
    strikes: WocStrikeRow | null;
    termsAcceptedAtMs: number | null;
    wallet: string | null;
  }> {
    const refresh = () => this.myActivityUncached(account);
    return this.deps.readCache ? this.deps.readCache.myActivity(account, refresh) : refresh();
  }

  /** SEQUENTIAL on purpose, never Promise.all: each db read is its own
   *  implicit pool checkout, so a six-way fan-out held six of the shared
   *  pool's ten clients per request (H11). One at a time, one request can
   *  never hold more than one client; the pool-hold bound is pinned by a
   *  counting test. */
  private async myActivityUncached(account: number): Promise<{
    listings: WocListingRow[];
    bids: WocActivityBidRow[];
    settlements: WocActivitySettlementRow[];
    strikes: WocStrikeRow | null;
    termsAcceptedAtMs: number | null;
    wallet: string | null;
  }> {
    const realm = this.cfg.realm;
    const startedAtMs = this.now();
    // Checked BETWEEN reads, the bond walk's shape: a read in flight
    // finishes, and a readout past the deadline fails fast instead of
    // walking every remaining checkout's own 5s wait (rationale at the
    // constant). Under the fixed test clocks elapsed is zero.
    const deadline = (): void => {
      if (this.now() - startedAtMs > WOC_MARKET_ME_READOUT_DEADLINE_MS) {
        throw new Error('woc market activity readout deadline exceeded');
      }
    };
    const listings = await this.deps.db.listingsBySeller(realm, account);
    deadline();
    const bids = await this.deps.db.bidsByAccount(realm, account, 50);
    deadline();
    const settlements = await this.deps.db.settlementsByAccount(realm, account, 50);
    deadline();
    const strikes = await this.deps.db.strikeInfo(account);
    deadline();
    const termsAcceptedAtMs = await this.deps.db.termsAcceptedAt(account);
    deadline();
    const wallet = await this.deps.verifiedWallet(account);
    return { listings, bids, settlements, strikes, termsAcceptedAtMs, wallet };
  }

  async salesHistory(itemId: string, limit = 20): Promise<WocSaleRow[]> {
    if (!this.cfg.enabled) return [];
    const refresh = () => this.deps.db.salesForItem(this.cfg.realm, itemId, limit);
    // Keyed by item alone: every route caller uses the default limit, and a
    // non-default limit (none exists today) must bypass rather than poison
    // the shared key. UNKNOWN item ids also bypass: they answer an empty
    // list either way, and caching them would let free-text ids (the route
    // screens the charset, not the vocabulary) evict the real items' warm
    // history entries.
    return this.deps.readCache && limit === 20 && Object.hasOwn(ITEMS, itemId)
      ? this.deps.readCache.sales(itemId, refresh)
      : refresh();
  }

  /** A seller's recent completed trades PLUS their public profile line
   *  (guild, character age), the Browse seller click-through's ONE readout:
   *  resolved together and cached as one entry so the pane costs one request
   *  and one cache slot. A null profile means the name no longer resolves to
   *  a character (renamed or deleted); the sales are provenance and stand
   *  alone. Seller names are FREE TEXT off the wire, so unlike the item read
   *  there is no vocabulary to gate caching on: the route screens shape, and
   *  the cache arm is its own bounded LRU whose worst case is churn, never
   *  an unbounded key set. Names resolve case-sensitively: the stored
   *  seller_name is the character's exact name, and the client always sends
   *  a name it read off a listing row. */
  async sellerSalesHistory(sellerName: string, limit = 20): Promise<WocSellerHistoryReadout> {
    if (!this.cfg.enabled) return { sales: [], profile: null };
    const refresh = async (): Promise<WocSellerHistoryReadout> => ({
      sales: await this.deps.db.salesForSeller(this.cfg.realm, sellerName, limit),
      profile: await this.deps.db.sellerProfile(this.cfg.realm, sellerName),
    });
    return this.deps.readCache && limit === 20
      ? this.deps.readCache.sellerSales(sellerName, refresh)
      : refresh();
  }

  // -------------------------------------------------------------------------
  // Shared guards
  // -------------------------------------------------------------------------

  private async guardEnabledHealthy(): Promise<Refused | null> {
    if (!this.cfg.enabled) return refuse('disabled');
    const price = await this.deps.economy.price();
    if (!price.available || !price.healthy) return refuse('market_paused');
    return null;
  }

  private async guardSuspended(account: number): Promise<Refused | null> {
    const row = await this.deps.db.strikeInfo(account);
    if (row?.suspendedUntilMs !== null && row !== null && row.suspendedUntilMs > this.now()) {
      return refuse('account_suspended');
    }
    return null;
  }

  private async guardTerms(account: number, acceptTerms: boolean): Promise<Refused | null> {
    const at = await this.deps.db.termsAcceptedAt(account);
    if (at !== null) return null;
    if (!acceptTerms) return refuse('terms_required');
    await this.deps.db.recordTermsAccepted(account, this.now());
    return null;
  }

  /** The stored form of the agreed-copy fingerprint: a fixed-width sha256 of
   *  the sim's canonical itemCopyPin string, never the raw serialization. The
   *  identity RULE stays the sim's (one pin definition for every exchange
   *  pipe); the digest is a storage decision: item_pin rides every offer row,
   *  is re-read by the offer views and the converge arm, and a raw
   *  client-derived serialization would let one account bank tens of
   *  kilobytes per row against the retention window. The pin is CONTENT
   *  identity, not slot identity: a byte-identical duplicate in another bag
   *  cell satisfies it, and the seller's named index picks which copy ships
   *  (deliberate: identical copies are interchangeable by definition). */
  private itemPinDigest(slot: {
    itemId: string;
    count: number;
    instance?: ItemInstancePayload;
    craftedRecipeId?: string;
  }): string {
    return createHash('sha256').update(itemCopyPin(slot)).digest('hex');
  }

  /** Balance is a bid-time plausibility gate, never a guarantee (the bond is
   *  the enforcement). Compares service-computed token estimates against the
   *  cached chain read; when either side is unreadable the gate refuses
   *  closed. */
  private async guardBalance(wallet: string, usdCents: number): Promise<Refused | null> {
    const [estimate, balance] = await Promise.all([
      this.deps.economy.estimate(usdCents),
      this.deps.balanceTokens(wallet),
    ]);
    if (!estimate.available || estimate.amount === null) return refuse('market_paused');
    if (balance === null) return refuse('insufficient_balance');
    return balance >= estimate.amount.tokens ? null : refuse('insufficient_balance');
  }

  /**
   * Consume-and-verify a step-up proof (B6/R1). Enforcement lives IN the two
   * service methods that move custody, never in route middleware a future
   * route could miss. A consumed challenge is spent even when verification
   * refuses (single-use by design: no retry oracle); `wallet` is the CURRENT
   * linked wallet the caller just re-read, the same canonical record the
   * payment path trusts.
   */
  /** The extracted step-up flow's slice of this service, built per call. */
  private stepUpCtx(): WocStepUpFlowCtx {
    return {
      db: this.deps.db,
      realm: this.cfg.realm,
      devSig: this.deps.stepUpDevSig,
      now: () => this.now(),
    };
  }

  private async guardStepUp(
    account: number,
    wallet: string,
    proof: WocStepUpProof | undefined,
    binding: WocStepUpBinding,
  ): Promise<Refused | null> {
    const reason = await stepUpProofRefusal(this.stepUpCtx(), account, wallet, proof, binding);
    return reason === null ? null : refuse(reason);
  }

  /**
   * Issue a step-up challenge for one intended custody move. The directed arm
   * takes ONLY the offer id and derives item and price from the authoritative
   * offer row (seller-scoped, anti-enumeration not_found for anyone else), so
   * the wallet always shows the figures the deal actually carries.
   */
  async issueStepUpChallenge(
    account: number,
    request:
      | Extract<WocStepUpBinding, { operation: 'create_listing' }>
      | { operation: 'accept_directed_offer'; offerId: number },
  ): Promise<
    | {
        ok: true;
        challenge: {
          nonce: string;
          message: string;
          expiresAtMs: number;
          signatureRequired: boolean;
        };
      }
    | Refused
  > {
    const gate = (await this.guardEnabledHealthy()) ?? (await this.guardSuspended(account));
    if (gate) return gate;
    const wallet = await this.deps.verifiedWallet(account);
    if (!wallet) return refuse('wallet_required');
    const out = await issueStepUpChallengeFlow(this.stepUpCtx(), account, wallet, request);
    if (!out.ok) return refuse(out.reason);
    // Registered by nonce so the handoff can serve the stored message.
    registerWocStepUpHandoff(this.deps.desktopHandoff, account, wallet, out.challenge);
    return out;
  }

  // -------------------------------------------------------------------------
  // Listing lifecycle (seller)
  // -------------------------------------------------------------------------

  async createListing(args: {
    account: number;
    characterId: number;
    itemRef: ExtractRef;
    params: WocListingParams;
    /** Set only by acceptDirectedOffer: the offer being consummated plus the
     *  agreed copy's fingerprint. The escrow stamps the offer atomically and
     *  the in-job re-check refuses a copy whose pin does not match (H10). */
    directed?: { offerId: number; itemPin: string | null };
    /** The wallet step-up proof (B6/R1). Required on every PUBLIC listing;
     *  the directed consummation arm skips it because the SELLER's own
     *  acceptance already verified an offer-bound proof. */
    stepUp?: WocStepUpProof;
  }): Promise<{ ok: true; listing: WocListingRow } | Refused> {
    // The draining refusal (the escrow write-path rider), FIRST and IO-free:
    // the HTTP listener stays open through the shutdown drain, and a listing
    // accepted late in the grace window can enter an escrow sequence whose
    // honest tail (guild flush plus the transaction ceiling) outlives
    // pool.end(). Behind the health guard it would itself run two pooled
    // reads on a closing pool. Only the ESCROW mutations refuse on drain
    // (this method, and the directed consummation that calls it: that path
    // escrows too, deliberately); the other guards are 2s-bounded and the
    // drain window is seconds, judged at the rider. The existing paused
    // answer (503, localized) is honest copy for "come back in a moment".
    if (this.deps.draining?.()) return refuse('market_paused');
    // The realm-gate pre-check, ALSO before any consumable is spent: the
    // gate's own refusal lands inside runSerialized, AFTER guardStepUp has
    // consumed the seller's single-use wallet challenge, so realm saturation
    // (other players' load) would otherwise burn an honest seller's
    // signature per retry. Racy by design (the authoritative check stays in
    // the custody entry); it leaks only realm-wide saturation, the same
    // class of state /readyz already serves unauthenticated.
    if (this.deps.escrowSaturated?.()) return refuse('contended');
    // A suspended defaulter cannot list either, not just bid: the suspension is
    // a marketplace-wide hold (PRD "Integrity").
    const gate = (await this.guardEnabledHealthy()) ?? (await this.guardSuspended(args.account));
    if (gate) return gate;
    const wallet = await this.deps.verifiedWallet(args.account);
    if (!wallet) return refuse('wallet_required');
    // Step-up BEFORE any business validation, deliberately: an unauthorized
    // bearer learns nothing about params or eligibility (no oracle). The one
    // accepted cost is that an honest seller who typo'd a price combination
    // signs the wallet popup and only then hears the params are invalid; the
    // client pre-validates the common cases (the buy-now-above-start check), so
    // this is an edge, and preserving the clean no-oracle posture on a custody
    // path outweighs it. The binding digests the RAW params the client asked
    // the challenge for, so challenge and request agree byte-for-byte or
    // refuse. The directed arm's proof was consumed at the seller's acceptance;
    // the public route can never set args.directed (pinned by the routes
    // suite), so this skip is unreachable from outside.
    if (!args.directed) {
      // Force expectInstance PRESENT (null if omitted) on the public arm: the
      // extraction skips its copy check when expectInstance is undefined, so an
      // omitting client could sign a challenge with no copy detail and escrow a
      // different copy at the named index (a compromised-client swap). With it
      // pinned to null-or-the-claimed-copy, the extraction's stale_copy check
      // always runs and the step-up binding is over this same value, so the
      // signed copy equals the claimed copy equals the extracted copy. The
      // directed arm keeps its own itemRef (its H10 itemPin re-check pins the
      // authoritative copy), so this normalization is public-arm only.
      args = {
        ...args,
        itemRef: { ...args.itemRef, expectInstance: args.itemRef.expectInstance ?? null },
      };
      const gateUp = await this.guardStepUp(args.account, wallet, args.stepUp, {
        operation: 'create_listing',
        itemId: args.itemRef.itemId,
        expectInstance: args.itemRef.expectInstance ?? null,
        format: args.params.format,
        startCents: args.params.startCents,
        reserveCents: args.params.reserveCents,
        buyNowCents: args.params.buyNowCents,
        durationHours: args.params.durationHours,
        offerNext: args.params.offerNext,
      });
      if (gateUp) return gateUp;
    }
    const params = validListingParams(args.params);
    if (!params.ok) return refuse(params.reason);
    // Own-property lookup, same as the offer intake: a prototype key would
    // resolve a Function the taxonomy's closed default refuses anyway, but an
    // honest miss beats a lucky one.
    const def = Object.hasOwn(ITEMS, args.itemRef.itemId) ? ITEMS[args.itemRef.itemId] : undefined;
    const eligible = listingEligibility(
      def,
      args.itemRef.expectInstance ?? undefined,
      this.cfg.policy,
    );
    if (!eligible.ok) return refuse(eligible.reason);
    // The cap counts EVERY non-closed listing, directed included (H12): both
    // kinds escrow a real copy, and the old directed exemption let an
    // accomplice pair lock unbounded escrow outside the cap. This pre-check
    // races (the authoritative count runs inside the escrow transaction under
    // the accounts row lock, same predicate); its job is refusing a capped
    // seller BEFORE the extract pays the FIFO job.
    const active = await this.deps.db.countActiveBySeller(this.cfg.realm, args.account);
    if (active >= WOC_MARKET_MAX_ACTIVE_LISTINGS) return refuse('cap_reached');

    // Custody edge, the WHOLE critical section as one job on the seller's
    // per-character save FIFO (H5): the copy leaves the live bags, the
    // character save and the listing insert commit together, and any persist
    // refusal restores the copy, all with no autosave able to interleave. An
    // autosave snapshot serialized BEFORE the extraction therefore always
    // commits before the escrow write, and the escrow blob (serialized at
    // extraction, inside the job) is fresher than every committed one, so no
    // stale snapshot can ever resurrect the escrowed item.
    // Ownership resolves BEFORE the serialized job: a foreign character id
    // must be a pure refusal with zero side effects (it must never occupy the
    // victim's escrow slot nor force their guild-book flush). The job's own
    // extractCopy re-checks under the queue, so a session that drops between
    // this probe and the job still refuses.
    if (!this.deps.custody.ownsLiveCharacter(args.account, args.characterId)) {
      return refuse('character_invalid');
    }
    type ListingJobOutcome = { refusal: WocMarketRefusal } | { id: number };
    const outcome = await this.deps.custody.runSerialized(
      args.characterId,
      async (): Promise<ListingJobOutcome> => {
        const extract = this.deps.custody.extractCopy(args.account, args.characterId, args.itemRef);
        if (!extract.ok) {
          return {
            refusal:
              extract.reason === 'offline' || extract.reason === 'not_yours'
                ? ('character_invalid' as const)
                : extract.reason,
          };
        }
        // Re-decide eligibility against the AUTHORITATIVE extracted copy, not
        // the payload the client claimed: a copy whose rolled quality sits
        // below its def quality must not slip through on the def alone.
        const eligibleReal = listingEligibility(def, extract.extracted.instance, this.cfg.policy);
        if (!eligibleReal.ok) {
          this.deps.custody.restoreCopy(extract.pid, args.characterId, extract.extracted);
          return { refusal: eligibleReal.reason };
        }
        // The agreed-item fingerprint (H10), checked against the AUTHORITATIVE
        // extracted copy, never the claimed ref: a seller accepting with a
        // different item, or a re-rolled instance of the same id, refuses
        // here and the copy restores. A null pin (an offer that predates the
        // pin column) refuses too: an unverifiable agreement must not escrow.
        if (args.directed && this.itemPinDigest(extract.extracted) !== args.directed.itemPin) {
          this.deps.custody.restoreCopy(extract.pid, args.characterId, extract.extracted);
          return { refusal: 'item_mismatch' as const };
        }
        const nowMs = this.now();
        const listing: NewWocListing = {
          realm: this.cfg.realm,
          sellerAccount: args.account,
          sellerCharacter: args.characterId,
          sellerName: extract.characterName,
          sellerWallet: wallet,
          item: extract.extracted,
          itemId: extract.extracted.itemId,
          quality: extract.extracted.instance?.rolled?.quality ?? def?.quality ?? 'common',
          category: def ? exchangeBrowseCategory(def) : null,
          subcategory: def ? exchangeBrowseSubcategory(def) : null,
          params: args.params,
          // A directed hold is the settlement window, not an auction duration
          // (H12): the named buyer pays now or the item flies home. The
          // params keep a valid durationHours for shape validation only; it
          // is deliberately inert on this arm.
          endsAtMs:
            args.params.directedBuyerAccount !== null
              ? nowMs + WOC_MARKET_DIRECTED_HOLD_SECONDS * 1000
              : nowMs + args.params.durationHours * 3600 * 1000,
          directedOfferId: args.directed?.offerId ?? null,
        };
        let inserted: Awaited<ReturnType<WocMarketDb['escrowInsertListing']>>;
        try {
          inserted = await this.deps.db.escrowInsertListing(extract.save, listing);
        } catch (err) {
          // Restore ONLY on proof the transaction rolled back. A throw that
          // proves nothing (a connection-class failure, a driver timeout with
          // no SQLSTATE) may follow a COMMIT that landed, and restoring there
          // mints the copy twice: once in the listing, once in the bags. The
          // ambiguous arm QUARANTINES the session instead: it reloads from
          // the durable row, which is correct in BOTH branches (committed:
          // item-free blob plus the listing; rolled back: the item still in
          // the bags). The log carries the full extracted slot so an
          // operator can reconstruct an instanced copy if anything else
          // interferes; the error itself is connection-class here, but keep
          // err.detail out of any future widening (constraint details echo
          // row values).
          if (throwProvedRollback(err)) {
            this.deps.custody.restoreCopy(extract.pid, args.characterId, extract.extracted);
          } else {
            // code+message only, never the raw error: an ambiguous class that
            // carries a detail (XX000, 08P01) can echo row values.
            console.error(
              `[woc_market] escrow_outcome_unknown: listing persist for character ${args.characterId} ` +
                `threw without rollback proof; abandoning the session so the durable row decides, ` +
                `slot ${JSON.stringify(extract.extracted)}`,
              {
                code:
                  typeof err === 'object' && err !== null
                    ? (err as { code?: string }).code
                    : undefined,
                message: String(err),
              },
            );
            this.deps.custody.escrowSessionLost(extract.pid, args.characterId, 'ambiguous');
          }
          throw err;
        }
        if (!inserted.ok) {
          if (inserted.reason === 'lease_lost') {
            // The fence matched no row: this session is a displaced zombie
            // (same signal as saveCharacter's fence-out arm). Restore the
            // copy for the durable-truth reload, then kick.
            this.deps.custody.restoreCopy(extract.pid, args.characterId, extract.extracted);
            this.deps.custody.escrowSessionLost(extract.pid, args.characterId, 'fenced');
            return { refusal: 'lease_lost' as const };
          }
          this.deps.custody.restoreCopy(extract.pid, args.characterId, extract.extracted);
          return { refusal: inserted.reason };
        }
        this.deps.custody.acknowledgeCharacterSave?.(extract.save);
        return { id: inserted.id };
      },
    );
    if (outcome === 'contended') return refuse('contended');
    if ('refusal' in outcome) return refuse(outcome.refusal);
    const row = await this.deps.db.listingById(this.cfg.realm, outcome.id);
    if (!row) throw new Error('woc_market: listing vanished after insert');
    return { ok: true, listing: row };
  }

  // -------------------------------------------------------------------------
  // Directed p2p offers (docs/prd/woc/p2p-woc-trade.md)
  // -------------------------------------------------------------------------

  /** The listing a directed offer becomes. One agreed price, so start and
   *  buy-now are the same number; validListingParams requires that for a
   *  directed sale and refuses any attempt to smuggle a second price in. */
  private directedParams(usdCents: number, buyerAccount: number): WocListingParams {
    return {
      format: 'buy_now',
      startCents: usdCents,
      reserveCents: null,
      buyNowCents: usdCents,
      // Shape validation only: createListing overrides a directed listing's
      // ends time with WOC_MARKET_DIRECTED_HOLD_SECONDS (the settlement
      // window, H12), so this duration never reaches the row. It stays the
      // shortest allowlist entry purely so validListingParams accepts the
      // params acceptance will use.
      durationHours: WOC_MARKET_DURATION_HOURS[0],
      offerNext: false,
      directedBuyerAccount: buyerAccount,
    };
  }

  /**
   * The BUYER proposes a p2p purchase: a price, named to one player, with no
   * item yet. The seller answers by staging goods and accepting.
   *
   * Nothing is escrowed here, so a stream of offers cannot lock anyone's goods;
   * acceptance is what takes the item.
   */
  async createDirectedOffer(args: {
    account: number;
    characterId: number;
    /** The counterparty's character NAME, the one handle the trade window has.
     *  Resolved here so no account id crosses the wire. */
    sellerCharacterName: string;
    usdCents: number;
    /** The agreed copy, exactly as the buyer's trade window shows it (H10).
     *  Client-supplied by necessity, and safe to be: the pin computed from it
     *  only ever REFUSES the seller's acceptance, so a forged snapshot hurts
     *  only the forger's own deal. */
    item: { itemId: string; instance?: ItemInstancePayload; craftedRecipeId?: string };
    acceptTerms: boolean;
  }): Promise<{ ok: true; offer: WocDirectedOfferRow } | Refused> {
    // Terms parity with the public buyer-side money paths (placeBid, buyNow):
    // a directed buyer can be STRUCK for walking away, and every other path
    // that can strike sits behind guardTerms. This is also what makes the pay
    // arm's "terms were accepted when the offer was made" premise true.
    const gate =
      (await this.guardEnabledHealthy()) ??
      (await this.guardSuspended(args.account)) ??
      (await this.guardTerms(args.account, args.acceptTerms));
    if (gate) return gate;
    const seller = await this.deps.db.characterByName(this.cfg.realm, args.sellerCharacterName);
    if (!seller) return refuse('character_invalid');
    const sellerAccount = seller.accountId;
    // Same ACCOUNT, not same character: an alt is still yourself, and dealing
    // between your own characters would be a fee-free self-deal that still
    // consumed escrow and settlement machinery.
    if (sellerAccount === args.account) return refuse('self_offer');
    // The BUYER's wallet: they are the one about to pay.
    const buyerWallet = await this.deps.verifiedWallet(args.account);
    if (!buyerWallet) return refuse('wallet_required');
    // The SELLER's wallet: they cannot be PAID in $WOC without one. This is the
    // refusal the buyer's trade window turns into "that player must connect a
    // wallet". Re-checked at acceptance, since a wallet can be unlinked between.
    const sellerWallet = await this.deps.verifiedWallet(sellerAccount);
    if (!sellerWallet) {
      return refuse('recipient_wallet_required');
    }
    // Same WALLET is the same beneficial owner even across accounts (H14).
    // Defense in depth: pubkey is UNIQUE so two live links can never collide
    // today, but this predicate must not depend on that constraint surviving.
    if (buyerWallet === sellerWallet) return refuse('self_offer');
    // Validate the params acceptance WILL use, not a looser approximation, so
    // an offer can never be created that its own acceptance would refuse on a
    // STATIC fact. The agreed ITEM gets the same treatment since H10: the
    // buyer names the exact copy, so its eligibility is checkable NOW, and an
    // armed commission piece (bind_armed) refuses here exactly as its
    // acceptance would. The escrow lifecycle is why the directed rail keeps
    // that refusal: every compensation exit (return flight, restore, mail,
    // operator park) would otherwise need its own binding decision (the
    // recorded judgment). The invariant deliberately does NOT cover MOVING
    // facts: the shared listing cap is the seller's live count at acceptance
    // time, so a capped seller's offers are creatable and refuse cap_reached
    // (typed, reopening the deal) when accepted.
    const params = validListingParams(this.directedParams(args.usdCents, args.account));
    if (!params.ok) return refuse(params.reason);
    // Own-property lookup: 'constructor' and friends would resolve prototype
    // members, and while the taxonomy's closed default refuses them anyway,
    // an honest miss is better than a lucky one.
    const agreedDef = Object.hasOwn(ITEMS, args.item.itemId) ? ITEMS[args.item.itemId] : undefined;
    const eligible = listingEligibility(agreedDef, args.item.instance, this.cfg.policy);
    if (!eligible.ok) return refuse(eligible.reason);
    // A plausibility gate on the money side too (the guardBalance medium):
    // the auction paths refuse an implausible bid at placement, and a
    // directed offer is a bid in everything but name. Fail-closed on an
    // unreadable estimate, per the helper's contract.
    const balanceGate = await this.guardBalance(buyerWallet, args.usdCents);
    if (balanceGate) return balanceGate;
    const buyer = await this.deps.db.deliveryTarget(this.cfg.realm, args.account, args.characterId);
    if (!buyer || buyer.characterId !== args.characterId) return refuse('character_invalid');

    const offer = await this.deps.db.insertDirectedOffer({
      realm: this.cfg.realm,
      sellerAccount,
      sellerCharacter: seller.characterId,
      sellerName: seller.name,
      buyerAccount: args.account,
      buyerName: buyer.name,
      usdCents: args.usdCents,
      expiresAtMs: this.now() + WOC_MARKET_DIRECTED_OFFER_TTL_SECONDS * 1000,
      itemId: args.item.itemId,
      // The fingerprint acceptance will demand of the extracted copy: item
      // id, instance payload, crafted provenance (the itemCopyPin 3-tuple),
      // stored as its fixed-width digest.
      itemPin: this.itemPinDigest({
        itemId: args.item.itemId,
        count: 1,
        ...(args.item.instance === undefined ? {} : { instance: args.item.instance }),
        ...(args.item.craftedRecipeId === undefined
          ? {}
          : { craftedRecipeId: args.item.craftedRecipeId }),
      }),
    });
    // ONE pending offer per pair (the strike-farming bound): the unique
    // partial index is the authority, surfaced typed. Its OWN code: the
    // already_pending copy talks about a pending BID, a different rail.
    if (offer === 'offer_pending') return refuse('offer_pending');
    return { ok: true, offer };
  }

  /**
   * One side agrees, through the trade window's ordinary Accept button.
   *
   * Both sides must accept, exactly as a gold trade requires, and the SECOND
   * acceptance is what escrows: the seller's copy leaves their bags and the
   * directed listing is created. Order does not matter, so whoever presses last
   * triggers it.
   *
   * This never routes through the sim's own confirm. That confirm performs the
   * atomic swap the instant both sides accept, and a $WOC deal carries no gold
   * and no buyer items, so it would hand the goods over for nothing. Agreement
   * is tracked here instead, on the offer, and the sim trade is left alone.
   */
  async acceptDirectedOffer(
    account: number,
    offerId: number,
    itemRef: ExtractRef | null,
    characterId: number,
    stepUp?: WocStepUpProof,
  ): Promise<{ ok: true; listing: WocListingRow | null } | Refused> {
    // The same two IO-free pre-checks createListing leads with, for the same
    // reasons: the seller-side acceptance consumes a single-use step-up
    // proof below and then escrows through the inner createListing, so a
    // drain or realm-gate refusal surfacing only there would burn the
    // signature and (on drain) cost a reopen write on a closing pool.
    if (this.deps.draining?.()) return refuse('market_paused');
    if (this.deps.escrowSaturated?.()) return refuse('contended');
    const gate = (await this.guardEnabledHealthy()) ?? (await this.guardSuspended(account));
    if (gate) return gate;
    const offer = await this.deps.db.directedOfferById(this.cfg.realm, offerId);
    if (!offer) return refuse('not_found');
    const side =
      offer.sellerAccount === account ? 'seller' : offer.buyerAccount === account ? 'buyer' : null;
    // not_found for a stranger, matching the directed-listing convention.
    if (side === null) return refuse('not_found');
    if (offer.status !== 'pending') return refuse('not_pending');
    if (offer.expiresAtMs <= this.now()) return refuse('offer_expired');
    const wallet = await this.deps.verifiedWallet(account);
    if (!wallet) return refuse('wallet_required');
    // The seller's acceptance carries the goods, because acceptance is the only
    // moment they are known; the buyer brings only money.
    if (side === 'seller') {
      // The custody-committing act on this rail (B6/R1): the seller's
      // acceptance is what authorizes their copy to escrow, whichever side
      // presses Accept last, so the proof is demanded HERE and never from
      // the buyer (whose money path signs its own payment). Bound to the
      // AUTHORITATIVE offer row's item and agreed price, not client input.
      // A legacy null-item offer never reaches here: its challenge issue
      // already refused not_found (nothing to sign for), so offer.itemId is
      // non-null by the time a valid proof exists.
      const gateUp = await this.guardStepUp(account, wallet, stepUp, {
        operation: 'accept_directed_offer',
        offerId,
        itemId: offer.itemId ?? '',
        usdCents: offer.usdCents,
      });
      if (gateUp) return gateUp;
      if (!itemRef) return refuse('character_invalid');
      const eligible = listingEligibility(
        Object.hasOwn(ITEMS, itemRef.itemId) ? ITEMS[itemRef.itemId] : undefined,
        itemRef.expectInstance ?? undefined,
        this.cfg.policy,
      );
      if (!eligible.ok) return refuse(eligible.reason);
    }

    const after = await this.deps.db.acceptDirectedOfferSide(
      this.cfg.realm,
      offerId,
      side,
      side === 'seller' ? itemRef : null,
    );
    if (!after) return refuse('not_pending');
    // Still waiting on the other side: agreed, nothing moved.
    if (!after.buyerAccepted || !after.sellerAccepted) return { ok: true, listing: null };
    if (!after.itemRef) return refuse('character_invalid');

    // Same WALLET twins refuse at the moment of consummation too (H14):
    // both wallets re-read live, so an unlink-relink between creation and
    // this second acceptance still refuses. Defense in depth beside the
    // claim-SQL guard the pay path runs (pubkey is UNIQUE, so two live links
    // can never collide today).
    const [buyerWallet, sellerWallet] = await Promise.all([
      this.deps.verifiedWallet(after.buyerAccount),
      this.deps.verifiedWallet(after.sellerAccount),
    ]);
    if (buyerWallet !== null && buyerWallet === sellerWallet) return refuse('self_offer');

    // Both agreed. Claim the offer BEFORE escrowing, so two simultaneous second
    // acceptances cannot both reach createListing and extract two copies.
    const claimed = await this.deps.db.resolveDirectedOffer(this.cfg.realm, offerId, 'accepted');
    if (!claimed) return refuse('not_pending');
    let created: Awaited<ReturnType<WocMarketService['createListing']>>;
    try {
      created = await this.createListing({
        account: after.sellerAccount,
        characterId: side === 'seller' ? characterId : after.sellerCharacter,
        itemRef: after.itemRef,
        params: this.directedParams(after.usdCents, after.buyerAccount),
        directed: { offerId, itemPin: after.itemPin },
      });
    } catch (err) {
      // The escrow THREW past the typed-refusal rail. With rollback PROOF the
      // listing provably does not exist, so reopening cannot pair a live
      // listing with a reopened offer and the deal stays retryable; without
      // proof NOTHING is written here (an unknowable COMMIT may have stamped
      // the offer atomically), and the accepted-offer converge arm settles it
      // from the durable truth. The seller-side quarantine and the parked
      // copy are the escrow arms' own business, unchanged.
      if (throwProvedRollback(err)) {
        try {
          await this.deps.db.reopenDirectedOffer(this.cfg.realm, offerId);
        } catch (reopenErr) {
          // A reopen that fails in transport (pool timeout, reset) must never
          // REPLACE the escrow root cause below: the row simply stays
          // accepted-and-unstamped and the converge arm settles it from
          // durable truth. Reported, never rethrown: without the report, a
          // systemic reopen failure would surface only as unexplained
          // converge latency.
          this.sweepError('offer_reopen', reopenErr);
        }
      }
      throw err;
    }
    if (!created.ok) {
      try {
        await this.deps.db.reopenDirectedOffer(this.cfg.realm, offerId);
      } catch (reopenErr) {
        // Same rationale: the typed refusal is the caller-facing truth, and
        // the converge arm recovers the still-accepted row.
        this.sweepError('offer_reopen', reopenErr);
      }
      return created;
    }
    // No post-acceptance stamp: the escrow transaction stamped listing_id
    // atomically with the insert (listing exists IFF the offer is stamped),
    // which is the invariant the converge arm proves rollback by.
    return { ok: true, listing: created.listing };
  }

  /** The seller says no, or the buyer pulls their offer. Nothing was escrowed,
   *  so this is a status flip and nothing else. */
  async resolveDirectedOffer(
    account: number,
    offerId: number,
    action: 'decline' | 'withdraw',
  ): Promise<{ ok: true } | Refused> {
    if (!this.cfg.enabled) return refuse('disabled');
    const offer = await this.deps.db.directedOfferById(this.cfg.realm, offerId);
    if (!offer) return refuse('not_found');
    const actor = action === 'decline' ? offer.sellerAccount : offer.buyerAccount;
    if (actor !== account) return refuse('not_found');
    if (offer.status !== 'pending') return refuse('not_pending');
    const to = action === 'decline' ? 'declined' : 'withdrawn';
    const done = await this.deps.db.resolveDirectedOffer(this.cfg.realm, offerId, to);
    return done ? { ok: true } : refuse('not_pending');
  }

  /**
   * Can this character be paid in $WOC?
   *
   * The trade window asks before offering the $WOC arm, so it can show "they
   * must connect a wallet" instead of a refusal after the fact. It answers for a
   * CHARACTER and returns no account id, and it exposes nothing new: holder-tier
   * flair already broadcasts per entity, so whether a player has a linked wallet
   * is visible on their nameplate today.
   *
   * Deliberately NOT a member of TradeInfo. That shape is built by the sim,
   * which sits inside the token firewall and may not know a wallet exists; this
   * rides beside it as server-fed data instead.
   */
  async tradePartner(
    viewerAccount: number,
    characterName: string,
  ): Promise<{ name: string; walletVerified: boolean } | null> {
    if (!this.cfg.enabled) return null;
    const target = await this.deps.db.characterByName(this.cfg.realm, characterName);
    if (!target) return null;
    const account = target.accountId;
    return {
      name: target.name,
      // Your own characters read as not payable, so the window never offers a
      // self-deal it would refuse at creation.
      walletVerified:
        account !== viewerAccount && (await this.deps.verifiedWallet(account)) !== null,
    };
  }

  /** The offers this account may act on or must still observe, both directions. */
  async directedOffers(account: number): Promise<WocDirectedOfferRow[]> {
    if (!this.cfg.enabled) return [];
    return this.deps.db.directedOffersForAccount(this.cfg.realm, account, this.now());
  }

  async cancelListing(
    account: number,
    listingId: number,
  ): Promise<{ ok: true; cancelPending?: boolean } | Refused> {
    if (!this.cfg.enabled) return refuse('disabled');
    const out = await this.deps.db.cancelListingIfUnbid(
      this.cfg.realm,
      listingId,
      account,
      this.now(),
    );
    if (out === 'not_found') return refuse('not_found');
    if (out === 'not_yours') return refuse('not_yours');
    if (out === 'has_bids') return refuse('has_bids');
    if (out === 'not_active') return refuse('not_active');
    // An unpaid locked window accepted the cancel as INTENT: the current
    // holder keeps their window, no new claims or bids land, and the converge
    // arm closes the listing (return flight home) once the window ends
    // unpaid. Reported ok with the pending flag, not a refusal: the seller's
    // cancel WILL happen unless the holder pays.
    if (out === 'cancel_pending') return { ok: true, cancelPending: true };
    // A settlement past 'offered' resolves only when the payment does; plain
    // row contention retries immediately.
    if (out === 'settlement_live') return refuse('settlement_in_flight');
    if (out === 'contended') return refuse('contended');
    // The return flight rides the sweep's reconciliation (closed, undisposed,
    // resolution != sold), so a crash right here still returns the item.
    await this.returnListingItem(out).catch(() => {});
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Bidding
  // -------------------------------------------------------------------------

  async placeBid(args: {
    account: number;
    characterId: number;
    listingId: number;
    amountCents: number;
    acceptTerms: boolean;
  }): Promise<{ ok: true; bid: WocBidRow; bond: WocQuoteIntent } | Refused> {
    const gate =
      (await this.guardEnabledHealthy()) ??
      (await this.guardSuspended(args.account)) ??
      (await this.guardTerms(args.account, args.acceptTerms));
    if (gate) return gate;
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) return refuse('bid_too_low');
    const wallet = await this.deps.verifiedWallet(args.account);
    if (!wallet) return refuse('wallet_required');
    // The delivery character is validated server-side, never client-named.
    const target = await this.deps.db.deliveryTarget(
      this.cfg.realm,
      args.account,
      args.characterId,
    );
    if (!target || target.characterId !== args.characterId) return refuse('character_invalid');
    const bond = bondCents(args.amountCents);
    const balanceGate = await this.guardBalance(wallet, args.amountCents + bond);
    if (balanceGate) return balanceGate;

    const nowMs = this.now();
    const inserted = await this.deps.db.insertPendingBid({
      realm: this.cfg.realm,
      listingId: args.listingId,
      account: args.account,
      characterId: target.characterId,
      characterName: target.name,
      wallet,
      amountCents: args.amountCents,
      bondCents: bond,
      nowMs,
      minNext: (row) => minNextBidCents(row.currentBidCents, row.startCents),
    });
    if (!inserted.ok) return refuse(inserted.reason);
    // The SERVICE owns the bond figure: send the bid (the ROW's figure, the
    // authoritative source once inserted), no echo (nothing has been shown to
    // the player for this bid yet), and adopt the bondCents the quote
    // answers. The local mirror above sized the balance guard AND seeded the
    // inserted row, so a row the quote path never reaches (refusal below)
    // carries the mirror figure until its TTL lapse.
    const intent = await this.deps.economy.bondQuote({
      memoRef: `woc_bond:${inserted.bid.id}`,
      bidCents: inserted.bid.amountCents,
      buyerWallet: wallet,
    });
    if (!intent.ok || intent.reference === null || intent.expiresAtMs === null) {
      // The pending bid lapses on its own TTL; nothing was transferred.
      return refuse('quote_unavailable');
    }
    // Bounded adoption: a carried figure outside the contract (not a positive
    // integer at or under the bid) refuses rather than persisting a bond the
    // refund accounting would then ride; an ABSENT figure falls back to the
    // mirror (an older service that does not send one yet).
    const adoptedBondCents =
      intent.bondCents === null
        ? bond
        : adoptableBondCents(intent.bondCents, inserted.bid.amountCents);
    if (adoptedBondCents === null) return refuse('quote_unavailable');
    if (adoptedBondCents > bond) {
      // The service priced the bond above the mirror the balance guard was
      // sized with: re-guard on the real figure before showing a prompt the
      // wallet cannot cover. The unpaid bid lapses on its own TTL.
      const reGuard = await this.guardBalance(wallet, inserted.bid.amountCents + adoptedBondCents);
      if (reGuard) return reGuard;
    }
    const applied = await this.deps.db.setBidBondQuote(
      inserted.bid.id,
      intent.reference,
      intent.expiresAtMs,
      adoptedBondCents,
    );
    if (!applied) {
      // Only reachable if this brand-new bid left 'pending_bond' (or somehow
      // gained a signature) in the milliseconds since the insert: answer as
      // plain contention, retryable, with nothing written.
      return refuse('contended');
    }
    // Past the CAS only: no signable authorization for a refused quote.
    registerWocQuoteHandoff(this.deps.desktopHandoff, args.account, wallet, intent, this.now());
    return {
      ok: true,
      // The patched bid mirrors the row the CAS just wrote (reference,
      // figure, AND quote expiry): a response bid disagreeing with its own
      // row invites a future consumer to cache "no live quote" for a bid
      // that has one.
      bid: {
        ...inserted.bid,
        bondReference: intent.reference,
        bondCents: adoptedBondCents,
        bondQuoteExpiresAtMs: intent.expiresAtMs,
      },
      bond: intent,
    };
  }

  /**
   * Withdraw a bid whose bond was never paid.
   *
   * The counterpart the refusal text already promised: placing a bid takes a
   * listing-wide lock ("Confirm or abandon your pending bid on this listing
   * first"), and until this existed the only abandon was waiting out a
   * five-minute TTL. A player who declined the wallet was told to do something
   * the client could not do, on their own bid, with their own money untouched.
   *
   * Deliberately NOT gated on market health. Every other bid path needs a live
   * price because it quotes one; giving up needs nothing, and refusing to let a
   * player release their own listing lock because the oracle is unhappy would
   * strand them for exactly as long as the outage lasts.
   */
  async abandonBid(account: number, bidId: number): Promise<{ ok: true } | Refused> {
    if (!this.cfg.enabled) return refuse('disabled');
    const bid = await this.deps.db.bidById(bidId);
    if (!bid) return refuse('not_found');
    if (bid.account !== account) return refuse('not_yours');
    if (bid.status !== 'pending_bond') return refuse('not_pending');
    // A recorded signature means the bidder's money may already be riding
    // this bond (broadcast, awaiting finality). Abandoning would void a
    // payment the chain may still land, so the abandon refuses until the
    // verdict arrives; the poll resolves it either way within its pass.
    if (bid.bondSignature !== null) return refuse('confirm_in_flight');
    // The status AND the signature are re-checked inside the UPDATE, so a bond
    // that landed (or a signature recorded) between the read and the write
    // keeps its bid rather than losing it to this call.
    const done = await this.deps.db.abandonPendingBid(this.cfg.realm, bidId, account);
    if (done) return { ok: true };
    const after = await this.deps.db.bidById(bidId);
    return refuse(
      after !== null && after.status === 'pending_bond' && after.bondSignature !== null
        ? 'confirm_in_flight'
        : 'not_pending',
    );
  }

  /**
   * Operator reads for the internal dashboard. Read-only and realm-scoped; the
   * realm comes from this service's own config rather than the caller, so a
   * dashboard cannot ask one realm's process about another's.
   */
  async opsListings(q: {
    status: WocOps.WocOpsListingStatus;
    fromMs: number;
    toMs: number;
    page: number;
    pageSize: number;
  }): Promise<{ rows: WocOps.WocOpsListingRow[]; hasMore: boolean }> {
    return this.deps.db.opsListings({ ...q, realm: this.cfg.realm });
  }

  async opsP2pTrades(q: {
    status: WocDirectedOfferStatus | 'all';
    fromMs: number;
    toMs: number;
    page: number;
    pageSize: number;
  }): Promise<{ rows: WocOps.WocOpsP2pTradeRow[]; hasMore: boolean }> {
    return this.deps.db.opsP2pTrades({ ...q, realm: this.cfg.realm });
  }

  /** A fresh bond quote for a still-pending bid whose previous quote expired. */
  async refreshBondQuote(
    account: number,
    bidId: number,
  ): Promise<{ ok: true; bond: WocQuoteIntent } | Refused> {
    const gate = await this.guardEnabledHealthy();
    if (gate) return gate;
    const bid = await this.deps.db.bidById(bidId);
    if (!bid) return refuse('not_found');
    if (bid.account !== account) return refuse('not_yours');
    if (bid.status !== 'pending_bond') return refuse('not_pending');
    // A recorded signature means the bond may already be PAID and merely
    // awaiting finality. Its reference must survive: the poller re-checks the
    // reference and signature as a pair, so overwriting the reference here
    // would read a real payment as refused and lapse a funded bond. This read
    // answers the common case without a wasted economy quote; the atomic arm
    // is the setBidBondQuote compare-and-set below.
    if (bid.bondSignature !== null) return refuse('confirm_in_flight');
    // The refresh must never mint a quote whose life outlives the SEAT: the
    // bid lapses at placed_at plus the pending TTL, and a quote straddling
    // that deadline invites a broadcast whose signature arrives against a
    // lapsed bid, where the intake can no longer record it (the one H4 loss
    // shape the signature-first recording cannot reach; stricter than the
    // settlement leg, which refuses only once its window has already
    // ended). The residual is the sweep-cadence race at the boundary
    // itself, seconds instead of a quote lifetime. Typed as its own
    // refusal: quote_expired's copy says to request a fresh quote, which is
    // exactly what cannot help here (the seat itself is closing; re-bid).
    const lapseAtMs = bid.placedAtMs + WOC_MARKET_BOND_PENDING_TTL_SECONDS * 1000;
    if (this.now() + WOC_MARKET_QUOTE_TTL_SECONDS * 1000 > lapseAtMs) {
      return refuse('bond_window_closed');
    }
    // The refresh ECHOES the stored figure (the one the player has been
    // shown). If the service's bond policy moved since, it refuses
    // bond_amount_drift CARRYING its expected bondCents: adopt that figure
    // and re-quote once, so a knob change re-prices the bond instead of
    // stranding the bid behind an endless refusal.
    let intent = await this.deps.economy.bondQuote({
      memoRef: `woc_bond:${bid.id}`,
      bidCents: bid.amountCents,
      usdCents: bid.bondCents,
      buyerWallet: bid.wallet,
    });
    let adoptedThroughDrift = false;
    if (
      !intent.ok &&
      intent.reason === 'bond_amount_drift' &&
      intent.bondCents !== null &&
      // Pre-screened BEFORE the retry: a carried figure the game would never
      // adopt is not worth an outbound echo (and a non-proxy economy
      // implementation may not have screened the wire integer at all).
      adoptableBondCents(intent.bondCents, bid.amountCents) !== null
    ) {
      // ONE retry with the adopted echo, never a loop: a service that drifts
      // again answers the ordinary refusal below.
      adoptedThroughDrift = true;
      intent = await this.deps.economy.bondQuote({
        memoRef: `woc_bond:${bid.id}`,
        bidCents: bid.amountCents,
        usdCents: intent.bondCents,
        buyerWallet: bid.wallet,
      });
    }
    if (!intent.ok || intent.reference === null || intent.expiresAtMs === null) {
      return refuse('quote_unavailable');
    }
    // Bounded adoption, and the drift path DEMANDS the figure: the service
    // just declared the stored one wrong, so falling back to it would persist
    // a bond the quote disagrees with. The plain path may fall back (an older
    // service that omits the figure).
    const refreshedBondCents =
      intent.bondCents === null
        ? adoptedThroughDrift
          ? null
          : bid.bondCents
        : adoptableBondCents(intent.bondCents, bid.amountCents);
    if (refreshedBondCents === null) return refuse('quote_unavailable');
    if (refreshedBondCents > bid.bondCents) {
      // The placeBid symmetry: a re-priced bond above the stored figure was
      // never balance-guarded, and the prompt labels itself from this quote.
      // Refusing here is safe (nothing written; the bid keeps its previous
      // quote state and lapses on its own TTL if never funded).
      const reGuard = await this.guardBalance(bid.wallet, bid.amountCents + refreshedBondCents);
      if (reGuard) return reGuard;
    }
    // The AUTHORITATIVE straddle check: the expiry actually stored is the
    // SERVICE's, not the local constant the pre-quote check predicted with,
    // and a service answering a longer TTL would straddle the lapse anyway.
    // The unused quote simply expires on its own (the CAS-loss shape).
    if (intent.expiresAtMs > lapseAtMs) {
      return refuse('bond_window_closed');
    }
    const applied = await this.deps.db.setBidBondQuote(
      bid.id,
      intent.reference,
      intent.expiresAtMs,
      refreshedBondCents,
    );
    if (!applied) {
      // The CAS lost a race: a signature landed (or the bid left pending)
      // between the read above and this write. Re-read for the precise
      // refusal; the unused economy quote simply expires on its own.
      const after = await this.deps.db.bidById(bid.id);
      return refuse(
        after !== null && after.status === 'pending_bond' ? 'confirm_in_flight' : 'not_pending',
      );
    }
    // Past the CAS only: no signable authorization for a refused refresh.
    registerWocQuoteHandoff(this.deps.desktopHandoff, account, bid.wallet, intent, this.now());
    return { ok: true, bond: intent };
  }

  async confirmBond(
    account: number,
    bidId: number,
    signature: string,
  ): Promise<{ ok: true; standing: boolean; pending?: boolean; reason?: string | null } | Refused> {
    if (!this.cfg.enabled) return refuse('disabled');
    const bid = await this.deps.db.bidById(bidId);
    if (!bid) return refuse('not_found');
    if (bid.account !== account) return refuse('not_yours');
    if (bid.status !== 'pending_bond') {
      // A retry of the signature that ALREADY decided this bid answers the
      // outcome, never a refusal: when a network blip swallows the first
      // response, 'not_pending' reads as "bid gone" for a payment that
      // SUCCEEDED. Only the recorded signature gets this arm; it extends
      // nothing (no new bond progress) and re-drives nothing.
      if (bid.bondSignature === signature) {
        if (bid.status === 'active' || bid.status === 'won') return { ok: true, standing: true };
        if (bid.status === 'outbid') return { ok: true, standing: false };
      }
      return refuse('not_pending');
    }
    if (bid.bondReference === null) return refuse('quote_unavailable');
    // Record the signature BEFORE any expiry verdict and BEFORE asking the
    // chain. The signature is the only trace of a payment that may already be
    // broadcast, so every refusal past this point would discard money in
    // flight. An EXPIRED quote is deliberately no exception: the transfer may
    // have left the wallet moments before expiry, and refusing it here with
    // no ledger trace was exactly the loss that cost a real settlement its
    // money. The row lands in the confirming set instead, and the chain's
    // verdict (here or on the poll) decides between completion and lapse.
    // The submission moment: captured BEFORE the chain round trip (or the
    // target drifts with RPC latency and a slow confirm pushes the anchor
    // past the close, nulling the extension the settled arm depends on).
    // Anchors are split by arm: the PENDING extension and the poll park axis
    // both use the FIRST recording (bond_signature_at, which the submit
    // returns), because a re-post of an undecided signature is free to mint
    // and a fresh-clock anchor let it hold the close to the cap; the SETTLED
    // arm anchors on this clock (the verdict moment), the paid-bond
    // extension the window has always granted.
    const progressAtMs = this.now();
    const submitted = await this.deps.db.submitBondSignature(bid.id, signature, progressAtMs);
    if (submitted === 'not_pending') {
      // Zero rows can mean the bid left pending_bond, OR a DIFFERENT
      // signature is already recorded and being decided. Re-read for the
      // truthful refusal: 'not_pending' on a still-pending bid misreads as
      // "bid gone" when the honest answer is "a payment is already in
      // flight; wait for its verdict". The second signature has no ledger
      // slot (one column, first claim wins); the reference-scoped service
      // verdict is the backstop for a genuine double broadcast.
      const after = await this.deps.db.bidById(bid.id);
      return refuse(
        after !== null && after.status === 'pending_bond' && after.bondSignature !== null
          ? 'confirm_in_flight'
          : 'not_pending',
      );
    }
    if (submitted === 'signature_reused') return refuse('signature_reused');
    // A contended recorder recorded NOTHING (the write-path rider's typed
    // arm): the signature stays in the client's hand, so the retryable
    // in-flight refusal is honest and the 2s bound never 500s a payment.
    if (submitted === 'contended') return refuse('confirm_in_flight');
    const anchorMs = submitted.signatureAtMs;
    const confirmed = await this.deps.economy.confirm(bid.bondReference, signature);
    // Anti-snipe rides BOND PROGRESS, and progress means the CHAIN has seen
    // the transfer (settled, or pending finality), never merely that a string
    // was posted: extending on the raw submission let a fabricated signature
    // move the authoritative clock for free. A verdict AGAINST extends
    // nothing. Best-effort ON PURPOSE: the signature above is already
    // durable, and a contended extension only fails toward a shorter
    // auction, so it must never turn a recorded payment into a refusal.
    const extend = async (anchor: number): Promise<void> => {
      await this.deps.db
        .extendAuctionForBondProgress(this.cfg.realm, bid.listingId, (row) =>
          antiSnipeExtendedEndMs(anchor, row.endsAtMs, row.baseEndsAtMs),
        )
        .catch(() => {});
    };
    if (confirmed.settled) {
      // Extend BEFORE activating: a verdict landing seconds from the close
      // must move the end first, or its own activation reads the auction as
      // already over. The SETTLED arm anchors on this request's clock (the
      // verdict moment): the money provably moved, so this is the paid-bond
      // extension the window has always granted, and reaching it repeatedly
      // needs repeated contended activations of a REAL payment, which the
      // cap already bounds. The creep the first-arrival anchor closes lives
      // in the PENDING arm below, where re-posting costs nothing.
      await extend(progressAtMs);
      return this.holdBondAndActivate(bid.id);
    }
    if (confirmed.pending) {
      // UNDECIDED, not refused. The payment may be perfectly good and merely
      // unfinalized (tens of seconds on mainnet), so the bid stays pending with
      // its signature and pollConfirmingBonds finishes it. Refusing here is the
      // mistake that cost a real settlement its money before the same shape was
      // found in this leg. The extension is an ALLOWLIST of one word: the
      // verifier reserves awaiting_finality for a transaction it MATCHED at
      // its read commitment, and answers not_yet_visible when the ledger has
      // shown nothing, so only the matched word is proof the chain saw the
      // transfer. The old gate excluded only service_unavailable, which let
      // any other pending word (a fabricated signature's not_yet_visible
      // included) move the authoritative clock for free.
      // First-arrival anchor: a re-post of a pending-forever signature must
      // not re-anchor on a fresh clock, or it holds the close at now plus
      // the extension continuously to the cap for free.
      if (confirmed.reason === WOC_MARKET_LEDGER_MATCHED_REASON) await extend(anchorMs);
      this.driftWarn.notePending(confirmed.reason);
      // The verbatim service word rides the ok-shape for the route layer to
      // screen: the player deserves to know WHICH pending this is.
      return { ok: true, standing: false, pending: true, reason: confirmed.reason };
    }
    // The bond leg is where the fail channel matters MOST: this refusal
    // drops the word and lapseBid records no reason, so unlike a settlement
    // row there is no verbatim column an operator could query after the
    // fact. The sighting line is the only trace.
    this.driftWarn.noteFail(confirmed.reason);
    return refuse('confirm_failed');
  }

  /** The two writes a decided, settled bond owes: hold it, then let it stand. */
  private async holdBondAndActivate(
    bidId: number,
  ): Promise<{ ok: true; standing: boolean; pending?: boolean }> {
    await this.deps.db.markBondHeld(bidId);
    const activated = await this.deps.db.activateBid(bidId, this.now());
    if (activated === 'contended') {
      // The bond IS held and the activation merely lost a lock race; the bid
      // stays in the confirmingBonds set (its select keys on status plus
      // signature, not bond_state), so the next pass retries. Report it as
      // PENDING: collapsing it into standing:false reads as "outbid" to the
      // client, the exact false verdict the undecided arm exists to avoid.
      return { ok: true, standing: false, pending: true };
    }
    if (activated === 'not_pending') {
      // The bid already left pending_bond, and the overwhelmingly common way
      // is the POLL winning the race: the recording committed, the sweep's
      // pass confirmed and activated while this request sat in the chain
      // round trip. Answer from the row's REAL status, the idempotent-retry
      // arm's shape: a bare standing:false here read as "outbid" to the very
      // bidder whose confirm just succeeded.
      const after = await this.deps.db.bidById(bidId);
      if (after && (after.status === 'active' || after.status === 'won')) {
        return { ok: true, standing: true };
      }
      return { ok: true, standing: false };
    }
    // A racer confirmed a higher bid first: this bond flips straight to
    // refund_due inside activateBid's superseded arm.
    return { ok: true, standing: activated === 'activated' };
  }

  /**
   * Bonds paid but not yet decided by the chain, re-checked on the sweep.
   *
   * The bid leg's twin of pollConfirmingSettlements. `continue` on an undecided
   * verdict is the load-bearing line: the row stays exactly as it is and the
   * next pass asks again, which is what makes waiting for finality free.
   */
  private async pollConfirmingBonds(): Promise<number> {
    const nowMs = this.now();
    const bonds = await this.deps.db.confirmingBonds(
      this.cfg.realm,
      SWEEP_BATCH,
      wocBackedOffIds(this.parkedBondPolls, nowMs),
    );
    for (const bid of bonds) {
      try {
        if (bid.bondReference === null || bid.bondSignature === null) continue;
        const confirmed = await this.deps.economy
          .confirm(bid.bondReference, bid.bondSignature)
          .catch(() => null);
        if (confirmed?.pending) this.driftWarn.notePending(confirmed.reason);
        if (!confirmed || confirmed.pending) {
          // Undecided. YOUNG bonds (inside the park window, the normal
          // finality span) keep the full poll cadence; a bond the chain
          // still has not decided past it rotates to the poll tail with an
          // in-process backoff, so a standing set of never-decided
          // signatures (a fabricated one, a service that answers pending
          // forever) cannot occupy the batch head and starve fresh bonds.
          // Aged from the SIGNATURE recording (placed_at only for legacy
          // rows): placement age says nothing about how long the chain has
          // had the transfer, and a bidder who signs late in their window
          // must not be parked twenty seconds after submitting. Rotation
          // only: the money policy is untouched (no automatic void; the
          // stuckBonds readout carries the visibility).
          const signedAtMs = bid.bondSignatureAtMs ?? bid.placedAtMs;
          if (nowMs - signedAtMs > WOC_MARKET_BOND_POLL_PARK_SECONDS * 1000) {
            wocParkRow(this.parkedBondPolls, bid.id, nowMs + WocMarketService.PARK_RETRY_MS);
            await this.deps.db.touchBidPollRow(bid.id);
          }
          continue;
        }
        this.parkedBondPolls.delete(bid.id);
        if (confirmed.settled) {
          // The confirm leg's settled-arm rule, kept symmetric here: extend
          // BEFORE activating, anchored on this pass's clock (the verdict
          // moment as observed). The allowlist narrowed the PENDING arm to
          // the one ledger-matched word, which un-extended the honest bidder
          // whose synchronous confirm raced chain visibility
          // (not_yet_visible) and whose bond the ledger then settled; a
          // settled verdict is stronger proof than the matched word, so
          // granting it here extends nothing a fabricated signature can
          // reach (a fabricated string never settles), and the math no-ops
          // once the auction is already over. Best-effort like the confirm
          // site: a contended extension only fails toward a shorter auction.
          // A FRESH clock read, not the pass-entry nowMs: the pass walks up
          // to SWEEP_BATCH chain round trips, and a stale anchor would deny
          // an honest bidder the window their verdict actually landed in.
          const observedAtMs = this.now();
          await this.deps.db
            .extendAuctionForBondProgress(this.cfg.realm, bid.listingId, (row) =>
              antiSnipeExtendedEndMs(observedAtMs, row.endsAtMs, row.baseEndsAtMs),
            )
            .catch(() => {});
          await this.holdBondAndActivate(bid.id);
        } else {
          // Decided AGAINST: the bond never landed, so the bid lapses and its
          // bond voids. Only a decided verdict may end it. A HELD bond
          // refuses the lapse (the reorg carve-out): park THAT row like a
          // never-decided one, or it re-owns the batch head every pass and
          // burns one confirm RPC forever, the exact starvation the park
          // mechanism exists to prevent. The refusal word leaves no row
          // behind on this leg, so the drift channel is its only trace.
          this.driftWarn.noteFail(confirmed.reason);
          const lapsed = await this.deps.db.lapseBid(bid.id);
          if (!lapsed) {
            wocParkRow(this.parkedBondPolls, bid.id, nowMs + WocMarketService.PARK_RETRY_MS);
            await this.deps.db.touchBidPollRow(bid.id);
          }
        }
      } catch (err) {
        // Per-row isolation: this backlog returns UNCLAIMED rows in order, so
        // a persistently failing head row would otherwise starve every later
        // bond of this arm on every pass.
        this.sweepError('polledBonds', err);
      }
    }
    return bonds.length;
  }

  // -------------------------------------------------------------------------
  // Buy-now
  // -------------------------------------------------------------------------

  async buyNow(args: {
    account: number;
    characterId: number;
    listingId: number;
    acceptTerms: boolean;
  }): Promise<{ ok: true; settlement: WocSettlementRow; quote: WocQuoteIntent } | Refused> {
    const nowMs = this.now();
    // The flag/health gate runs BEFORE any database read: with the feature off
    // or pricing unhealthy, this flow performs no query and no custody action.
    const preGate = await this.guardEnabledHealthy();
    if (preGate) return preGate;
    const listingPeek = await this.deps.db.listingById(this.cfg.realm, args.listingId);
    if (!listingPeek) return refuse('not_found');
    // A directed sale is buyable ONLY by the account it was addressed to. This
    // is the second of two independent defences (browse already excludes the
    // row), because the row id is guessable and browse exclusion alone would
    // leave a stranger who guesses one able to buy it.
    //
    // The refusal is `not_found`, deliberately, NOT a distinct "not for you":
    // the anti-enumeration convention already used by not_yours. A caller
    // probing ids must not be able to tell "no such listing" from "a listing
    // exists here and it is not yours", because the second answer confirms both
    // that the id is real and that a private trade is in flight.
    if (
      listingPeek.directedBuyerAccount !== null &&
      listingPeek.directedBuyerAccount !== args.account
    ) {
      return refuse('not_found');
    }
    if (listingPeek.buyNowCents === null) return refuse('no_buy_now');
    const gate =
      (await this.guardSuspended(args.account)) ??
      (await this.guardTerms(args.account, args.acceptTerms));
    if (gate) return gate;
    const wallet = await this.deps.verifiedWallet(args.account);
    if (!wallet) return refuse('wallet_required');
    // Same WALLET is the same beneficial owner (H14): seller_account alone
    // missed the relink dance (list under wallet W, unlink, relink W on a
    // second account, buy the own listing into the public sales history).
    // This is the cheap fast refusal from values already in hand; the
    // AUTHORITATIVE guard is inside claimBuyNowLock, re-read under the
    // listing row lock and asserted again in the claiming UPDATE itself.
    if (listingPeek.sellerWallet === wallet) return refuse('own_listing');
    const target = await this.deps.db.deliveryTarget(
      this.cfg.realm,
      args.account,
      args.characterId,
    );
    if (!target || target.characterId !== args.characterId) return refuse('character_invalid');
    const balanceGate = await this.guardBalance(wallet, listingPeek.buyNowCents);
    if (balanceGate) return balanceGate;

    const lockExpiresAtMs = nowMs + WOC_MARKET_BUY_NOW_LOCK_SECONDS * 1000;
    const claimed = await this.deps.db.claimBuyNowLock(
      this.cfg.realm,
      args.listingId,
      args.account,
      nowMs,
      lockExpiresAtMs,
    );
    if (claimed === 'not_found') return refuse('not_found');
    if (claimed === 'not_active') return refuse('not_active');
    if (claimed === 'locked') return refuse('buy_now_locked');
    if (claimed === 'no_buy_now') return refuse('no_buy_now');
    if (claimed === 'own_listing') return refuse('own_listing');
    if (claimed === 'cancel_pending') return refuse('cancel_pending');
    if (typeof claimed === 'object' && 'refusal' in claimed) {
      // Honest remaining time, never zero: the store computed WHEN a retry can
      // first succeed, and a floor of one second keeps a boundary race from
      // telling the player to retry "in 0 seconds" while still refused.
      return refuse('claim_cooldown', {
        retryAfterSeconds: Math.max(1, Math.ceil((claimed.retryAtMs - nowMs) / 1000)),
      });
    }
    if (claimed === 'contended') return refuse('contended');

    const settlement = await this.deps.db.insertSettlement({
      listingId: claimed.id,
      bidId: null,
      attempt: 0,
      buyerAccount: args.account,
      buyerCharacter: target.characterId,
      buyerName: target.name,
      buyerWallet: wallet,
      amountCents: claimed.buyNowCents ?? 0,
      deadlineAtMs: lockExpiresAtMs,
      nowMs,
    });
    if (settlement === 'live_settlement_exists' || settlement === 'winner_gone') {
      // winner_gone is unreachable here (no winnerBidId is passed); it rides
      // this arm so the union stays exhaustively narrowed.
      await this.deps.db.clearBuyNowLock(claimed.id, args.account);
      return refuse('buy_now_locked');
    }
    if (settlement === 'contended') {
      // A guard transaction holds the listing row; nothing was inserted.
      // Release the lock and let the buyer retry immediately.
      await this.deps.db.clearBuyNowLock(claimed.id, args.account);
      return refuse('contended');
    }
    if (settlement === 'listing_closed') {
      // Belt-and-braces: cancel and suspend refuse while the lock is
      // unexpired, so this arm needs the listing to close in the sliver
      // between the claim and the insert. Answer honestly rather than with a
      // phantom lock.
      await this.deps.db.clearBuyNowLock(claimed.id, args.account);
      return refuse('not_active');
    }
    const quote = await this.quoteFor(settlement, claimed.sellerWallet);
    if (!quote.ok) {
      await this.deps.db.transitionSettlement(settlement.id, ['offered'], 'expired');
      await this.deps.db.clearBuyNowLock(claimed.id, args.account);
      return refuse('quote_unavailable');
    }
    return { ok: true, settlement, quote };
  }

  // -------------------------------------------------------------------------
  // Settlement (winner or buy-now buyer)
  // -------------------------------------------------------------------------

  private async quoteFor(
    settlement: WocSettlementRow,
    sellerWallet: string,
  ): Promise<WocQuoteIntent> {
    const intent = await this.deps.economy.settlementQuote({
      memoRef: settlementCustodyRef(settlement.id),
      usdCents: settlement.amountCents,
      buyerWallet: settlement.buyerWallet,
      sellerWallet,
    });
    if (intent.ok && intent.reference !== null && intent.expiresAtMs !== null) {
      let retiredPair: { reference: string; signature: string } | null = null;
      if (
        settlement.quoteReference !== null &&
        settlement.quoteReference !== intent.reference &&
        settlement.txSignature !== null
      ) {
        // A revival re-quote RETIRES a stored reference a payment may exist
        // against: the row holds one scalar, and every later confirm asks
        // about the fresh one only. The service side can legitimately end up
        // with TWO settled quotes for this memoRef (its entry adoption
        // re-settles a superseded quote a ledger-proven payment backs), and
        // it keys everything on the reference, so this line is the game's
        // only durable trace of the retired pair; an operator reconciling a
        // later-adopted payment matches it against the service's admin quote
        // rows (dev-channel, deliberately not player text). Scoped to rows
        // with a RECORDED signature: an unsigned re-quote is routine (the
        // quote-refresh path) and tracing it would emit a line per refresh.
        // An UNSIGNED retired reference (paid on chain, never confirmed to
        // the game) leaves no game-side line, deliberately: the service
        // still holds that quote keyed by this settlement's memoRef
        // (settlementCustodyRef of the id), which is what actually anchors
        // reconciliation. Captured here, emitted only AFTER the CAS lands:
        // the guarded write can lose (the row left 'offered' to a racing
        // confirm), and a trace claiming a retirement that never happened
        // would falsify the very trail it exists to keep.
        retiredPair = {
          reference: settlement.quoteReference,
          signature: settlement.txSignature,
        };
      }
      const stamped = await this.deps.db.setSettlementQuote(
        settlement.id,
        intent.reference,
        intent.expiresAtMs,
        intent.amount?.base ?? null,
      );
      if (!stamped) return { ...intent, ok: false, reason: 'settlement_not_open' };
      // Every payable settlement quote (buy-now, winner, revival) registers
      // for desktop signing, past the stamp only (no adopted row, no entry).
      registerWocQuoteHandoff(
        this.deps.desktopHandoff,
        settlement.buyerAccount,
        settlement.buyerWallet,
        intent,
        this.now(),
      );
      if (retiredPair !== null) {
        console.warn(
          `[woc_market] settlement ${settlement.id} retires quote reference ${logSafe(retiredPair.reference)} with recorded signature ${logSafe(retiredPair.signature)}`,
        );
      }
    }
    return intent;
  }

  async settlementQuote(
    account: number,
    settlementId: number,
  ): Promise<{ ok: true; quote: WocQuoteIntent } | Refused> {
    const gate = await this.guardEnabledHealthy();
    if (gate) return gate;
    const settlement = await this.deps.db.settlementById(settlementId);
    if (!settlement) return refuse('not_found');
    if (settlement.buyerAccount !== account) return refuse('not_yours');
    // Deadline first, BEFORE any revival: a past-deadline 'failed' row must
    // stay 'failed' for the overdue sweep's default pass, never be revived
    // into an open row this method then refuses anyway.
    if (settlement.deadlineAtMs <= this.now()) return refuse('quote_expired');
    if (settlement.state === 'failed') {
      // A refused confirmation returns to offered for a retry inside the
      // window. The revival is a CAS and can also lose to the
      // one-open-settlement index (a second open settlement raced in over the
      // retry window; the db layer reports that 23505 as false): a failed
      // revival must refuse HERE, before any quote is issued, or the buyer
      // could broadcast a payment no settlement will ever carry.
      const revived = await this.deps.db.transitionSettlement(settlement.id, ['failed'], 'offered');
      if (!revived) return refuse('not_active');
    } else if (settlement.state !== 'offered') {
      return refuse('not_active');
    }
    const listing = await this.deps.db.listingById(this.cfg.realm, settlement.listingId);
    if (!listing) return refuse('not_found');
    const quote = await this.quoteFor({ ...settlement, state: 'offered' }, listing.sellerWallet);
    if (!quote.ok) return refuse('quote_unavailable');
    return { ok: true, quote };
  }

  async confirmSettlement(
    account: number,
    settlementId: number,
    signature: string,
  ): Promise<{ ok: true; state: WocSettlementState; reason?: string | null } | Refused> {
    if (!this.cfg.enabled) return refuse('disabled');
    const settlement = await this.deps.db.settlementById(settlementId);
    if (!settlement) return refuse('not_found');
    if (settlement.buyerAccount !== account) return refuse('not_yours');
    // Idempotent retry (the bond leg's rule): resubmitting the RECORDED
    // signature against a 'confirming' row re-asks the chain instead of
    // refusing, so a network blip between the recording and the response
    // cannot strand the buyer behind a false refusal. The retry skips the
    // recording write entirely: nothing new to record, and re-stamping
    // updated_at would push out the confirming-age review bound, re-opening
    // the unbounded hold that bound exists to close. A DIFFERENT signature
    // on a confirming row refuses typed: a payment is already being decided.
    const retryOfRecorded =
      settlement.state === 'confirming' && settlement.txSignature === signature;
    if (settlement.state === 'confirming' && !retryOfRecorded) return refuse('confirm_in_flight');
    // A retry of the recorded signature AFTER the payment succeeded answers
    // the outcome (the current state), never not_active: the blip case read
    // as "purchase gone" for a completed sale. 'review' joins the outcome
    // arm (the H15 park can land between a recording and its retry, and
    // "purchase gone" is exactly wrong for money under review; the client
    // renders the state honestly). A 'failed' same-signature retry still
    // refuses below (the settlementQuote revival owns that path).
    if (
      settlement.txSignature === signature &&
      (settlement.state === 'confirmed' ||
        settlement.state === 'delivering' ||
        settlement.state === 'delivered' ||
        settlement.state === 'review')
    ) {
      return { ok: true, state: settlement.state };
    }
    if (!retryOfRecorded && settlement.state !== 'offered') return refuse('not_active');
    if (settlement.quoteReference === null || settlement.quoteExpiresAtMs === null) {
      return refuse('quote_unavailable');
    }
    if (!retryOfRecorded) {
      // No expiry refusal past this point: the signature is recorded FIRST (the
      // bond leg's rule, and originally this leg's lesson). A payment broadcast
      // near quote expiry lands in 'confirming' with its ledger trace, and the
      // chain's verdict decides; refusing an expired quote here would discard
      // the only trace of money already in flight. Deadline-expired rows are
      // still bounded: the overdue sweep owns them, and a 'confirming' row that
      // never resolves ages into the operator review state.
      if (settlement.txSignature !== null && settlement.txSignature !== signature) {
        // A revived row (failed -> offered) still carries its refused
        // attempt's signature, and the new recording replaces it. The refusal
        // reason survives on fail_reason and the economy service's own ledger
        // keeps the refused transfer; this line is the game-side trace of the
        // replacement (dev-channel, deliberately not player text).
        console.warn(
          `[woc_market] settlement ${settlement.id} records a new payment attempt over refused signature ${logSafe(settlement.txSignature)}`,
        );
      }
      const submitted = await this.deps.db.submitSettlementSignature(settlement.id, signature);
      if (submitted === 'not_offered') return refuse('not_active');
      if (submitted === 'signature_reused') return refuse('signature_reused');
      // Same typed arm as the bond leg: contended recorded nothing, refuse
      // retryable instead of a 500 on money in flight.
      if (submitted === 'contended') return refuse('confirm_in_flight');
    }
    const confirmed = await this.deps.economy.confirm(settlement.quoteReference, signature);
    if (confirmed.settled) {
      await this.deps.db.transitionSettlement(settlement.id, ['confirming'], 'confirmed');
      // Deliver eagerly; the sweep is the backstop for any failure past here.
      // A fresh LOCAL scope: this entry runs outside any sweep pass, so it
      // must neither inherit a pass's contention verdict nor clobber one
      // mid-flight. Its park count is deliberately discarded (the monitor
      // still carries the row; only the pass stat line loses the event).
      await this.deliverConfirmedSettlements(this.now(), { contended: false, parked: 0 }).catch(
        () => {},
      );
      const after = await this.deps.db.settlementById(settlement.id);
      return { ok: true, state: after?.state ?? 'confirmed' };
    }
    // The verbatim service word rides the ok-shape for the route layer to
    // screen (same contract as the bond leg's pending arm).
    if (confirmed.pending) {
      this.driftWarn.notePending(confirmed.reason);
      return { ok: true, state: 'confirming', reason: confirmed.reason };
    }
    this.driftWarn.noteFail(confirmed.reason);
    await this.deps.db.transitionSettlement(
      settlement.id,
      ['confirming'],
      'failed',
      confirmed.reason ?? 'refused',
    );
    return refuse('confirm_failed');
  }

  // -------------------------------------------------------------------------
  // Admin / moderation
  // -------------------------------------------------------------------------

  // Account-scoped owned lookups for the route layer's requireOwned loaders
  // (the BOLA load-then-authorize seam): null for absent OR non-owned, so the
  // middleware's uniform 404 never leaks existence.
  async ownedListing(account: number, id: number): Promise<WocListingRow | null> {
    const row = await this.deps.db.listingById(this.cfg.realm, id);
    return row !== null && row.sellerAccount === account ? row : null;
  }

  async ownedBid(account: number, id: number): Promise<WocBidRow | null> {
    const row = await this.deps.db.bidById(id);
    return row !== null && row.account === account ? row : null;
  }

  async ownedSettlement(account: number, id: number): Promise<WocSettlementRow | null> {
    const row = await this.deps.db.settlementById(id);
    return row !== null && row.buyerAccount === account ? row : null;
  }

  /** Operator support view: a seller's listings, any status. */
  async adminListingsBySeller(account: number): Promise<WocListingRow[]> {
    return this.deps.db.listingsBySeller(this.cfg.realm, account);
  }

  /** The safe path only: the atomic guard refuses whenever a payment may
   *  already be moving (see suspendListingIfSafe), so a suspend can never
   *  expire a settlement whose broadcast payment still lands. The operator
   *  retries once the settlement resolves; the item return still rides the
   *  sweep's reconciliation of closed undisposed listings. */
  async adminSuspendListing(listingId: number): Promise<{ ok: true } | Refused> {
    // The kill switch freezes operator WRITES too: a suspend returns the item
    // via custody mail, which is exactly the movement WOC_MARKET_ENABLED=0 is
    // pulled to stop. The operator READS above stay live for incident work.
    if (!this.cfg.enabled) return refuse('disabled');
    const out = await this.deps.db.suspendListingIfSafe(this.cfg.realm, listingId, this.now());
    if (out === 'not_found') return refuse('not_found');
    if (out === 'not_active') return refuse('not_active');
    if (out === 'contended') return refuse('contended');
    if (out === 'buy_now_pending' || out === 'settlement_live') {
      return refuse('settlement_in_flight');
    }
    return { ok: true };
  }

  async adminSetSaleExcluded(saleId: number, excluded: boolean): Promise<{ ok: true } | Refused> {
    if (!this.cfg.enabled) return refuse('disabled');
    const done = await this.deps.db.setSaleExcluded(saleId, excluded);
    if (done === 'ok') return { ok: true };
    // Distinct refusals: a missing row and a correction blocked by a standing
    // non-excluded sale row are different operator problems.
    return done === 'conflict' ? refuse('sale_conflict') : refuse('not_found');
  }

  async adminClearStrikes(account: number): Promise<{ ok: true } | Refused> {
    if (!this.cfg.enabled) return refuse('disabled');
    await this.deps.db.clearStrikes(account);
    return { ok: true };
  }

  async adminResolveReviewSettlement(
    id: number,
    verdict: WocReviewVerdict,
  ): Promise<WocReviewResolution | Refused> {
    // Kill-switch gated like its three write siblings; semantics live in
    // woc_market_review_resolution.ts. The buyer's cached myActivity readout
    // deliberately rides the TTL here (the sweep-transition ruling in
    // woc_market_read_cache.ts): do not import the routes runtime to bust it.
    if (!this.cfg.enabled) return refuse('disabled');
    return resolveReviewSettlement(this.deps.db, this.cfg.realm, id, verdict);
  }

  // -------------------------------------------------------------------------
  // The sweep pass (called by woc_market_sweep.ts on its own clock)
  // -------------------------------------------------------------------------

  /**
   * One pass's ordered plan, for the sweep shell to bracket with the
   * per-realm advisory lock SEGMENT BY SEGMENT instead of camping a pool
   * client and the lock across the whole pass (H11: the two chain-poll arms
   * alone can walk 2 x SWEEP_BATCH confirm round trips at the 60s confirm
   * timeout).
   *
   * Segment contract:
   * - `locked: true` segments are the database arms; the shell holds the
   *   advisory lock (and its one pool client) only for that segment's
   *   bounded batches, releasing both between segments. One honest
   *   exception: the expiry arms' strike gate consults the CACHED price
   *   (strikeDefaultingBuyer), bounded by the price cache's policy (about
   *   one blocking probe per 3s failure-memo window under an outage, never
   *   per row); the segment's remaining worst case is lock-wait arithmetic
   *   under the watchdog's 60s alarm, measured at scale by the pg rigs.
   * - `locked: false` segments (the confirm polls) make read-only CHAIN
   *   calls and run with NO client checked out between their statements and
   *   NO advisory lock held. Safe under a concurrent peer (the deploy-overlap
   *   window) because every STATE write they make is a single-winner CAS over
   *   the row's own state (the park-rotation timestamp touch,
   *   touchBidPollRow, is unguarded on purpose: idempotent bookkeeping a
   *   racing peer merely repeats): transitionSettlement's state guard, holdBondAndActivate
   *   (an ordered re-read under the row lock), the guarded lapse, and the
   *   anti-snipe extension (extendAuctionForBondProgress re-reads the listing
   *   under the row lock and recomputes against the base cap, so a racing peer
   *   moves the close by observation skew, never by a second extension). A peer racing
   *   the same row costs duplicate confirm round trips for the overlap
   *   window, never a duplicate effect. The individual guarded writes still
   *   check out their own clients for their own bounded transactions; what an
   *   unlocked segment never does is HOLD one across a chain round trip.
   *   Money-moving chain arms are locked (see bond-payouts below).
   * - Progress persists BETWEEN segments by construction: every arm commits
   *   its row transitions per row, so an aborted pass (lost lock, shutdown)
   *   resumes from durable state on the next pass.
   * - The pass shares ONE nowMs captured at plan build (the one-block
   *   pass's semantic); a long chain-polls segment ages it conservatively
   *   (fewer expiries, wider park windows), and processDueBonds re-reads
   *   the clock for its own budget.
   *
   * Arm ORDER is the load-bearing part and is unchanged from the one-block
   * pass this replaces; the ordering comments ride the arms below.
   * finish() fires the per-pass reporting exactly once with whatever ran
   * (unrun arms score 0, which can never read as saturated).
   */
  sweepSegments(): {
    segments: ReadonlyArray<{ name: string; locked: boolean; run(): Promise<void> }>;
    finish(): WocSweepPassStats;
  } | null {
    if (!this.cfg.enabled) return null;
    // Contention and park accounting are SCOPED to this pass: the eager
    // confirm entry mints its own scope, so a request thread can neither
    // clobber a pass mid-flight nor inherit a finished pass's verdict (a
    // shared field raced both ways).
    const scope: WocDeliveryScope = { contended: false, parked: 0 };
    // The bond walk's budget-break flag, pass-scoped like the delivery
    // scope: a sub-batch break must still reach the saturated list.
    const budgetBroke = { bonds: false };
    const nowMs = this.now();
    const stats: WocSweepPassStats = {
      lapsedBids: 0,
      expiredOffers: 0,
      convergedOffers: 0,
      reclaimed: 0,
      closed: 0,
      reviewed: 0,
      expired: 0,
      cancelClosed: 0,
      polled: 0,
      polledBonds: 0,
      delivered: 0,
      reconciled: 0,
      redriven: 0,
      disposed: 0,
      returned: 0,
      parked: 0,
      bonds: 0,
    };
    // Every arm runs through arm(): one failing arm (or one poisoned row
    // inside an arm's own loop) is reported to onSweepError and the REST of
    // the pass still runs. Without this, a single throw skipped every later
    // arm of the pass, and the sale-dedupe index makes a throw here
    // strictly more likely than it used to be.
    const runArm = async (name: keyof WocSweepPassStats, run: () => Promise<number>) => {
      stats[name] = await this.arm(name, run);
    };
    const segments = [
      {
        name: 'expiry',
        locked: true,
        run: async () => {
          await runArm('lapsedBids', () =>
            this.deps.db.lapsePendingBids(
              this.cfg.realm,
              nowMs - WOC_MARKET_BOND_PENDING_TTL_SECONDS * 1000,
              SWEEP_BATCH,
            ),
          );
          // Directed offers escrow nothing, so an unanswered one costs no
          // custody. It still has to expire: left pending it stays visible in
          // both players' trade windows as a deal that can never be accepted,
          // and the retention prune only reaches resolved rows, so the table
          // would grow forever.
          await runArm('expiredOffers', () =>
            this.deps.db.expireDueDirectedOffers(this.cfg.realm, nowMs, SWEEP_BATCH),
          );
          // Offer housekeeping's sibling, no ordering dependency on any other
          // arm: it touches only accepted offers with NO listing, a set the
          // listing arms never read.
          await runArm('convergedOffers', () => this.convergeUnstampedOffers(nowMs));
          await runArm('reclaimed', () => this.reclaimStrandedListings(nowMs));
          // BEFORE the close/expiry arms on purpose: a delivered-but-unclosed
          // listing must converge to its finished sale before anything else
          // can misread it as resolvable. Minute-scale (REDRIVE_INTERVAL_MS):
          // the arm converges an OLDER binary's residue, so an every-pass run
          // bought nothing but query load; counts rows ADVANCED, not rows
          // examined.
          await runArm('redriven', () => this.redriveDeliveredTails(nowMs, scope));
          // The sibling residue class, its own arm so a throw here can never
          // discard the page walk's count (and vice versa); shares the minute
          // cadence and honors a contended pass.
          await runArm('disposed', () => this.disposeSoldResidue(nowMs, scope));
          await runArm('closed', () => this.closeDueAuctions(nowMs));
          // BEFORE the poll arm (see parkOverdueConfirming) and before
          // cancelClosed (the abandon-recording order rule).
          await runArm('reviewed', () => this.parkOverdueConfirming(nowMs));
          await runArm('expired', () => this.expireOverdueSettlements(nowMs));
          // AFTER the expiry arm on purpose: the overdue arm is the canonical
          // abandon recorder and expires the abandoned window's settlement, so
          // a cancel-pending listing converges in the same pass its window
          // dies.
          await runArm('cancelClosed', () => this.closeCancelPendingListings(nowMs));
        },
      },
      {
        name: 'chain-polls',
        locked: false,
        run: async () => {
          await runArm('polled', () => this.pollConfirmingSettlements());
          // BEFORE the lapse arm above would matter: a paid-but-undecided
          // bond is excluded from lapsing by its signature, and this is what
          // resolves it.
          await runArm('polledBonds', () => this.pollConfirmingBonds());
        },
      },
      {
        name: 'delivery',
        locked: true,
        run: async () => {
          await runArm('delivered', () => this.deliverConfirmedSettlements(nowMs, scope));
          await runArm('reconciled', () => this.reconcileDelivering(nowMs, scope));
          await runArm('returned', () => this.returnUndisposedItems(nowMs, scope));
        },
      },
      {
        name: 'bond-payouts',
        locked: true,
        run: async () => {
          // LOCKED, unlike the poll segment, because this arm's chain calls
          // MOVE MONEY (bond refunds and forfeits) and bondsDue is an
          // unclaimed read: two deploy-overlap peers would both read the same
          // refund_due row and both fire the refund RPC before either
          // setBondState CAS lands. The service's release protocol is
          // idempotent by reference (the claim CAS persists the signed tx
          // before broadcast, probe-before-resend), so a duplicate request
          // cannot double-pay, but the lock keeps game-side exclusion
          // PROVABLE rather than resting on the cross-repo contract alone.
          // The hold is BUDGETED: processDueBonds stops its walk at
          // BOND_PAYOUT_BUDGET_MS, so a degraded service bounds the lock and
          // client hold at about the budget plus one RPC timeout (~35s),
          // under the watchdog's 60s alarm; the remainder stays durably due
          // and the next pass resumes. The hour-scale camp H11 flags lives
          // in the confirm polls, which stay unlocked.
          await runArm('bonds', () => this.processDueBonds(budgetBroke));
        },
      },
    ];
    return {
      segments,
      finish: (): WocSweepPassStats => {
        // Read AFTER the delivery segment, so it sees every park event of
        // this pass. New park EVENTS only: a row skipped inside its backoff
        // window counts nothing, so a standing parked set cannot flood this
        // the way counting parked rows as delivered once flooded the
        // saturation warning.
        stats.parked = scope.parked;
        // A FULL batch means the arm did not drain: that is the one signal
        // that separates a healthy idle marketplace from a permanently
        // starved backlog, so it is reported rather than left to look
        // identical. The delivery arms count rows ADVANCED; park events ride
        // their own stat so a parked-only pass still reads as work without
        // turning the saturation warning into a permanent 5-second flood.
        const saturated = Object.entries(stats)
          .filter(([, n]) => n >= SWEEP_BATCH)
          .map(([arm]) => arm);
        // A budget-broken bond walk did not drain BY DEFINITION, even when
        // the fetched count sits under a full batch (10 due, 3 walked): the
        // flag keeps the degraded case in the saturation signal.
        if (budgetBroke.bonds && !saturated.includes('bonds')) saturated.push('bonds');
        this.deps.onSweepPass?.(stats, saturated, this.now() - nowMs);
        return stats;
      },
    };
  }

  /** The whole pass in one call: the segment plan run back to back with no
   *  locking (the shell owns locks; only tests call this today, no
   *  production caller exists). Arm order and stats match the one-block
   *  pass this replaced exactly, INCLUDING its one divergence from the
   *  shell: a segment throw here skips finish(), as the old pass skipped
   *  onSweepPass, while the shell's finally always reports. The only throw
   *  path out of a segment is a throwing onSweepError dep, which production
   *  does not wire. */
  async sweepPass(): Promise<WocSweepPassStats | null> {
    const plan = this.sweepSegments();
    if (!plan) return null;
    for (const segment of plan.segments) await segment.run();
    return plan.finish();
  }

  /** Per-arm error isolation: report the failure and score 0 for this pass;
   *  the next pass retries from the durable state. */
  private async arm(name: keyof WocSweepPassStats, run: () => Promise<number>): Promise<number> {
    try {
      return await run();
    } catch (err) {
      this.sweepError(name, err);
      return 0;
    }
  }

  private sweepError(arm: WocSweepErrorTag, err: unknown): void {
    if (this.deps.onSweepError) {
      this.deps.onSweepError(arm, err);
      return;
    }
    // code+message+stack, never the raw error (the escrow arm's discipline):
    // a pg violation's `detail` spells out key values (account ids, pair
    // columns), so the raw object would echo row values into the ops log.
    // The stack carries no row values and is what locates a failure across
    // an arm's dozens of call sites; the null-safe code read keeps a bare
    // Promise.reject() from escaping arm()'s isolation as a TypeError here.
    console.error(`[woc_market] sweep arm ${arm} failed:`, {
      code: typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined,
      message: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }

  /**
   * Converge 'accepted' offers whose escrow never stamped a listing.
   *
   * With the atomic stamp (escrowInsertListing), an AGED accepted-unstamped
   * offer proves its escrow rolled back: the acceptance threw past the
   * typed-refusal rail without rollback proof, so the request wrote nothing
   * (the three-legged residual: offer stuck 'accepted', seller quarantined,
   * copy parked). The durable truth has since settled, so this arm finishes
   * the unwind: reopen the deal (the pair retries by accepting again), or
   * expire it when its TTL already passed. Both writes are the
   * accepted-and-unstamped CAS, so a pathologically late COMMIT that lands
   * the stamp mid-arm makes the write miss harmlessly (EvalPlanQual
   * re-checks the row's own columns). Nearly every row resolves in one
   * pass; the exception is a reopen BLOCKED by an occupied pair slot, which
   * keeps its updated_at and re-enters at the batch head each pass until
   * its own TTL flips it to the expire arm, a bounded few minutes, so there
   * is still no park machinery here; per-row isolation keeps a poisoned row
   * from stranding the batch.
   */
  private async convergeUnstampedOffers(nowMs: number): Promise<number> {
    const due = await this.deps.db.acceptedUnstampedOffers(
      this.cfg.realm,
      nowMs - WOC_MARKET_OFFER_CONVERGE_SECONDS * 1000,
      nowMs - WOC_MARKET_OFFER_CONVERGE_MAX_AGE_SECONDS * 1000,
      SWEEP_BATCH,
    );
    let advanced = 0;
    for (const offer of due) {
      try {
        const moved =
          offer.expiresAtMs <= nowMs
            ? await this.deps.db.expireDirectedOfferIfUnstamped(this.cfg.realm, offer.id)
            : await this.deps.db.reopenDirectedOffer(this.cfg.realm, offer.id);
        if (moved) advanced++;
      } catch (err) {
        this.sweepError('convergedOffers', err);
      }
    }
    return advanced;
  }

  /** One strike, with the ladder's escalating suspension. Non-idempotent by
   *  nature (an increment), so every caller gates it on a write that can
   *  happen at most once per offense (a settlement expiry CAS, a close CAS
   *  plus the never-settled probe). */
  private async strikeAccount(account: number, nowMs: number): Promise<void> {
    const strikes = await this.deps.db.strikeInfo(account);
    const count = (strikes?.strikes ?? 0) + 1;
    const suspension = strikeSuspensionMs(count);
    await this.deps.db.addStrike(account, suspension > 0 ? nowMs + suspension : null);
  }

  /**
   * The defaulting buyer's non-payment strike, with the two fairness gates a
   * strike presumes. ONE path for BOTH rails: the directed arms and the
   * auction-default arm ride it, so the fairness gates can never drift apart
   * (the auction arm used to call strikeAccount bare, and a public winner
   * locked out by a pricing pause was struck for the outage).
   *
   * A strike punishes a payment DEFAULT, so it presumes payment was possible:
   * while the price oracle or economy service is unhealthy, buyNow and
   * confirmSettlement refuse market_paused, so the sweep closing a hold in
   * that window would strike a buyer for an OUTAGE (the sweep deliberately
   * keeps closing and returning items while unhealthy; only the penalty
   * pauses). The health read here is the same one guardEnabledHealthy makes,
   * probed at STRIKE time: a blip earlier inside the window is not visible
   * from here and is accepted (recorded residual; the buyer had the rest of
   * the window). The gate spares the STRIKE only: the auction arm's bond
   * forfeiture stays ungated (the R2-ruled contractual consequence; whether
   * an outage window should also spare the bond is recorded as an open
   * pre-enable question for the close-out audit, not decided here).
   *
   * And a recorded refusal class that says the chain plausibly saw money
   * spares the strike on the SAME vocabulary the public rail's abandon
   * recorder exempts (WOC_MARKET_ABANDON_EXEMPT_FAIL_REASONS, one member,
   * service_unavailable, deliberately non-mintable): a directed buyer whose
   * payment died in a service outage must not eat a strike the public buyer
   * would not even eat a cooldown for. Reachability, honestly: TODAY no
   * in-repo path writes that reason onto a settlement row (the proxy's
   * outage arm answers pending and both confirm consumers return before
   * recording a reason), the same standing gap the public exemption carries;
   * the R5/verifier work owns making the vocabulary real, and until then the
   * HEALTH probe above is the live gate. The arm stays because the exempt
   * list is the one seam that vocabulary lands on when R5 delivers.
   */
  private async strikeDefaultingBuyer(
    account: number,
    nowMs: number,
    failReason: string | null,
  ): Promise<void> {
    if (
      failReason !== null &&
      (WOC_MARKET_ABANDON_EXEMPT_FAIL_REASONS as readonly string[]).includes(failReason)
    ) {
      return;
    }
    const price = await this.deps.economy.price();
    if (!price.available || !price.healthy) return;
    await this.strikeAccount(account, nowMs);
  }

  private async closeDueAuctions(nowMs: number): Promise<number> {
    const due = await this.deps.db.claimDueListings(this.cfg.realm, nowMs, SWEEP_BATCH);
    for (const listing of due) {
      try {
        await this.closeOneDueAuction(listing, nowMs);
      } catch (err) {
        // Per-listing isolation: one poisoned row must not strand the rest of
        // the batch (its own claim is re-opened by the stranded reclaim).
        this.sweepError('closed', err);
      }
    }
    return due.length;
  }

  private async closeOneDueAuction(listing: WocListingRow, nowMs: number): Promise<void> {
    const bids = await this.deps.db.bidsForListing(listing.id);
    const standing = bids.find((b) => b.status === 'active');
    const reserve = listing.reserveCents;
    if (!standing) {
      // A DIRECTED hold that ran out: the named buyer accepted the deal
      // (acceptance is what created this listing and escrowed the copy) and
      // then never paid, so the walk-away earns the directed strike (H12)
      // beside the ordinary close-and-return.
      if (listing.directedBuyerAccount !== null) {
        // An UNEXPIRED claim lock is a buyer mid-flight, not a walk-away:
        // the 270s lock window can outlive the 600s hold, and closing over
        // it would return the escrow while a payment request is in the air.
        // The settlement rails own that window's outcome; this arm retries
        // after it resolves.
        if (
          listing.buyNowLockAccount !== null &&
          listing.buyNowLockExpiresMs !== null &&
          listing.buyNowLockExpiresMs > nowMs
        ) {
          return;
        }
        // The strike gate reads EVER-settled, not open-settled: a buyer
        // whose payment attempt landed a settlement row (even a failed one)
        // is the overdue arm's to strike, and striking here too would be a
        // second strike for one walk-away. Probed AFTER the close CAS
        // succeeds, which closes the once-theoretical sliver where a
        // settlement lands and dies between a pre-close probe and the close
        // (insertSettlement refuses on a closed listing, so nothing can land
        // after the CAS); the strike also only runs after that CAS because
        // addStrike is a non-idempotent increment and a contended close
        // re-runs this row from durable state next pass.
        if (!(await this.deps.db.closeListingIfNoOpenSettlement(listing.id, 'unsettled'))) {
          await this.deps.db.markListingSettling(listing.id);
          return;
        }
        if (!(await this.deps.db.everSettledForListing(listing.id))) {
          await this.strikeDefaultingBuyer(listing.directedBuyerAccount, nowMs, null);
        }
        return;
      }
      // Guarded close: a buy-now settlement placed inside the closing
      // window may be riding this listing, and this arm never reaches
      // insertSettlement's unique-index arbiter, so an unguarded close here
      // was the item-dupe hole (return sweep mails the escrow home while
      // the buyer can still pay). A refusal parks the listing 'settling';
      // the delivery and overdue sweeps resolve the settlement and the
      // ordinary close paths finish the job.
      if (!(await this.deps.db.closeListingIfNoOpenSettlement(listing.id, 'no_bids'))) {
        await this.deps.db.markListingSettling(listing.id);
      }
      return;
    }
    if (reserve !== null && standing.amountCents < reserve) {
      // Atomic demote: outbid plus the held-bond refund ride ONE statement,
      // so a crash between them can never strand a held bond no sweep arm
      // reaches. Same guarded close as the no-bids arm above. Demote BEFORE
      // the close on purpose (a crash between the two must never leave a
      // closed listing holding an active bid); the known cosmetic edge is a
      // purely CONTENDED close refusal, where the reclaimed re-run finds no
      // active bid and records 'no_bids' instead of 'reserve_not_met'.
      await this.deps.db.markBidOutbidQueueRefund(standing.id);
      if (!(await this.deps.db.closeListingIfNoOpenSettlement(listing.id, 'reserve_not_met'))) {
        await this.deps.db.markListingSettling(listing.id);
      }
      return;
    }
    const settlement = await this.deps.db.insertSettlement({
      listingId: listing.id,
      bidId: standing.id,
      attempt: 1,
      buyerAccount: standing.account,
      buyerCharacter: standing.characterId,
      buyerName: standing.characterName,
      buyerWallet: standing.wallet,
      amountCents: standing.amountCents,
      deadlineAtMs: nowMs + WOC_MARKET_SETTLEMENT_WINDOW_SECONDS * 1000,
      nowMs,
      // Stamped 'won' inside the insert's transaction, so the race below can
      // never leave a settlement-less winner. The close-time winner is
      // always read as 'active' just above, so the pickable set is exactly
      // that: a bid something else moved off 'active' meanwhile has lost
      // its claim and must not be stamped.
      winnerBidId: standing.id,
      winnerFrom: ['active'],
    });
    if (settlement === 'listing_closed') {
      // A suspend closed the listing under our 'ending' claim; it already
      // resolved the bid book and the bonds, so there is nothing to settle.
      return;
    }
    if (settlement === 'contended') {
      // A guard transaction holds the listing row; nothing was written.
      // Leave the claim as-is: the stranded reclaim re-opens an 'ending'
      // row after its grace and the next pass retries the close.
      return;
    }
    if (settlement === 'live_settlement_exists' || settlement === 'winner_gone') {
      // A buy-now settlement is already in flight (or a concurrent suspend
      // took the winner off 'active'): that racer won. The standing bid
      // loses its claim (the insert and its 'won' stamp rolled back
      // together) and its bond rides the refund pipeline, atomically; the
      // demote's own compare-and-set from 'active' cannot resurrect a bid
      // a concurrent suspend already cancelled.
      await this.deps.db.markBidOutbidQueueRefund(standing.id);
    }
    // Either way the listing leaves 'ending': a claimed row that stays there
    // is unreachable forever (claimDueListings only selects 'active'), which
    // would strand the escrowed copy and the winner's bond with no
    // reconciliation path. On the buy-now race above the live settlement is
    // the one that drives it, and it also becomes 'settling'.
    await this.deps.db.markListingSettling(listing.id);
  }

  /**
   * Reclaim listings stranded mid-resolution: a query failure or a crash
   * between the claimDueListings UPDATE and the per-listing resolution leaves
   * rows in 'ending' (or in 'settling' with no live settlement) that no other
   * arm can reach. Both are re-opened to 'active' with their original end, so
   * the next pass resolves them normally; the anti-snipe cap keeps the end
   * from drifting.
   */
  private async reclaimStrandedListings(nowMs: number): Promise<number> {
    const stranded = await this.deps.db.strandedListings(
      this.cfg.realm,
      nowMs - WOC_MARKET_STRANDED_RECLAIM_SECONDS * 1000,
      SWEEP_BATCH,
    );
    let reopened = 0;
    for (const listing of stranded) {
      // Per-listing isolation: one poisoned row must not starve the rest of
      // the stranded batch until the next pass.
      try {
        const live = await this.deps.db.liveSettlementForListing(listing.id);
        // Genuinely settling: every live state has its own arm (a stranded
        // 'delivered' converges through the redriven beat; this arm's only
        // job is to never REOPEN over it, which the live check guarantees).
        if (live) continue;
        // A 'failed' settlement is NOT reclaimable either, and must not be
        // expired here: it is still inside the overdue sweep's jurisdiction,
        // whose deadline pass is what defaults the winner, forfeits the bond,
        // records the strike, and runs the offerNext cascade. Expiring it from
        // this arm would silently drop all four (a bond left 'held' is
        // unreachable by every sweep arm). The reopen statement itself refuses
        // while any open OR failed settlement rides the listing, so a row that
        // lands between the read above and the write stays parked.
        await this.deps.db.reopenListing(listing.id);
        reopened++;
      } catch (err) {
        this.sweepError('reclaimed', err);
      }
    }
    return reopened;
  }

  /** The cancel-intent converge: stamped listings whose lock window ended
   *  unpaid close 'cancelled' with the return flight home. 'skip' and
   *  'contended' rows simply wait for the next pass (a paid window converges
   *  through settlement instead, and its finalize closes the listing sold). */
  private async closeCancelPendingListings(nowMs: number): Promise<number> {
    // A 'skip' (a paid window converging through settlement instead, whose
    // finalize closes the listing sold) PARKS: rotate once on
    // sweep_parked_at, back off in-process, and stay excluded from the batch
    // read while waiting, the delivery arms' seam, because a paid window can
    // sit unresolved for operator-scale time and must not head the batch
    // every pass. 'contended' just retries next pass.
    const pending = await this.deps.db.cancelPendingListings(
      this.cfg.realm,
      nowMs,
      SWEEP_BATCH,
      wocBackedOffIds(this.parkedCancelIntents, nowMs),
    );
    let closed = 0;
    for (const listing of pending) {
      try {
        const out = await this.deps.db.closeCancelPendingListing(this.cfg.realm, listing.id, nowMs);
        if (out === 'skip') {
          wocParkRow(this.parkedCancelIntents, listing.id, nowMs + WocMarketService.PARK_RETRY_MS);
          await this.deps.db.touchListingRow(listing.id);
          continue;
        }
        if (out === 'contended') continue;
        closed++;
        this.parkedCancelIntents.delete(listing.id);
        // Eager return flight, best-effort: the sweep's undisposed
        // reconciliation (closed, undisposed, resolution != sold) backstops a
        // crash right here.
        await this.returnListingItem(out).catch(() => {});
      } catch (err) {
        // Per-row isolation, the sweep-wide rule.
        this.sweepError('cancelClosed', err);
      }
    }
    return closed;
  }

  /** The H15 exit, its OWN arm with its own batch budget (sharing the
   *  overdue batch let a confirming backlog, oldest deadlines by
   *  construction, own the batch head and starve the offered/failed expiry
   *  work). A signature exists and the chain never decided, so each row is
   *  AMBIGUOUS by construction. It must not default, forfeit, strike, or
   *  cascade (the buyer may have paid), and it must not be polled forever
   *  either. 'review' parks it for an operator verdict: out of the polling
   *  set, still OPEN (the listing cannot re-auction), surfaced by the stuck
   *  readout. The operator resolution arms are review -> confirmed (payment
   *  verified on chain: delivery resumes) and review -> failed (verified
   *  unpaid: the ordinary overdue default pass takes it from there), driven
   *  by POST /internal/woc-market/settlements/:id/resolve through the
   *  realm-scoped CAS. Runs BEFORE the poll arm in the pass, so a row
   *  whose economy recovered exactly at the bound parks rather than
   *  resolves: deliberate (six hours of polls already failed) and
   *  operator-recoverable. */
  private async parkOverdueConfirming(nowMs: number): Promise<number> {
    const overdue = await this.deps.db.confirmingOverdueSettlements(
      this.cfg.realm,
      nowMs - this.cfg.confirmingReviewMs,
      SWEEP_BATCH,
    );
    let parked = 0;
    for (const settlement of overdue) {
      try {
        const out = await this.deps.db.transitionSettlement(
          settlement.id,
          ['confirming'],
          'review',
          'confirming_overdue',
        );
        if (out) parked++;
      } catch (err) {
        // Per-row isolation, the sweep-wide rule.
        this.sweepError('reviewed', err);
      }
    }
    return parked;
  }

  private async expireOverdueSettlements(nowMs: number): Promise<number> {
    const overdue = await this.deps.db.overdueSettlements(this.cfg.realm, nowMs, SWEEP_BATCH);
    for (const settlement of overdue) {
      try {
        await this.expireOneOverdueSettlement(settlement, nowMs);
      } catch (err) {
        // Per-row isolation: this backlog returns UNCLAIMED rows in deadline
        // order, so a persistently failing head row would otherwise starve
        // every later expiry (and its bond and strike work) forever.
        this.sweepError('expired', err);
      }
    }
    return overdue.length;
  }

  private async expireOneOverdueSettlement(
    settlement: WocSettlementRow,
    nowMs: number,
  ): Promise<void> {
    // A 'failed' row KEEPS its refusal reason across the expiry (COALESCE in
    // the transition): the abandon recorders' exempt predicate reads it, and
    // 'window_elapsed' would erase exactly the fact that distinguishes a
    // chain-refused try from a walk-away. Offered rows (no refusal ever)
    // stamp window_elapsed as before.
    const moved = await this.deps.db.transitionSettlement(
      settlement.id,
      ['offered', 'failed'],
      'expired',
      settlement.state === 'failed' ? undefined : 'window_elapsed',
    );
    if (!moved) return;
    const listing = await this.deps.db.listingById(this.cfg.realm, settlement.listingId);
    if (!listing) return;
    if (settlement.bidId !== null) {
      // The close-time winner defaulted: forfeit the held bond, strike them.
      // CAS from 'won': a bid something else already resolved (a suspend's
      // CTE cancelled it with its refund queued) must not be re-labelled a
      // default on top of that resolution. The strike rides the SHARED
      // fairness gate (oracle health plus the exempt refusal vocabulary):
      // a winner locked out by a pricing pause is not struck for the outage.
      // The forfeit itself stays ungated (R2's ruled consequence; the
      // outage-window forfeit question is recorded for the pre-enable audit).
      await this.deps.db.markBidStatus(settlement.bidId, 'defaulted', ['won']);
      await this.deps.db.setBondState(settlement.bidId, ['held'], 'forfeit_due');
      await this.strikeDefaultingBuyer(settlement.buyerAccount, nowMs, settlement.failReason);
    } else {
      // An abandoned buy-now. On a PUBLIC listing the buyer committed no
      // money, the lock clears and the listing resumes for the next person,
      // so no strike is warranted; what it DOES cost them now is a cooldown
      // (the abandon-loop ruling): the recorded abandonment blocks re-claims
      // of this listing and counts toward the account-wide hourly cap.
      // Recorded BEFORE the clear (a crash between the two must not lose the
      // row), keyed by the window (the settlement deadline IS the lock
      // expiry), deduped against the steal-time recorder. The clear is
      // holder-guarded: if a new claimer already stole the expired lock,
      // their live window survives this arm.
      //
      // A DIRECTED sale keeps its strike instead (and records no cooldown
      // row). Its buyer accepted a named offer, and that acceptance is what
      // pulled a specific player's item out of their bags into escrow;
      // walking away leaves that seller holding an unsellable listing they
      // have to notice and cancel. This is the requester's rule that strikes
      // apply to p2p non-payment once both parties have accepted, and
      // acceptance is exactly the moment escrow happened. There is no bond
      // to forfeit here (a directed sale carries none).
      // The abandon-vs-tried distinction lives in ONE place, the recorder's
      // own exempt-window predicate (recordBuyNowAbandon refuses windows
      // whose refusal class says the chain plausibly saw money), shared with
      // the steal-time recorder so the two can never disagree. A bare
      // signature does NOT exempt: it proves only that a string was posted,
      // and exempting on it let one fabricated request bypass the whole
      // cooldown arm.
      if (listing.directedBuyerAccount === null) {
        await this.deps.db.recordBuyNowAbandon(
          this.cfg.realm,
          listing.id,
          settlement.buyerAccount,
          settlement.deadlineAtMs,
        );
      }
      await this.deps.db.clearBuyNowLock(listing.id, settlement.buyerAccount);
      if (listing.directedBuyerAccount !== null) {
        // AUTO-CLOSE (H12) runs FIRST: a directed listing has exactly one
        // permitted buyer, so an expired unpaid settlement is the end of the
        // deal, not a return to the shelf, and closing returns the item on
        // the next return-flight pass. Custody before penalty: the strike
        // below awaits an economy health read that can reject, and the
        // expiry CAS above fires once, so a strike-side throw after the
        // close costs only the penalty, never the item's trip home. The
        // close guard refuses only if a RACING fresh claim opened a new
        // settlement in this sliver; that window then owns the outcome and
        // a later expiry converges the close. The close-arm strike stays
        // mutually exclusive with this one through its ever-settled gate
        // (this settlement row exists); this strike is gated by the expiry
        // transition CAS (`moved`), which fires at most once per settlement.
        if (!(await this.deps.db.closeListingIfNoOpenSettlement(listing.id, 'unsettled'))) {
          await this.deps.db.markListingSettling(listing.id);
        }
        await this.strikeDefaultingBuyer(settlement.buyerAccount, nowMs, settlement.failReason);
      }
      return;
    }
    // Cascade to the next eligible bidder when the seller opted in. Prior
    // winners are excluded inside the pick itself (a bounded store-side
    // derivation; this arm used to materialize the listing's whole bid
    // history per overdue settlement to build that set).
    if (listing.offerNext) {
      const next = await this.deps.db.nextCascadeBidder(
        listing.id,
        listing.reserveCents ?? listing.startCents,
      );
      if (next) {
        // The promoted bidder's bond was released when they were outbid, so
        // re-arm it: a cascade winner with nothing at risk cannot be made to
        // forfeit (PRD "A winner who fails to settle forfeits the bond").
        // 'refunded' is terminal, so only a still-held or refund-pending bond
        // is re-held; an already-refunded one is re-quoted by the client
        // through the ordinary bond flow before the settlement can confirm.
        await this.deps.db.setBondState(next.id, ['refund_due', 'held'], 'held');
        const cascaded = await this.deps.db.insertSettlement({
          listingId: listing.id,
          bidId: next.id,
          attempt: settlement.attempt + 1,
          buyerAccount: next.account,
          buyerCharacter: next.characterId,
          buyerName: next.characterName,
          buyerWallet: next.wallet,
          amountCents: next.amountCents,
          deadlineAtMs: nowMs + WOC_MARKET_SETTLEMENT_WINDOW_SECONDS * 1000,
          nowMs,
          // The cascade only ever promotes an 'outbid' runner-up
          // (nextCascadeBidder's selection), so that is the whole pickable
          // set here.
          winnerBidId: next.id,
          winnerFrom: ['outbid'],
        });
        if (typeof cascaded === 'string') {
          // live_settlement_exists / listing_closed: a cancel or suspend
          // closed the listing between this arm's listingById read and the
          // insert (the insert's own listing lock is what refuses now), or
          // a second open settlement raced in over the retry window of the
          // 'failed' row this arm expired. winner_gone: a suspend cancelled
          // the runner-up under us. contended: a guard holds the listing
          // row and nothing was written. In every arm the insert (and any
          // 'won' stamp) rolled back; unwind the re-hold so the bond cannot
          // sit held on a bid with no claim.
          await this.deps.db.setBondState(next.id, ['held'], 'refund_due');
        }
        return;
      }
    }
    await this.deps.db.closeListing(listing.id, 'unsettled');
  }

  private async pollConfirmingSettlements(): Promise<number> {
    const confirming = await this.deps.db.confirmingSettlements(this.cfg.realm, SWEEP_BATCH);
    for (const settlement of confirming) {
      try {
        if (settlement.quoteReference === null || settlement.txSignature === null) continue;
        const confirmed = await this.deps.economy
          .confirm(settlement.quoteReference, settlement.txSignature)
          .catch(() => null);
        if (confirmed?.pending) this.driftWarn.notePending(confirmed.reason);
        if (!confirmed || confirmed.pending) continue;
        if (confirmed.settled) {
          await this.deps.db.transitionSettlement(settlement.id, ['confirming'], 'confirmed');
        } else {
          this.driftWarn.noteFail(confirmed.reason);
          await this.deps.db.transitionSettlement(
            settlement.id,
            ['confirming'],
            'failed',
            confirmed.reason ?? 'refused',
          );
        }
      } catch (err) {
        // Per-row isolation: an unclaimed ordered backlog, same rationale as
        // the expiry arm.
        this.sweepError('polled', err);
      }
    }
    return confirming.length;
  }

  /** Shared loop for the two delivery arms: per-row isolation, park handling
   *  (a parked row rotates ONCE, at park time, onto the sweep_parked_at
   *  batch order; while its backoff runs the batch reads EXCLUDE it, so it
   *  costs neither a batch slot nor a write per pass), and a SCOPE-WIDE stop
   *  on the first 'contended' outcome: the rows a break leaves behind are
   *  already 'delivering', so without the flag the reconcile arm would
   *  re-attempt them seconds later in the same pass and spend the
   *  lock_timeout budget the break conserved. Returns rows ADVANCED. */
  /** The delivery arms live in server/woc_market_delivery.ts (the monolith
   *  ratchet row's named extraction candidate, landed by the escrow
   *  write-path rider). The ledgers and deps stay HERE as live service
   *  state; the arms hold only their own cadence cursors, which is why the
   *  factory is memoized: a fresh instance per call would reset the
   *  minute-scale residue gates every pass. */
  private deliveryArmsMemo?: WocMarketDeliveryArms;

  private delivery(): WocMarketDeliveryArms {
    this.deliveryArmsMemo ??= createWocMarketDeliveryArms({
      db: this.deps.db,
      custody: this.deps.custody,
      realm: this.cfg.realm,
      now: () => this.now(),
      sweepError: (arm, err) => this.sweepError(arm, err),
      pruneLocalLedgers: (nowMs) => this.pruneLocalLedgers(nowMs),
      parkedDeliveries: this.parkedDeliveries,
      parkedReturns: this.parkedReturns,
      pendingGrants: this.pendingGrants,
      pendingMail: this.pendingMail,
      parkRetryMs: WocMarketService.PARK_RETRY_MS,
      sweepBatch: SWEEP_BATCH,
    });
    return this.deliveryArmsMemo;
  }

  private deliverConfirmedSettlements(nowMs: number, scope: WocDeliveryScope): Promise<number> {
    return this.delivery().deliverConfirmedSettlements(nowMs, scope);
  }

  private reconcileDelivering(nowMs: number, scope: WocDeliveryScope): Promise<number> {
    return this.delivery().reconcileDelivering(nowMs, scope);
  }

  private redriveDeliveredTails(nowMs: number, scope: WocDeliveryScope): Promise<number> {
    return this.delivery().redriveDeliveredTails(nowMs, scope);
  }

  private disposeSoldResidue(nowMs: number, scope: WocDeliveryScope): Promise<number> {
    return this.delivery().disposeSoldResidue(nowMs, scope);
  }

  private returnUndisposedItems(nowMs: number, scope: WocDeliveryScope): Promise<number> {
    return this.delivery().returnUndisposedItems(nowMs, scope);
  }

  private returnListingItem(listing: WocListingRow): Promise<boolean> {
    return this.delivery().returnListingItem(listing);
  }

  private async processDueBonds(budgetBroke?: { bonds: boolean }): Promise<number> {
    const startedAtMs = this.now();
    const due = await this.deps.db.bondsDue(this.cfg.realm, SWEEP_BATCH);
    let walked = 0;
    for (const bid of due) {
      // The budget check runs BETWEEN rows, never mid-RPC: a row in flight
      // finishes (its verdict writes), and the remainder stays due for the
      // next pass. Under the fixed test clocks elapsed is zero, so suites
      // exercise the full batch unless they advance time on purpose.
      if (this.now() - startedAtMs > BOND_PAYOUT_BUDGET_MS) {
        // The break itself is reported: a SUB-batch break reads as a drained
        // pass by count alone (the saturation filter fires at a full batch).
        if (budgetBroke) budgetBroke.bonds = true;
        break;
      }
      walked++;
      try {
        if (bid.bondReference === null) {
          // Nothing was ever transferred; close the loop locally.
          await this.deps.db.setBondState(bid.id, ['refund_due', 'forfeit_due'], 'void');
          continue;
        }
        if (bid.bondState === 'refund_due') {
          const out = await this.deps.economy.refundBond(bid.bondReference).catch(() => null);
          if (out?.done) await this.deps.db.setBondState(bid.id, ['refund_due'], 'refunded');
        } else if (bid.bondState === 'forfeit_due') {
          const out = await this.deps.economy.forfeitBond(bid.bondReference).catch(() => null);
          if (out?.done) await this.deps.db.setBondState(bid.id, ['forfeit_due'], 'forfeited');
        }
      } catch (err) {
        // Per-row isolation: bondsDue returns UNCLAIMED rows in deadline
        // order, so a persistently failing head row (a pg error out of
        // setBondState; the economy calls are already caught) would starve
        // every other player's refund forever.
        this.sweepError('bonds', err);
      }
    }
    // Rows FETCHED (== walked except on a budget break, where the undrained
    // remainder must keep counting; the break rides the flag into saturated).
    return due.length;
  }
}
