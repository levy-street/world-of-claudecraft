// Pure, host-agnostic core for the World Market's Market Sweep card.
//
// A sweep buys N units of one item across many sellers' listings in one command
// (src/sim/market_sweep.ts). The client cannot price it: it sees one browse page
// of a book the server filters and paginates, so the server plans on the whole
// book and echoes a quote in MarketInfo.sweepQuote alongside the request it was
// computed for. This core owns the three decisions worth testing without a DOM,
// leaving market_sweep_panel.ts to paint the card and dispatch:
//
//   1) WHICH browse rows may stage a sweep (the planner's own eligibility, read
//      off the wire row: someone else's plain, fungible listing).
//   2) WHAT the card states: the echoed quote, trusted only when it answers the
//      item AND count the player currently has staged (the sellPriceItemId
//      precedent), so a stale snapshot across a count edit never quotes the
//      previous ask.
//   3) Whether the quoted terms are STILL the live ones when the player confirms.
//      The prompt is modal but the market under it is not frozen; the sim holds
//      the final say (marketSweep refuses past the agreed cap), and this recheck
//      is the same stale-capture doctrine market_buy_confirm_core.ts applies so a
//      changed quote is refused with a reason instead of a silent server error.
//
// DOM-free and i18n-free: it returns states, ids and copper amounts, and the
// painter formats them. Driven by tests/market_sweep_core.test.ts.

import { MARKET_SWEEP_MAX_UNITS } from '../sim/market_sweep';
import type { MarketInfo, MarketListingView, MarketSweepQuote } from '../world_api';

/** What the player has staged: the item and how many units they want. */
export interface MarketSweepStage {
  itemId: string;
  count: number;
}

/** A browse row that may stage a sweep: someone else's plain, fungible listing
 *  (never mine, never house stock, never an instanced, crafted, or signed copy). */
export function sweepEligibleRow(l: MarketListingView): boolean {
  if (l.mine || l.house || l.instance) return false;
  if (l.craftedRecipeId !== undefined) return false;
  return !l.materialSources?.some(({ source }) => source.signer !== undefined);
}

/** The echoed quote, only when it answers the staged item and count. */
export function stagedSweepQuote(
  info: MarketInfo | null,
  stage: MarketSweepStage,
): MarketSweepQuote | null {
  const q = info?.sweepQuote ?? null;
  if (!q || q.itemId !== stage.itemId || q.count !== stage.count) return null;
  return q;
}

/**
 * What the card's quote line says. `waiting`: no echo for this stage yet (the
 * painter shows nothing rather than a stale line). `none`: the book holds no
 * eligible listing. `ok` / `short`: the plan, with `short` meaning the book could
 * not cover the count and the plan holds every eligible row. `each` is
 * `ceil(total / units)`, the browse row's own per-unit shape.
 */
export type SweepQuoteView =
  | { state: 'waiting' }
  | { state: 'none' }
  | { state: 'ok' | 'short'; units: number; listings: number; total: number; each: number };

export function sweepQuoteView(info: MarketInfo | null, stage: MarketSweepStage): SweepQuoteView {
  const q = stagedSweepQuote(info, stage);
  if (!q) return { state: 'waiting' };
  if (q.units === 0) return { state: 'none' };
  return {
    state: q.short ? 'short' : 'ok',
    units: q.units,
    listings: q.listings,
    total: q.total,
    each: Math.ceil(q.total / q.units),
  };
}

/** A typed unit count, clamped into the sweep's admitted range (junk reads as 1). */
export function sweepCountFromInput(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MARKET_SWEEP_MAX_UNITS);
}

/** The terms the player agreed to on the confirm prompt. */
export interface MarketSweepAgreed {
  units: number;
  total: number;
}

export type MarketSweepRecheck =
  | { state: 'ok'; total: number }
  | { state: 'gone' }
  | { state: 'changed' };

/**
 * Re-resolve the agreed quote against the live snapshot at confirm time. `gone`
 * when there is no matching quote any more (the mirror stopped streaming, the
 * stage changed, or the book emptied); `changed` when a quote still answers the
 * stage but on different terms than the player read. Both send nothing.
 */
export function recheckMarketSweep(
  info: MarketInfo | null,
  stage: MarketSweepStage,
  agreed: MarketSweepAgreed,
): MarketSweepRecheck {
  const q = stagedSweepQuote(info, stage);
  if (!q || q.units === 0) return { state: 'gone' };
  if (q.units !== agreed.units || q.total !== agreed.total) return { state: 'changed' };
  return { state: 'ok', total: q.total };
}
