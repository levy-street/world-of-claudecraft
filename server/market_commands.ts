// World Market wire surface: the command bodies of the Merchant's auction house
// (market_search, market_sell_price_check, market_list, market_list_instance,
// market_buy, market_sweep_quote, market_sweep, market_cancel, market_collect),
// extracted whole from server/game.ts with the Market Sweep (the monolith
// ratchet; the farming_commands precedent). The case labels stay in game.ts:
// the command-schema suite scans that switch for the dispatch universe, and the
// labels ARE the protocol surface. This module owns the frame guards only; the
// sim stays the single definition of legality.

import { sanitizeMarketQuery } from '../src/sim/market_query';
import type { Sim } from '../src/sim/sim';
import type { ItemInstancePayload } from '../src/sim/types';
import { buyWithSoldVolume, sweepWithSoldVolume } from './market_sold_volume';

/** Routes one market command frame. `msg` is the already-parsed client frame
 *  (game.ts's ClientMessage, structurally a string-keyed record); every field is
 *  TYPE-guarded here exactly as dispatchMessage guards its own cases, never
 *  normalized (an unknown value is refused, not laundered into a default the
 *  sim never saw). Returns whether a sim method was invoked. */
export function dispatchMarketCommand(
  sim: Sim,
  msg: Record<string, unknown>,
  pid: number,
): boolean {
  switch (msg.cmd) {
    case 'market_search':
      sim.marketSearch(
        sanitizeMarketQuery({
          search: typeof msg.q === 'string' ? msg.q : '',
          itemType: msg.itemType,
          subtype: msg.subtype,
          armorClass: msg.armorClass,
          primaryStat: msg.primaryStat,
          rarity: msg.rarity,
          sort: msg.sort,
          page: typeof msg.page === 'number' ? msg.page : 0,
          collapseLowest: msg.collapseLowest,
        }),
        pid,
      );
      return true;
    case 'market_sell_price_check':
      sim.marketSellPriceCheck(typeof msg.item === 'string' ? msg.item : null, pid);
      return true;
    case 'market_list':
      if (
        typeof msg.item === 'string' &&
        typeof msg.count === 'number' &&
        Number.isFinite(msg.count) &&
        typeof msg.price === 'number' &&
        Number.isFinite(msg.price)
      ) {
        sim.marketList(msg.item, msg.count, msg.price, pid);
        return true;
      }
      return false;
    case 'market_list_instance':
      // The instance object is only an equality needle: the sim re-resolves
      // it against the sender's own bags and escrows the actual held copy's
      // payload, so no wire-supplied field ever enters the book directly.
      if (
        typeof msg.item === 'string' &&
        typeof msg.price === 'number' &&
        Number.isFinite(msg.price) &&
        typeof msg.instance === 'object' &&
        msg.instance !== null &&
        !Array.isArray(msg.instance)
      ) {
        sim.marketListInstance(msg.item, msg.price, msg.instance as ItemInstancePayload, pid);
        return true;
      }
      return false;
    case 'market_buy':
      if (typeof msg.id === 'number') {
        buyWithSoldVolume(sim, msg.id, pid);
        return true;
      }
      return false;
    case 'market_sweep_quote':
      // The count is re-sanitized sim-side (sanitizeSweepCount); a junk count
      // clears the quote rather than quoting a bogus plan.
      if (typeof msg.item === 'string' && typeof msg.count === 'number') {
        sim.marketSweepQuote(msg.item, msg.count, pid);
        return true;
      }
      return false;
    case 'market_sweep':
      // `max` is the quoted total the buyer agreed to; the sim re-plans on the
      // live book and refuses past it, so a client can never name its own price.
      if (
        typeof msg.item === 'string' &&
        typeof msg.count === 'number' &&
        typeof msg.max === 'number' &&
        Number.isFinite(msg.max)
      ) {
        sweepWithSoldVolume(sim, msg.item, msg.count, msg.max, pid);
        return true;
      }
      return false;
    case 'market_cancel':
      if (typeof msg.id === 'number') {
        sim.marketCancel(msg.id, pid);
        return true;
      }
      return false;
    case 'market_collect':
      sim.marketCollect(pid);
      return true;
    default:
      return false;
  }
}
