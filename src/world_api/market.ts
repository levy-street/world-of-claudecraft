import type { MarketListOptions } from '../sim/market';
import type { MarketQuery } from '../sim/market_query';
import type { InvSlot } from '../sim/types';

// ---------------------------------------------------------------------------
// The World Market (the Merchant's auction house). Listings are global and
// shared by every player; collections are the per-player gold + items waiting
// to be picked up (sale proceeds, expired/returned listings, outbid refunds).
// ---------------------------------------------------------------------------

export interface MarketListingView {
  id: number;
  sellerName: string;
  itemId: string;
  count: number;
  price: number; // total copper buyout for the whole stack (auction: the starting bid)
  mine: boolean; // the viewer is the seller (offer them Cancel, not Buy)
  house: boolean; // the Merchant's own standing stock
  secondsLeft: number; // sim-seconds until expiry; -1 for house stock (no expiry)
  kind: 'fixed' | 'auction';
  pricePerUnit?: number; // fixed rows only; absent on a legacy whole-lot row
  currentBid?: number; // auction rows: the standing high bid, if any
  minNextBid?: number; // auction rows: the lowest bid the sim will accept
  buyoutPrice?: number; // auction rows: optional instant whole-lot price
  myBid: boolean; // the viewer holds the standing high bid
  // Total copper forfeited if the viewer cancels this listing unsold. Only sent
  // for the viewer's own listings (undefined otherwise); 0 for a legacy/house row.
  depositTotal?: number;
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
  durationsHours: readonly number[]; // the selectable listing duration tiers
}

export interface IWorldMarket {
  marketInfo: MarketInfo | null;
  // World Market. The browse query (search + type/subtype/rarity filters + sort +
  // page) is sent to the server, which filters and paginates; marketInfo mirrors
  // the result.
  marketSearch(query: MarketQuery): void;
  // pricePerUnit is the per-unit ask for a fixed listing (ignored for an auction);
  // opts selects the duration tier and, for an auction lot, the bid parameters.
  marketList(itemId: string, count: number, pricePerUnit: number, opts?: MarketListOptions): void;
  // quantity buys part of a per-unit row (default: the whole remainder). Legacy
  // whole-lot rows and auction buyouts always transact the full stack.
  marketBuy(listingId: number, quantity?: number): void;
  marketBid(listingId: number, amount: number): void;
  marketCancel(listingId: number): void;
  marketCollect(): void;
}
