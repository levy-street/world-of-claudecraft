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
import {
  applyBagFilter,
  type BagFilterState,
  bagFilterIsDefault,
  type ItemLookup,
} from './bag_filter';

/** The item facts the bag click/tooltip logic needs (a subset of ItemDef). */
export interface BagItemInfo {
  kind: string;
  noMarketList?: boolean;
  /** Truthy when the item has a generic "use" effect (e.g. fishing). */
  use?: unknown;
  /** Protected from destruction (the sim's discardItem also no-ops these). */
  noDiscard?: boolean;
  /** Bound to its owner: cannot be traded, mailed, listed, or sold. */
  soulbound?: boolean;
}

/** The open-window modes that change what a bag click does. At most one is the
 *  effective mode (checked in priority order: trade, mail-attach, market-sell,
 *  vendor, bank-deposit, pet-feed). */
export interface BagMode {
  tradeOpen: boolean;
  /** The Ravenpost mailbox is open on its Send tab (clicks attach parcels). */
  mailAttach: boolean;
  /** The World Market is open on its Sell tab. */
  marketSell: boolean;
  vendorOpen: boolean;
  /** The bank window is open (docked beside the bags): a click deposits the stack. */
  bankDeposit: boolean;
  /** Pet-feed cursor mode is armed. */
  petFeed: boolean;
}

/** What clicking a bag item does, given the item + modes. The *Blocked variants
 *  mean the click is rejected with an error toast (no dispatch). */
export type BagAction =
  | 'transferBlockedSoulbound'
  | 'trade'
  | 'mailAttach'
  | 'mailAttachBlocked'
  | 'marketSell'
  | 'marketSellBlockedQuest'
  | 'marketSellBlockedNoMarket'
  | 'vendorSell'
  | 'bankDeposit'
  | 'bankDepositBlockedQuest'
  | 'petFeed'
  | 'petFeedBlocked'
  | 'discardQuest'
  | 'equipBag'
  | 'use';

/** The tooltip hint sub-line i18n key for a bag item (or '' for no hint). */
export type BagTooltipHintKey =
  | 'hudChrome.itemSoulbound'
  | 'itemUi.tooltip.clickTradeOffer'
  | 'itemUi.tooltip.cannotMarket'
  | 'itemUi.tooltip.clickMarketList'
  | 'itemUi.tooltip.cannotVendor'
  | 'itemUi.tooltip.clickSell'
  | 'hudChrome.bank.depositHint'
  | 'hudChrome.bank.cannotDeposit'
  | 'itemUi.tooltip.clickDestroy'
  | 'itemUi.tooltip.clickEquip'
  | 'itemUi.tooltip.clickConsume'
  | 'itemUi.tooltip.clickUseInstant'
  | 'itemUi.tooltip.clickUse'
  | 'hudChrome.mailbox.clickAttach'
  | 'hudChrome.mailbox.cannotMail'
  | '';

/** Decide what a click on a bag item does. Mirrors the original click handler's
 *  priority order exactly: trade > mail-attach > market-sell > vendor > bank-deposit
 *  > pet-feed > quest > use. */
export function bagItemAction(item: BagItemInfo, mode: BagMode): BagAction {
  if (item.soulbound && (mode.tradeOpen || mode.mailAttach || mode.marketSell || mode.vendorOpen))
    return 'transferBlockedSoulbound';
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
  // Window modes cluster before the armed pet-feed cursor (vendor beats pet-feed
  // today); the sim refuses a quest item, so block it in place with the deny toast.
  if (mode.bankDeposit) return item.kind === 'quest' ? 'bankDepositBlockedQuest' : 'bankDeposit';
  if (mode.petFeed) return item.kind === 'food' ? 'petFeed' : 'petFeedBlocked';
  if (item.kind === 'quest') return 'discardQuest';
  if (item.kind === 'bag') return 'equipBag';
  return 'use';
}

/** Whether a shift-click on a bag item should link it into chat (classic
 *  shift-click-to-link). True in every mode except at a vendor or the open bank,
 *  where shift-click already owns the split-stack sell / deposit prompt; those
 *  affordances are left untouched. */
export function bagShiftLinks(mode: BagMode): boolean {
  return !mode.vendorOpen && !mode.bankDeposit;
}

/** Resolve the exact inventory index of a clicked bag stack by REFERENCE identity,
 *  never a first-match-by-itemId: duplicate fungible stacks and distinct instanced
 *  copies share an itemId, so only reference identity targets the stack the player
 *  actually clicked (the filtered/sorted grid reuses the live inventory slot objects,
 *  so a clicked slot is `===` one of them). Returns -1 when the slot is no longer in
 *  the inventory (a stale click after a repaint), which the caller treats as a no-op.
 *  The bank deposit command is index-based, so this is how a click targets a slot. */
export function bagStackIndex(inventory: readonly InvSlot[], slot: InvSlot): number {
  return inventory.indexOf(slot);
}

/** Whether a shift-click in bank-deposit mode opens the partial-amount prompt (a
 *  splittable stack) rather than depositing the whole stack. A single-count stack
 *  and any instanced item always move whole (the sim moves an instanced slot whole
 *  regardless of count), so neither opens the prompt. */
export function bankDepositOpensPrompt(slot: InvSlot): boolean {
  return Math.floor(slot.count) > 1 && !slot.instance;
}

/** Re-resolve a bank deposit at prompt submit. The prompt captured its slot + index
 *  when it opened, but the bags can repaint under it (using an item, a server
 *  correction), shifting or replacing what sits at that index. Given the live slot
 *  now at the captured index and the slot the prompt captured, return null to REFUSE
 *  (a different item now occupies the index, a stale prompt: depositing the wrong item
 *  is worse than dismissing) or the clamped count (>=1, and no more than the live
 *  stack or the original max) to deposit. Mirrors the bank withdraw prompt's guard. */
export function resolveDepositSubmit(
  live: InvSlot | undefined,
  captured: InvSlot,
  requested: number,
  maxCount: number,
): number | null {
  if (!live || live.itemId !== captured.itemId) return null;
  return Math.max(1, Math.min(maxCount, live.count, Math.floor(requested)));
}

/** Whether the #bags window is currently shown, from its inline display value.
 *  Shown = any non-hidden value (#bags is only ever assigned 'flex' today), NOT
 *  hidden ('none') and NOT the cold-load empty ''. The '' case is the bug (issue
 *  #1538): the .window stylesheet rule hides the window, so a fresh page load
 *  leaves the inline display '' (never 'none'). It must read as NOT shown so the
 *  first toggle OPENS instead of taking the close branch (and playing the close
 *  sound) against an already-hidden window. Guards on the hidden values rather
 *  than pinning to a specific shown value (mirroring close() and the closeAll
 *  precedent), so it stays correct if the shown value ever changes. */
export function bagsWindowShown(display: string): boolean {
  return display !== 'none' && display !== '';
}

/** What a right-click (destroy affordance) on a bag item does. 'discard' opens the
 *  destroy prompt, 'discardBlocked' rejects a protected item with feedback, 'none'
 *  means the destroy affordance is inert. */
export type BagDestroyAction = 'discard' | 'discardBlocked' | 'none';

/** Decide the right-click destroy affordance for a bag item. Inert in the
 *  transactional modes (trade / mail / market / vendor / pet-feed / bank-deposit),
 *  whose own click/contextmenu owns the slot; a noDiscard item is protected with
 *  feedback, every other item can be destroyed (mirrors the sim's discardItem rule,
 *  which accepts any non-noDiscard item). Left-click use/equip is unaffected. */
export function bagDestroyAction(item: BagItemInfo, mode: BagMode): BagDestroyAction {
  if (
    mode.tradeOpen ||
    mode.mailAttach ||
    mode.marketSell ||
    mode.vendorOpen ||
    mode.petFeed ||
    mode.bankDeposit
  )
    return 'none';
  if (item.noDiscard) return 'discardBlocked';
  return 'discard';
}

/** The tooltip hint sub-line for a bag item, matching the original tooltip's
 *  mode-then-kind branch. Returns '' when no hint applies (e.g. a material). */
export function bagTooltipHintKey(item: BagItemInfo, mode: BagMode): BagTooltipHintKey {
  if (item.soulbound && (mode.tradeOpen || mode.mailAttach || mode.marketSell || mode.vendorOpen))
    return 'hudChrome.itemSoulbound';
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
  if (mode.bankDeposit)
    return item.kind === 'quest' ? 'hudChrome.bank.cannotDeposit' : 'hudChrome.bank.depositHint';
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
