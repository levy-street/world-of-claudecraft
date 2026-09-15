// The Market Sweep planner: buy N units of ONE item across many sellers' listings
// in a single action, cheapest per unit first. Pure and host-agnostic (no
// SimContext, no rng, the market_collapse precedent), so the ordering,
// eligibility, and all-or-nothing rules pin under tests/market_sweep_plan.test.ts
// with plain objects, and the offline Sim and the authoritative server plan
// byte-identically from the same book.
//
// Why a server-side plan and not a client loop of market_buy frames: the client
// only ever sees one browse page (MARKET_PAGE_SIZE) of a book the server filters
// and paginates, and its command lane admits ~30 frames a second, so "buy 40
// copper ore" as 40 buys is both blind and throttled. The sweep plans on the WHOLE
// book, quotes the total, and the buy carries that quote back as a price cap
// (Market.marketSweep), which is the confirm-time stale-capture doctrine
// market_buy_confirm_core.ts already applies to a single buy.
//
// Granularity: listings are whole-stack buyouts, so the plan takes whole rows and
// may overshoot the wanted count by up to one stack; the quote states the real
// unit total so the player agrees to what actually lands.
//
// Eligibility, all four deliberate:
//   - the viewer's own rows (a sweep never buys your own goods; reclaim is free);
//   - the Merchant's house stock (never depletes and pays no one, so it is not a
//     market to sweep; buying it stays the single Buy button);
//   - instanced copies (enchants, rolled stats, maker's marks: non-fungible);
//   - signed material stacks (the same non-fungible reasoning market_collapse
//     uses) and crafted-recipe stacks: their units do not merge into the plain
//     stack, so the one summed bag-capacity check the sweep makes before its
//     first settlement could not stand for them, and a sweep must buy everything
//     it quoted or nothing. Those rows keep the single Buy button. Unsigned
//     material sources are plain (gathered stock carries them by default).

import type { MaterialComposition } from './material_sources';
import type { ItemInstancePayload } from './types';

/** The most units one sweep may ask for: a fat-finger guard and a bound on the
 *  per-command work, not a balance lever. */
export const MARKET_SWEEP_MAX_UNITS = 200;

/** The listing shape the planner reads. `MarketListing` satisfies it. */
export interface SweepableListing {
  id: number;
  sellerKey: string;
  itemId: string;
  count: number;
  price: number; // total copper buyout for the whole stack
  house: boolean;
  instance?: ItemInstancePayload;
  craftedRecipeId?: string;
  materialSources?: MaterialComposition;
}

export interface MarketSweepPlan {
  itemId: string;
  /** The unit count the sweep asked for. */
  wanted: number;
  /** Listing ids to buy, in buy order (cheapest per unit first). */
  listingIds: number[];
  /** Units the plan actually delivers (>= wanted unless `short`). */
  units: number;
  /** Total copper for every listing in the plan. */
  total: number;
  /** The book could not cover `wanted`: the plan holds every eligible row. */
  short: boolean;
}

/** A plain, fungible, provenance-free, someone-else's listing of `itemId`. */
export function sweepEligible(
  l: SweepableListing,
  itemId: string,
  isMine: (l: SweepableListing) => boolean,
): boolean {
  if (l.itemId !== itemId || l.house || l.instance) return false;
  if (l.craftedRecipeId !== undefined) return false;
  if (l.materialSources?.some(({ source }) => source.signer !== undefined)) return false;
  return !isMine(l);
}

/**
 * Plan a sweep over `listings` for `wanted` units of `itemId`. Cheapest per unit
 * first (exact ratio, so a 5-stack at 25 beats a single at 6); ties go to the
 * older (smaller) listing id, the market_collapse tie-break. Takes whole rows
 * until the running unit count reaches `wanted`. Never mutates the input.
 */
export function planMarketSweep(
  listings: readonly SweepableListing[],
  itemId: string,
  wanted: number,
  isMine: (l: SweepableListing) => boolean,
): MarketSweepPlan {
  return planSweepFromCandidates(sweepCandidates(listings, itemId), itemId, wanted, isMine);
}

/**
 * The BOOK-level half of the plan: every plain, fungible, non-house listing of
 * `itemId`, cheapest per unit first (older id on a tie). A property of the book
 * alone (no viewer in it), so the Market memoizes it per bookRev the way it
 * memoizes its sorted views, and every viewer's quote and every sweep attempt
 * share one filter + sort per item per book change.
 */
export function sweepCandidates<T extends SweepableListing>(
  listings: readonly T[],
  itemId: string,
): T[] {
  return listings
    .filter((l) => sweepEligible(l, itemId, () => false))
    .sort((a, b) => a.price * b.count - b.price * a.count || a.id - b.id);
}

/** The VIEWER-level half: walk the sorted candidates, skipping the viewer's own
 *  rows, taking whole rows until `wanted` is covered. O(k) over the candidates. */
export function planSweepFromCandidates(
  candidates: readonly SweepableListing[],
  itemId: string,
  wanted: number,
  isMine: (l: SweepableListing) => boolean,
): MarketSweepPlan {
  const listingIds: number[] = [];
  let units = 0;
  let total = 0;
  for (const l of candidates) {
    if (units >= wanted) break;
    if (isMine(l)) continue;
    listingIds.push(l.id);
    units += l.count;
    total += l.price;
  }
  return { itemId, wanted, listingIds, units, total, short: units < wanted };
}

/** A wire or UI unit count, admitted only as a positive integer within the cap. */
export function sanitizeSweepCount(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  if (raw < 1 || raw > MARKET_SWEEP_MAX_UNITS) return null;
  return raw;
}
