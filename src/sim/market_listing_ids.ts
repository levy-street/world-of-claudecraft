// The World Market's listing-id allocator: the pure core that keeps the
// Merchant's standing house stock and persisted player listings in two
// non-overlapping id bands.
//
// Why this exists (#2463): house rows are reseeded from the SAME counter on
// every boot and are never persisted, while player listings are pushed back
// from the save carrying the ids an OLDER build issued them. Every time the
// stock table grows, the reseeded house band swallows ids that build had
// already handed to real player listings, and because the house rows are pushed
// first, `findIndex((l) => l.id === listingId)` resolves the duplicate to the
// house row: the owner cannot reclaim their goods ("That is not your listing")
// and a buyer gets the house item at the house price without the row ever being
// consumed, so the purchase repeats and the seller is never paid.
//
// Two complementary rules, both pure and both tested directly:
//  - `playerListingIdFloor` reserves a whole low band for house stock, so
//    growing the Merchant's stock table can never reach the player band again.
//  - `planListingIds` settles the counter BEFORE the load pushes anything back
//    and reissues any persisted id the book has already taken, which repairs a
//    save that an earlier stock batch already armed.
//
// `src/sim`-pure: no imports at all, no rng, no clock. A Vitest imports it
// directly (`tests/market_listing_ids.test.ts`).

// The first id the counter hands to a PLAYER listing on a fresh world. Every id
// below it belongs to the reseeded house band, which is a couple of dozen rows
// today and may grow into the whole reserved span without ever reaching a
// persisted player id.
export const MARKET_PLAYER_LISTING_ID_BASE = 1000;

// A usable listing id: a positive safe integer. Anything else a persisted row
// can carry (missing, null, fractional, NaN, Infinity, past the safe-integer
// range, or a numeric string) is treated as NO id and gets reissued: the
// id-resolving call sites match with `===`, so such a row would be unreachable
// for its owner and would poison the counter through `Math.max`.
export function isListingId(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
}

// The counter to resume from once the house band is seeded: at or past the
// reserved base, and past every seeded row, so the player band starts at
// MARKET_PLAYER_LISTING_ID_BASE on a fresh world and still clears the stock
// table in the (unreached) case where it ever outgrows the reserved span.
export function playerListingIdFloor(seededIds: Iterable<number>): number {
  let floor = MARKET_PLAYER_LISTING_ID_BASE;
  for (const id of seededIds) if (isListingId(id) && id >= floor) floor = id + 1;
  return floor;
}

export interface ListingIdPlanInput {
  // Ids already in the book when the save is replayed (the reseeded house band).
  taken: Iterable<number>;
  // The persisted listing ids in save order; any entry may be malformed.
  saved: readonly unknown[];
  // The counter as it stands before the replay (post-seed, so already floored).
  from: number;
  // The counter the save carries: honoured when it is ahead, never trusted alone.
  savedNext: unknown;
}

export interface ListingIdPlan {
  // The id to push each persisted listing back with, index-aligned with `saved`
  // (a row the caller skips simply leaves its planned id unused).
  ids: number[];
  // The counter the market resumes issuing from.
  nextListingId: number;
  // How many persisted ids had to be reissued; 0 on a healthy save.
  remapped: number;
}

// Decide the id every persisted listing is replayed under, keeping the whole
// book collision-free. A healthy save keeps every id verbatim and reports
// `remapped: 0`.
export function planListingIds(input: ListingIdPlanInput): ListingIdPlan {
  const used = new Set<number>();
  for (const id of input.taken) if (isListingId(id)) used.add(id);

  // Settle the counter FIRST, past everything the book already holds AND
  // everything the save carries. Doing this before a single id is handed out is
  // what stops a reissued id from landing on a persisted id further down the
  // same save (the old code advanced the counter only AFTER the push loop, so
  // it could not have reissued anything safely).
  let next = isListingId(input.from) ? input.from : 1;
  for (const id of used) if (id >= next) next = id + 1;
  if (isListingId(input.savedNext) && input.savedNext > next) next = input.savedNext;
  for (const id of input.saved) if (isListingId(id) && id >= next) next = id + 1;

  const ids: number[] = [];
  let remapped = 0;
  for (const id of input.saved) {
    if (isListingId(id) && !used.has(id)) {
      used.add(id);
      ids.push(id);
      continue;
    }
    // Taken by the house band, duplicated inside the save, or malformed: hand
    // out a fresh id from the settled counter.
    used.add(next);
    ids.push(next);
    next++;
    remapped++;
  }
  return { ids, nextListingId: next, remapped };
}
