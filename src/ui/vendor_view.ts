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

export interface VendorGoodsRow {
  itemId: string;
  item: ItemDef;
  /** Copper the vendor sells this item for. Always > 0 for a goods row. */
  price: number;
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
}

/**
 * Build the structured vendor view from raw inputs.
 *
 * Goods: a vendor item is offered only if it exists in the item table and has a
 * truthy buyValue (vendors never list a priceless item). Buyback: a stored slot
 * is redeemable only if the item still exists and the stack count is positive.
 */
export function buildVendorView(
  vendorItemIds: readonly string[],
  buybackSlots: readonly InvSlot[],
  items: Record<string, ItemDef>,
): VendorView {
  const goods: VendorGoodsRow[] = [];
  for (const itemId of vendorItemIds) {
    const item = items[itemId];
    if (!item?.buyValue) continue;
    goods.push({ itemId, item, price: item.buyValue });
  }
  const buyback: VendorBuybackRow[] = [];
  for (const slot of buybackSlots) {
    const item = items[slot.itemId];
    if (!item || slot.count <= 0) continue;
    buyback.push({ itemId: slot.itemId, item, count: slot.count, price: item.sellValue });
  }
  return { goods, buyback };
}
