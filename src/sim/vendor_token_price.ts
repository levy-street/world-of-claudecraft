// The token price of a vendor row (ItemDef.priceItem): a count of an ITEM the
// buyer pays from their bags, per purchase, never stack-multiplied (the Honor
// rule). One reader shared by the authoritative buy path (items.ts buyItem) and
// the vendor window's view core (ui/hud/vendor/vendor_view.ts), so the price a
// row shows is the price the sim charges. Pure leaf.
import type { ItemDef } from './types';

export interface VendorTokenPrice {
  itemId: string;
  count: number;
}

/** The row's token price, or null when it has none (or a malformed one). */
export function vendorTokenPrice(def: ItemDef | undefined): VendorTokenPrice | null {
  const price = def?.priceItem;
  if (!price || typeof price.itemId !== 'string' || price.itemId === '') return null;
  if (!Number.isFinite(price.count) || price.count < 1) return null;
  return { itemId: price.itemId, count: Math.floor(price.count) };
}
