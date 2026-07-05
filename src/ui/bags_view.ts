// Pure, host-agnostic core for the Bags window (#bags). It owns the bag grid's
// DOM-free decisions: (1) the mode-dependent click behaviour (trade / market-sell
// / vendor / pet-feed / quest-discard / plain-use) and the matching tooltip hint,
// so the 6-way branch is unit-tested without the DOM, and (2) the filtered grid
// model (empty vs no-match vs the ordered visible slots), reusing the already
// extracted bag_filter core rather than re-deriving the filter. bags_window
// renders the grid and performs the actual dispatch, mirroring the unit_portrait
// pure-core split.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import type { InvSlot } from '../sim/types';
import { applyBagFilter, type BagFilterState, type ItemLookup } from './bag_filter';

/** The item facts the bag click/tooltip logic needs (a subset of ItemDef). */
export interface BagItemInfo {
  kind: string;
  noMarketList?: boolean;
  /** Truthy when the item has a generic "use" effect (e.g. fishing). */
  use?: unknown;
}

/** The open-window modes that change what a bag click does. At most one is the
 *  effective mode (checked in priority order: trade, mail-attach, market-sell,
 *  vendor, pet-feed). */
export interface BagMode {
  tradeOpen: boolean;
  /** The Ravenpost mailbox is open on its Send tab (clicks attach parcels). */
  mailAttach: boolean;
  /** The World Market is open on its Sell tab. */
  marketSell: boolean;
  vendorOpen: boolean;
  /** Pet-feed cursor mode is armed. */
  petFeed: boolean;
}

/** What clicking a bag item does, given the item + modes. The *Blocked variants
 *  mean the click is rejected with an error toast (no dispatch). */
export type BagAction =
  | 'trade'
  | 'mailAttach'
  | 'mailAttachBlocked'
  | 'marketSell'
  | 'marketSellBlockedQuest'
  | 'marketSellBlockedNoMarket'
  | 'vendorSell'
  | 'petFeed'
  | 'petFeedBlocked'
  | 'discardQuest'
  | 'equipBag'
  | 'use';

/** The tooltip hint sub-line i18n key for a bag item (or '' for no hint). */
export type BagTooltipHintKey =
  | 'itemUi.tooltip.clickTradeOffer'
  | 'itemUi.tooltip.cannotMarket'
  | 'itemUi.tooltip.clickMarketList'
  | 'itemUi.tooltip.cannotVendor'
  | 'itemUi.tooltip.clickSell'
  | 'itemUi.tooltip.clickDestroy'
  | 'itemUi.tooltip.clickEquip'
  | 'itemUi.tooltip.clickConsume'
  | 'itemUi.tooltip.clickUseInstant'
  | 'itemUi.tooltip.clickUse'
  | 'hudChrome.mailbox.clickAttach'
  | 'hudChrome.mailbox.cannotMail'
  | '';

/** Decide what a click on a bag item does. Mirrors the original click handler's
 *  priority order exactly: trade > market-sell > vendor > pet-feed > quest > use. */
export function bagItemAction(item: BagItemInfo, mode: BagMode): BagAction {
  if (mode.tradeOpen) return 'trade';
  if (mode.mailAttach) {
    // Mirrors the sim's mail escrow rule: quest and unmailable items refuse.
    if (item.kind === 'quest' || item.noMarketList) return 'mailAttachBlocked';
    return 'mailAttach';
  }
  if (mode.marketSell) {
    if (item.kind === 'quest') return 'marketSellBlockedQuest';
    if (item.noMarketList) return 'marketSellBlockedNoMarket';
    return 'marketSell';
  }
  if (mode.vendorOpen) return 'vendorSell';
  if (mode.petFeed) return item.kind === 'food' ? 'petFeed' : 'petFeedBlocked';
  if (item.kind === 'quest') return 'discardQuest';
  if (item.kind === 'bag') return 'equipBag';
  return 'use';
}

/** Whether a shift-click on a bag item should link it into chat (classic
 *  shift-click-to-link). True in every mode except at a vendor, where shift-click
 *  already owns the split-stack sell prompt; that affordance is left untouched. */
export function bagShiftLinks(mode: BagMode): boolean {
  return !mode.vendorOpen;
}

/** The tooltip hint sub-line for a bag item, matching the original tooltip's
 *  mode-then-kind branch. Returns '' when no hint applies (e.g. a material). */
export function bagTooltipHintKey(item: BagItemInfo, mode: BagMode): BagTooltipHintKey {
  if (mode.tradeOpen) return 'itemUi.tooltip.clickTradeOffer';
  if (mode.mailAttach) {
    return item.kind === 'quest' || item.noMarketList
      ? 'hudChrome.mailbox.cannotMail'
      : 'hudChrome.mailbox.clickAttach';
  }
  if (mode.marketSell) {
    return item.kind === 'quest' || item.noMarketList
      ? 'itemUi.tooltip.cannotMarket'
      : 'itemUi.tooltip.clickMarketList';
  }
  if (mode.vendorOpen)
    return item.kind === 'quest' ? 'itemUi.tooltip.cannotVendor' : 'itemUi.tooltip.clickSell';
  if (item.kind === 'quest') return 'itemUi.tooltip.clickDestroy';
  if (item.kind === 'weapon' || item.kind === 'armor' || item.kind === 'bag')
    return 'itemUi.tooltip.clickEquip';
  if (item.kind === 'food' || item.kind === 'drink') return 'itemUi.tooltip.clickConsume';
  if (item.kind === 'potion') return 'itemUi.tooltip.clickUseInstant';
  if (item.use) return 'itemUi.tooltip.clickUse';
  return '';
}

/** The quality key into QUALITY_COLOR for an item ('common' when unspecified).
 *  The painter maps this to a color token; centralizing the default here keeps
 *  the fallback out of the painter as a magic string. */
export function bagQualityKey(item: { quality?: string }): string {
  return item.quality ?? 'common';
}

/** The three grid states: the whole bag is empty, the filter matched nothing, or
 *  there are visible rows to paint. */
export type BagGridState = 'empty' | 'noMatch' | 'items';

export interface BagGridModel {
  state: BagGridState;
  /** The filtered, ordered slots to paint (empty unless state === 'items'). */
  visible: InvSlot[];
  /** Free slot squares to paint after the items (0 while a filter/search is
   *  active: a filtered view shows matches only, not the free space). */
  emptyCells: number;
  /** Stacks above the capacity budget (a legacy over-capacity save); the
   *  painter surfaces it on the capacity counter. 0 when within budget. */
  overflow: number;
}

/** True when the filter is showing everything (no category, no search), which
 *  is the only view where the free-slot squares are meaningful. */
export function bagFilterIsDefault(filter: BagFilterState): boolean {
  return filter.category === 'all' && filter.search.trim() === '';
}

/** Build the filtered grid model from the raw inventory + filter state, reusing
 *  applyBagFilter (bag_filter.ts) for the filter/sort. An empty unfiltered bag
 *  paints capacity empty squares (state 'empty' keeps the "(empty)" line for a
 *  zero-capacity edge); a non-empty bag whose filter matches nothing shows the
 *  "no match" line; otherwise the ordered visible slots are painted, padded
 *  with the free-slot squares in the unfiltered view. */
export function buildBagGrid(
  inventory: readonly InvSlot[],
  lookup: ItemLookup,
  filter: BagFilterState,
  capacity = 0,
): BagGridModel {
  const showEmpties = bagFilterIsDefault(filter);
  const emptyCells = showEmpties ? Math.max(0, capacity - inventory.length) : 0;
  const overflow = Math.max(0, inventory.length - capacity);
  if (inventory.length === 0) {
    return emptyCells > 0
      ? { state: 'items', visible: [], emptyCells, overflow }
      : { state: 'empty', visible: [], emptyCells: 0, overflow };
  }
  const visible = applyBagFilter(inventory, lookup, filter);
  if (visible.length === 0) return { state: 'noMatch', visible: [], emptyCells: 0, overflow };
  return { state: 'items', visible, emptyCells, overflow };
}

/** One socket of the bag bar: the equipped bag (with its slot count) or an
 *  empty socket awaiting a bag item. */
export interface BagSocketModel {
  socket: number;
  itemId: string | null;
  slots: number;
}

/** The bag-bar model: the implicit backpack plus the 4 equip sockets, and the
 *  used/capacity counter the header shows. Pure data; the painter renders it. */
export interface BagBarModel {
  backpackSlots: number;
  sockets: BagSocketModel[];
  used: number;
  capacity: number;
}

export function buildBagBar(
  bags: readonly (string | null)[],
  used: number,
  capacity: number,
  backpackSlots: number,
  bagSlotsOf: (itemId: string) => number,
): BagBarModel {
  return {
    backpackSlots,
    sockets: bags.map((itemId, socket) => ({
      socket,
      itemId,
      slots: itemId ? bagSlotsOf(itemId) : 0,
    })),
    used,
    capacity,
  };
}
