// In-memory WocMarketDb for the $WOC Exchange service tests: a faithful
// stand-in for server/woc_market_db.ts (PgWocMarketDb) with zero runtime pg.
// Every method mirrors the SQL semantics, including the check ORDER inside the
// guarded transactions (insertPendingBid's refusal ladder, activateBid's
// supersede arms, claimBuyNowLock's diagnosis order, the one-live-settlement
// rule, addStrike's GREATEST-of-epochs quirk on the conflict arm), so the
// service under test exercises the same decision surface it sees in
// production. Rows are deep-copied (structuredClone) on the way in AND out, so
// a test can never mutate internal state by aliasing a returned row.
//
// Test hooks: `failNextEscrow` forces the next escrowInsertListing to refuse
// (the compensation/restore paths); `escrowSaves` records every character
// save the escrow edge received; `failNextMarkBooked` fails the next
// markCustodyRefBooked (the written-flag twins); `failNextDeliveredSave`
// forces the next saveDeliveredCharacterBooked outcome ('lease_lost',
// 'throw', or 'throw_after_commit') with `deliveredSaves` recording every
// save it received; `failNextFinalize` forces the next finalize to report
// contention.

import type {
  CharacterSaveArgs,
  NewWocListing,
  WocActivityBidRow,
  WocActivitySettlementRow,
  WocBidRow,
  WocBondState,
  WocBrowseQuery,
  WocCustodyRefState,
  WocDirectedOfferRow,
  WocDirectedOfferStatus,
  WocListingResolution,
  WocListingRow,
  WocMarketDb,
  WocSaleRow,
  WocSellerProfile,
  WocSettlementRow,
  WocStrikeRow,
  WocStuckCustodyClasses,
} from '../../../server/woc_market';
import { SETTLED_OFFER_GRACE_MS } from '../../../server/woc_market_db';
import type {
  WocOpsListingRow,
  WocOpsListingStatus,
  WocOpsP2pTradeRow,
} from '../../../server/woc_market_ops';
import type { WocBidStatus, WocSettlementState } from '../../../server/woc_market_rules';
import {
  WOC_MARKET_ABANDON_EXEMPT_FAIL_REASONS,
  WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS,
  WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR,
  WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS,
  WOC_MARKET_MAX_ACTIVE_LISTINGS,
} from '../../../server/woc_market_rules';
import type {
  NewWocStepUpChallenge,
  WocStepUpChallengeRow,
} from '../../../server/woc_market_stepup';
import type { ExtractRef } from '../../../src/sim/inventory_extract';

export interface FakeWocMarketCharacter {
  characterId: number;
  accountId: number;
  name: string;
  realm: string;
}

// The realm column exists on the bids/settlements TABLES but not on the row
// shapes woc_market.ts consumes; the fake carries it internally and strips it
// on the way out, like the Pg column list does.
type BidRec = WocBidRow & { realm: string };
type SettlementRec = WocSettlementRow & { realm: string };

// Mirrors the woc_market_settlements_open2 partial unique index: 'delivered'
// stays open until the listing row closes, so liveness checks keep seeing it,
// and 'review' (an over-aged confirming parked for the operator) stays open
// because the payment may have landed. Exported so the DB-free structural pin
// (woc_market_directed_sql.test.ts) can hold this list and the shipped index
// predicate to the same literals.
export const OPEN_SETTLEMENT_STATES: readonly WocSettlementState[] = [
  'offered',
  'confirming',
  'review',
  'confirmed',
  'delivering',
  'delivered',
];

export class FakeWocMarketDb implements WocMarketDb {
  /** Force the NEXT escrowInsertListing to refuse (consumed on use). */
  failNextEscrow: 'lease_lost' | 'cap_reached' | 'contended' | 'not_pending' | null = null;
  /** THROW from the next escrowInsertListing (after recording the save args,
   *  which still cross the edge when a real transaction dies): the error's
   *  .code drives the caller's rollback-proof compensation split. */
  failNextEscrowThrow: Error | null = null;
  /** The buy-now abandon ledger (claim cooldowns), the Pg table's mirror. */
  readonly buyNowAbandons: {
    realm: string;
    listingId: number;
    account: number;
    lockExpiresMs: number;
  }[] = [];
  /** The bond poll rotation stamps (the Pg poll_parked_at mirror). */
  private readonly bidPollParkedMs = new Map<number, number>();
  /** Every closeCancelPendingListing call's listing id, in order. */
  readonly cancelConvergeAttempts: number[] = [];
  /** Force the NEXT closeCancelPendingListing to report contention
   *  (consumed on use), for the park-vs-retry distinction. */
  failNextCancelConverge: 'contended' | null = null;
  /** Every character save escrowInsertListing received, in order. */
  readonly escrowSaves: CharacterSaveArgs[] = [];
  /** The durable book-once ledger (woc_market_custody_claims), exposed so
   *  tests can assert claim/book/grant-intent lifecycles directly. */
  readonly custodyClaims = new Map<
    string,
    {
      realm: string;
      claimedAtMs: number;
      bookedAtMs: number | null;
      grantCharacterId: number | null;
      mailIntentAtMs: number | null;
    }
  >();

  private readonly characters: FakeWocMarketCharacter[];
  private readonly now: () => number;

  private readonly listings = new Map<number, WocListingRow>();
  /** The category/subcategory stamps beside each listing row (the two table
   *  columns; WocListingRow itself never carries them). Tests may seed a
   *  null-category entry to model a pre-stamp legacy row. */
  readonly listingCategories = new Map<
    number,
    { category: string | null; subcategory: string | null }
  >();
  private readonly bids = new Map<number, BidRec>();
  private readonly settlements = new Map<number, SettlementRec>();
  private readonly sales = new Map<number, WocSaleRow>();
  private readonly strikes = new Map<number, WocStrikeRow>();
  private readonly terms = new Map<number, number>();

  // updated_at mirrors (the readout's age signals; stamped on every real
  // mutation, exactly where the Pg UPDATEs set updated_at = now()).
  private readonly listingTouchMs = new Map<number, number>();
  private readonly settlementTouchMs = new Map<number, number>();
  /** wallet_links mirror for the claim's same-wallet twin guard; tests seed it. */
  readonly walletLinks = new Map<number, string>();
  // sweep_parked_at mirrors: the rotation column the park writes. Kept apart
  // from the touch maps so a parked row cycles to the batch tail WITHOUT
  // refreshing its age (the Pg split this fake must model faithfully).
  private readonly listingParkedMs = new Map<number, number>();
  private readonly settlementParkedMs = new Map<number, number>();

  private nextListingId = 1;
  private nextBidId = 1;
  private nextSettlementId = 1;
  private nextSaleId = 1;

  constructor(seed: { characters: FakeWocMarketCharacter[]; now?: () => number }) {
    this.characters = seed.characters.map((c) => ({ ...c }));
    this.now = seed.now ?? (() => 0);
  }

  // -------------------------------------------------------------------------
  // Internal copy/order helpers
  // -------------------------------------------------------------------------

  private listingOut(row: WocListingRow): WocListingRow {
    return structuredClone(row);
  }

  private bidOut(rec: BidRec): WocBidRow {
    const copy = structuredClone(rec) as WocBidRow & { realm?: string };
    delete copy.realm;
    return copy;
  }

  private settlementOut(rec: SettlementRec): WocSettlementRow {
    const copy = structuredClone(rec) as WocSettlementRow & { realm?: string };
    delete copy.realm;
    return copy;
  }

  private touchListing(id: number): void {
    this.listingTouchMs.set(id, this.now());
  }

  private touchSettlement(id: number): void {
    this.settlementTouchMs.set(id, this.now());
  }

  private byTouch(map: Map<number, number>) {
    return (a: { id: number }, b: { id: number }): number =>
      (map.get(a.id) ?? 0) - (map.get(b.id) ?? 0) || a.id - b.id;
  }

  /** The batch order the parked-row rotation feeds: COALESCE(sweep_parked_at,
   *  updated_at), mirroring PARK_ROTATION_ORDER in the Pg module. */
  private byRotation(parked: Map<number, number>, touch: Map<number, number>) {
    return (a: { id: number }, b: { id: number }): number =>
      (parked.get(a.id) ?? touch.get(a.id) ?? 0) - (parked.get(b.id) ?? touch.get(b.id) ?? 0) ||
      a.id - b.id;
  }

  // -------------------------------------------------------------------------
  // Listings
  // -------------------------------------------------------------------------

  async escrowInsertListing(
    save: CharacterSaveArgs,
    listing: NewWocListing,
  ): Promise<
    | { ok: true; id: number }
    | { ok: false; reason: 'lease_lost' | 'cap_reached' | 'contended' | 'not_pending' }
  > {
    // The Pg transaction counts the cap FIRST and only then runs the fenced
    // character save; the fake records the save ARGS it received either way,
    // because the args cross the seam on every call and a refused escrow
    // commits nothing in Pg (the rollback) or here (no store write).
    this.escrowSaves.push(structuredClone(save));
    let active = 0;
    for (const row of this.listings.values()) {
      if (
        row.realm === listing.realm &&
        row.sellerAccount === listing.sellerAccount &&
        row.status !== 'closed'
      ) {
        active += 1;
      }
    }
    // EVERY non-closed listing counts, directed included, mirroring the real
    // transaction's widened cap predicate (H12).
    if (active >= WOC_MARKET_MAX_ACTIVE_LISTINGS) {
      return { ok: false, reason: 'cap_reached' };
    }
    // The forced-failure hooks model the FENCED SAVE, which the real
    // transaction reaches only past the cap count: a staged fence failure at
    // a full cap answers cap_reached and the hook stays armed for the next
    // call, exactly as an unreached save fails nothing.
    if (this.failNextEscrowThrow !== null) {
      const err = this.failNextEscrowThrow;
      this.failNextEscrowThrow = null;
      throw err;
    }
    if (this.failNextEscrow !== null) {
      const reason = this.failNextEscrow;
      this.failNextEscrow = null;
      return { ok: false, reason };
    }
    // The atomic offer stamp's CAS, checked BEFORE the insert lands in the
    // fake (one memory step models one atomic transaction: a miss leaves no
    // listing behind, exactly like the real TxAbort rollback).
    if (listing.directedOfferId !== null) {
      const offer = this.offers.get(listing.directedOfferId);
      if (
        !offer ||
        offer.realm !== listing.realm ||
        offer.status !== 'accepted' ||
        offer.listingId !== null
      ) {
        return { ok: false, reason: 'not_pending' };
      }
    }
    const id = this.nextListingId++;
    const row: WocListingRow = {
      id,
      realm: listing.realm,
      directedBuyerAccount: listing.params.directedBuyerAccount,
      sellerAccount: listing.sellerAccount,
      sellerCharacter: listing.sellerCharacter,
      sellerName: listing.sellerName,
      sellerWallet: listing.sellerWallet,
      item: structuredClone(listing.item),
      itemId: listing.itemId,
      quality: listing.quality,
      format: listing.params.format,
      startCents: listing.params.startCents,
      reserveCents: listing.params.reserveCents,
      buyNowCents: listing.params.buyNowCents,
      offerNext: listing.params.offerNext,
      status: 'active',
      resolution: null,
      itemDisposed: false,
      currentBidCents: null,
      soldCents: null,
      currentBidId: null,
      endsAtMs: listing.endsAtMs,
      baseEndsAtMs: listing.endsAtMs,
      buyNowLockAccount: null,
      buyNowLockExpiresMs: null,
      createdAtMs: this.now(),
      cancelRequestedAtMs: null,
    };
    this.listings.set(id, row);
    // The category stamps live beside the row (WocListingRow carries no
    // category field: the wire never reads it), mirroring the two columns.
    this.listingCategories.set(id, {
      category: listing.category,
      subcategory: listing.subcategory,
    });
    this.touchListing(id);
    if (listing.directedOfferId !== null) {
      const offer = this.offers.get(listing.directedOfferId);
      if (offer) {
        offer.listingId = id;
        this.offerUpdatedMs.set(offer.id, this.now());
      }
    }
    return { ok: true, id };
  }

  /** Test seam: write a listing row DIRECTLY, bypassing the escrow
   *  transaction's cap count and offer stamp; the fake's twin of the pg
   *  suites' raw-SQL seeding. For staging state an OLDER binary left behind
   *  (delivered-but-unclosed residue, rows that predate the widened cap),
   *  which the current binary's own paths can no longer produce; never a
   *  shortcut around a rule a test means to exercise. */
  seedListingRow(row: Omit<WocListingRow, 'id'>): number {
    const id = this.nextListingId++;
    this.listings.set(id, { ...structuredClone(row), id } as WocListingRow);
    this.touchListing(id);
    return id;
  }

  async listingById(realm: string, id: number): Promise<WocListingRow | null> {
    const row = this.listings.get(id);
    return row && row.realm === realm ? this.listingOut(row) : null;
  }

  async browseListings(
    realm: string,
    q: WocBrowseQuery,
  ): Promise<{ rows: WocListingRow[]; hasMore: boolean }> {
    const itemIds = q.itemIds && q.itemIds.length > 0 ? q.itemIds.slice(0, 50) : null;
    const matched = [...this.listings.values()].filter(
      (row) =>
        row.realm === realm &&
        (row.status === 'active' || row.status === 'settling' || row.status === 'ending') &&
        // Mirrors the real query's unconditional exclusion. Without this the
        // fake would report a directed row as publicly browsable and the test
        // asserting it is hidden would pass against a fake that never hides it.
        row.directedBuyerAccount === null &&
        (q.quality === null || row.quality === q.quality) &&
        (q.format === null || row.format === q.format) &&
        (itemIds === null || itemIds.includes(row.itemId)),
    );
    const price = (row: WocListingRow): number => row.currentBidCents ?? row.startCents;
    matched.sort((a, b) => {
      if (q.sort === 'newest') return b.createdAtMs - a.createdAtMs || b.id - a.id;
      if (q.sort === 'price_asc') return price(a) - price(b) || a.id - b.id;
      if (q.sort === 'price_desc') return price(b) - price(a) || a.id - b.id;
      return a.endsAtMs - b.endsAtMs || a.id - b.id;
    });
    const pageSize = Math.min(Math.max(1, q.pageSize), 50);
    const offset = Math.max(0, q.page) * pageSize;
    // The Pg has-more PROBE mirrored: select one row past the page, report
    // hasMore when it existed, and slice the page back to pageSize.
    const probe = matched.slice(offset, offset + pageSize + 1);
    const hasMore = probe.length > pageSize;
    const rows = hasMore ? probe.slice(0, pageSize) : probe;
    return { rows: rows.map((r) => this.listingOut(r)), hasMore };
  }

  /** Mirrors the real predicates: public rows only, the created_at window
   *  INCLUSIVE at both ends, and status narrowed unless 'all'. */
  async opsListings(q: {
    realm: string;
    status: WocOpsListingStatus;
    fromMs: number;
    toMs: number;
    page: number;
    pageSize: number;
  }): Promise<{ rows: WocOpsListingRow[]; hasMore: boolean }> {
    const matched = [...this.listings.values()]
      .filter(
        (r) =>
          r.realm === q.realm &&
          r.directedBuyerAccount === null &&
          r.createdAtMs >= q.fromMs &&
          r.createdAtMs <= q.toMs &&
          (q.status === 'all' ||
            (q.status === 'sold' || q.status === 'cancelled'
              ? r.status === 'closed' && r.resolution === q.status
              : r.status === q.status)),
      )
      .sort((a, b) => b.createdAtMs - a.createdAtMs || b.id - a.id);
    const pageSize = Math.min(Math.max(1, q.pageSize), 200);
    const offset = Math.max(0, q.page) * pageSize;
    const page = matched.slice(offset, offset + pageSize + 1);
    const hasMore = page.length > pageSize;
    return {
      rows: (hasMore ? page.slice(0, pageSize) : page).map((r) => {
        const sale =
          r.status === 'closed' && r.resolution === 'sold'
            ? [...this.sales.values()].find((s) => s.listingId === r.id && !s.excluded)
            : undefined;
        return {
          ...this.listingOut(r),
          buyerAccount: sale?.buyerAccount ?? null,
          buyerName: sale?.buyerName ?? null,
          soldAtMs: sale?.atMs ?? null,
        };
      }),
      hasMore,
    };
  }

  async opsP2pTrades(q: {
    realm: string;
    status: WocDirectedOfferStatus | 'all';
    fromMs: number;
    toMs: number;
    page: number;
    pageSize: number;
  }): Promise<{ rows: WocOpsP2pTradeRow[]; hasMore: boolean }> {
    const matched = [...this.offers.values()]
      .filter(
        (o) =>
          o.realm === q.realm &&
          o.createdAtMs >= q.fromMs &&
          o.createdAtMs <= q.toMs &&
          (q.status === 'all' || o.status === q.status),
      )
      .sort((a, b) => b.createdAtMs - a.createdAtMs || b.id - a.id);
    const pageSize = Math.min(Math.max(1, q.pageSize), 200);
    const offset = Math.max(0, q.page) * pageSize;
    const page = matched.slice(offset, offset + pageSize + 1);
    const hasMore = page.length > pageSize;
    const settlementFor = (listingId: number | null) =>
      listingId === null
        ? null
        : ([...this.settlements.values()]
            .filter((s) => s.listingId === listingId)
            .sort((a, b) => b.id - a.id)[0] ?? null);
    return {
      rows: (hasMore ? page.slice(0, pageSize) : page).map((o) => {
        const s = settlementFor(o.listingId);
        return {
          ...structuredClone(o),
          settlementState: s?.state ?? null,
          settledAmountBase: s?.settledAmountBase ?? null,
          txSignature: s?.txSignature ?? null,
        };
      }),
      hasMore,
    };
  }

  async listingsBySeller(realm: string, account: number): Promise<WocListingRow[]> {
    return [...this.listings.values()]
      .filter((row) => row.realm === realm && row.sellerAccount === account)
      .sort((a, b) => b.createdAtMs - a.createdAtMs || b.id - a.id)
      .slice(0, 50)
      .map((r) => this.listingOut(r));
  }

  // --- Directed p2p offers ---------------------------------------------------
  // The real table's semantics that the service depends on: a compare-and-set
  // resolve (so a double accept cannot escrow twice) and a reopen narrowed to an
  // accepted offer with no listing.
  readonly offers = new Map<number, WocDirectedOfferRow>();
  private nextOfferId = 1;
  /** The updated_at mirror, the converge arm's age axis: stamped on every
   *  offer write like the real column. */
  readonly offerUpdatedMs = new Map<number, number>();

  async insertDirectedOffer(offer: {
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
  }): Promise<WocDirectedOfferRow | 'offer_pending'> {
    // The pair-pending unique index's mirror: one live deal per
    // (buyer, seller) pair (the strike-farming bound).
    for (const o of this.offers.values()) {
      if (
        o.realm === offer.realm &&
        o.status === 'pending' &&
        o.buyerAccount === offer.buyerAccount &&
        o.sellerAccount === offer.sellerAccount
      ) {
        return 'offer_pending';
      }
    }
    const row: WocDirectedOfferRow = {
      id: this.nextOfferId++,
      ...offer,
      itemRef: null,
      status: 'pending',
      listingId: null,
      // Pg stamps created_at DEFAULT now(); the poll read orders by it, so
      // the fake must carry the real clock or its ordering mirror is a lie.
      createdAtMs: this.now(),
      buyerAccepted: false,
      sellerAccepted: false,
      listingStatus: null,
      listingResolution: null,
      settlementState: null,
    };
    this.offers.set(row.id, row);
    this.offerUpdatedMs.set(row.id, this.now());
    // Copy on the way out (the header contract): the store row stays private.
    return structuredClone(row);
  }

  /** Stage a pre-pin legacy offer shape (null item) IN the store: the read
   *  path hands out copies now, so tests can no longer mutate a live row. */
  stageLegacyOfferWithoutItem(id: number): void {
    const row = this.offers.get(id);
    if (row) {
      row.itemId = null;
      row.itemPin = null;
    }
  }

  async directedOfferById(realm: string, id: number): Promise<WocDirectedOfferRow | null> {
    const row = this.offers.get(id);
    // Deep-copied on the way out like every other read (the header contract):
    // a caller mutating the result must never edit the store.
    return row && row.realm === realm ? structuredClone(row) : null;
  }

  // --- Step-up challenges (mirrors the Pg semantics: consume is an atomic
  // delete scoped to realm + account, expiry deliberately NOT judged here) --

  private readonly stepUpChallenges = new Map<string, NewWocStepUpChallenge>();

  async createStepUpChallenge(row: NewWocStepUpChallenge): Promise<void> {
    if (this.stepUpChallenges.has(row.nonce)) throw new Error('duplicate step-up nonce');
    this.stepUpChallenges.set(row.nonce, structuredClone(row));
  }

  async consumeStepUpChallenge(
    realm: string,
    nonce: string,
    accountId: number,
  ): Promise<WocStepUpChallengeRow | null> {
    const row = this.stepUpChallenges.get(nonce);
    if (!row || row.realm !== realm || row.accountId !== accountId) return null;
    this.stepUpChallenges.delete(nonce);
    const { realm: _realm, ...rest } = row;
    return structuredClone(rest);
  }

  async pruneStepUpChallenges(realm: string, nowMs: number): Promise<number> {
    let pruned = 0;
    for (const [nonce, row] of this.stepUpChallenges) {
      if (row.realm === realm && row.expiresAtMs <= nowMs) {
        this.stepUpChallenges.delete(nonce);
        pruned += 1;
      }
    }
    return pruned;
  }

  /** Test hook: how many live challenge rows the store holds. */
  stepUpChallengeCount(): number {
    return this.stepUpChallenges.size;
  }

  async directedOffersForAccount(
    realm: string,
    account: number,
    nowMs: number = this.now(),
  ): Promise<WocDirectedOfferRow[]> {
    // Full Pg fidelity (the read used to return 'pending' rows only, which
    // hid the whole payment machinery from every fake-driven test):
    // pending AND accepted rows; a just-RESOLVED row (declined / withdrawn /
    // expired) for the grace window, so the non-resolving side can read the
    // verdict; the closed-listing grace clause; and the listing/settlement
    // join fields the arm derives its wocOfferPhase from. nowMs is the
    // service clock the seam passes (defaulted to the injected clock for the
    // direct callers in the fake's own suite), like the Pg read.
    const graceCutoffMs = nowMs - SETTLED_OFFER_GRACE_MS;
    return (
      [...this.offers.values()]
        .filter(
          (o) => o.realm === realm && (o.buyerAccount === account || o.sellerAccount === account),
        )
        .filter(
          (o) =>
            o.status === 'pending' ||
            o.status === 'accepted' ||
            (this.offerUpdatedMs.get(o.id) ?? 0) > graceCutoffMs,
        )
        .filter((o) => {
          if (o.listingId === null) return true;
          const l = this.listings.get(o.listingId);
          if (!l || l.status !== 'closed') return true;
          return (this.listingTouchMs.get(o.listingId) ?? 0) > graceCutoffMs;
        })
        // Mirror the Pg read's ORDER BY o.created_at DESC, o.id DESC LIMIT 50
        // (the id tiebreak is in the SQL too, so same-clock ties order the
        // same way here and there), so an ordering or truncation assumption
        // cannot pass here and fail against Postgres.
        .sort((a, b) => b.createdAtMs - a.createdAtMs || b.id - a.id)
        .slice(0, 50)
        .map((o) => {
          const l = o.listingId === null ? undefined : this.listings.get(o.listingId);
          const latest = [...this.settlements.values()]
            .filter((s) => s.listingId === o.listingId)
            .sort((a, b) => b.id - a.id)[0];
          // Deep copy per row (the header contract): a shallow spread would
          // alias the nested itemRef object to the store row, so a caller
          // mutating a returned offer would edit the fake's internal state
          // where Postgres hands back independently parsed rows.
          return {
            ...structuredClone(o),
            listingStatus: l?.status ?? null,
            listingResolution: l?.resolution ?? null,
            settlementState: o.listingId === null ? null : (latest?.state ?? null),
          };
        })
    );
  }

  async resolveDirectedOffer(
    realm: string,
    id: number,
    to: Exclude<WocDirectedOfferStatus, 'pending'>,
  ): Promise<WocDirectedOfferRow | null> {
    const row = this.offers.get(id);
    if (!row || row.realm !== realm) return null;
    // The compare-and-set. Without this the fake would let a second accept
    // through and the double-escrow test would pass against a fake that cannot
    // reproduce the race it is meant to prove is closed. The listing id is
    // NOT stamped here: escrowInsertListing owns the atomic stamp.
    if (row.status !== 'pending') return null;
    row.status = to;
    this.offerUpdatedMs.set(id, this.now());
    // Copy on the way out (the header contract): the store row stays private.
    return structuredClone(row);
  }

  async characterByName(
    realm: string,
    name: string,
  ): Promise<{ characterId: number; accountId: number; name: string } | null> {
    const c = this.characters.find((x) => x.name === name && x.realm === realm);
    return c ? { characterId: c.characterId, accountId: c.accountId, name: c.name } : null;
  }

  async acceptDirectedOfferSide(
    realm: string,
    id: number,
    side: 'buyer' | 'seller',
    itemRef: ExtractRef | null,
  ): Promise<WocDirectedOfferRow | null> {
    const row = this.offers.get(id);
    // Narrowed to pending, mirroring the real UPDATE: a resolved offer cannot
    // gain an acceptance, which is what stops a late click reviving one.
    if (!row || row.realm !== realm || row.status !== 'pending') return null;
    if (side === 'buyer') row.buyerAccepted = true;
    else row.sellerAccepted = true;
    // item_id stays the BUYER's agreed item (stamped at creation); only the
    // seller's claimed extraction ref is recorded, mirroring the real UPDATE.
    // Clone on the way IN and OUT: the real path serializes the ref to jsonb,
    // so neither the stored row nor the returned row may alias the caller's
    // live object.
    if (itemRef !== null) row.itemRef = structuredClone(itemRef);
    this.offerUpdatedMs.set(id, this.now());
    return structuredClone(row);
  }

  async reopenDirectedOffer(realm: string, id: number): Promise<boolean> {
    const row = this.offers.get(id);
    if (!row || row.realm !== realm || row.status !== 'accepted' || row.listingId !== null) {
      return false;
    }
    // The pair-bound guard: a reopen is an insert into the pair-pending
    // unique index, and a fresh offer may occupy the pair; the blocked
    // reopen NO-OPS and the converge arm expires the row at its TTL.
    for (const o of this.offers.values()) {
      if (
        o.id !== id &&
        o.realm === realm &&
        o.status === 'pending' &&
        o.buyerAccount === row.buyerAccount &&
        o.sellerAccount === row.sellerAccount
      ) {
        return false;
      }
    }
    // Reset the SELLER's acceptance and named item; keep the buyer's standing
    // consent. The seller must re-accept with a fresh step-up proof, mirroring
    // the Pg UPDATE.
    row.status = 'pending';
    row.sellerAccepted = false;
    row.itemRef = null;
    this.offerUpdatedMs.set(id, this.now());
    return true;
  }

  async expireDueDirectedOffers(realm: string, nowMs: number, limit: number): Promise<number> {
    let n = 0;
    for (const row of this.offers.values()) {
      if (n >= limit) break;
      if (row.realm === realm && row.status === 'pending' && row.expiresAtMs <= nowMs) {
        row.status = 'expired';
        this.offerUpdatedMs.set(row.id, this.now());
        n += 1;
      }
    }
    return n;
  }

  async acceptedUnstampedOffers(
    realm: string,
    olderThanMs: number,
    oldestAllowedMs: number,
    limit: number,
  ): Promise<{ id: number; expiresAtMs: number }[]> {
    return [...this.offers.values()]
      .filter(
        (o) =>
          o.realm === realm &&
          o.status === 'accepted' &&
          o.listingId === null &&
          (this.offerUpdatedMs.get(o.id) ?? 0) <= olderThanMs &&
          (this.offerUpdatedMs.get(o.id) ?? 0) > oldestAllowedMs,
      )
      .sort((a, b) => (this.offerUpdatedMs.get(a.id) ?? 0) - (this.offerUpdatedMs.get(b.id) ?? 0))
      .slice(0, limit)
      .map((o) => ({ id: o.id, expiresAtMs: o.expiresAtMs }));
  }

  async expireDirectedOfferIfUnstamped(realm: string, id: number): Promise<boolean> {
    const row = this.offers.get(id);
    if (row && row.realm === realm && row.status === 'accepted' && row.listingId === null) {
      row.status = 'expired';
      this.offerUpdatedMs.set(id, this.now());
      return true;
    }
    return false;
  }

  async everSettledForListing(listingId: number): Promise<boolean> {
    for (const s of this.settlements.values()) {
      if (s.listingId === listingId) return true;
    }
    return false;
  }

  async countActiveBySeller(realm: string, account: number): Promise<number> {
    let n = 0;
    for (const row of this.listings.values()) {
      // EVERY non-closed row counts, directed included, mirroring the widened
      // predicate in server/woc_market_db.ts (H12).
      if (row.realm === realm && row.sellerAccount === account && row.status !== 'closed') {
        n += 1;
      }
    }
    return n;
  }

  async cancelListingIfUnbid(
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
  > {
    const row = this.listings.get(id);
    if (!row || row.realm !== realm) return 'not_found';
    if (row.sellerAccount !== sellerAccount) return 'not_yours';
    if (row.status !== 'active') return 'not_active';
    for (const bid of this.bids.values()) {
      if (bid.listingId === id && (bid.status === 'pending_bond' || bid.status === 'active')) {
        return 'has_bids';
      }
    }
    if (
      row.buyNowLockAccount !== null &&
      row.buyNowLockExpiresMs !== null &&
      row.buyNowLockExpiresMs > nowMs
    ) {
      // Mirrors the Pg cancel-intent branch: a PAID window (any settlement
      // past 'offered') refuses; an unpaid one stamps and reports pending.
      for (const s of this.settlements.values()) {
        if (
          s.listingId === id &&
          OPEN_SETTLEMENT_STATES.includes(s.state) &&
          s.state !== 'offered'
        ) {
          return 'settlement_live';
        }
      }
      row.cancelRequestedAtMs = row.cancelRequestedAtMs ?? nowMs;
      this.touchListing(id);
      return 'cancel_pending';
    }
    // The Pg method expires 'failed' rows FIRST and rolls the expiry back via
    // TxAbort when the open check trips (its ordering exists for row-lock
    // serialization); single-threaded, check-then-expire is observably
    // identical because 'failed' is disjoint from the open set.
    for (const s of this.settlements.values()) {
      if (s.listingId === id && OPEN_SETTLEMENT_STATES.includes(s.state)) {
        return 'settlement_live';
      }
    }
    // A leftover 'failed' settlement is expired with the close, so its retry
    // arm cannot revive a payment against a cancelled listing.
    for (const s of this.settlements.values()) {
      if (s.listingId === id && s.state === 'failed') {
        s.state = 'expired';
        s.failReason = 'listing_cancelled';
        this.touchSettlement(s.id);
      }
    }
    row.status = 'closed';
    row.resolution = 'cancelled';
    this.touchListing(id);
    return this.listingOut(row);
  }

  async suspendListingIfSafe(
    realm: string,
    id: number,
    nowMs: number,
  ): Promise<
    WocListingRow | 'not_found' | 'not_active' | 'buy_now_pending' | 'settlement_live' | 'contended'
  > {
    const row = this.listings.get(id);
    if (!row || row.realm !== realm) return 'not_found';
    if (row.status === 'closed') return 'not_active';
    if (
      row.buyNowLockAccount !== null &&
      row.buyNowLockExpiresMs !== null &&
      row.buyNowLockExpiresMs > nowMs
    ) {
      return 'buy_now_pending';
    }
    // The blocking set DERIVES from the shared open list rather than
    // hand-copying it (a sixth open state must block here without a second
    // edit): everything open blocks except an expirable 'offered', and
    // 'offered' is only expirable while it holds NO live quote (a stamped,
    // unexpired quote means the buyer may already have broadcast payment).
    const expirableOffered = (s: SettlementRec): boolean =>
      s.state === 'offered' &&
      (s.quoteReference === null || s.quoteExpiresAtMs === null || s.quoteExpiresAtMs <= nowMs);
    for (const s of this.settlements.values()) {
      if (s.listingId === id && OPEN_SETTLEMENT_STATES.includes(s.state) && !expirableOffered(s)) {
        return 'settlement_live';
      }
    }
    for (const s of this.settlements.values()) {
      if (s.listingId === id && (expirableOffered(s) || s.state === 'failed')) {
        s.state = 'expired';
        s.failReason = 'listing_suspended';
        this.touchSettlement(s.id);
        // The Pg CTE releases the expired settlement's close-time WINNER in
        // the same statement: cancelled, held bond queued for refund (an
        // administrative expiry is not the buyer's fault; the deadline pass
        // is the one that defaults and forfeits).
        if (s.bidId !== null) {
          const winner = this.bids.get(s.bidId);
          if (winner && winner.status === 'won') {
            winner.status = 'cancelled';
            if (winner.bondState === 'held') winner.bondState = 'refund_due';
          }
        }
      }
    }
    for (const bid of this.bids.values()) {
      if (bid.listingId === id && (bid.status === 'pending_bond' || bid.status === 'active')) {
        // Mirrors the real teardown's paid-but-undecided carve-out: a signed,
        // unheld bond stays with the bond poll instead of being cancelled out
        // of the polling set.
        if (
          bid.status === 'pending_bond' &&
          bid.bondSignature !== null &&
          bid.bondState === 'pending'
        ) {
          continue;
        }
        bid.status = 'cancelled';
        if (bid.bondState === 'held') bid.bondState = 'refund_due';
      }
    }
    row.status = 'closed';
    row.resolution = 'suspended';
    this.touchListing(id);
    return this.listingOut(row);
  }

  async claimDueListings(realm: string, nowMs: number, limit: number): Promise<WocListingRow[]> {
    const due = [...this.listings.values()]
      .filter((row) => row.realm === realm && row.status === 'active' && row.endsAtMs <= nowMs)
      .sort((a, b) => a.endsAtMs - b.endsAtMs || a.id - b.id)
      .slice(0, limit);
    for (const row of due) {
      row.status = 'ending';
      this.touchListing(row.id);
    }
    return due.map((r) => this.listingOut(r));
  }

  async closeListing(id: number, resolution: WocListingResolution): Promise<void> {
    const row = this.listings.get(id);
    if (!row || row.status === 'closed') return;
    row.status = 'closed';
    row.resolution = resolution;
    this.touchListing(id);
  }

  async closeListingIfNoOpenSettlement(
    id: number,
    resolution: WocListingResolution,
  ): Promise<boolean> {
    const row = this.listings.get(id);
    if (!row || row.status === 'closed') return false;
    for (const s of this.settlements.values()) {
      if (s.listingId === id && OPEN_SETTLEMENT_STATES.includes(s.state)) return false;
    }
    row.status = 'closed';
    row.resolution = resolution;
    this.touchListing(id);
    return true;
  }

  async markListingSettling(id: number): Promise<void> {
    const row = this.listings.get(id);
    if (!row) return;
    if (row.status === 'ending' || row.status === 'active' || row.status === 'settling') {
      row.status = 'settling';
      this.touchListing(id);
    }
  }

  async undisposedClosedListings(
    realm: string,
    limit: number,
    excludeIds: readonly number[],
  ): Promise<WocListingRow[]> {
    // Mirrors the Pg predicate: sold rows never enter the return backlog (a
    // sold undisposed row is stuck residue the readout surfaces instead),
    // and the caller's backing-off parked rows are excluded in the READ.
    const excluded = new Set(excludeIds);
    return [...this.listings.values()]
      .filter(
        (row) =>
          row.realm === realm &&
          row.status === 'closed' &&
          !row.itemDisposed &&
          !excluded.has(row.id) &&
          // Mirrors the SQL's (resolution IS NULL OR resolution <> 'sold'):
          // in SQL the IS NULL arm is load-bearing (NULL <> 'sold' is NULL);
          // in TS the inequality already covers null, so one arm suffices.
          row.resolution !== 'sold',
      )
      .sort(this.byRotation(this.listingParkedMs, this.listingTouchMs))
      .slice(0, limit)
      .map((r) => this.listingOut(r));
  }

  async strandedListings(
    realm: string,
    olderThanMs: number,
    limit: number,
  ): Promise<WocListingRow[]> {
    // updated_at mirror: listingTouchMs is stamped by touchListing on every
    // mutation, exactly where the Pg UPDATEs set updated_at = now().
    return [...this.listings.values()]
      .filter(
        (row) =>
          row.realm === realm &&
          (row.status === 'ending' || row.status === 'settling') &&
          (this.listingTouchMs.get(row.id) ?? 0) <= olderThanMs,
      )
      .sort(this.byTouch(this.listingTouchMs))
      .slice(0, limit)
      .map((r) => this.listingOut(r));
  }

  async reopenListing(id: number): Promise<void> {
    const row = this.listings.get(id);
    if (!row) return;
    // Fail-closed: an open OR retry-eligible 'failed' settlement refuses the
    // reopen (the Pg statement carries the same NOT EXISTS predicate; the
    // failed row belongs to the overdue sweep's default pass).
    for (const s of this.settlements.values()) {
      if (
        s.listingId === id &&
        (OPEN_SETTLEMENT_STATES.includes(s.state) || s.state === 'failed')
      ) {
        return;
      }
    }
    if (row.status === 'ending' || row.status === 'settling') {
      row.status = 'active';
      this.touchListing(id);
    }
  }

  async claimCustodyRef(realm: string, custodyRef: string): Promise<boolean> {
    // ON CONFLICT (custody_ref) DO NOTHING: only the FIRST claim inserts.
    if (this.custodyClaims.has(custodyRef)) return false;
    this.custodyClaims.set(custodyRef, {
      realm,
      claimedAtMs: this.now(),
      bookedAtMs: null,
      grantCharacterId: null,
      mailIntentAtMs: null,
    });
    return true;
  }

  /** Throw ONCE on the next booking (the crash window between the mail write
   *  and the booking; consumed on use). */
  failNextMarkBooked = false;

  async markCustodyRefBooked(custodyRef: string): Promise<void> {
    if (this.failNextMarkBooked) {
      this.failNextMarkBooked = false;
      throw new Error('booking failed');
    }
    const claim = this.custodyClaims.get(custodyRef);
    if (claim && claim.bookedAtMs === null) claim.bookedAtMs = this.now();
  }

  async custodyRefState(custodyRef: string): Promise<WocCustodyRefState | null> {
    const claim = this.custodyClaims.get(custodyRef);
    if (!claim) return null;
    return {
      booked: claim.bookedAtMs !== null,
      grantCharacterId: claim.grantCharacterId,
      mailIntent: claim.mailIntentAtMs !== null,
    };
  }

  async markCustodyGrantIntent(custodyRef: string, characterId: number): Promise<boolean> {
    // The Pg UPDATE is guarded on booked_at IS NULL, and matching no row is
    // the caller's park signal.
    const claim = this.custodyClaims.get(custodyRef);
    if (!claim || claim.bookedAtMs !== null) return false;
    claim.grantCharacterId = characterId;
    return true;
  }

  async markCustodyMailIntent(custodyRef: string): Promise<boolean> {
    // One statement in Pg: stamp the mail intent AND withdraw any grant
    // intent (the only legal conversion follows a grantCopy refusal).
    const claim = this.custodyClaims.get(custodyRef);
    if (!claim || claim.bookedAtMs !== null) return false;
    claim.mailIntentAtMs = this.now();
    claim.grantCharacterId = null;
    return true;
  }

  /** Outcome forcing for the atomic save-and-book edge, consumed on use.
   *  'lease_lost' models the fence (nothing lands); 'throw' models a
   *  transient failure whose transaction never committed; 'throw_after_commit'
   *  models the ambiguous case (the booking COMMITTED, then the reply was
   *  lost), which is exactly what booked_at exists to resolve. */
  failNextDeliveredSave: 'lease_lost' | 'throw' | 'throw_after_commit' | null = null;
  /** Every atomic save-and-book the delivery edge received, in order. */
  readonly deliveredSaves: CharacterSaveArgs[] = [];

  async saveDeliveredCharacterBooked(
    save: CharacterSaveArgs,
    custodyRef: string,
  ): Promise<'booked' | 'lease_lost' | 'claim_missing'> {
    this.deliveredSaves.push(structuredClone(save));
    const forced = this.failNextDeliveredSave;
    this.failNextDeliveredSave = null;
    if (forced === 'lease_lost') return 'lease_lost';
    if (forced === 'throw') throw new Error('delivered save failed');
    const claim = this.custodyClaims.get(custodyRef);
    if (!claim || claim.bookedAtMs !== null) return 'claim_missing';
    claim.bookedAtMs = this.now();
    if (forced === 'throw_after_commit') throw new Error('delivered save reply lost');
    return 'booked';
  }

  async stuckCustodyReadout(
    realm: string,
    olderThanMs: number,
    sampleLimit: number,
    countCap: number,
    bondOlderThanMs: number,
  ): Promise<WocStuckCustodyClasses> {
    // Counts SATURATE at countCap, mirroring the Pg inner-LIMIT subqueries,
    // and the cap fails CLOSED to 1 exactly like the Pg clamp.
    const cap = Number.isFinite(countCap) && countCap >= 1 ? Math.trunc(countCap) : 1;
    // Age signals mirror the Pg predicates: rotation (the parked maps) never
    // moves them, so a permanently parked row still ages into the readout;
    // the delivering class ages on the updated_at mirror stamped when the
    // row ENTERED 'delivering'.
    const claims = [...this.custodyClaims.entries()]
      .filter(([, c]) => c.realm === realm && c.bookedAtMs === null && c.claimedAtMs <= olderThanMs)
      .sort((a, b) => a[1].claimedAtMs - b[1].claimedAtMs || a[0].localeCompare(b[0]));
    const delivering = [...this.settlements.values()]
      .filter(
        (s) =>
          s.realm === realm &&
          s.state === 'delivering' &&
          (this.settlementTouchMs.get(s.id) ?? 0) <= olderThanMs,
      )
      .sort(this.byTouch(this.settlementTouchMs));
    const undisposed = [...this.listings.values()]
      .filter(
        (l) =>
          l.realm === realm &&
          l.status === 'closed' &&
          !l.itemDisposed &&
          (this.listingTouchMs.get(l.id) ?? 0) <= olderThanMs,
      )
      .sort(this.byTouch(this.listingTouchMs));
    // 'review' rows carry NO age filter (the sweep's bound already aged them);
    // stuck bonds age on the signature recording (placement for legacy rows)
    // past the caller's bond cutoff, the Pg COALESCE mirror.
    const review = [...this.settlements.values()]
      .filter((s) => s.realm === realm && s.state === 'review')
      .sort(this.byTouch(this.settlementTouchMs));
    const bondStuckSince = (b: { bondSignatureAtMs: number | null; placedAtMs: number }) =>
      b.bondSignatureAtMs ?? b.placedAtMs;
    const stuckBonds = [...this.bids.values()]
      .filter(
        (b) =>
          b.realm === realm &&
          b.status === 'pending_bond' &&
          b.bondSignature !== null &&
          bondStuckSince(b) <= bondOlderThanMs,
      )
      // The SAMPLE orders on placed_at like the real query (the COALESCE age
      // axis had no expression index; the real docblock concedes the axes can
      // diverge by minutes while stuck_since still reports the honest age per
      // row). The id tiebreak is the documented determinism aid.
      .sort((a, b) => a.placedAtMs - b.placedAtMs || a.id - b.id);
    return {
      unbookedClaims: {
        count: Math.min(claims.length, cap),
        saturated: claims.length >= cap,
        sample: claims.slice(0, sampleLimit).map(([ref, c]) => ({
          custodyRef: ref,
          claimedAtMs: c.claimedAtMs,
          grantCharacterId: c.grantCharacterId,
          mailIntent: c.mailIntentAtMs !== null,
        })),
      },
      stuckDelivering: {
        count: Math.min(delivering.length, cap),
        saturated: delivering.length >= cap,
        sample: delivering.slice(0, sampleLimit).map((s) => ({
          id: s.id,
          listingId: s.listingId,
          createdAtMs: s.createdAtMs,
          updatedAtMs: this.settlementTouchMs.get(s.id) ?? 0,
        })),
      },
      undisposedListings: {
        count: Math.min(undisposed.length, cap),
        saturated: undisposed.length >= cap,
        sample: undisposed.slice(0, sampleLimit).map((l) => ({
          id: l.id,
          resolution: l.resolution,
          updatedAtMs: this.listingTouchMs.get(l.id) ?? 0,
        })),
      },
      reviewSettlements: {
        count: Math.min(review.length, cap),
        saturated: review.length >= cap,
        sample: review.slice(0, sampleLimit).map((s) => ({
          id: s.id,
          listingId: s.listingId,
          createdAtMs: s.createdAtMs,
          updatedAtMs: this.settlementTouchMs.get(s.id) ?? 0,
        })),
      },
      stuckBonds: {
        count: Math.min(stuckBonds.length, cap),
        saturated: stuckBonds.length >= cap,
        sample: stuckBonds.slice(0, sampleLimit).map((b) => ({
          id: b.id,
          listingId: b.listingId,
          account: b.account,
          placedAtMs: b.placedAtMs,
          stuckSinceMs: bondStuckSince(b),
        })),
      },
    };
  }

  async markItemDisposed(id: number): Promise<void> {
    const row = this.listings.get(id);
    if (!row) return;
    row.itemDisposed = true;
    this.touchListing(id);
    // Terminal transition clears the rotation stamp (mirrors the SQL).
    this.listingParkedMs.delete(id);
  }

  async claimBuyNowLock(
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
    | { refusal: 'claim_cooldown'; retryAtMs: number }
    | 'contended'
  > {
    const row = this.listings.get(id);
    // Mirror the Pg diagnosis order for a precise client error.
    if (!row || row.realm !== realm) return 'not_found';
    if (row.sellerAccount === account) return 'own_listing';
    if (row.status !== 'active') return 'not_active';
    if (row.buyNowCents === null) return 'no_buy_now';
    if (row.cancelRequestedAtMs !== null) return 'cancel_pending';
    const lockHeld =
      row.buyNowLockAccount !== null &&
      row.buyNowLockExpiresMs !== null &&
      row.buyNowLockExpiresMs > nowMs;
    if (lockHeld) return 'locked';
    // An OPEN settlement outlives its lock window: refuse and record NOTHING
    // (the Pg probe's mirror; a rival's claim must not stamp a paying buyer).
    for (const s of this.settlements.values()) {
      if (s.listingId === id && OPEN_SETTLEMENT_STATES.includes(s.state)) return 'locked';
    }
    // Both cooldown arms probed with the LATER retry moment winning,
    // mirroring the Pg cooldownRefused helper both passes share.
    const cooldownRetryAtMs = (): number | null => {
      const reclaimCutoff = nowMs - WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS * 1000;
      const windowCutoff = nowMs - WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS * 1000;
      const mine = this.buyNowAbandons.filter((a) => a.realm === realm && a.account === account);
      const reclaimHits = mine.filter((a) => a.listingId === id && a.lockExpiresMs > reclaimCutoff);
      const reclaimAtMs =
        reclaimHits.length === 0
          ? null
          : Math.max(...reclaimHits.map((a) => a.lockExpiresMs)) +
            WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS * 1000;
      const inWindow = mine
        .filter((a) => a.lockExpiresMs > windowCutoff)
        .sort((a, b) => b.lockExpiresMs - a.lockExpiresMs);
      const capBoundary =
        inWindow.length >= WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR
          ? inWindow[WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR - 1].lockExpiresMs
          : null;
      const capDrainsAtMs =
        capBoundary === null
          ? null
          : capBoundary + WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS * 1000;
      if (reclaimAtMs === null && capDrainsAtMs === null) return null;
      return Math.max(reclaimAtMs ?? 0, capDrainsAtMs ?? 0);
    };
    // The ADVISORY pass mirror: on a public listing with NO standing lock the
    // cooldown answers lock-free BEFORE the transaction's twin re-check runs.
    if (row.buyNowLockAccount === null && row.directedBuyerAccount === null) {
      const retryAtMs = cooldownRetryAtMs();
      if (retryAtMs !== null) return { refusal: 'claim_cooldown', retryAtMs };
    }
    // The same-wallet twin guard (the relink dance): the Pg transaction
    // re-reads wallet_links under the listing lock and its claiming UPDATE
    // carries the NOT EXISTS twin predicate. Tests seed walletLinks directly.
    if (
      typeof row.sellerWallet === 'string' &&
      this.walletLinks.get(account) === row.sellerWallet
    ) {
      return 'own_listing';
    }
    // Steal-time abandon recording (public only), then the in-transaction
    // cooldown re-check, mirroring the Pg order so a self-steal refuses in
    // the same call.
    if (
      row.buyNowLockAccount !== null &&
      row.buyNowLockExpiresMs !== null &&
      row.directedBuyerAccount === null
    ) {
      this.recordAbandon(realm, id, row.buyNowLockAccount, row.buyNowLockExpiresMs);
    }
    if (row.directedBuyerAccount === null) {
      const retryAtMs = cooldownRetryAtMs();
      if (retryAtMs !== null) return { refusal: 'claim_cooldown', retryAtMs };
    }
    row.buyNowLockAccount = account;
    row.buyNowLockExpiresMs = expiresAtMs;
    this.touchListing(id);
    return this.listingOut(row);
  }

  /** Holder-guarded, mirroring the Pg UPDATE's WHERE. */
  async clearBuyNowLock(id: number, holderAccount: number): Promise<void> {
    const row = this.listings.get(id);
    if (!row || row.buyNowLockAccount !== holderAccount) return;
    row.buyNowLockAccount = null;
    row.buyNowLockExpiresMs = null;
    this.touchListing(id);
  }

  /** The in-memory abandon ledger, deduped on the (listing, account,
   *  lock_expires) window key like the real unique index, with the shared
   *  exempt-window predicate (RECORD_ABANDON_SQL's NOT EXISTS): a window
   *  whose settlement carries a signature AND a chain-plausible refusal
   *  class records nothing. A bare signature does NOT exempt. */
  private recordAbandon(
    realm: string,
    listingId: number,
    account: number,
    lockExpiresMs: number,
  ): void {
    for (const s of this.settlements.values()) {
      if (
        s.listingId === listingId &&
        s.buyerAccount === account &&
        s.deadlineAtMs === lockExpiresMs &&
        s.txSignature !== null &&
        s.failReason !== null &&
        (WOC_MARKET_ABANDON_EXEMPT_FAIL_REASONS as readonly string[]).includes(s.failReason)
      ) {
        return;
      }
    }
    if (
      this.buyNowAbandons.some(
        (a) =>
          a.listingId === listingId && a.account === account && a.lockExpiresMs === lockExpiresMs,
      )
    ) {
      return;
    }
    this.buyNowAbandons.push({ realm, listingId, account, lockExpiresMs });
  }

  async recordBuyNowAbandon(
    realm: string,
    listingId: number,
    account: number,
    lockExpiresAtMs: number,
  ): Promise<void> {
    this.recordAbandon(realm, listingId, account, lockExpiresAtMs);
  }

  async cancelPendingListings(
    realm: string,
    nowMs: number,
    limit: number,
    excludeIds: readonly number[],
  ): Promise<WocListingRow[]> {
    // Mirrors the Pg read: rotation order (COALESCE(sweep_parked_at,
    // updated_at) via the parked/touch maps) plus the caller's backoff
    // exclusion.
    const excluded = new Set(excludeIds);
    return [...this.listings.values()]
      .filter(
        (l) =>
          l.realm === realm &&
          l.status === 'active' &&
          l.cancelRequestedAtMs !== null &&
          !excluded.has(l.id) &&
          (l.buyNowLockAccount === null ||
            l.buyNowLockExpiresMs === null ||
            l.buyNowLockExpiresMs <= nowMs),
      )
      .sort(this.byRotation(this.listingParkedMs, this.listingTouchMs))
      .slice(0, limit)
      .map((l) => this.listingOut(l));
  }

  async closeCancelPendingListing(
    realm: string,
    id: number,
    nowMs: number,
  ): Promise<WocListingRow | 'skip' | 'contended'> {
    // Recorded so tests can see which rows a pass ATTEMPTED (the backoff
    // exclusion is otherwise invisible from outside).
    this.cancelConvergeAttempts.push(id);
    if (this.failNextCancelConverge !== null) {
      this.failNextCancelConverge = null;
      return 'contended';
    }
    const row = this.listings.get(id);
    if (
      !row ||
      row.realm !== realm ||
      row.status !== 'active' ||
      row.cancelRequestedAtMs === null
    ) {
      return 'skip';
    }
    if (
      row.buyNowLockAccount !== null &&
      row.buyNowLockExpiresMs !== null &&
      row.buyNowLockExpiresMs > nowMs
    ) {
      return 'skip';
    }
    for (const bid of this.bids.values()) {
      if (bid.listingId === id && (bid.status === 'pending_bond' || bid.status === 'active')) {
        return 'skip';
      }
    }
    // The Pg method expires 'failed' rows then rolls the expiry back via
    // TxAbort when the open check trips; single-threaded, check-then-expire
    // is observably identical (the cancelListingIfUnbid fake's rationale).
    // That equivalence DEPENDS on 'failed' staying outside
    // OPEN_SETTLEMENT_STATES: if that set ever gained 'failed', Pg would
    // expire-and-proceed where this skips, silently.
    for (const s of this.settlements.values()) {
      if (s.listingId === id && OPEN_SETTLEMENT_STATES.includes(s.state)) return 'skip';
    }
    for (const s of this.settlements.values()) {
      if (s.listingId === id && s.state === 'failed') {
        s.state = 'expired';
        s.failReason = 'listing_cancelled';
        this.touchSettlement(s.id);
      }
    }
    row.status = 'closed';
    row.resolution = 'cancelled';
    this.touchListing(id);
    return this.listingOut(row);
  }

  // -------------------------------------------------------------------------
  // Bids
  // -------------------------------------------------------------------------

  async insertPendingBid(args: {
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
          | 'already_pending';
      }
  > {
    const row = this.listings.get(args.listingId);
    if (!row || row.realm !== args.realm) return { ok: false, reason: 'not_found' };
    // The callbacks see the row as it was read (a copy), the Pg SELECT shape.
    const snapshot = this.listingOut(row);
    // A directed sale accepts NO bids, refused not_found before any other
    // verdict (mirrors the Pg anti-enumeration guard).
    if (snapshot.directedBuyerAccount !== null) return { ok: false, reason: 'not_found' };
    if (snapshot.status !== 'active') return { ok: false, reason: 'not_active' };
    if (snapshot.endsAtMs <= args.nowMs) return { ok: false, reason: 'not_active' };
    // Cancel-intent blocks new bids (mirrors the Pg guard).
    if (snapshot.cancelRequestedAtMs !== null) return { ok: false, reason: 'cancel_pending' };
    if (snapshot.sellerAccount === args.account) return { ok: false, reason: 'own_listing' };
    // One wallet is one bidder: a seller cannot bid through a second account
    // sharing the payout wallet.
    if (snapshot.sellerWallet === args.wallet) return { ok: false, reason: 'own_listing' };
    if (args.amountCents < args.minNext(snapshot)) return { ok: false, reason: 'bid_too_low' };
    for (const bid of this.bids.values()) {
      if (
        bid.listingId === args.listingId &&
        bid.account === args.account &&
        bid.status === 'pending_bond'
      ) {
        return { ok: false, reason: 'already_pending' };
      }
    }
    const id = this.nextBidId++;
    const rec: BidRec = {
      id,
      realm: args.realm,
      listingId: args.listingId,
      account: args.account,
      characterId: args.characterId,
      characterName: args.characterName,
      wallet: args.wallet,
      amountCents: args.amountCents,
      status: 'pending_bond',
      bondCents: args.bondCents,
      bondState: 'pending',
      bondReference: null,
      bondQuoteExpiresAtMs: null,
      bondSignature: null,
      bondSignatureAtMs: null,
      placedAtMs: args.nowMs,
    };
    this.bids.set(id, rec);
    // Placement does NOT extend the auction (the extension moved to bond
    // progress: extendAuctionForBondProgress below), matching Pg.
    return { ok: true, bid: this.bidOut(rec) };
  }

  /** Mirrors the Pg arm: the callback sees the listing as read (a copy), and
   *  only an 'active' listing extends. */
  async extendAuctionForBondProgress(
    realm: string,
    listingId: number,
    extendEndsToMs: (row: WocListingRow) => number | null,
  ): Promise<'extended' | 'skip' | 'contended'> {
    const row = this.listings.get(listingId);
    if (!row || row.realm !== realm || row.status !== 'active') return 'skip';
    const extended = extendEndsToMs(this.listingOut(row));
    if (extended === null) return 'skip';
    row.endsAtMs = extended;
    this.touchListing(row.id);
    return 'extended';
  }

  /** Mirrors the real UPDATE: narrowed to pending_bond, idempotent on the same
   *  signature, and refusing one already recorded against a DIFFERENT bid (the
   *  unique index's 23505). Success returns the STAMPED first-arrival moment
   *  (the RETURNING mirror), the caller's extension anchor. */
  async submitBondSignature(
    bidId: number,
    signature: string,
    nowMs: number,
    // 'contended' joins the declared union for interface parity (the fake
    // itself never contends; tests stub the member to drive the arm).
  ): Promise<{ signatureAtMs: number } | 'not_pending' | 'signature_reused' | 'contended'> {
    const bid = this.bids.get(bidId);
    if (!bid || bid.status !== 'pending_bond') return 'not_pending';
    if (bid.bondSignature !== null && bid.bondSignature !== signature) return 'not_pending';
    // The reuse verdict comes from the unique index, which Pg consults only
    // when the guarded UPDATE actually matched: a dead bid answers
    // not_pending even when the signature is spent elsewhere.
    for (const [id, other] of this.bids) {
      if (id !== bidId && other.bondSignature === signature) return 'signature_reused';
    }
    // COALESCE mirror: the first recording moment wins across resubmits, and
    // a legacy-shaped row (signature set, stamp null) falls back to
    // placement, never the resubmit's clock.
    const hadSignature = bid.bondSignature !== null;
    bid.bondSignature = signature;
    bid.bondSignatureAtMs = bid.bondSignatureAtMs ?? (hadSignature ? bid.placedAtMs : nowMs);
    return { signatureAtMs: bid.bondSignatureAtMs };
  }

  async confirmingBonds(
    realm: string,
    limit: number,
    excludeIds: readonly number[],
  ): Promise<WocBidRow[]> {
    // Mirrors the Pg rotation order (COALESCE(poll_parked_at, placed_at))
    // and the caller's backoff exclusion. The id tiebreak is the fake's own
    // determinism aid; the Pg ORDER BY has none (ties are planner order).
    const excluded = new Set(excludeIds);
    return [...this.bids.values()]
      .filter(
        (b) =>
          b.realm === realm &&
          b.status === 'pending_bond' &&
          b.bondSignature !== null &&
          !excluded.has(b.id),
      )
      .sort(
        (a, b) =>
          (this.bidPollParkedMs.get(a.id) ?? a.placedAtMs) -
            (this.bidPollParkedMs.get(b.id) ?? b.placedAtMs) || a.id - b.id,
      )
      .slice(0, limit)
      .map((b) => this.bidOut(b));
  }

  /** Rotate one bond to the poll tail (the Pg poll_parked_at mirror). */
  async touchBidPollRow(id: number): Promise<void> {
    if (this.bids.has(id)) this.bidPollParkedMs.set(id, this.now());
  }

  async lapseBid(bidId: number): Promise<boolean> {
    const bid = this.bids.get(bidId);
    // The held carve-out mirror: a held bond never voids on a late
    // contradictory verdict (see PgWocMarketDb.lapseBid).
    if (!bid || bid.status !== 'pending_bond' || bid.bondState !== 'pending') return false;
    bid.status = 'lapsed';
    bid.bondState = 'void';
    return true;
  }

  /** Mirrors the real CAS: a quote applies only to an UNPAID bond (status
   *  pending_bond AND no recorded signature); false = nothing written. The
   *  adopted service bondCents rides the same write, like the real UPDATE. */
  async setBidBondQuote(
    bidId: number,
    reference: string,
    expiresAtMs: number,
    bondCents: number,
  ): Promise<boolean> {
    const bid = this.bids.get(bidId);
    if (!bid || bid.status !== 'pending_bond' || bid.bondSignature !== null) return false;
    bid.bondReference = reference;
    bid.bondQuoteExpiresAtMs = expiresAtMs;
    bid.bondCents = bondCents;
    return true;
  }

  async bidById(id: number): Promise<WocBidRow | null> {
    const bid = this.bids.get(id);
    return bid ? this.bidOut(bid) : null;
  }

  /** Mirrors the real UPDATE's predicate exactly (realm + id + account +
   *  status + no recorded signature). A fake that checked fewer arms would let
   *  the service's tests pass over SQL that never matched, which this suite
   *  has been bitten by before. */
  async abandonPendingBid(realm: string, bidId: number, account: number): Promise<boolean> {
    const bid = this.bids.get(bidId);
    if (!bid || bid.realm !== realm || bid.account !== account || bid.status !== 'pending_bond') {
      return false;
    }
    if (bid.bondSignature !== null) return false;
    bid.status = 'cancelled';
    bid.bondState = 'void';
    return true;
  }

  async activateBid(
    bidId: number,
    nowMs: number,
  ): Promise<'activated' | 'superseded' | 'listing_closed' | 'not_pending'> {
    const bid = this.bids.get(bidId);
    if (!bid || bid.status !== 'pending_bond') return 'not_pending';
    const supersede = (): void => {
      bid.status = 'outbid';
      if (bid.bondState === 'held') bid.bondState = 'refund_due';
    };
    const listing = this.listings.get(bid.listingId);
    if (!listing) {
      supersede();
      return 'listing_closed';
    }
    if (listing.status !== 'active' || listing.endsAtMs <= nowMs) {
      supersede();
      return 'listing_closed';
    }
    if (listing.currentBidCents !== null && bid.amountCents <= listing.currentBidCents) {
      supersede();
      return 'superseded';
    }
    if (listing.currentBidId !== null) {
      const previous = this.bids.get(listing.currentBidId);
      if (previous && previous.status === 'active') {
        previous.status = 'outbid';
        if (previous.bondState === 'held') previous.bondState = 'refund_due';
      }
    }
    bid.status = 'active';
    listing.currentBidCents = bid.amountCents;
    listing.currentBidId = bidId;
    this.touchListing(listing.id);
    return 'activated';
  }

  async markBondHeld(bidId: number): Promise<void> {
    const bid = this.bids.get(bidId);
    if (bid && bid.bondState === 'pending') bid.bondState = 'held';
  }

  async lapsePendingBids(realm: string, cutoffMs: number, limit: number): Promise<number> {
    const due = [...this.bids.values()]
      .filter(
        (bid) =>
          bid.realm === realm &&
          bid.status === 'pending_bond' &&
          bid.placedAtMs <= cutoffMs &&
          // A signed bond is PAID and merely awaiting the chain: the real SQL
          // excludes it, and a fake that reaped it would hide the very defect
          // this arm exists to prevent.
          bid.bondSignature === null,
      )
      .sort((a, b) => a.placedAtMs - b.placedAtMs || a.id - b.id)
      .slice(0, limit);
    for (const bid of due) {
      bid.status = 'lapsed';
      bid.bondState = 'void';
    }
    return due.length;
  }

  async bidsByAccount(realm: string, account: number, limit: number): Promise<WocActivityBidRow[]> {
    // Item-named like the Pg read; empty string when the listing is gone.
    return [...this.bids.values()]
      .filter((bid) => bid.realm === realm && bid.account === account)
      .sort((a, b) => b.placedAtMs - a.placedAtMs || b.id - a.id)
      .slice(0, limit)
      .map((b) => ({ ...this.bidOut(b), itemId: this.listings.get(b.listingId)?.itemId ?? '' }));
  }

  async bidsForListing(listingId: number): Promise<WocBidRow[]> {
    return [...this.bids.values()]
      .filter((bid) => bid.listingId === listingId)
      .sort((a, b) => b.amountCents - a.amountCents || a.placedAtMs - b.placedAtMs || a.id - b.id)
      .map((b) => this.bidOut(b));
  }

  async nextCascadeBidder(listingId: number, minCents: number): Promise<WocBidRow | null> {
    // Selection only, like the Pg SELECT: the 'won' stamp rides the
    // settlement insert (insertSettlement winnerBidId). Prior winners are
    // derived here exactly like the real NOT EXISTS: an account with ANY
    // 'won' or 'defaulted' bid on the listing is excluded, even when its
    // candidate row is an eligible 'outbid'.
    const priorWinners = new Set(
      [...this.bids.values()]
        .filter(
          (b) => b.listingId === listingId && (b.status === 'won' || b.status === 'defaulted'),
        )
        .map((b) => b.account),
    );
    const next = [...this.bids.values()]
      .filter(
        (bid) =>
          bid.listingId === listingId &&
          bid.status === 'outbid' &&
          bid.amountCents >= minCents &&
          !priorWinners.has(bid.account),
      )
      .sort(
        (a, b) => b.amountCents - a.amountCents || a.placedAtMs - b.placedAtMs || a.id - b.id,
      )[0];
    if (!next) return null;
    return this.bidOut(next);
  }

  async markBidStatus(bidId: number, status: WocBidStatus, from?: WocBidStatus[]): Promise<void> {
    const bid = this.bids.get(bidId);
    if (!bid) return;
    if (from && !from.includes(bid.status)) return;
    bid.status = status;
  }

  async markBidOutbidQueueRefund(bidId: number): Promise<void> {
    // One statement in Pg: outbid + queue the held bond, CAS from 'active'.
    const bid = this.bids.get(bidId);
    if (!bid || bid.status !== 'active') return;
    bid.status = 'outbid';
    if (bid.bondState === 'held') bid.bondState = 'refund_due';
  }

  async setBondState(bidId: number, from: WocBondState[], to: WocBondState): Promise<boolean> {
    const bid = this.bids.get(bidId);
    if (!bid || !from.includes(bid.bondState)) return false;
    bid.bondState = to;
    return true;
  }

  async bondsDue(realm: string, limit: number): Promise<WocBidRow[]> {
    return [...this.bids.values()]
      .filter(
        (bid) =>
          bid.realm === realm &&
          (bid.bondState === 'refund_due' || bid.bondState === 'forfeit_due'),
      )
      .sort((a, b) => a.placedAtMs - b.placedAtMs || a.id - b.id)
      .slice(0, limit)
      .map((b) => this.bidOut(b));
  }

  // -------------------------------------------------------------------------
  // Settlements
  // -------------------------------------------------------------------------

  /** Force the NEXT finalize verdict (consumed on use): 'contended' models a
   *  lock-timeout loser, 'stale' models a hand-moved row vanishing between
   *  the batch read and the transaction (only an operator can produce it). */
  failNextFinalize: 'contended' | 'stale' | null = null;

  async finalizeDeliveredSettlement(args: {
    settlementId: number;
    listingId: number;
    bidId: number | null;
    sale: Omit<WocSaleRow, 'id' | 'excluded' | 'atMs'>;
  }): Promise<'finalized' | 'already_final' | 'stale' | 'contended'> {
    if (this.failNextFinalize) {
      const forced = this.failNextFinalize;
      this.failNextFinalize = null;
      return forced;
    }
    const rec = this.settlements.get(args.settlementId);
    const listing = this.listings.get(args.listingId);
    if (!rec || !listing) return 'stale';
    // The CAS accepts 'delivered' too: that is what makes the re-drive and a
    // re-run converge (mirrors the Pg transaction).
    if (rec.state !== 'delivering' && rec.state !== 'delivered') return 'stale';
    rec.state = 'delivered';
    this.touchSettlement(rec.id);
    // Terminal transition clears the rotation stamp (mirrors the SQL).
    this.settlementParkedMs.delete(rec.id);
    // ON CONFLICT (listing_id) WHERE excluded = false DO NOTHING.
    const standing = [...this.sales.values()].some(
      (s) => s.listingId === args.listingId && !s.excluded,
    );
    if (!standing) {
      const id = this.nextSaleId++;
      this.sales.set(id, {
        ...structuredClone(args.sale),
        id,
        excluded: false,
        atMs: this.now(),
      });
    }
    // The close is a real compare-and-set (mirrors the Pg WHERE): a listing
    // already closed AND disposed downgrades the whole run to already_final.
    const closedNow = listing.status !== 'closed' || !listing.itemDisposed;
    if (listing.status !== 'closed') {
      listing.status = 'closed';
      listing.resolution = 'sold';
    }
    listing.itemDisposed = true;
    if (closedNow) {
      this.touchListing(listing.id);
      this.listingParkedMs.delete(listing.id);
    }
    if (args.bidId !== null) {
      const winner = this.bids.get(args.bidId);
      if (winner && winner.bondState === 'held') winner.bondState = 'refund_due';
    }
    for (const bid of this.bids.values()) {
      if (
        bid.listingId === args.listingId &&
        (bid.status === 'pending_bond' || bid.status === 'active')
      ) {
        // Mirrors the real teardown's paid-but-undecided carve-out: a signed,
        // unheld bond stays with the bond poll instead of being cancelled out
        // of the polling set.
        if (
          bid.status === 'pending_bond' &&
          bid.bondSignature !== null &&
          bid.bondState === 'pending'
        ) {
          continue;
        }
        bid.status = 'cancelled';
        if (bid.bondState === 'held') bid.bondState = 'refund_due';
      }
    }
    return closedNow ? 'finalized' : 'already_final';
  }

  async insertSettlement(args: {
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
  > {
    // Pg aborts before the INSERT when the named winner left the caller's
    // pickable states (a concurrent suspend cancelled it): no settlement may
    // exist whose winner holds no claim. Checked first, matching the Pg
    // statement order. 'contended' never occurs here (no lock waits in a
    // Map); it exists only to satisfy the interface union.
    if (args.winnerBidId !== undefined) {
      const winner = this.bids.get(args.winnerBidId);
      const pickable = args.winnerFrom ?? ['active', 'outbid'];
      if (!winner || !pickable.includes(winner.status)) {
        return 'winner_gone';
      }
    }
    const listing = this.listings.get(args.listingId);
    // Pg mirrors: INSERT..SELECT from a missing listing inserts no row; a
    // CLOSED listing gets its own value (the guard that stops a cascade
    // insert landing on a listing an admin suspend just closed).
    if (!listing) return 'live_settlement_exists';
    if (listing.status === 'closed') return 'listing_closed';
    for (const s of this.settlements.values()) {
      if (s.listingId === args.listingId && OPEN_SETTLEMENT_STATES.includes(s.state)) {
        // The Pg transaction rolls the winner stamp back with the insert, so
        // the fake refuses BEFORE touching the bid: same observable order.
        return 'live_settlement_exists';
      }
    }
    if (args.winnerBidId !== undefined) {
      const winner = this.bids.get(args.winnerBidId);
      if (winner) winner.status = 'won';
    }
    const id = this.nextSettlementId++;
    const rec: SettlementRec = {
      id,
      realm: listing.realm,
      listingId: args.listingId,
      bidId: args.bidId,
      attempt: args.attempt,
      buyerAccount: args.buyerAccount,
      buyerCharacter: args.buyerCharacter,
      buyerName: args.buyerName,
      buyerWallet: args.buyerWallet,
      amountCents: args.amountCents,
      state: 'offered',
      quoteReference: null,
      quoteExpiresAtMs: null,
      txSignature: null,
      failReason: null,
      settledAmountBase: null,
      deadlineAtMs: args.deadlineAtMs,
      createdAtMs: args.nowMs,
    };
    this.settlements.set(id, rec);
    this.touchSettlement(id);
    return this.settlementOut(rec);
  }

  async settlementById(id: number): Promise<WocSettlementRow | null> {
    const rec = this.settlements.get(id);
    return rec ? this.settlementOut(rec) : null;
  }

  async settlementsByAccount(
    realm: string,
    account: number,
    limit: number,
  ): Promise<WocActivitySettlementRow[]> {
    // Item-named like the Pg read; empty string when the listing is gone.
    return [...this.settlements.values()]
      .filter((s) => s.realm === realm && s.buyerAccount === account)
      .sort((a, b) => b.createdAtMs - a.createdAtMs || b.id - a.id)
      .slice(0, limit)
      .map((s) => ({
        ...this.settlementOut(s),
        itemId: this.listings.get(s.listingId)?.itemId ?? '',
      }));
  }

  async liveSettlementForListing(listingId: number): Promise<WocSettlementRow | null> {
    for (const s of this.settlements.values()) {
      if (s.listingId === listingId && OPEN_SETTLEMENT_STATES.includes(s.state)) {
        return this.settlementOut(s);
      }
    }
    return null;
  }

  async setSettlementQuote(
    id: number,
    reference: string,
    expiresAtMs: number,
    amountBase: string | null,
  ): Promise<boolean> {
    const rec = this.settlements.get(id);
    if (!rec || rec.state !== 'offered') return false;
    rec.quoteReference = reference;
    rec.quoteExpiresAtMs = expiresAtMs;
    rec.settledAmountBase = amountBase;
    this.touchSettlement(id);
    return true;
  }

  async submitSettlementSignature(
    id: number,
    signature: string,
  ): Promise<'ok' | 'not_offered' | 'signature_reused' | 'contended'> {
    const rec = this.settlements.get(id);
    if (!rec || rec.state !== 'offered') return 'not_offered';
    // The tx_signature UNIQUE constraint: any OTHER settlement already
    // carrying the signature refuses the reuse. The row under test is
    // skipped, matching Pg: re-writing the same value onto the same row adds
    // no new index entry, so a buyer retrying the same signature after a
    // failed -> offered revival proceeds.
    for (const other of this.settlements.values()) {
      if (other.id !== id && other.txSignature === signature) return 'signature_reused';
    }
    rec.state = 'confirming';
    rec.txSignature = signature;
    this.touchSettlement(id);
    return 'ok';
  }

  async transitionSettlement(
    id: number,
    from: WocSettlementState[],
    to: WocSettlementState,
    failReason?: string,
  ): Promise<boolean> {
    const rec = this.settlements.get(id);
    if (!rec || !from.includes(rec.state)) return false;
    // The one-open-settlement unique index is a CONSTRAINT, not an insert-time
    // check: a transition INTO the open set (the failed -> offered revival)
    // refuses when another open settlement holds the listing's slot, exactly
    // as Pg reports that 23505 (the fake must never reach a two-open state Pg
    // makes structurally impossible).
    if (OPEN_SETTLEMENT_STATES.includes(to) && !OPEN_SETTLEMENT_STATES.includes(rec.state)) {
      for (const other of this.settlements.values()) {
        if (
          other.id !== id &&
          other.listingId === rec.listingId &&
          OPEN_SETTLEMENT_STATES.includes(other.state)
        ) {
          return false;
        }
      }
    }
    rec.state = to;
    // COALESCE($4, fail_reason): a transition without a reason keeps the old one.
    rec.failReason = failReason ?? rec.failReason;
    this.touchSettlement(id);
    return true;
  }

  /** The parked-review arm's realm-scoped CAS twin: the rec carries realm
   *  internally (see the type note above), so a wrong-realm caller misses,
   *  matching the SQL's AND realm = $2. */
  async transitionSettlementInRealm(
    realm: string,
    id: number,
    from: WocSettlementState[],
    to: WocSettlementState,
    failReason?: string,
  ): Promise<boolean> {
    const rec = this.settlements.get(id);
    if (!rec || rec.realm !== realm) return false;
    return this.transitionSettlement(id, from, to, failReason);
  }

  async settlementStateInRealm(
    realm: string,
    id: number,
  ): Promise<{ state: WocSettlementState } | null> {
    const rec = this.settlements.get(id);
    return rec && rec.realm === realm ? { state: rec.state } : null;
  }

  async confirmingSettlements(realm: string, limit: number): Promise<WocSettlementRow[]> {
    return [...this.settlements.values()]
      .filter((s) => s.realm === realm && s.state === 'confirming')
      .sort(this.byTouch(this.settlementTouchMs))
      .slice(0, limit)
      .map((s) => this.settlementOut(s));
  }

  async claimDeliverableSettlements(realm: string, limit: number): Promise<WocSettlementRow[]> {
    const claimed = [...this.settlements.values()]
      .filter((s) => s.realm === realm && s.state === 'confirmed')
      .sort(this.byTouch(this.settlementTouchMs))
      .slice(0, limit);
    for (const rec of claimed) {
      rec.state = 'delivering';
      this.touchSettlement(rec.id);
    }
    return claimed.map((s) => this.settlementOut(s));
  }

  async deliveringSettlements(
    realm: string,
    limit: number,
    excludeIds: readonly number[],
  ): Promise<WocSettlementRow[]> {
    const excluded = new Set(excludeIds);
    return [...this.settlements.values()]
      .filter((s) => s.realm === realm && s.state === 'delivering' && !excluded.has(s.id))
      .sort(this.byRotation(this.settlementParkedMs, this.settlementTouchMs))
      .slice(0, limit)
      .map((s) => this.settlementOut(s));
  }

  async deliveredUnclosedSettlementsPage(
    realm: string,
    afterListingId: number,
    pageSize: number,
    maxSettlements: number,
  ): Promise<{ settlements: WocSettlementRow[]; lastListingId: number | null }> {
    // Mirrors the Pg two-statement page: a bounded slice of open listing ids
    // (the same three-status literal the SQL spells; the four-way lifecycle
    // means "not closed", pinned in woc_market_directed_sql.test.ts), then
    // the delivered settlements riding them, bounded by maxSettlements with
    // the truncation-cursor semantics (next beat resumes behind the last
    // RETURNED row instead of skipping the remainder to the wrap).
    const openIds = [...this.listings.values()]
      .filter(
        (l) =>
          l.realm === realm &&
          (l.status === 'active' || l.status === 'ending' || l.status === 'settling') &&
          l.id > afterListingId,
      )
      .map((l) => l.id)
      .sort((a, b) => a - b)
      .slice(0, pageSize);
    if (openIds.length === 0) return { settlements: [], lastListingId: null };
    const idSet = new Set(openIds);
    const matched = [...this.settlements.values()]
      // No realm qual here, mirroring the real second statement: the id page
      // already scoped the realm.
      .filter((s) => s.state === 'delivered' && idSet.has(s.listingId))
      .sort((a, b) => a.listingId - b.listingId)
      .map((s) => this.settlementOut(s));
    if (matched.length > maxSettlements) {
      const kept = matched.slice(0, maxSettlements);
      return {
        settlements: kept,
        lastListingId: kept[kept.length - 1]?.listingId ?? null,
      };
    }
    return { settlements: matched, lastListingId: openIds[openIds.length - 1] ?? null };
  }

  async disposeSoldResidueListings(realm: string, limit: number): Promise<number> {
    let disposed = 0;
    // id order, mirroring the SQL's ORDER BY l.id (deterministic lock order).
    const rows = [...this.listings.values()].sort((a, b) => a.id - b.id);
    for (const listing of rows) {
      if (disposed >= limit) break;
      if (
        listing.realm !== realm ||
        listing.status !== 'closed' ||
        listing.resolution !== 'sold' ||
        listing.itemDisposed
      ) {
        continue;
      }
      const standing = [...this.sales.values()].some(
        (s) => s.listingId === listing.id && !s.excluded,
      );
      if (!standing) continue;
      listing.itemDisposed = true;
      this.touchListing(listing.id);
      disposed++;
    }
    return disposed;
  }

  async touchSettlementRow(id: number): Promise<void> {
    // Rotation writes the parked mirror ONLY, never the age signal.
    if (this.settlements.has(id)) this.settlementParkedMs.set(id, this.now());
  }

  async touchListingRow(id: number): Promise<void> {
    if (this.listings.has(id)) this.listingParkedMs.set(id, this.now());
  }

  async overdueSettlements(
    realm: string,
    nowMs: number,
    limit: number,
  ): Promise<WocSettlementRow[]> {
    // Mirrors the real single-arm predicate: deadline-overdue offered/failed
    // only (the H15 confirming bound is the sibling read below, its own arm
    // so a confirming backlog cannot own this batch head).
    return [...this.settlements.values()]
      .filter(
        (s) =>
          s.realm === realm &&
          (s.state === 'offered' || s.state === 'failed') &&
          s.deadlineAtMs <= nowMs,
      )
      .sort((a, b) => a.deadlineAtMs - b.deadlineAtMs || a.id - b.id)
      .slice(0, limit)
      .map((s) => this.settlementOut(s));
  }

  async confirmingOverdueSettlements(
    realm: string,
    cutoffMs: number,
    limit: number,
  ): Promise<WocSettlementRow[]> {
    // 'confirming' aged on updated_at (the touch mirror) past the H15
    // cutoff, oldest first (the Pg ORDER BY updated_at mirror).
    return [...this.settlements.values()]
      .filter(
        (s) =>
          s.realm === realm &&
          s.state === 'confirming' &&
          (this.settlementTouchMs.get(s.id) ?? 0) <= cutoffMs,
      )
      .sort(
        (a, b) =>
          (this.settlementTouchMs.get(a.id) ?? 0) - (this.settlementTouchMs.get(b.id) ?? 0) ||
          a.id - b.id,
      )
      .slice(0, limit)
      .map((s) => this.settlementOut(s));
  }

  // -------------------------------------------------------------------------
  // Sales, strikes, terms, delivery targets
  // -------------------------------------------------------------------------

  async insertSale(args: Omit<WocSaleRow, 'id' | 'excluded' | 'atMs'>): Promise<number> {
    // woc_market_sales_listing_once: one non-excluded sale row per listing,
    // surfaced as the same pg error shape the real INSERT throws.
    for (const sale of this.sales.values()) {
      if (sale.listingId === args.listingId && !sale.excluded) {
        throw Object.assign(
          new Error(
            'duplicate key value violates unique constraint "woc_market_sales_listing_once"',
          ),
          { code: '23505' },
        );
      }
    }
    const id = this.nextSaleId++;
    const row: WocSaleRow = {
      ...structuredClone(args),
      id,
      excluded: false,
      atMs: this.now(),
    };
    this.sales.set(id, row);
    return id;
  }

  async salesForItem(realm: string, itemId: string, limit: number): Promise<WocSaleRow[]> {
    return [...this.sales.values()]
      .filter((s) => s.realm === realm && s.itemId === itemId && !s.excluded)
      .sort((a, b) => b.atMs - a.atMs || b.id - a.id)
      .slice(0, limit)
      .map((s) => structuredClone(s));
  }

  async salesForSeller(realm: string, sellerName: string, limit: number): Promise<WocSaleRow[]> {
    return [...this.sales.values()]
      .filter((s) => s.realm === realm && s.sellerName === sellerName && !s.excluded)
      .sort((a, b) => b.atMs - a.atMs || b.id - a.id)
      .slice(0, limit)
      .map((s) => structuredClone(s));
  }

  /** Seeded by tests that drive the seller pane's profile line; absent
   *  names answer null, the renamed-or-deleted arm. Keyed realm\x1fname. */
  readonly sellerProfiles = new Map<string, WocSellerProfile>();

  async listingItemIdsMissingCategory(): Promise<string[]> {
    const ids = new Set<string>();
    for (const [id, stamps] of this.listingCategories) {
      if (stamps.category !== null) continue;
      const row = this.listings.get(id);
      if (row) ids.add(row.itemId);
    }
    return [...ids];
  }

  async stampListingCategory(
    itemId: string,
    category: string,
    subcategory: string | null,
  ): Promise<number> {
    let stamped = 0;
    for (const [id, stamps] of this.listingCategories) {
      if (stamps.category !== null) continue;
      if (this.listings.get(id)?.itemId !== itemId) continue;
      this.listingCategories.set(id, { category, subcategory });
      stamped += 1;
    }
    return stamped;
  }

  async sellerProfile(realm: string, sellerName: string): Promise<WocSellerProfile | null> {
    return this.sellerProfiles.get(`${realm}\x1f${sellerName}`) ?? null;
  }

  async setSaleExcluded(id: number, excluded: boolean): Promise<'ok' | 'miss' | 'conflict'> {
    const row = this.sales.get(id);
    if (!row) return 'miss';
    if (!excluded) {
      // woc_market_sales_listing_once: re-including while another non-excluded
      // row stands for the listing refuses as a distinct conflict (Pg catches
      // its 23505 to 'conflict').
      for (const other of this.sales.values()) {
        if (other.id !== id && other.listingId === row.listingId && !other.excluded) {
          return 'conflict';
        }
      }
    }
    row.excluded = excluded;
    return 'ok';
  }

  async strikeInfo(account: number): Promise<WocStrikeRow | null> {
    const row = this.strikes.get(account);
    return row ? { ...row } : null;
  }

  async addStrike(account: number, suspendedUntilMs: number | null): Promise<WocStrikeRow> {
    const existing = this.strikes.get(account);
    if (!existing) {
      const row: WocStrikeRow = { accountId: account, strikes: 1, suspendedUntilMs };
      this.strikes.set(account, row);
      return { ...row };
    }
    existing.strikes += 1;
    // The Pg conflict arm computes GREATEST over COALESCE(.., 'epoch'), so two
    // null suspensions produce epoch (0 ms), never null. Mirrored on purpose.
    existing.suspendedUntilMs = Math.max(existing.suspendedUntilMs ?? 0, suspendedUntilMs ?? 0);
    return { ...existing };
  }

  async clearStrikes(account: number): Promise<void> {
    this.strikes.delete(account);
  }

  async termsAcceptedAt(account: number): Promise<number | null> {
    return this.terms.get(account) ?? null;
  }

  async recordTermsAccepted(account: number, nowMs: number): Promise<void> {
    // ON CONFLICT DO NOTHING: the first acceptance wins.
    if (!this.terms.has(account)) this.terms.set(account, nowMs);
  }

  async deliveryTarget(
    realm: string,
    account: number,
    preferredCharacter: number,
  ): Promise<{ characterId: number; name: string } | null> {
    const preferred = this.characters.find(
      (c) => c.characterId === preferredCharacter && c.accountId === account && c.realm === realm,
    );
    if (preferred) return { characterId: preferred.characterId, name: preferred.name };
    // The Pg fallback orders by updated_at DESC; the fake treats later seed
    // entries as newer.
    const fallback = [...this.characters]
      .reverse()
      .find((c) => c.accountId === account && c.realm === realm);
    if (fallback) return { characterId: fallback.characterId, name: fallback.name };
    return null;
  }
}
