import type { MarketQuery } from '../sim/market_query';
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
  // The viewer's own listings (always wired, for reclaim) followed by ONE page of
  // other sellers' listings matching the active query. The server filters + paginates
  // authoritatively, so paging walks the whole market, not just a single wire window.
  listings: MarketListingView[];
  totalCount: number; // all listings matching the active filter (mine + others)
  filter: string; // the active search string (echoed back from the server)
  page: number; // current browse page (of other sellers' listings), 0-based
  pageCount: number; // total browse pages of other sellers' listings (>= 1)
  collectionCopper: number; // proceeds waiting to be collected
  collectionItems: InvSlot[]; // returned/expired items waiting to be collected
  cutPct: number; // the Merchant's cut on a sale, as a percentage
  maxListings: number; // per-seller active-listing cap
  myListingCount: number; // how many active listings the viewer already has
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
  marketList(itemId: string, count: number, price: number): void;
  /** List ONE instanced copy (count 1), named by its payload: the sim escrows
   *  the actual held copy whose payload matches, refusing transfer-locked
   *  (bindOnTrade-armed or boundTo-bound) copies. Plain stacks use marketList. */
  marketListInstance(itemId: string, price: number, instance: ItemInstancePayload): void;
  marketBuy(listingId: number): void;
  marketCancel(listingId: number): void;
  marketCollect(): void;
}
