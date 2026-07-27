// Filler World Market listings for the dev evidence scripts: a block of cheap
// other-seller rows pushed straight into the sim's listing book so one
// screenshot can show a market busy enough to page, without 200 real sellers.
//
// Why the ids need an allocator of their own (#2475): the listing-id counter is
// `private nextListingId` on `Market` and `Sim` exposes nothing equivalent, so a
// script cannot read it. `scripts/market_listing_count_shot.mjs` used to try
// (`let id = sim.nextListingId`), read `undefined`, and stamp every one of its
// 200 rows with `NaN`, one unusable id shared by the whole block, which is the
// duplicate-id state #2463 was filed about. So the fillers take a band of their
// own, far above the player band the sim issues from (see
// `MARKET_PLAYER_LISTING_ID_BASE` in `src/sim/market_listing_ids.ts`), floored
// past whatever the book already holds.
//
// Pure Node: no puppeteer, no DOM, no `src/` import (scripts never import the TS
// sources raw). A Vitest imports it directly (`tests/market_filler_listings.test.ts`)
// and the shot script builds its rows here, then hands them to `page.evaluate`.

// The first id handed to a filler row. The sim starts the PLAYER band at 1000 and
// walks it one listing at a time, so a band three orders of magnitude further out
// cannot be reached by any number of listings a screenshot session can place.
export const MARKET_FILLER_LISTING_ID_BASE = 1_000_000;

// The filler block is one cheap stack of a common trash item repeated. Browse sorts
// by item NAME and only then by price, so what buries the seller's own goods is the
// filler item's name sorting ahead of theirs ("Bone Fragments" before "Cracked Wolf
// Fang"), not the asking price. That buried state is what the evidence shot captures.
const FILLER_ITEM_ID = 'bone_fragments';
const FILLER_PRICE_BASE = 40; // copper, a plausible trash-item ask
const FILLER_PRICE_SPREAD = 30; // rows cycle through base..base+spread-1 so prices vary
const FILLER_SECONDS_LEFT = 1000; // sim-seconds, long enough to outlive any capture

// A usable listing id: a positive safe integer. Mirrors `isListingId` in
// `src/sim/market_listing_ids.ts` (a `.mjs` script helper cannot import the TS
// source); `tests/market_filler_listings.test.ts` pins the two against each other
// so the copy cannot drift.
//
// Filtering before the comparison below is load-bearing, and not only for `NaN`
// (which a bare `>=` happens to reject on its own). A fractional id would give a
// fractional band, and a NUMERIC STRING is the nasty one: `'1000001' >= 1000000`
// coerces to true, then `'1000001' + 1` CONCATENATES to `'10000011'` and every row
// gets a string id no `l.id === listingId` lookup in the sim can ever match, which
// is the same unreachable-row failure as #2475 wearing a different mask.
function isUsableId(v) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
}

// The first id the filler block may take: at or past the reserved base, and past
// every id the book already holds, so the block collides with nothing already
// there and leaves the sim's own counter (which sits far below) free to keep
// issuing real listing ids for the rest of the session.
export function fillerListingIdBase(takenIds = []) {
  let base = MARKET_FILLER_LISTING_ID_BASE;
  for (const id of takenIds) if (isUsableId(id) && id >= base) base = id + 1;
  return base;
}

// Build `count` filler rows shaped exactly like a `MarketListing`
// (`src/sim/market.ts`), ready to push onto `sim.marketListings`. `takenIds` is
// the book's current ids and `now` is `sim.time`, both read out of the page first
// so the rows can be built here in Node where a Vitest can pin them. `now` is
// required rather than defaulted: rows expire at `now + FILLER_SECONDS_LEFT`, so a
// caller that forgot it would seed a block the next market sweep culls, and the
// capture would show an empty market with nothing raised anywhere.
export function buildFillerListings({ count, takenIds = [], now }) {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`buildFillerListings: count must be a non-negative safe integer, got ${count}`);
  }
  if (!Number.isFinite(now)) {
    throw new Error(`buildFillerListings: now must be a finite sim time, got ${now}`);
  }
  const base = fillerListingIdBase(takenIds);
  // Saturation is unreachable from a real book, but a band running off the end of the
  // safe-integer range would mint ids this module's own predicate rejects. Fail loudly
  // instead. Parenthesized deliberately: `base + count - 1` evaluates the sum FIRST,
  // and near the ceiling that sum rounds up before the subtraction brings it back
  // under, so the guard would clear a band whose last row is still 2 ** 53.
  const last = base + (count - 1);
  if (count > 0 && !Number.isSafeInteger(last)) {
    throw new Error(`buildFillerListings: id band ${base}..${last} is not representable`);
  }
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: base + i,
      sellerKey: `Trader${i}`,
      sellerName: `Trader${i}`,
      itemId: FILLER_ITEM_ID,
      count: 1,
      price: FILLER_PRICE_BASE + (i % FILLER_PRICE_SPREAD),
      expiresAt: now + FILLER_SECONDS_LEFT,
      house: false,
    });
  }
  return rows;
}

// The health of a set of listing ids, so a script that seeds the book can print
// the same verdict the Vitest asserts: every row reachable by its own id. This is
// #2475's acceptance criterion made executable, which is why it lives beside the
// allocator instead of being inlined in the one script that prints it.
export function summarizeListingIds(ids) {
  const all = [...ids];
  return {
    total: all.length,
    unique: new Set(all).size,
    unusable: all.filter((id) => !isUsableId(id)).length,
    duplicated: all.length - new Set(all).size,
  };
}
