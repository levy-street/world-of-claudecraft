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

import type { InvSlot, ItemDef } from '../sim/types';
import { vendorStackSize } from '../sim/vendor_stack';

export interface VendorGoodsRow {
  itemId: string;
  item: ItemDef;
  /** Server-matching price for one purchase. Either component may be zero. */
  price: VendorPrice;
  /** Units handed over per purchase: food/drink come in a stack, the rest are 1. */
  quantity: number;
  /** Advisory UI state only; the authoritative buy path rechecks both balances. */
  affordable: boolean;
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
    goods.push({
      itemId,
      item,
      price,
      quantity,
      affordable: balances.copper >= price.copper && balances.honor >= price.honor,
    });
  }
  const buyback: VendorBuybackRow[] = [];
  for (const slot of buybackSlots) {
    const item = items[slot.itemId];
    if (!item || slot.count <= 0) continue;
    buyback.push({ itemId: slot.itemId, item, count: slot.count, price: item.sellValue });
  }
  return {
    goods,
    buyback,
    honorBalance: Math.max(0, Math.floor(balances.honor)),
    hasHonorGoods: goods.some((row) => row.price.honor > 0),
  };
}
