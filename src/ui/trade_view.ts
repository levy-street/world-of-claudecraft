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
import { countRawInSlots } from '../sim/item_lock';
import type { MaterialComposition } from '../sim/material_sources';
import { TRADE_OFFER_MAX_LINES } from '../sim/social/trade';
import type { InvSlot, ItemDef, ItemInstancePayload } from '../sim/types';
import { itemDisplayName } from './entity_i18n';
import { formatNumber, t } from './i18n';
import { knownItemDef } from './known_item';
import { materialSourcesForDisplay } from './material_sources_view';

/** Total held count of `itemId` across every bag slot: the trade offer
 *  stepper's ceiling. A thin domain alias over the shared sim walk
 *  (item_lock.ts countRawInSlots), so the ceiling can never drift from the
 *  summed total the sim validates the offer against. */
export function tradeOfferCeiling(inventory: InvSlot[], itemId: string): number {
  return countRawInSlots(inventory, itemId);
}

/** The sim's own line cap (src/sim/social/trade.ts tradeSetOffer), re-exported
 *  so the UI and the server can never disagree about how many lines fit. */
export { TRADE_OFFER_MAX_LINES };

/** How many more units of `itemId` the player may still stage into the
 *  offer: the summed held total (tradeOfferCeiling) minus what the offer
 *  already carries, and 0 when a NEW line would exceed the line cap. This is
 *  the shift-click quantity prompt's ceiling (bags_window.ts) and the guard
 *  every stage runs, so the two can never disagree about what fits. */
export function tradeOfferHeadroom(
  staged: InvSlot[],
  inventory: InvSlot[],
  itemId: string,
): number {
  const existing = staged.find((s) => s.itemId === itemId);
  if (!existing && staged.length >= TRADE_OFFER_MAX_LINES) return 0;
  return Math.max(0, tradeOfferCeiling(inventory, itemId) - (existing?.count ?? 0));
}

/** Stage `count` more units of `itemId` into the offer, clamped to the
 *  headroom above, mutating `staged` IN PLACE (the Hud-owned live object the
 *  trade controller also mutates). Returns the number of units actually
 *  added (0 when nothing fit: the caller then skips the offer push). */
export function stageTradeOffer(
  staged: InvSlot[],
  inventory: InvSlot[],
  itemId: string,
  count: number,
): number {
  const room = tradeOfferHeadroom(staged, inventory, itemId);
  const added = Math.min(room, Math.max(0, Math.floor(count)));
  if (added < 1) return 0;
  const existing = staged.find((s) => s.itemId === itemId);
  if (existing) existing.count += added;
  else staged.push({ itemId, count: added });
  return added;
}

/** Whether a click on an offered row opens the remove-quantity prompt: only
 *  a line with MORE than one unit has a quantity to choose. A one-unit line
 *  (every weapon and armour piece) unstages directly, the way it always did;
 *  the offer side's twin is bags_view.ts tradeOfferOpensPrompt. */
export function tradeOfferRemoveOpensPrompt(line: InvSlot): boolean {
  return Math.floor(line.count) > 1;
}

/** Take `count` units off one staged line (the trade window's remove
 *  prompt); the whole line leaves the table once nothing is left. Mutates
 *  `staged` in place (the Hud-owned live object) and returns whether anything
 *  changed, so the caller can skip a no-op push. A line that is no longer
 *  staged is left alone (a stale prompt). */
export function removeTradeOfferUnits(staged: InvSlot[], itemId: string, count: number): boolean {
  const index = staged.findIndex((s) => s.itemId === itemId);
  if (index < 0) return false;
  const taken = Math.floor(count);
  if (taken < 1) return false;
  if (taken >= staged[index].count) {
    staged.splice(index, 1);
    return true;
  }
  staged[index].count -= taken;
  return true;
}

/** The remove prompt's submit guard: null REFUSES when the line already left
 *  the table, else the requested count clamped to [1, the line's live count]
 *  (so "remove 50" of a line of 12 removes the line). */
export function resolveTradeOfferRemove(
  staged: InvSlot[],
  itemId: string,
  requested: number,
): number | null {
  const line = staged.find((s) => s.itemId === itemId);
  if (!line || line.count < 1) return null;
  return Math.max(1, Math.min(line.count, Math.floor(requested) || 0));
}

/** Re-resolve the trade quantity prompt at submit against the LIVE headroom
 *  (the bank family's stale-prompt guard, bank_quantity_prompt.ts): null
 *  REFUSES when nothing fits any more (the trade closed, the stack left the
 *  bags, the line filled up), else the requested count clamped to [1, room]. */
export function resolveTradeOfferSubmit(liveHeadroom: number, requested: number): number | null {
  if (liveHeadroom < 1) return null;
  return Math.max(1, Math.min(liveHeadroom, Math.floor(requested) || 0));
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
): {
  item: ItemDef;
  instance?: ItemInstancePayload;
  materialSources?: MaterialComposition;
} | null {
  const s = items[index];
  if (!s) return null;
  // knownItemDef, not a bare ITEMS index: this branches between a known-item
  // arm and an unknown-item arm, so a prototype-key id must take the
  // unknown arm here too (R34 family, src/ui/known_item.ts).
  const item = knownItemDef(ITEMS, s.itemId);
  if (!item) return null;
  // A staged offer line PINS the exact units it offers, so the row states which
  // contributors are on the table: this is the identity the counterparty is
  // agreeing to, not decoration.
  return { item, instance: s.instance, materialSources: materialSourcesForDisplay(s) };
}
