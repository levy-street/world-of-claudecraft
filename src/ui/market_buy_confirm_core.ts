// Pure, host-agnostic core for the World Market buy confirmation.
//
// A market buyout spends coin the instant it lands and there is no buyback for
// it (the vendor buyback tab covers vendor sales only), so the Browse tab's Buy
// button asks first. This core owns the two decisions worth testing without a
// DOM, leaving market_window.ts to paint the prompt and dispatch:
//
//   1) WHAT the prompt states: the listing's terms captured at the moment the
//      player pressed Buy (id, item, stack count, total ask, per-unit ask).
//   2) Whether the captured terms are STILL the live ones when the player
//      confirms. The prompt is modal but the market underneath it is not frozen:
//      the window repaints on the snapshot band, a listing can sell to someone
//      else, expire, or be replaced at the same id by the server's id reuse. The
//      bank withdraw prompt already holds this doctrine (re-resolve the live row
//      and refuse on a mismatch rather than acting on a stale capture); buying
//      the WRONG stack, or the right one at a price the player never read, is
//      exactly that failure with coin attached.
//
// The per-unit ask is `ceil(price / count)`, byte-identical to the browse row's
// "{money} each" line, so the prompt never quotes a different unit price than
// the row the player just read.
//
// DOM-free and i18n-free: it returns ids and copper amounts, and the painter
// formats them. Driven directly by tests/market_buy_confirm.test.ts against both
// a Sim-shaped and a ClientWorld-mirror-shaped snapshot.

import type { MarketInfo, MarketListingView } from '../world_api';

/**
 * The terms of the listing the player asked to buy, captured when the prompt
 * opens. Everything the confirm copy quotes plus the id the buy command sends.
 */
export interface MarketBuyConfirm {
  listingId: number;
  itemId: string;
  /** How many the stack holds (1 for a single). */
  count: number;
  /** Total copper buyout for the whole stack. */
  price: number;
  /** Per-unit ask for a stack (the browse row's "each"), null for a single. */
  unitPrice: number | null;
}

/** Capture a browse row's terms for the confirm prompt. */
export function marketBuyConfirm(listing: MarketListingView): MarketBuyConfirm {
  return {
    listingId: listing.id,
    itemId: listing.itemId,
    count: listing.count,
    price: listing.price,
    unitPrice: listing.count > 1 ? Math.ceil(listing.price / listing.count) : null,
  };
}

/**
 * The verdict on a confirmed purchase: `ok` to send it, `gone` when the listing
 * left the snapshot entirely, `changed` when a listing still answers to that id
 * but on different terms than the player agreed to (a different item, stack
 * count, or price). Both refusals send nothing.
 */
export type MarketBuyRecheck = { state: 'ok' } | { state: 'gone' } | { state: 'changed' };

/**
 * Re-resolve the captured listing against the live snapshot at confirm time.
 *
 * `info === null` (the player walked out of the Merchant's range while the
 * prompt was up, so the market mirror stopped streaming) is `gone`: with no
 * snapshot there is nothing to agree with, and the server would refuse the buy
 * on range anyway.
 *
 * `mine` is treated as `changed` rather than `ok`: the browse row only offers
 * Buy on someone else's listing, so a captured id that now reads as the viewer's
 * own is a different listing wearing the same id, not the one they agreed to.
 */
export function recheckMarketBuy(
  info: MarketInfo | null,
  confirm: MarketBuyConfirm,
): MarketBuyRecheck {
  if (!info) return { state: 'gone' };
  const live = info.listings.find((listing) => listing.id === confirm.listingId);
  if (!live) return { state: 'gone' };
  if (
    live.itemId !== confirm.itemId ||
    live.count !== confirm.count ||
    live.price !== confirm.price ||
    live.mine
  ) {
    return { state: 'changed' };
  }
  return { state: 'ok' };
}
