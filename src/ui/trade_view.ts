// Pure view-core for the Trade window (#trade-window). Owns the offer
// stepper's ceiling (how many of one item id the player may stage into a
// trade offer) and the per-row item resolution the offer columns render.
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
import { itemDisplayName } from './entity_i18n';
import { formatNumber, t } from './i18n';
import { knownItemDef } from './known_item';

/** Total held count of `itemId` across every bag slot: the trade offer
 *  stepper's ceiling. */
export function tradeOfferCeiling(inventory: InvSlot[], itemId: string): number {
  return inventory.filter((s) => s.itemId === itemId).reduce((n, s) => n + s.count, 0);
}

/** One offer row, resolved for rendering. `item` is undefined for an id this
 *  bundle cannot resolve; the label then shows the raw id and the painter must
 *  swap its icon for the unknown-item fallback rather than dereferencing. */
export interface TradeItemRowModel {
  item: ItemDef | undefined;
  label: string;
}

/** Resolve one offer slot into its row model (stale-client guard, R34). The
 *  OTHER side's offer is server truth: it can carry item ids minted by content
 *  this bundle predates, and the shipped failure shape was an itemIcon throw
 *  on exactly that slot, freezing the whole offer display. An unknown id keeps
 *  its raw id as the label, so the row still names what is on the table. */
export function buildTradeItemRow(
  slot: InvSlot,
  items: Readonly<Record<string, ItemDef>>,
): TradeItemRowModel {
  // knownItemDef, not a bare index: a prototype-key id must take the
  // unknown arm here, or the fallback below never runs (R34 family).
  const item: ItemDef | undefined = knownItemDef(items, slot.itemId);
  const name = item ? itemDisplayName(item) : slot.itemId;
  const label =
    slot.count > 1
      ? `${name} ${t('itemUi.bags.stackCount', {
          count: formatNumber(slot.count, { maximumFractionDigits: 0 }),
        })}`
      : name;
  return { item, label };
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
  // knownItemDef, not a bare ITEMS index: this branches between a known-item
  // arm and an unknown-item arm, so a prototype-key id must take the
  // unknown arm here too (R34 family, src/ui/known_item.ts).
  const item = knownItemDef(ITEMS, s.itemId);
  if (!item) return null;
  return { item, instance: s.instance };
}
