// The Sales History provenance vocabulary, its own leaf module (the
// woc_market_economy_types.ts / woc_market_monitor_types.ts pattern):
// re-exported from woc_market.ts so every existing importer keeps that one
// home, while the coordinator stays under its ratchet ceiling.

import type { InvSlot } from '../src/sim/types';
import type { WocListingFormat } from './woc_market_rules';

/** How a sale closed, for the Sales History tab. Derived at the one insert
 *  site from facts in hand (directed offer, buy-now claim vs auction win) and
 *  stamped on the row, since the listing it came from is later pruned. */
export type WocSaleType = 'auction' | 'buy_now' | 'directed';

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
  // The Sales History axes, stamped at insert from the settled listing (which
  // carries them all) and derived saleType. Null on rows written before this
  // shipped: they sit outside the filtered results, the same convention the
  // Browse category stamps use for pre-enable listings. category/subcategory
  // are filter-only (never on the wire); quality also frames the item cell.
  // Optional so the many delivery/settlement test fixtures that predate this
  // compile unchanged; a live row read (toSale) always materializes them.
  saleType?: WocSaleType | null;
  quality?: string | null;
  category?: string | null;
  subcategory?: string | null;
  excluded: boolean;
  atMs: number;
}

/** The Sales History read's filter tuple: the Browse axes minus sort (sales
 *  are always most-recent-first). `format` reuses the Browse listing-format
 *  vocabulary and matches a row's stamped saleType; 'directed' is reachable
 *  only by leaving it null (no directed listings browse, so no filter option
 *  offers it), which lets directed sales show in the unfiltered list. */
export interface WocSalesQuery {
  page: number;
  pageSize: number;
  quality: string | null;
  /** Matches the row's stamped sale_type, not a listing format: the sale-type
   *  vocabulary is auction/buy_now/directed, so `auction_buy_now` (a listing
   *  format that no sale row ever carries) is rejected at the route rather than
   *  answering an empty page. */
  format: WocSaleType | null;
  category: string | null;
  subcategory: string | null;
  itemIds: readonly string[] | null;
}

/** The Browse read's filter tuple. Moved to this query-types leaf beside
 *  WocSalesQuery (they share the axes) to keep the coordinator under its
 *  ratchet ceiling; re-exported from woc_market.ts. */
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

/** A player's strike/suspension state (the anti-default ledger). A row type
 *  moved here beside the other read types to keep the coordinator under its
 *  ratchet ceiling; re-exported from woc_market.ts. */
export interface WocStrikeRow {
  accountId: number;
  strikes: number;
  suspendedUntilMs: number | null;
}

/** The seller click-through's public profile line: only facts the game
 *  already shows in the world (the guild tag on nameplates and rosters).
 *  Derived per read, never stored on sale rows. Moved here beside the seller
 *  sale readout; re-exported from woc_market.ts. */
export interface WocSellerProfile {
  guildName: string | null;
}

/** The seller click-through's one cached readout: sales plus profile. */
export interface WocSellerHistoryReadout {
  sales: WocSaleRow[];
  profile: WocSellerProfile | null;
}
