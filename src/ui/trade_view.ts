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
import { ITEMS } from '../sim/data';
import type { InvSlot, ItemDef, ItemInstancePayload } from '../sim/types';

/** Total held count of `itemId` across every bag slot: the trade offer
 *  stepper's ceiling. */
export function tradeOfferCeiling(inventory: InvSlot[], itemId: string): number {
  return inventory.filter((s) => s.itemId === itemId).reduce((n, s) => n + s.count, 0);
}

/** Resolves the bag-style tooltip target (item def + optional per-instance
 *  payload) for the slot at `index` in a trade offer's item list. Both offer
 *  sides render from the same `InvSlot[]` (`TradeOffer.items` in
 *  `src/world_api/trade.ts`), so a trade slot's tooltip is exactly the item's
 *  bag tooltip, instance detail included. Returns null for an out-of-range
 *  index or an unrecognized item id (#2693). */
export function tradeRowTooltipTarget(
  items: InvSlot[],
  index: number,
): { item: ItemDef; instance?: ItemInstancePayload } | null {
  const s = items[index];
  if (!s) return null;
  const item = ITEMS[s.itemId];
  if (!item) return null;
  return { item, instance: s.instance };
}
