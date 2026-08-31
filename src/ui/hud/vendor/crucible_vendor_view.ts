// Pure, host-agnostic view model for the Crucible Quartermaster window.
//
// The pure-core half of the pure-core + thin-consumer split (reference
// heroic_vendor_view.ts): it decides which redemption rows render for the
// viewer's class and whether each is affordable at the viewer's sigil counts,
// and lists the viewer's sigil balances. The DOM/i18n side lives in
// crucible_vendor_window.ts. DOM-free and i18n-free so
// tests/crucible_vendor.test.ts can drive it directly.

import type { CrucibleVendorOffer } from '../../../sim/content/ignivar_loot';
import type { ItemDef, PlayerClass } from '../../../sim/types';

export interface CrucibleShopRow {
  itemId: string;
  item: ItemDef;
  /** The sigil that pays for this piece (one is always the price). */
  sigilId: string;
  sigil: ItemDef;
  affordable: boolean;
}

export interface CrucibleSigilBalance {
  sigilId: string;
  sigil: ItemDef;
  count: number;
}

export interface CrucibleShopView {
  rows: CrucibleShopRow[];
  /** The viewer's held sigils (only kinds with a positive count). */
  balances: CrucibleSigilBalance[];
}

/** Build the structured shop view: stock filtered to the viewer's class,
 * priced in sigils counted from the viewer's bags. Unknown item or sigil ids
 * are dropped (never render a row the sim would refuse to sell). */
export function buildCrucibleVendorView(
  stock: readonly CrucibleVendorOffer[],
  items: Record<string, ItemDef>,
  viewerClass: PlayerClass,
  sigilCount: (sigilId: string) => number,
): CrucibleShopView {
  const rows: CrucibleShopRow[] = [];
  const balanceById = new Map<string, CrucibleSigilBalance>();
  for (const offer of stock) {
    const item = items[offer.itemId];
    const sigil = items[offer.sigilId];
    if (!item || !sigil) continue;
    if (item.requiredClass && !item.requiredClass.includes(viewerClass)) continue;
    const count = sigilCount(offer.sigilId);
    rows.push({
      itemId: offer.itemId,
      item,
      sigilId: offer.sigilId,
      sigil,
      affordable: count >= 1,
    });
    if (count > 0 && !balanceById.has(offer.sigilId)) {
      balanceById.set(offer.sigilId, { sigilId: offer.sigilId, sigil, count });
    }
  }
  return { rows, balances: [...balanceById.values()] };
}
