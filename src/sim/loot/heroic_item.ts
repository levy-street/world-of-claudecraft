import { heroicVariantId } from '../content/heroic_variants';
import { ITEMS } from '../data';
import { itemLevel } from '../item_level';

/** The same upgrade rule for corpse loot and weekly reward previews/claims. */
export function heroicLootItemId(id: string, heroic: boolean): string {
  if (!heroic) return id;
  const variant = ITEMS[heroicVariantId(id)];
  if (!variant) return id;
  return (itemLevel(variant) ?? 0) > (itemLevel(ITEMS[id]) ?? 0) ? variant.id : id;
}
