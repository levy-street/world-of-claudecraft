// Pure, host-agnostic view model for the vendor window.
//
// This is the pure-core half of the pure-core + thin-consumer split (root
// CLAUDE.md Conventions; reference unit_portrait.ts / stat_tooltip.ts). It owns
// the one thing the vendor window decides that is worth testing without a DOM:
// which rows are sellable goods and which buyback slots are still redeemable,
// and at what price. The DOM/i18n side lives in vendor_window.ts; rendering is
// driven entirely off the structure returned here.
//
// DOM-free and i18n-free so tests/vendor_view.test.ts can drive it directly.

import { stackSizeOf } from '../../../sim/bags';
import { resolveVendorRowGate, type VendorRowGate } from '../../../sim/content/vendor_row_gates';
import { junkSellableSlot } from '../../../sim/items';
import type { InvSlot, ItemDef, ItemInstancePayload } from '../../../sim/types';
import { bulkBuyQuantity, vendorCountForced } from '../../../sim/vendor_buy_stack';
import { vendorStackSize } from '../../../sim/vendor_stack';
import { knownItemDef } from '../../known_item';

/** The vendor window's selected purchase multiple (the 1x/5x/10x/custom
 *  control row, phase 21): a fixed row-unit count, or 'custom' where a row
 *  click opens the countFit-capped amount prompt. Lives on Hud (it must
 *  survive the buy-driven rebuild) and is passed into the build so every
 *  row's disable state tracks the SELECTED multiple, not the 1x baseline. */
export type VendorMultiple = 1 | 5 | 10 | 'custom';

export const VENDOR_MULTIPLES: readonly VendorMultiple[] = [1, 5, 10, 'custom'];

export interface VendorGoodsRow {
  itemId: string;
  item: ItemDef;
  /** Server-matching price for one purchase. Either component may be zero. */
  price: VendorPrice;
  /** Units handed over per purchase: food/drink come in a stack, the rest are 1. */
  quantity: number;
  /** Advisory UI state only; the authoritative buy path rechecks both balances. */
  affordable: boolean;
  /** True when the row's tool carries a wield requirement the viewer has not
   *  met yet (content/vendor_row_gates.ts, the R22 advisory surface). PURELY
   *  advisory: the row still sells, and the buy path runs no proficiency
   *  check at all; enforcement lives at the harvest gate
   *  (professions/wield_gate.ts). The painter renders the requirement line
   *  so a buyer knows what the tool will ask of them before it swings. */
  requirementUnmet: boolean;
  /** The row's gate when it carries one, met or not, so the painter can name
   *  the requirement. Ids and numbers only; this core stays i18n-free. */
  requirement?: VendorRowGate;
  /** Present when a bulk ("Buy Stack") purchase is offered for this row: as many
   *  units as the buyer can currently afford in one purchase, capped at the
   *  item's real bag stack size (bulkBuyQuantity, the same helper buyItem uses
   *  authoritatively, so this preview can never promise more than the server
   *  will grant). Undefined for a non-stacking item, a mount, or anything
   *  carrying an Honor price (Honor is a per-purchase cost, never
   *  stack-multiplied; see VendorPrice.honor). */
  bulkQuantity?: number;
  /** Advisory UI state for the bulk row only, checked against the bulk total
   *  rather than the ordinary row's price (see `affordable`): a bulk quantity
   *  is floor-affordable by construction, so a food/drink row whose ordinary
   *  5-unit price the player cannot afford can still offer a smaller,
   *  affordable bulk purchase. Undefined whenever `bulkQuantity` is. */
  bulkAffordable?: boolean;
  /** Present when a fixed multiple above 1 is selected AND the row takes a
   *  count (never on the Q23 force-1 rows: honor-priced, soulbound, mount,
   *  riding service, which keep their 1x baseline fields whatever the row
   *  selection). One click buys `count` row units for `copper` total; the
   *  painter disables the row on `affordable`, which tracks the SELECTED
   *  multiple. Advisory only, the buy path rechecks everything. */
  countBuy?: {
    count: number;
    copper: number;
    affordable: boolean;
  };
  /** True when 'custom' is selected and the row takes a count: a click opens
   *  the countFit-capped amount prompt instead of buying. The row keeps its
   *  1x affordability (the typed amount decides the rest). */
  customBuy?: boolean;
}

export interface VendorPrice {
  /** Total copper: the per-unit buyValue multiplied by vendor quantity. */
  copper: number;
  /** Honor is authored as a per-purchase price and is not stack-multiplied. */
  honor: number;
}

export interface VendorBalances {
  copper: number;
  honor: number;
  /** The viewer's gathering counters, for the advisory row gate.
   *
   *  REQUIRED, deliberately. Defaulting it would be safe against the sim (an
   *  empty map locks rather than opens), but the failure it hides is worse than
   *  the one it prevents: forgetting to pass it shows every player a lock that
   *  is not real, and a capped gatherer silently loses the ability to buy the
   *  tool they earned, with nothing red anywhere. Required turns that into a
   *  compile error naming every call site. */
  gatheringProficiency: Readonly<Record<string, number>>;
}

export interface VendorBuybackRow {
  itemId: string;
  item: ItemDef;
  count: number;
  /** Copper the player pays to buy the item back (the vendor sell value). */
  price: number;
  /** Position of this row in the source vendorBuyback array: pass back to
   *  onBuyBack so the server redeems this exact row (see buyBackItem, #2398). */
  index: number;
  /** Present when this row carries a masterwork/signed payload the buyback
   *  will restore, so it can be told apart from a plain row of the same item. */
  instance?: ItemInstancePayload;
  /** Present when this row carries crafted provenance used by disenchant. */
  craftedRecipeId?: string;
}

export interface VendorView {
  goods: VendorGoodsRow[];
  buyback: VendorBuybackRow[];
  honorBalance: number;
  hasHonorGoods: boolean;
  /** The selected control-row multiple this view was built for, so the
   *  painter renders the pressed state from the same source of truth. */
  multiple: VendorMultiple;
}

/**
 * Build the structured vendor view from raw inputs.
 *
 * Goods: a vendor item is offered only if it exists in the item table and has a
 * positive copper or Honor price (vendors never list a priceless item). Buyback:
 * a stored slot is redeemable only if the item still exists and the stack count
 * is positive.
 *
 * A row whose proficiency gate is unmet is still OFFERED, carrying `locked` and
 * its `requirement`: the two drop rules above are about rows that could never be
 * bought by anyone, while a gate is a row you cannot buy YET, and hiding those
 * would leave a player unable to learn that the next tool exists or what opens
 * it. Same reasoning as the trainer's locked recipes (train_view.ts) and the
 * delve shop's locked offers.
 */
export function buildVendorView(
  vendorItemIds: readonly string[],
  buybackSlots: readonly InvSlot[],
  items: Record<string, ItemDef>,
  balances: VendorBalances,
  multiple: VendorMultiple = 1,
): VendorView {
  const goods: VendorGoodsRow[] = [];
  for (const itemId of vendorItemIds) {
    const item = items[itemId];
    if (!item) continue;
    const quantity = vendorStackSize(item);
    const price: VendorPrice = {
      copper: Math.max(0, item.buyValue ?? 0) * quantity,
      honor: Math.max(0, Math.floor(item.priceHonor ?? 0)),
    };
    if (price.copper <= 0 && price.honor <= 0) continue;
    // The same resolver every advisory surface shares
    // (content/vendor_row_gates.ts), whose numbers alias the wield table the
    // harvest gate enforces, so the line a counter shows can never disagree
    // with the requirement the tool will actually ask. The buy path itself
    // runs no proficiency check any more (R22: counters sell ahead freely).
    const gate = resolveVendorRowGate(itemId, balances.gatheringProficiency);
    // Bulk eligibility mirrors buyItem's server-side gate exactly (items.ts):
    // plain copper price, no Honor component, never a mount (buying several
    // copies of the same reins would only waste gold), and the item must
    // actually stack in the bags.
    const unitCopper = Math.max(0, item.buyValue ?? 0);
    const bulkEligible =
      item.kind !== 'mount' && price.honor <= 0 && unitCopper > 0 && stackSizeOf(item) > 1;
    const bulkQuantity = bulkEligible
      ? Math.max(1, bulkBuyQuantity(item, unitCopper, balances.copper))
      : undefined;
    // The count axis (phase 21): the sim leaf's force-1 predicate decides
    // eligibility so the control row can never promise a multiple the buy
    // path would collapse back to 1. Eligible rows at a fixed multiple carry
    // the whole-count total and an affordability that TRACKS the selection;
    // at 'custom' they only flag that a click opens the capped prompt.
    const countable = !vendorCountForced(item);
    const countBuy =
      countable && multiple !== 'custom' && multiple > 1
        ? {
            count: multiple,
            copper: price.copper * multiple,
            affordable: balances.copper >= price.copper * multiple,
          }
        : undefined;
    goods.push({
      itemId,
      item,
      price,
      quantity,
      affordable: balances.copper >= price.copper && balances.honor >= price.honor,
      requirementUnmet: gate.locked,
      ...(gate.requirement ? { requirement: gate.requirement } : {}),
      ...(bulkQuantity !== undefined && {
        bulkQuantity,
        bulkAffordable: balances.copper >= unitCopper * bulkQuantity,
      }),
      ...(countBuy && { countBuy }),
      ...(countable && multiple === 'custom' && { customBuy: true }),
    });
  }
  const buyback: VendorBuybackRow[] = [];
  buybackSlots.forEach((slot, index) => {
    const item = items[slot.itemId];
    if (!item || slot.count <= 0) return;
    buyback.push({
      itemId: slot.itemId,
      item,
      count: slot.count,
      price: item.sellValue,
      index,
      ...(slot.instance && { instance: slot.instance }),
      ...(slot.craftedRecipeId === undefined ? {} : { craftedRecipeId: slot.craftedRecipeId }),
    });
  });
  return {
    goods,
    buyback,
    honorBalance: Math.max(0, Math.floor(balances.honor)),
    hasHonorGoods: goods.some((row) => row.price.honor > 0),
    multiple,
  };
}

/**
 * The Sell Junk button's enablement and quote as ONE pure decision. The two
 * halves deliberately diverge on unknown-id slots (a bundle behind the
 * server, R34): the server resolves sell_all_junk against ITS OWN table, so
 * grays this bundle cannot classify still sell, and the button stays live
 * whenever such a slot exists, while the quoted total keeps counting only
 * what this bundle can price. A player holding ONLY unknown non-gray items
 * therefore sees a live button quoting zero that sells nothing, the accepted
 * cosmetic cost of never stranding real junk unsellable on a stale bundle.
 */
export function sellJunkButtonState(
  inventory: readonly InvSlot[],
  items: Readonly<Record<string, ItemDef>>,
): { enabled: boolean; proceeds: number } {
  const junk = inventory.filter((slot) => junkSellableSlot(items[slot.itemId], slot));
  const hasUnknownSlots = inventory.some((slot) => knownItemDef(items, slot.itemId) === undefined);
  return {
    enabled: junk.length > 0 || hasUnknownSlots,
    // junkSellableSlot only passes defs that carry a sell value, so the ?? 0
    // is unreachable belt-and-braces, never a quote change.
    proceeds: junk.reduce(
      (sum, slot) => sum + (items[slot.itemId]?.sellValue ?? 0) * slot.count,
      0,
    ),
  };
}
