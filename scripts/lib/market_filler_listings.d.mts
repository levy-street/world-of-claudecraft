// Hand-written types for market_filler_listings.mjs (scripts/CLAUDE.md: a module a
// type-checked Vitest imports carries a .d.mts next to the .mjs). The export set here
// is pinned against the runtime module by tests/market_filler_listings.test.ts.

// One filler row, shaped exactly like `MarketListing` in src/sim/market.ts.
export interface FillerListing {
  id: number;
  sellerKey: string;
  sellerName: string;
  itemId: string;
  count: number;
  price: number;
  expiresAt: number;
  house: false;
}

export interface FillerListingInput {
  // How many filler rows to build.
  count: number;
  // Ids the book already holds, so the band is floored past them.
  takenIds?: Iterable<unknown>;
  // The sim clock the rows expire against (`sim.time`). Required, so a caller
  // cannot seed a block that the next market sweep silently culls.
  now: number;
}

export interface ListingIdSummary {
  total: number;
  unique: number;
  // Ids that are not positive safe integers (the #2475 failure: every row `NaN`).
  unusable: number;
  duplicated: number;
}

export declare const MARKET_FILLER_LISTING_ID_BASE: number;
export declare function fillerListingIdBase(takenIds?: Iterable<unknown>): number;
export declare function buildFillerListings(input: FillerListingInput): FillerListing[];
export declare function summarizeListingIds(ids: Iterable<unknown>): ListingIdSummary;
