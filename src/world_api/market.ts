import type {
  MarketArmorClassFilter,
  MarketItemTypeFilter,
  MarketPrimaryStatFilter,
  MarketQuery,
  MarketRarityFilter,
  MarketSort,
  MarketSubtypeFilter,
} from '../sim/market_query';
import type { MarketSaleRecord } from '../sim/market_sale_log';
import type { InvSlot, ItemInstancePayload } from '../sim/types';

// ---------------------------------------------------------------------------
// The World Market (the Merchant's auction house). Listings are global and
// shared by every player; collections are the per-player gold + items waiting
// to be picked up (sale proceeds, expired/returned listings).
// ---------------------------------------------------------------------------

export interface MarketListingView {
  id: number;
  sellerName: string;
  itemId: string;
  count: number;
  price: number; // total copper buyout for the whole stack
  mine: boolean; // the viewer is the seller (offer them Cancel, not Buy)
  house: boolean; // the Merchant's own standing stock
  /** DISPLAY payload of an instanced listing (#1165), trimmed to the public
   *  allowlist (signer/enchant/rolled; never boundTo/bindOnTrade/charges): the
   *  tooltip's enchant line and maker's mark. Absent on plain listings. */
  instance?: ItemInstancePayload;
}

export interface MarketInfo {
  // The viewer's own visible listings followed by ONE page of other sellers' listings
  // matching the active query. All matching own rows wire for reclaim normally; collapse
  // mode first narrows the whole match set, including own rows. The server filters +
  // paginates authoritatively, so paging walks the whole market.
  listings: MarketListingView[];
  totalCount: number; // all listings matching the active filter (mine + others)
  filter: string; // the active search string (echoed back from the server)
  // The type/subtype/armor-class/primary-stat/rarity filters the server actually
  // applied, echoed back alongside `filter` above. A fresh join (post-linkdead-grace
  // reconnect) resets the session-only server query to default while the window's
  // own filter controls survive the socket drop untouched; echoing every filter
  // axis, not just the search text, is what lets the client detect that drift
  // (queryDiffersFromEcho below) instead of silently showing filter buttons that no
  // longer describe what the listings were actually matched against (issue #2416).
  itemType: MarketItemTypeFilter;
  subtype: MarketSubtypeFilter;
  armorClass: MarketArmorClassFilter;
  primaryStat: MarketPrimaryStatFilter;
  rarity: MarketRarityFilter;
  sort: MarketSort;
  // Whether the server collapsed matching plain listings to the lowest price per item
  // (issue #3103), echoed back for the same drift-detection reason as the axes above.
  collapseLowest: boolean;
  page: number; // current browse page (of other sellers' listings), 0-based
  pageCount: number; // total browse pages of other sellers' listings (>= 1)
  collectionCopper: number; // proceeds waiting to be collected
  collectionItems: InvSlot[]; // returned/expired items waiting to be collected
  /** The itemized ledger behind `collectionCopper`: one row per sale still awaiting
   *  pickup, oldest first. Empty when nothing has sold since the last collect. */
  collectionSales: MarketSaleRecord[];
  /** Older sales the ledger cap dropped. Their gold IS in `collectionCopper`, so the
   *  tab says how many rows it is not listing rather than showing a short list that
   *  does not add up. */
  collectionSalesOmitted: number;
  cutPct: number; // the Merchant's cut on a sale, as a percentage
  maxListings: number; // per-seller active-listing cap
  myListingCount: number; // how many active listings the viewer already has
  // The Sell tab's current-lowest-listing-price reference (issue #3043), echoed
  // alongside the item id it was computed for so a stale snapshot across an item
  // switch is detectable (compare against the currently staged item before
  // trusting sellLowestPrice). Null itemId means nothing is staged; a null
  // price with a non-null itemId means the item has no active listings.
  sellPriceItemId: string | null;
  sellLowestPrice: number | null; // per unit, matching the sell form's "price each" field
}

export interface IWorldMarket {
  marketInfo: MarketInfo | null;
  // True while gold or items wait at the Merchant. Always available (the HUD
  // minimap badge; the mailUnread pattern), while the full marketInfo above
  // still streams only at the Merchant.
  marketCollectPending: boolean;
  // World Market. The browse query (search + type/subtype/rarity filters + page) is
  // sent to the server, which filters and paginates; marketInfo mirrors the result.
  marketSearch(query: MarketQuery): void;
  /** Ask for a current-lowest-listing-price reference for the Sell tab's staged
   *  item (issue #3043); null clears it. Purely a display/query narrowing (no
   *  gameplay effect), the marketSearch precedent. */
  marketSellPriceCheck(itemId: string | null): void;
  marketList(itemId: string, count: number, price: number): void;
  /** List ONE instanced copy (count 1), named by its payload: the sim escrows
   *  the actual held copy whose payload matches, refusing transfer-locked
   *  (bindOnTrade-armed or boundTo-bound) copies. Plain stacks use marketList. */
  marketListInstance(itemId: string, price: number, instance: ItemInstancePayload): void;
  marketBuy(listingId: number): void;
  marketCancel(listingId: number): void;
  marketCollect(): void;
}

// True when the caller's intended browse query no longer matches what the server
// actually applied, per the filter axes MarketInfo echoes back (issue #2416). Page
// and the raw search text are deliberately left out: the server clamps `page`
// against the live match count (a normal narrowing, not drift), and `filter` is
// not sanitized the same way `search` is on the way in (length/trim), so comparing
// it here would false-positive on a search box the player is mid-typing in. The
// seven compared axes (five filters plus sort, issue 3102, plus collapseLowest,
// issue 3103) are exactly the ones that silently reset to default on a fresh join
// (post-linkdead-grace reconnect) while a window's own filter controls survive the
// socket drop untouched.
export function queryDiffersFromEcho(query: MarketQuery, info: MarketInfo): boolean {
  return (
    query.itemType !== info.itemType ||
    query.subtype !== info.subtype ||
    query.armorClass !== info.armorClass ||
    query.primaryStat !== info.primaryStat ||
    query.rarity !== info.rarity ||
    query.sort !== info.sort ||
    query.collapseLowest !== info.collapseLowest
  );
}

// True when a settled search box no longer matches what the server actually
// applied. Deliberately NOT folded into queryDiffersFromEcho above: that
// check runs on every filter-button click (including mid-typed-in searches),
// where `filter` is not a safe comparison because it is not sanitized the
// same way `search` is on the client side as the player types. This one is
// reconnect-only (MarketWindow.onReconnected, once the socket is settled and
// no keystroke is in flight), where the stored server-side query is exactly
// `search.slice(0, MARKET_SEARCH_MAX_LEN)` (sanitizeMarketQuery in
// src/sim/market_query.ts) and so is directly comparable to the echo.
export const MARKET_SEARCH_MAX_LEN = 40;

export function searchDiffersFromEcho(query: MarketQuery, info: MarketInfo): boolean {
  return info.filter !== query.search.slice(0, MARKET_SEARCH_MAX_LEN);
}
