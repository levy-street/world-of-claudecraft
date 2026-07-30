// Pure view-core for the Trade window (#trade-window). Currently owns only
// the offer stepper's ceiling: how many of one item id the player may stage
// into a trade offer.
//
// addItemToTrade (hud.ts) used to read the FIRST matching bag slot's count
// (Array.find) as that ceiling, so a fungible item split across multiple bag
// stacks (bags.ts's DEFAULT_STACK caps a stack at 20, so anything held above
// that lives in 2+ InvSlot entries) could never be offered past whichever
// single slot the search happened to land on, even though the player held
// more and the sim's own countItem/offerableCount (src/sim/sim.ts,
// src/sim/social/trade.ts) already validate the offer against the SUMMED
// total. market_window.ts's bagCount() and mailbox_window.ts's
// ownedCountFor() already sum every matching slot for this same question;
// tradeOfferCeiling gives the trade window the same total.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).
import type { InvSlot } from '../sim/types';

/** Total held count of `itemId` across every bag slot: the trade offer
 *  stepper's ceiling. */
export function tradeOfferCeiling(inventory: InvSlot[], itemId: string): number {
  return inventory.filter((s) => s.itemId === itemId).reduce((n, s) => n + s.count, 0);
}
