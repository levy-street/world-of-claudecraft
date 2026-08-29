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

import { poolCapacityOf, poolOccupancyOf } from '../sim/bag_pools';
import { BACKPACK_SLOTS } from '../sim/bags';
import { type BagCells, layoutBagCells } from '../sim/inventory_order';
import { isTransferLockedInstance } from '../sim/item_instance_transfer';
import type { Quality } from '../sim/loot_master';
import { isMaterialItemId } from '../sim/material_ids';
import type { InvSlot, ItemInstancePayload } from '../sim/types';
import {
  applyBagFilter,
  type BagFilterState,
  bagFilterIsDefault,
  bagOrderIsManual,
  type ItemLookup,
} from './bag_filter';

export type { BagCells };

/** The item facts the bag click/tooltip logic needs (a subset of ItemDef). */
export interface BagItemInfo {
  kind: string;
  noMarketList?: boolean;
  /** Refused by the sim's vendor sell path (src/sim/items.ts sellItem). */
  noVendorSell?: boolean;
  /** Rarity tier; only 'poor' is instant-sellable (vendorSellIsInstant below). */
  quality?: Quality;
  /** Truthy when the item has a generic "use" effect (e.g. fishing). */
  use?: unknown;
  /** Protected from destruction (the sim's discardItem also no-ops these). */
  noDiscard?: boolean;
  /** Bound to its owner: cannot be traded, mailed, listed, or sold. */
  soulbound?: boolean;
  /** The catalog mount a kind:'mount' reins item owns (see MountItemDef). */
  mount?: string;
  /** The id is in the Materials Vault's honest material set
   *  (vaultMaterialIds()). Computed by the CALLER (this info shape carries no
   *  id to test); read only by the vaultDeposit mode arm, so every other
   *  caller may omit it. */
  vaultMaterial?: boolean;
}

/** The open-window modes that change what a bag click does. At most one is the
 *  effective mode (checked in priority order: trade, mail-attach, market-sell,
 *  vendor, guild-bank-deposit, bank-deposit, bank-open-no-target, pet-feed; the
 *  wiring sets at most one of the two bank modes, keyed off the bank window's
 *  active tab). */
export interface BagMode {
  tradeOpen: boolean;
  /** The Ravenpost mailbox is open on its Send tab (clicks attach parcels). */
  mailAttach: boolean;
  /** The World Market is open on its Sell tab. */
  marketSell: boolean;
  vendorOpen: boolean;
  /** The bank window is OPEN AT ALL (docked beside the bags), on any of its
   *  panes and views. This is the mode that says "the bank cluster owns the bag
   *  slot"; the two deposit modes below are the SUBSET of it where a grid is
   *  actually on screen to drop into. The wiring sets it as a superset of both,
   *  so open-with-neither-deposit-armed (the guild pane's Log view, a reading
   *  surface) is a state the ladder can name instead of falling out the bottom
   *  into the use/equip default. */
  bankOpen: boolean;
  /** The bank window is open ON ITS PERSONAL TAB: a click deposits the stack. */
  bankDeposit: boolean;
  /** An unlocked bank bag socket is EMPTY right now (hasOpenBankSocket over
   *  the live bankInfo; meaningful only beside bankDeposit): a clicked
   *  payload-free bag SOCKETS into the bank instead of depositing as an item,
   *  the carried equip grammar aimed at the bank's socket row. False keeps
   *  every bag click a plain deposit, so storing spare bags stays possible
   *  once the sockets are full (and a payload-bearing bag always deposits:
   *  sockets store bare ids, the sim's #2837 peek would refuse it). */
  bankSocketable: boolean;
  /** The bank window is open ON ITS GUILD TAB: a click deposits into the guild
   *  bank instead. The wiring sets at most ONE of the three bank deposit
   *  modes (see vaultDeposit below). */
  guildBankDeposit: boolean;
  /** The bank window is open ON ITS VAULT TAB with the Materials Vault
   *  unlocked: a click deposits the material into the vault. The wiring sets
   *  at most ONE of the three bank deposit modes (keyed off the bank window's
   *  active tab); the LOCKED vault pane arms none of them, so its clicks fall
   *  to the bankOpen no-target rung like the guild Log view's. */
  vaultDeposit: boolean;
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
  | 'mailAttachBlockedBound'
  | 'marketSell'
  | 'marketSellBlockedQuest'
  | 'marketSellBlockedNoMarket'
  | 'marketSellBlockedBound'
  | 'vendorSell'
  | 'vendorSellBlocked'
  | 'bankDeposit'
  | 'bankDepositBlockedQuest'
  /** Socket the clicked bag into the bank's first empty unlocked socket. */
  | 'bankSocketBag'
  /** The bank window is open with NEITHER grid on screen to deposit into. */
  | 'bankDepositBlockedNoTarget'
  | 'guildBankDeposit'
  | 'guildBankDepositBlockedQuest'
  | 'guildBankDepositBlockedSoulbound'
  | 'guildBankDepositBlockedNoTransfer'
  | 'vaultDeposit'
  /** Not in the honest material set: the vault stores materials only. */
  | 'vaultDepositBlockedNotMaterial'
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
  | 'hudChrome.bank.cannotDepositNow'
  | 'hudChrome.bank.socketHint'
  | 'hudChrome.bank.guildDepositHint'
  | 'hudChrome.bank.guildCannotDeposit'
  | 'hudChrome.bank.vaultDepositHint'
  | 'hudChrome.bank.vaultCannotDeposit'
  | 'itemUi.tooltip.clickDestroy'
  | 'hudChrome.mounts.clickManage'
  | 'itemUi.tooltip.clickEquip'
  | 'itemUi.tooltip.clickConsume'
  | 'itemUi.tooltip.clickUseInstant'
  | 'itemUi.tooltip.clickUse'
  // Tool-effect charms are not bag-usable: the sim refuses useItem with the
  // "Open Professions to slot that" line, so the hover must not advertise
  // "Click to use" for a click that only errors.
  | 'hudChrome.professions.toolEffectTooltip.openProfessions'
  | 'hudChrome.mailbox.clickAttach'
  | 'hudChrome.mailbox.cannotMail'
  | '';

/** Decide what a click on a bag item does. Mirrors the original click handler's
 *  priority order exactly: trade > mail-attach > market-sell > vendor >
 *  guild-bank-deposit > bank-deposit > vault-deposit > bank-open-no-target >
 *  pet-feed > quest > use (the wiring sets at most one of the THREE bank
 *  deposit modes, keyed off the bank window's active tab).
 *  `instance` is the clicked SLOT's payload (issue 1165):
 *  a transfer-locked copy (bindOnTrade-armed or boundTo-bound,
 *  isTransferLockedInstance, the sim's pipe rule) blocks mail-attach and
 *  market-sell in place; an unlocked instanced copy stages as itself. */
export function bagItemAction(
  item: BagItemInfo,
  mode: BagMode,
  instance?: ItemInstancePayload,
  /** The slot's crafting provenance marker (InvSlot.craftedRecipeId): read
   *  by the bank socket arm (bank sockets store bare ids, so a marked bag
   *  deposits instead). The vault preserves it, so it never blocks there. */
  craftedRecipeId?: string,
): BagAction {
  if (item.soulbound && (mode.tradeOpen || mode.mailAttach || mode.marketSell || mode.vendorOpen))
    return 'transferBlockedSoulbound';
  if (mode.tradeOpen) return 'trade';
  if (mode.mailAttach) {
    // Mirrors the sim's mail escrow rule: quest and unmailable items refuse.
    if (item.kind === 'quest' || item.noMarketList) return 'mailAttachBlocked';
    if (isTransferLockedInstance(instance)) return 'mailAttachBlockedBound';
    return 'mailAttach';
  }
  if (mode.marketSell) {
    if (item.kind === 'quest') return 'marketSellBlockedQuest';
    if (item.noMarketList) return 'marketSellBlockedNoMarket';
    if (isTransferLockedInstance(instance)) return 'marketSellBlockedBound';
    return 'marketSell';
  }
  if (mode.vendorOpen) {
    // Mirrors the sim's vendor rule (src/sim/items.ts sellItem refuses on
    // noVendorSell), so the click is denied in place with a toast instead of
    // dispatching a sale the server was always going to refuse.
    if (item.noVendorSell) return 'vendorSellBlocked';
    return 'vendorSell';
  }
  // Window modes cluster before the armed pet-feed cursor (vendor beats pet-feed
  // today); the sim refuses a quest item, so block it in place with the deny toast.
  // The GUILD tab carries the full anonymous-pipe policy (the sim's
  // guildBankPipeRefusal: quest / soulbound / noMarketList / per-copy transfer
  // lock), pre-empted here with the matching deny arms; note the top-of-function
  // soulbound gate deliberately does NOT cover this mode, so the guild arm owns
  // its own soulbound deny with the guild-worded sim line.
  if (mode.guildBankDeposit) {
    if (item.kind === 'quest') return 'guildBankDepositBlockedQuest';
    if (item.soulbound) return 'guildBankDepositBlockedSoulbound';
    if (item.noMarketList || isTransferLockedInstance(instance))
      return 'guildBankDepositBlockedNoTransfer';
    return 'guildBankDeposit';
  }
  if (mode.bankDeposit) {
    if (item.kind === 'quest') return 'bankDepositBlockedQuest';
    // The socket arm (Bank Storage phase 07): a payload-free bag with an open
    // socket waiting SOCKETS (the carried equip grammar, bank-aimed); a
    // payload-bearing copy or a full/locked socket row falls through to the
    // plain deposit, so the click always still banks the bag somewhere. The
    // hover hint (bagTooltipHintKey) names which outcome this click takes.
    if (item.kind === 'bag' && mode.bankSocketable && !instance && craftedRecipeId === undefined) {
      return 'bankSocketBag';
    }
    return 'bankDeposit';
  }
  // The VAULT tab: materials only (membership computed by the caller from the
  // honest id set, never approximated by kind). Identity payloads and crafted
  // provenance are accepted and preserved by the vault's special collection.
  if (mode.vaultDeposit) {
    if (!item.vaultMaterial) return 'vaultDepositBlockedNotMaterial';
    return 'vaultDeposit';
  }
  // The bank window is open but NEITHER grid is on screen to drop into (today:
  // its guild pane's Log view, a reading surface). This arm is stated
  // EXPLICITLY rather than left to fall out the bottom of the ladder, because
  // everything below it acts on the item: disarming both deposits without it
  // turned "read the activity log" into "drink the potion / equip the plate /
  // summon the mount" on the very next click. A disarmed mode must name its own
  // no-target rung; it must never demote the click to the default use ladder.
  if (mode.bankOpen) return 'bankDepositBlockedNoTarget';
  if (mode.petFeed) return item.kind === 'food' ? 'petFeed' : 'petFeedBlocked';
  // A usable quest item (e.g. the firebottle: use.type 'throw') is USED on click,
  // not discarded; only inert quest items fall through to the discard prompt.
  if (item.kind === 'quest') return item.use ? 'use' : 'discardQuest';
  if (item.kind === 'bag') return 'equipBag';
  // A collected reins item falls through to 'use' like any other usable item:
  // clicking it summons that mount (sim useItem -> summonMountItem). There is no
  // picker to open any more.
  return 'use';
}

/** The unknown (def-less) cell's one possible click action, derived from the
 *  SAME mode ladder bagItemAction walks: every def-needing mode that outranks
 *  the bank deposit there (trade, mail-attach, market-sell, vendor) means NO
 *  action on a def-less stack, never a deposit that jumps the ladder. One
 *  definition so the unknown cell cannot silently diverge when the ladder
 *  gains a mode or reorders. */
export function bagUnknownAction(mode: BagMode): 'bankDeposit' | 'none' {
  if (mode.tradeOpen || mode.mailAttach || mode.marketSell || mode.vendorOpen) return 'none';
  // The GUILD tab deliberately offers NOTHING on an unknown cell, stated here
  // rather than left to fall out of the two bank modes being exclusive. The
  // guild pipe refuses on four item dimensions (quest, soulbound,
  // noMarketList, transfer-locked) that a client which does not know the def
  // cannot evaluate, and a refused copy strands DORMANT in a shared book that
  // no player action can clear. The personal pane keeps its deposit: its only
  // refusal is quest, and its owner can always withdraw again.
  if (mode.guildBankDeposit) return 'none';
  // The VAULT tab likewise offers nothing on an unknown cell: the honest
  // material set is derived from THIS bundle's content tables, so a def-less
  // id is never a member and the sim would refuse the deposit anyway.
  if (mode.vaultDeposit) return 'none';
  // bankOpen-with-no-target needs no arm of its own here: an unknown cell has
  // no use/equip ladder below it to fall into, so the closing 'none' is already
  // the right answer. The ITEM ladder needed an explicit rung; this one does not.
  return mode.bankDeposit ? 'bankDeposit' : 'none';
}

/** Whether a plain vendor-window click may sell `item` immediately, with no
 *  confirm step. Only true junk qualifies: poor quality AND no instance
 *  payload of any kind (an enchant, masterwork bake, signer, rolled stats, a
 *  bound-to owner, or a player lock all make a copy non-interchangeable with
 *  a plain one; item_copy_ref.ts's whole reason two copies of an id stopped
 *  being safe to treat as one) AND no crafted-recipe marker (InvSlot's OWN
 *  `craftedRecipeId`, kept off the instance payload on purpose so common
 *  crafted gear does not gain a signer/masterwork/enchant identity, item
 *  types.ts). Mirrors src/sim/items.ts junkSellableSlot's poor-quality gate,
 *  widened to ANY instance payload or crafted marker rather than only a
 *  bound/locked one: this gate exists to protect VALUE from an accidental
 *  click, not merely to mirror what the sim would refuse outright. False
 *  routes the caller to a confirm prompt instead of an instant sale, closing
 *  the gap where selling gray junk one item at a time (no per-item
 *  confirmation existed) could vendor an adjacent, unrelated valuable item on
 *  a single stray click. */
export function vendorSellIsInstant(
  item: BagItemInfo,
  instance?: ItemInstancePayload,
  craftedRecipeId?: string,
): boolean {
  return item.quality === 'poor' && instance === undefined && craftedRecipeId === undefined;
}

/** Whether a shift-click on a bag item should link it into chat (classic
 *  shift-click-to-link). True in every mode except at a vendor or an ARMED bank
 *  deposit, where shift-click already owns the split-stack sell / deposit
 *  prompt; those affordances are left untouched.
 *
 *  `bankOpen` is deliberately NOT in this list, unlike every other consumer of
 *  it: the gate here is "does something else already own shift-click", and on a
 *  bank view with no deposit target there is no split prompt to collide with.
 *  Linking a stack into chat is inert and available on every other surface, so
 *  the reading view keeps it. */
export function bagShiftLinks(mode: BagMode): boolean {
  return !mode.vendorOpen && !mode.bankDeposit && !mode.guildBankDeposit && !mode.vaultDeposit;
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

/** Whether a SHOWN bag window's money row is painting a stale purse (issue #2373).
 *  The money row is the only thing inside #bags that reads copper (neither
 *  buildBagGrid nor buildBagBar sees it), and several credits reach no bags arm in
 *  either host: online a money-only snapshot carries no inventory delta at all, and
 *  offline a trainer fee, a settled Vale Cup bet or delve copper emit no event the
 *  bags listen to. The window has to be SHOWN before the purse is compared, so a
 *  hidden or never-opened window costs one string compare and never reaches a
 *  painter. `lastPainted` is the purse as of the last paint; the -1 cold sentinel a
 *  caller starts from can never equal a real purse, which is never negative. */
export function bagsMoneyRowStale(display: string, copper: number, lastPainted: number): boolean {
  return bagsWindowShown(display) && copper !== lastPainted;
}

/** What the shift+right-click destroy affordance on a bag item does. 'discard' opens
 *  the destroy prompt, 'discardBlocked' rejects a protected item with feedback, 'none'
 *  means the destroy affordance is inert. A plain right-click (no shift) now runs the
 *  same primary action as a left-click (equip/use/etc, via bagItemAction), matching
 *  classic-MMO expectations instead of destroying the item by surprise (issue 1852). */
export type BagDestroyAction = 'discard' | 'discardBlocked' | 'none';

/** Decide the shift+right-click destroy affordance for a bag item. Inert in the
 *  transactional modes (trade / mail / market / vendor / pet-feed / the open bank),
 *  whose own click/contextmenu owns the slot; a noDiscard item is protected with
 *  feedback, every other item can be destroyed (mirrors the sim's discardItem rule,
 *  which accepts any non-noDiscard item). Left-click use/equip is unaffected.
 *
 *  The bank gate is `bankOpen`, not the two deposit modes: the window owning the
 *  slot is what makes destroy inert, and that does not stop being true on a view
 *  with no deposit target. Reading the guild activity log must not quietly re-arm
 *  a destroy prompt over the bags. The two deposit modes stay listed so a caller
 *  that sets one without the superset still reads as inert. */
export function bagDestroyAction(item: BagItemInfo, mode: BagMode): BagDestroyAction {
  if (
    mode.tradeOpen ||
    mode.mailAttach ||
    mode.marketSell ||
    mode.vendorOpen ||
    mode.petFeed ||
    mode.bankOpen ||
    mode.bankDeposit ||
    mode.guildBankDeposit ||
    mode.vaultDeposit
  )
    return 'none';
  if (item.noDiscard) return 'discardBlocked';
  return 'discard';
}

/** The slot-count line key for a bag-kind item's tooltip and the bag-socket
 *  aria-label: a materialsOnly bag says so ('{slots} Slot Materials Bag'), an
 *  unrestricted bag keeps the plain family line. Returns null ONLY for a
 *  non-bag; whether a line renders at all stays each consumer's decision
 *  (the hud tooltip also gates on bagSlots, the socket aria always speaks),
 *  so the leaf answers the variant question alone and cannot silently drop
 *  the materials claim on a degenerate zero-slot def. Pure key choice so
 *  hud.ts and bags_window.ts share ONE decision instead of two ternaries. */
export function bagSlotsLineKey(
  item: { kind: string; bagSlots?: number; materialsOnly?: boolean } | undefined,
): 'itemUi.tooltip.bagSlots' | 'itemUi.tooltip.bagSlotsMaterials' | null {
  if (item?.kind !== 'bag') return null;
  return item.materialsOnly ? 'itemUi.tooltip.bagSlotsMaterials' : 'itemUi.tooltip.bagSlots';
}

/** The tooltip hint sub-line for a bag item, matching the original tooltip's
 *  mode-then-kind branch. Returns '' when no hint applies (e.g. a material).
 *  `instance` mirrors bagItemAction's third parameter: a transfer-locked copy
 *  reads the same cannot-mail / cannot-market hint its click deny shows. */
export function bagTooltipHintKey(
  item: BagItemInfo,
  mode: BagMode,
  instance?: ItemInstancePayload,
  /** The slot's crafting provenance marker, the bagItemAction twin: read only
   *  by the vaultDeposit arm. */
  craftedRecipeId?: string,
): BagTooltipHintKey {
  if (item.soulbound && (mode.tradeOpen || mode.mailAttach || mode.marketSell || mode.vendorOpen))
    return 'hudChrome.itemSoulbound';
  if (mode.tradeOpen) return 'itemUi.tooltip.clickTradeOffer';
  if (mode.mailAttach) {
    return item.kind === 'quest' || item.noMarketList || isTransferLockedInstance(instance)
      ? 'hudChrome.mailbox.cannotMail'
      : 'hudChrome.mailbox.clickAttach';
  }
  if (mode.marketSell) {
    return item.kind === 'quest' || item.noMarketList || isTransferLockedInstance(instance)
      ? 'itemUi.tooltip.cannotMarket'
      : 'itemUi.tooltip.clickMarketList';
  }
  if (mode.vendorOpen)
    return item.kind === 'quest' || item.noVendorSell
      ? 'itemUi.tooltip.cannotVendor'
      : 'itemUi.tooltip.clickSell';
  if (mode.guildBankDeposit) {
    // The guild pipe refuses more than quest items; every refused dimension
    // reads the same guild cannot-be-banked hint (the click deny carries the
    // exact sim wording), an allowed stack the guild deposit hint. The keys
    // are DISTINCT from the personal pair: the consequences differ (a shared
    // pool any officer can take from; a refused copy would strand dormant).
    return item.kind === 'quest' ||
      item.soulbound ||
      item.noMarketList ||
      isTransferLockedInstance(instance)
      ? 'hudChrome.bank.guildCannotDeposit'
      : 'hudChrome.bank.guildDepositHint';
  }
  if (mode.bankDeposit) {
    if (item.kind === 'quest') return 'hudChrome.bank.cannotDeposit';
    // The hover previews exactly which outcome the click takes (the socket
    // arm's condition, mirrored from bagItemAction): socket when a payload-free
    // bag has an open socket waiting, plain deposit otherwise.
    if (item.kind === 'bag' && mode.bankSocketable && !instance && craftedRecipeId === undefined) {
      return 'hudChrome.bank.socketHint';
    }
    return 'hudChrome.bank.depositHint';
  }
  // The vault twin: only a non-material is refused. Identity-bearing materials
  // keep the same deposit hint because the vault preserves their visuals.
  if (mode.vaultDeposit) {
    return !item.vaultMaterial
      ? 'hudChrome.bank.vaultCannotDeposit'
      : 'hudChrome.bank.vaultDepositHint';
  }
  // Twin of bagItemAction's no-target rung: with the bank open and no grid on
  // screen, the hint must NOT fall through to the kind branch and advertise
  // "Click to equip" for a click that will be refused. The hover previews the
  // exact line the click raises, the way the vendor / market cannot-hints do.
  if (mode.bankOpen) return 'hudChrome.bank.cannotDepositNow';
  if (item.kind === 'quest') return 'itemUi.tooltip.clickDestroy';
  if (item.kind === 'mount') return 'hudChrome.mounts.clickManage';
  if (
    item.kind === 'weapon' ||
    item.kind === 'armor' ||
    item.kind === 'held_offhand' ||
    item.kind === 'bag'
  )
    return 'itemUi.tooltip.clickEquip';
  if (item.kind === 'food' || item.kind === 'drink') return 'itemUi.tooltip.clickConsume';
  if (item.kind === 'potion') return 'itemUi.tooltip.clickUseInstant';
  // Charms (use.type 'toolEffect') slot from the Professions window, not from
  // a bag click. Mirror the sim refusal copy so the hover never promises a
  // use action the click cannot perform.
  if (isToolEffectBagUse(item.use)) {
    return 'hudChrome.professions.toolEffectTooltip.openProfessions';
  }
  if (item.use) return 'itemUi.tooltip.clickUse';
  return '';
}

/** True when bag use payload is a tool-effect charm (ItemDef use.type). */
function isToolEffectBagUse(use: unknown): boolean {
  return (
    !!use &&
    typeof use === 'object' &&
    Object.hasOwn(use, 'type') &&
    (use as { type: unknown }).type === 'toolEffect'
  );
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
  /** The bag's REAL cells: one entry per square, null where the square is empty, with
   *  every stack sitting in the cell the player parked it in (src/sim/inventory_order.ts
   *  layoutBagCells). Only the pristine view (no filter, no search, sort by recent) shows
   *  the true cells; a filtered or sorted view is a derived LIST, so this is empty there
   *  and the painter falls back to `visible` + `emptyCells`. */
  cells: BagCells;
  /** The filtered, ordered slots to paint (empty unless state === 'items'). */
  visible: InvSlot[];
  /** Free slot squares to paint after the items (0 while a filter/search is
   *  active: a filtered view shows matches only, not the free space). */
  emptyCells: number;
  /** Stacks above the capacity budget (a legacy over-capacity save); the
   *  painter surfaces it on the capacity counter. 0 when within budget. */
  overflow: number;
}

/** Which no-match empty copy the bag grid should paint. Quest filter gets a
 *  warm purpose-class line; every other filter keeps the generic no-match line. */
export type BagNoMatchKind = 'generic' | 'quest';

/** Discriminant for the empty-filter message. Pure so the painter only maps
 *  kind -> t() key and never re-derives the category branch. */
export function bagNoMatchKind(filter: BagFilterState): BagNoMatchKind {
  return filter.category === 'quest' ? 'quest' : 'generic';
}

/** One row in a derived (list) bag grid: either a soft section caption or a stack.
 *  Section rows are NEVER drop targets and never carry a bag cell index. */
export type BagListRow = { kind: 'section'; section: 'quest' } | { kind: 'stack'; slot: InvSlot };

/** Soft Quest section headers are allowed only when the grid is a derived list
 *  (not the All+recent manual cell stream). Inserting a header node into the
 *  drop-target cell stream would shift bagIndex positions and break reorder.
 *  Category `quest` already implies bagOrderIsManual is false, so it is covered. */
export function bagQuestSectionHeadersAllowed(filter: BagFilterState): boolean {
  return !bagOrderIsManual(filter);
}

/** Build paint rows for a derived bag list. When section headers are allowed and
 *  the visible list mixes quest and non-quest stacks, emits a soft Quest header
 *  then quest stacks (stable relative order), then the rest (stable relative
 *  order). When headers are disallowed or the list is not mixed, returns plain
 *  stack rows in the original order so sort/search stay honest and the manual
 *  All+recent path (which never calls this; it paints model.cells) stays free
 *  of header nodes that would break drop indices. */
export function buildBagListRows(
  visible: readonly InvSlot[],
  lookup: ItemLookup,
  filter: BagFilterState,
): BagListRow[] {
  if (!bagQuestSectionHeadersAllowed(filter)) {
    return visible.map((slot) => ({ kind: 'stack' as const, slot }));
  }
  const quest: InvSlot[] = [];
  const rest: InvSlot[] = [];
  for (const slot of visible) {
    const item = lookup(slot.itemId);
    if (item?.kind === 'quest') quest.push(slot);
    else rest.push(slot);
  }
  // Soft section only when both sides exist. All-quest (category quest) and
  // pure non-quest lists need no caption; a lone header would be noise.
  if (quest.length === 0 || rest.length === 0) {
    return visible.map((slot) => ({ kind: 'stack' as const, slot }));
  }
  const rows: BagListRow[] = [{ kind: 'section', section: 'quest' }];
  for (const slot of quest) rows.push({ kind: 'stack', slot });
  for (const slot of rest) rows.push({ kind: 'stack', slot });
  return rows;
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
  // The pristine view paints the bag's real cells (holes and all); every other view is a
  // derived list, where a square is just a row and holds no position.
  const cells = bagOrderIsManual(filter) ? layoutBagCells(inventory, capacity) : [];
  if (inventory.length === 0) {
    return emptyCells > 0
      ? { state: 'items', cells, visible: [], emptyCells, overflow }
      : { state: 'empty', cells: [], visible: [], emptyCells: 0, overflow };
  }
  const visible = applyBagFilter(inventory, lookup, filter);
  if (visible.length === 0)
    return { state: 'noMatch', cells: [], visible: [], emptyCells: 0, overflow };
  return { state: 'items', cells, visible, emptyCells, overflow };
}

/** Stable key over exactly what the sort command changes: each stack's id,
 *  count (consolidation merges), and parked cell hint (the restamp), in array
 *  order. The sort settle ripple keys on this changing rather than on the
 *  painted grid, because the press also resets an active filter and the
 *  derived-list-to-real-cells SHAPE switch would read as a content change on
 *  the press's own repaint (online, that paint still shows the unsorted
 *  mirror; the tidied inventory lands with the heavy self snapshot). */
export function bagSortSignature(inventory: readonly InvSlot[]): string {
  return inventory.map((s) => `${s.itemId}x${s.count}@${s.slot ?? '-'}`).join(',');
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

/** One pool of the carried split: its occupancy and its budget. */
export interface CarriedPool {
  used: number;
  capacity: number;
}

/** The carried inventory's per-pool split for the bag-bar counter's tooltip
 *  and split aria (the Bank Storage phase 08 carried follow-up). */
export interface CarriedPoolsModel {
  general: CarriedPool;
  materials: CarriedPool;
  /** The materials pool has something to say: capacity from an equipped
   *  materials-only bag. Occupancy alone can never trip it: poolOccupancyOf
   *  clamps materialsUsed to the pool capacity, so occupancy stranded by an
   *  unequip re-accounts to the GENERAL pool (only general reads over). */
  showMaterials: boolean;
}

/** The per-pool split for the CARRIED bags, from the SAME shared helpers the
 *  sim's own carried gates consume (src/sim/bags.ts bagPools is
 *  poolCapacityOf over BACKPACK_SLOTS + the equipped bag ids, and its fit
 *  gates run poolOccupancyOf over the inventory with the honest-taxonomy
 *  isMaterialItemId predicate), so the readout can never drift from the
 *  sim's allocation rule. Unlike the bank there is no wire split to read:
 *  both hosts mirror `bags` and `inventory`, and this derives through the
 *  one shared module. Occupancies always sum to inventory.length and the
 *  capacities to the summed budget; either pool may sit over budget
 *  (tolerated over-capacity, never repaired here). */
export function carriedPools(
  bags: readonly (string | null)[],
  inventory: readonly InvSlot[],
): CarriedPoolsModel {
  const pools = poolCapacityOf(BACKPACK_SLOTS, bags);
  const { generalUsed, materialsUsed } = poolOccupancyOf(inventory, pools, isMaterialItemId);
  return {
    general: { used: generalUsed, capacity: pools.general },
    materials: { used: materialsUsed, capacity: pools.materials },
    // No occupancy disjunct: unlike the bank's wire-fed pool four, this
    // derives locally through the clamped helper, so materialsUsed > 0
    // without capacity is unconstructible here.
    showMaterials: pools.materials > 0,
  };
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
