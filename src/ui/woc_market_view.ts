// $WOC Exchange window view core (docs/prd/woc/marketplace.md): maps the SDK
// payloads (status, browse page, detail, activity) plus the live inventory to
// the render model the painter draws. DOM/i18n-free and deterministic: the
// caller passes nowMs, the painter owns every t() string, formatter, and the
// clock. The client computes NO price, token, or increment values: everything
// economic in this model is a passthrough of server-provided numbers; the one
// derivation here is TIME (remaining/deadline milliseconds from server
// timestamps) and the sell-tab eligibility PRE-filter, which mirrors the
// server policy's shape (quality floor from /status; hard transfer locks from
// the item def) purely as a courtesy: the server re-validates every listing.

import { ITEMS } from '../sim/data';
import {
  exchangeCategoryUsesQualityFloor,
  exchangeHardLock,
  exchangeItemCategory,
} from '../sim/exchange_eligibility';
import type { InvSlot, ItemInstancePayload } from '../sim/types';

// Structural twins of the src/net/woc_market_sdk.ts payload shapes. The
// pure-core sweep (tests/architecture.test.ts) forbids net imports here even
// type-only, so the core declares the shapes it reads and the SDK objects
// flow in unchanged through TypeScript's structural typing; the painter is
// the only module that names both sides.

export interface WocQuoteLegView {
  base: string;
  tokens: number;
}

export interface WocPriceView {
  available: boolean;
  healthy: boolean;
  tokensPerUsd: number | null;
  asOfMs: number | null;
}

export interface WocMarketStatus {
  ok: boolean;
  enabled: boolean;
  price: WocPriceView;
  maxActiveListings: number;
  durationsHours: readonly number[];
  minPriceCents: number;
  maxPriceCents: number;
  qualityFloor: string;
  allowMounts: boolean;
  allowMechChromas: boolean;
  settlementWindowSeconds: number;
  bond?: {
    rateBps: number;
    minCents: number;
    maxCents: number;
    pendingTtlSeconds: number;
  };
}

export interface WocListingView {
  id: number;
  item: InvSlot;
  itemId: string;
  quality: string;
  format: 'auction' | 'buy_now' | 'auction_buy_now';
  sellerName: string;
  mine: boolean;
  startCents: number;
  hasReserve: boolean;
  reserveMet: boolean | null;
  buyNowCents: number | null;
  offerNext: boolean;
  status: string;
  resolution: string | null;
  currentBidCents: number | null;
  /** The sale's closing price on the seller's sold rows; absent from an
   *  older server and null on live rows. */
  soldCents?: number | null;
  minNextBidCents: number;
  /** Server-computed bond for a bid at minNextBidCents (client computes none). */
  minNextBidBondCents: number;
  buyNowLocked: boolean;
  /** Cancel intent stamped on an active listing. Absent from an older server. */
  cancelPending?: boolean;
  /** Directed p2p sale, never a public auction. Absent from an older server. */
  directed?: boolean;
  endsAtMs: number;
  createdAtMs: number;
}

export interface WocEstimateView {
  available: boolean;
  usdCents: number;
  amount: WocQuoteLegView | null;
  asOfMs: number | null;
}

export interface WocBidView {
  id: number;
  listingId: number;
  /** The listed item this bid is for (the Activity read names it); null or
   *  absent from an older server or a pruned listing. */
  itemId?: string | null;
  amountCents: number;
  status: string;
  bondCents: number;
  bondState: string;
  bondReference: string | null;
  bondQuoteExpiresAtMs: number | null;
  /** A submitted bond payment is awaiting the chain. Mirrors the field of the
   *  same name on the net SDK's view; this seam keeps its own copy so the pure
   *  core stays free of a net/ import. */
  bondConfirming: boolean;
  placedAtMs: number;
}

export interface WocSettlementView {
  id: number;
  listingId: number;
  /** The listed item this payment is for; null or absent from an older
   *  server or a pruned listing. */
  itemId?: string | null;
  attempt: number;
  amountCents: number;
  state: string;
  quoteReference: string | null;
  quoteExpiresAtMs: number | null;
  /** The screened verdict behind a failed payment (server vocabulary; an
   *  unknown service word arrives as 'other'). Absent from an older server. */
  failReason?: string | null;
  deadlineAtMs: number;
  createdAtMs: number;
}

export interface WocSaleView {
  id: number;
  itemId: string;
  priceCents: number;
  sellerName: string;
  buyerName: string;
  atMs: number;
}

export interface WocActivityView {
  listings: WocListingView[];
  bids: WocBidView[];
  settlements: WocSettlementView[];
  strikes: { strikes: number; suspendedUntilMs: number | null } | null;
  termsAcceptedAtMs: number | null;
  walletLinked: boolean;
}

export type WocMarketTab = 'browse' | 'sell' | 'activity';

export interface WocMarketViewInput {
  /** Feature capability on this client build (platform gate). */
  capable: boolean;
  /** Status payload, or null while it loads / when it failed. */
  status: WocMarketStatus | null;
  statusFailed: boolean;
  walletLinked: boolean;
  tab: WocMarketTab;
  nowMs: number;
  browse: {
    listings: readonly WocListingView[];
    hasMore: boolean;
    page: number;
    pageSize: number;
    loading: boolean;
    failed: boolean;
    selectedId: number | null;
    detail: WocListingView | null;
    estimate: WocEstimateView | null;
    sales: readonly WocSaleView[] | null;
  };
  /** The live inventory (IWorld read) for the sell tab. */
  inventory: readonly InvSlot[];
  activity: WocActivityView | null;
}

export interface WocListingRowModel {
  id: number;
  itemId: string;
  count: number;
  instance: ItemInstancePayload | undefined;
  quality: string;
  format: WocListingView['format'];
  sellerName: string;
  mine: boolean;
  currentCents: number | null;
  /** The sale's closing price when resolved sold (null from an older server
   *  or on live rows); prefer it over currentCents on a sold row. */
  soldCents: number | null;
  startCents: number;
  minNextBidCents: number;
  minNextBidBondCents: number;
  buyNowCents: number | null;
  buyNowLocked: boolean;
  reserveBadge: 'met' | 'not_met' | null;
  remainingMs: number;
  endsAtMs: number;
  selected: boolean;
  status: string;
  resolution: string | null;
  /** The seller asked to cancel a locked listing; it closes on its own after
   *  an unpaid window. Absent from an older server reads as false. */
  cancelPending: boolean;
  /** A directed p2p sale minted from a trade offer, not a public auction. */
  directed: boolean;
}

/**
 * Whether the seller may still cancel this listing from a client surface: an
 * ACTIVE listing, unbid, with no cancel already requested (a cancel-pending
 * listing closes on its own; a second press only re-answers the same). The
 * server's guards decide the rest (has_bids, settlement_live, the
 * cancel-pending conversion on a locked window); this is the one predicate the
 * browse detail pane and the Activity rows share, which used to spell it two
 * ways and disagree on the cancel-pending arm. Ownership is the caller's
 * check (the Activity list is the seller's own; the browse row carries mine).
 */
export function canCancelListing(
  row: Pick<WocListingRowModel, 'status' | 'currentCents' | 'cancelPending'>,
): boolean {
  return row.status === 'active' && !row.cancelPending && row.currentCents === null;
}

export interface WocDetailModel {
  row: WocListingRowModel;
  estimateAmount: WocQuoteLegView | null;
  estimateAsOfMs: number | null;
  offerNext: boolean;
  sales: readonly WocSaleView[];
}

export interface WocSellRowModel {
  index: number;
  itemId: string;
  quality: string;
  instance: ItemInstancePayload | undefined;
}

export interface WocActivityModel {
  listings: WocListingRowModel[];
  bids: (WocBidView & { bondQuoteRemainingMs: number | null })[];
  settlements: (WocSettlementView & {
    deadlineRemainingMs: number;
    quoteRemainingMs: number | null;
    /** The WHY line's gate, decided HERE so it is testable without a DOM:
     *  the screened verdict on FAILED rows only. An expired row keeps a
     *  chain-refused try's failReason (the sweep COALESCEs it), but its
     *  label already says "expired unpaid" and a mismatch line under it
     *  would accuse a buyer who simply walked away. */
    failDetailReason: string | null;
  })[];
  strikes: number;
  suspendedRemainingMs: number | null;
  termsAccepted: boolean;
}

export type WocMarketViewModel =
  | { kind: 'unavailable' } // platform-incapable build: the window never shows
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'disabled' }
  | {
      kind: 'ready';
      tab: WocMarketTab;
      paused: boolean;
      walletLinked: boolean;
      tokensPerUsd: number | null;
      priceAsOfMs: number | null;
      settlementWindowSeconds: number;
      durationsHours: readonly number[];
      minPriceCents: number;
      maxPriceCents: number;
      browse: {
        rows: WocListingRowModel[];
        hasMore: boolean;
        page: number;
        loading: boolean;
        failed: boolean;
        detail: WocDetailModel | null;
      };
      sell: {
        rows: WocSellRowModel[];
        maxActiveListings: number;
        /** Copies the picker hides that UNLOCKING would bring back, so the
         *  caption about locked items is only shown when it is true. */
        lockedOut: number;
        /** The policy figures the sell-empty caption resolves (the same
         *  values the pre-filter above already applied), so the copy names
         *  THIS realm's floor and categories instead of a generic sentence. */
        qualityFloor: string;
        allowMounts: boolean;
        allowMechChromas: boolean;
      };
      /** The bond schedule and payment window off /status, or null on an
       *  older server (the disclosures then keep their figure-free copy). */
      bondSchedule: {
        rateBps: number;
        minCents: number;
        maxCents: number;
        pendingTtlSeconds: number;
      } | null;
      activity: WocActivityModel | null;
    };

const QUALITY_RANK: Record<string, number> = {
  poor: 0,
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

/**
 * The sell-tab pre-filter: every category the server's policy trades, free of
 * every hard transfer lock, with the equipment floor applied to equipment only.
 * Mirrors, never replaces, the server-side listingEligibility + extraction
 * checks, and shares their lock predicate and taxonomy so it cannot drift into
 * hiding something the server would have accepted.
 *
 * The category switches ride the status payload rather than being assumed here:
 * a realm with mounts turned off must not offer them in the picker and then
 * refuse the listing.
 */
export function sellableRows(
  inventory: readonly InvSlot[],
  qualityFloor: string,
  categories: { mounts: boolean; mechChromas: boolean },
): WocSellRowModel[] {
  return rowsPassing(inventory, qualityFloor, categories, (lock) => lock === null);
}

/**
 * The copies the picker hides that the SELLER can unhide: everything the filter
 * above would have taken, refused by the player's OWN item lock and nothing
 * stronger (`exchangeHardLock` reports 'locked' only as its last arm).
 *
 * This exists so the sell tab's "locked items are not listed here" caption is
 * true when it is shown. Asking only "is any known item in the bags locked"
 * claimed it about a locked stack of cloth, which the picker would never have
 * offered lock or no lock, and which no amount of unlocking would bring back.
 */
export function lockedOutRows(
  inventory: readonly InvSlot[],
  qualityFloor: string,
  categories: { mounts: boolean; mechChromas: boolean },
): WocSellRowModel[] {
  return rowsPassing(inventory, qualityFloor, categories, (lock) => lock === 'locked');
}

/** The one filter body both readings share, so they cannot drift apart. */
function rowsPassing(
  inventory: readonly InvSlot[],
  qualityFloor: string,
  categories: { mounts: boolean; mechChromas: boolean },
  acceptLock: (lock: ReturnType<typeof exchangeHardLock>) => boolean,
): WocSellRowModel[] {
  const floor = QUALITY_RANK[qualityFloor] ?? QUALITY_RANK.epic;
  const rows: WocSellRowModel[] = [];
  inventory.forEach((slot, index) => {
    const def = ITEMS[slot.itemId];
    if (!def) return;
    if (!acceptLock(exchangeHardLock(def, slot.instance))) return;
    const category = exchangeItemCategory(def);
    if (category === 'other') return;
    if (category === 'mount' && !categories.mounts) return;
    if (category === 'mech_chroma' && !categories.mechChromas) return;
    const quality = slot.instance?.rolled?.quality ?? def.quality ?? 'common';
    if (exchangeCategoryUsesQualityFloor(category) && (QUALITY_RANK[quality] ?? 0) < floor) return;
    rows.push({ index, itemId: slot.itemId, quality, instance: slot.instance });
  });
  return rows;
}

/** The Browse quality filter's closed vocabulary, in rank order. Equipment
 *  floors at the realm's quality floor, but the collectible categories
 *  bypass it (sellableRows' own rule) and rank down to uncommon (SkinRank),
 *  so allowing either widens the vocabulary to uncommon: those listings
 *  genuinely exist. Ranks below every listable thing stay out; dead options
 *  read as a broken filter. */
export function browseQualityOptions(
  qualityFloor: string,
  categories: { mounts: boolean; mechChromas: boolean },
): string[] {
  const floor = QUALITY_RANK[qualityFloor] ?? QUALITY_RANK.epic;
  const lowest =
    categories.mounts || categories.mechChromas ? Math.min(floor, QUALITY_RANK.uncommon) : floor;
  return Object.entries(QUALITY_RANK)
    .filter(([, rank]) => rank >= lowest)
    .sort((a, b) => a[1] - b[1])
    .map(([quality]) => quality);
}

/**
 * The pending quote's own repaint key, at SECOND resolution like every other
 * countdown in the view digest: the display has no finer grain, so a finer
 * key would rebuild the window many times per second for a string that did
 * not change. Empty when there is no deadline to count.
 */
export function wocQuoteCountdownSig(
  expiresAtMs: number | null | undefined,
  nowMs: number,
): string {
  if (expiresAtMs === undefined || expiresAtMs === null) return '';
  return String(Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000)));
}

/**
 * Resolve the Browse item filter's free-text query to catalog item ids, the
 * sell combobox's matching rule (case-insensitive substring over the
 * localized display name).
 *
 * Three answers, each meaning something different to the caller:
 * - null: no filter (an empty query, or one too broad to narrow: past the
 *   cap a truncated arbitrary subset would silently HIDE matching listings,
 *   which is worse than not filtering yet).
 * - []: a real "nothing matches" (the caller paints the empty face and
 *   skips the fetch: the SDK omits an empty itemIds param, so sending it
 *   would mean NO filter and show everything).
 * - ids: the filter the browse request carries.
 */
export function browseItemFilterIds(
  query: string,
  itemName: (itemId: string) => string,
  itemIds: readonly string[],
  cap = 40,
): readonly string[] | null {
  const q = query.trim().toLowerCase();
  if (q === '') return null;
  const out: string[] = [];
  for (const id of itemIds) {
    if (!itemName(id).toLowerCase().includes(q)) continue;
    out.push(id);
    if (out.length > cap) return null;
  }
  return out;
}

function listingRow(
  listing: WocListingView,
  nowMs: number,
  selectedId: number | null,
): WocListingRowModel {
  return {
    id: listing.id,
    itemId: listing.itemId,
    count: listing.item?.count ?? 1,
    instance: listing.item?.instance,
    quality: listing.quality,
    format: listing.format,
    sellerName: listing.sellerName,
    mine: listing.mine,
    currentCents: listing.currentBidCents,
    soldCents: listing.soldCents ?? null,
    startCents: listing.startCents,
    minNextBidCents: listing.minNextBidCents,
    minNextBidBondCents: listing.minNextBidBondCents,
    buyNowCents: listing.buyNowCents,
    buyNowLocked: listing.buyNowLocked,
    reserveBadge: listing.hasReserve ? (listing.reserveMet ? 'met' : 'not_met') : null,
    remainingMs: Math.max(0, listing.endsAtMs - nowMs),
    endsAtMs: listing.endsAtMs,
    selected: listing.id === selectedId,
    status: listing.status,
    resolution: listing.resolution,
    cancelPending: listing.cancelPending === true,
    directed: listing.directed === true,
  };
}

export function buildWocMarketView(input: WocMarketViewInput): WocMarketViewModel {
  if (!input.capable) return { kind: 'unavailable' };
  if (input.statusFailed) return { kind: 'error' };
  if (input.status === null) return { kind: 'loading' };
  if (!input.status.ok) return { kind: 'error' };
  if (!input.status.enabled) return { kind: 'disabled' };

  const nowMs = input.nowMs;
  const status = input.status;
  const paused = !status.price.available || !status.price.healthy;

  const rows = input.browse.listings.map((l) => listingRow(l, nowMs, input.browse.selectedId));
  const detailSource =
    input.browse.detail ??
    input.browse.listings.find((l) => l.id === input.browse.selectedId) ??
    null;
  const detail: WocDetailModel | null = detailSource
    ? {
        row: listingRow(detailSource, nowMs, input.browse.selectedId),
        estimateAmount: input.browse.estimate?.amount ?? null,
        estimateAsOfMs: input.browse.estimate?.asOfMs ?? null,
        offerNext: detailSource.offerNext,
        sales: input.browse.sales ?? [],
      }
    : null;

  const activity: WocActivityModel | null = input.activity
    ? {
        listings: input.activity.listings.map((l) => listingRow(l, nowMs, null)),
        bids: input.activity.bids.map((b) => ({
          ...b,
          bondQuoteRemainingMs:
            b.bondQuoteExpiresAtMs === null ? null : Math.max(0, b.bondQuoteExpiresAtMs - nowMs),
        })),
        settlements: input.activity.settlements.map((s) => ({
          ...s,
          deadlineRemainingMs: Math.max(0, s.deadlineAtMs - nowMs),
          quoteRemainingMs:
            s.quoteExpiresAtMs === null ? null : Math.max(0, s.quoteExpiresAtMs - nowMs),
          failDetailReason: s.state === 'failed' ? (s.failReason ?? null) : null,
        })),
        strikes: input.activity.strikes?.strikes ?? 0,
        suspendedRemainingMs:
          input.activity.strikes?.suspendedUntilMs != null &&
          input.activity.strikes.suspendedUntilMs > nowMs
            ? input.activity.strikes.suspendedUntilMs - nowMs
            : null,
        termsAccepted: input.activity.termsAcceptedAtMs !== null,
      }
    : null;

  return {
    kind: 'ready',
    tab: input.tab,
    paused,
    walletLinked: input.walletLinked,
    tokensPerUsd: status.price.tokensPerUsd,
    priceAsOfMs: status.price.asOfMs,
    settlementWindowSeconds: status.settlementWindowSeconds,
    durationsHours: status.durationsHours,
    minPriceCents: status.minPriceCents,
    maxPriceCents: status.maxPriceCents,
    browse: {
      rows,
      // hasMore, not a page count: the server ships a has-more probe rather
      // than a total (the count query read every live listing per page).
      hasMore: input.browse.hasMore,
      page: input.browse.page,
      loading: input.browse.loading,
      failed: input.browse.failed,
      detail,
    },
    sell: {
      rows: sellableRows(input.inventory, status.qualityFloor, {
        mounts: status.allowMounts,
        mechChromas: status.allowMechChromas,
      }),
      maxActiveListings: status.maxActiveListings,
      lockedOut: lockedOutRows(input.inventory, status.qualityFloor, {
        mounts: status.allowMounts,
        mechChromas: status.allowMechChromas,
      }).length,
      qualityFloor: status.qualityFloor,
      allowMounts: status.allowMounts,
      allowMechChromas: status.allowMechChromas,
    },
    bondSchedule: status.bond ?? null,
    activity,
  };
}

/**
 * A countdown's signature bucket: second resolution inside the final two
 * minutes (the anti-snipe window, where the display ticks in seconds) and
 * minute resolution beyond it, so a page of far-off auctions does not force
 * a rebuild on every slow-band poll.
 */
export function countdownSigBucket(remainingMs: number): number {
  return remainingMs < 120_000
    ? Math.floor(remainingMs / 1000)
    : 120 + Math.floor(remainingMs / 60_000);
}

/**
 * The repaint signature: a digest of the DATA the painter renders, so the
 * poll rebuilds only on change (the lastSig family). Text-independent by
 * design; the language fan-out calls relocalize() instead. Countdowns fold
 * in through countdownSigBucket so open auctions tick without a self-armed
 * driver.
 */
export function wocMarketViewSig(model: WocMarketViewModel): string {
  if (model.kind !== 'ready') return model.kind;
  const rows = model.browse.rows
    .map(
      (r) =>
        `${r.id}:${r.currentCents}:${r.buyNowLocked ? 1 : 0}:${r.reserveBadge}:${countdownSigBucket(r.remainingMs)}:${r.selected ? 1 : 0}`,
    )
    .join(',');
  const detail = model.browse.detail
    ? `${model.browse.detail.row.id}:${model.browse.detail.estimateAmount?.base ?? ''}:${model.browse.detail.sales.length}`
    : '';
  const sell = model.sell.rows.map((r) => `${r.index}:${r.itemId}`).join(',');
  const activity = model.activity
    ? [
        // currentCents rides too: the seller's Cancel button is gated on an
        // unbid listing and the price cell renders it, so a bid landing on
        // the poll must move the digest or both go stale under the seller.
        model.activity.listings
          .map(
            (l) =>
              `${l.id}:${l.status}:${l.resolution ?? ''}:${l.cancelPending ? 1 : 0}:${l.currentCents ?? ''}`,
          )
          .join(','),
        model.activity.bids
          .map(
            // bondConfirming is folded in because NOTHING else here moves when a
            // bond payment is submitted: the bid stays pending_bond and the bond
            // stays pending until the chain answers. Without it the progress
            // spinner would never appear, and once it did it would never clear.
            (b) =>
              `${b.id}:${b.status}:${b.bondState}:${b.bondConfirming ? 1 : 0}:${Math.floor((b.bondQuoteRemainingMs ?? -1000) / 1000)}`,
          )
          .join(','),
        model.activity.settlements
          .map(
            (s) =>
              // failDetailReason joins the digest: a revival can change the
              // WHY line while state stays 'failed'. The ':' delimiters stay
              // collision-safe because the reason is the server's SCREENED
              // vocabulary (no member contains ':' and unknown words collapse
              // to 'other'), a property of the screen, not of this digest.
              // A signature that
              // misses it leaves the old accusation on screen.
              `${s.id}:${s.state}:${s.failDetailReason ?? ''}:${countdownSigBucket(s.deadlineRemainingMs)}:${Math.floor((s.quoteRemainingMs ?? -1000) / 1000)}`,
          )
          .join(','),
        `${model.activity.strikes}:${model.activity.suspendedRemainingMs === null ? '' : Math.floor(model.activity.suspendedRemainingMs / 60_000)}:${model.activity.termsAccepted ? 1 : 0}`,
      ].join('|')
    : '';
  return [
    model.tab,
    model.paused ? 1 : 0,
    model.walletLinked ? 1 : 0,
    model.tokensPerUsd ?? '',
    model.browse.page,
    model.browse.hasMore ? 1 : 0,
    model.browse.loading ? 1 : 0,
    model.browse.failed ? 1 : 0,
    rows,
    detail,
    sell,
    activity,
  ].join('#');
}
