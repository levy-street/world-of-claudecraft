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
import type { InvSlot, ItemDef, ItemInstancePayload } from '../../../sim/types';
import { bulkBuyQuantity } from '../../../sim/vendor_buy_stack';
import { vendorStackSize } from '../../../sim/vendor_stack';

export interface VendorGoodsRow {
  itemId: string;
  item: ItemDef;
  /** Server-matching price for one purchase. Either component may be zero. */
  price: VendorPrice;
  /** Units handed over per purchase: food/drink come in a stack, the rest are 1. */
  quantity: number;
  /** Advisory UI state only; the authoritative buy path rechecks both balances. */
  affordable: boolean;
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
}

/**
 * Build the structured vendor view from raw inputs.
 *
 * Goods: a vendor item is offered only if it exists in the item table and has a
 * positive copper or Honor price (vendors never list a priceless item). Buyback:
 * a stored slot is redeemable only if the item still exists and the stack count
 * is positive.
 */
export function buildVendorView(
  vendorItemIds: readonly string[],
  buybackSlots: readonly InvSlot[],
  items: Record<string, ItemDef>,
  balances: VendorBalances,
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
    goods.push({
      itemId,
      item,
      price,
      quantity,
      affordable: balances.copper >= price.copper && balances.honor >= price.honor,
      ...(bulkQuantity !== undefined && {
        bulkQuantity,
        bulkAffordable: balances.copper >= unitCopper * bulkQuantity,
      }),
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
  };
}
