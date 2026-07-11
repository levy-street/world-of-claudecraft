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
  /** Total copper for one purchase (per-unit buyValue times quantity). Always > 0. */
  price: number;
  /** Units handed over per purchase: food/drink come in a stack, the rest are 1. */
  quantity: number;
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

export interface VendorSellRow {
  itemId: string;
  item: ItemDef;
  /** Total units held across every bag slot of this item. Always > 0. */
  count: number;
  /** Per-unit vendor sell value (copper). Always > 0. */
  unitPrice: number;
  /** Copper for selling the whole stack: unitPrice times count. */
  total: number;
  /** True if ANY aggregated slot carried per-instance (rolled-stat) payload. The
   *  sim sells by itemId and buyback only restores a BASE copy, so a one-click
   *  whole-stack sell of a rolled row would lose the rolled stats: the UI gates it
   *  behind a confirm. Plain fungible rows (no instance) sell with no friction. */
  instanced: boolean;
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
    const quantity = vendorStackSize(item);
    goods.push({ itemId, item, price: item.buyValue * quantity, quantity });
  }
  const buyback: VendorBuybackRow[] = [];
  for (const slot of buybackSlots) {
    const item = items[slot.itemId];
    if (!item || slot.count <= 0) continue;
    buyback.push({ itemId: slot.itemId, item, count: slot.count, price: item.sellValue });
  }
  return { goods, buyback };
}

/**
 * Build the sellable-inventory rows for the vendor Sell tab.
 *
 * A bag slot is sellable only if its item still exists, its count is positive,
 * and the vendor will actually pay for it: quest items and noVendorSell items are
 * excluded (the same rejections the sim's sellItem enforces), and a zero (or
 * missing) sellValue item is excluded too (nothing to gain, and never a "sellable"
 * row). Slots of the same item are aggregated into ONE row keyed by itemId, in
 * first-seen order, because the sim sells by itemId across every slot: a row's
 * count is the total held and its Sell action sells that whole total (the classic
 * right-click-sells-the-stack dispatch), so the displayed total is exactly what
 * the sale pays out.
 */
export function buildVendorSellRows(
  inventory: readonly InvSlot[],
  items: Record<string, ItemDef>,
): VendorSellRow[] {
  const byId = new Map<string, VendorSellRow>();
  const order: string[] = [];
  for (const slot of inventory) {
    if (slot.count <= 0) continue;
    const item = items[slot.itemId];
    if (!item) continue;
    if (item.kind === 'quest') continue;
    if (item.noVendorSell) continue;
    if (!item.sellValue || item.sellValue <= 0) continue;
    const slotInstanced = slot.instance != null;
    const existing = byId.get(slot.itemId);
    if (existing) {
      existing.count += slot.count;
      existing.total = existing.unitPrice * existing.count;
      if (slotInstanced) existing.instanced = true;
    } else {
      byId.set(slot.itemId, {
        itemId: slot.itemId,
        item,
        count: slot.count,
        unitPrice: item.sellValue,
        total: item.sellValue * slot.count,
        instanced: slotInstanced,
      });
      order.push(slot.itemId);
    }
  }
  return order.map((id) => byId.get(id) as VendorSellRow);
}
