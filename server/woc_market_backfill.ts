// One-shot boot backfill for the Browse category stamps: rows escrowed
// before the category/subcategory columns existed carry NULL and would sit
// outside every category-filtered browse forever (found live on dev: the
// pre-round listings vanished under Category = Weapons while their items
// plainly derived to weapon/sword). The stamps are derived DISPLAY data, so
// re-deriving them for old rows is safe by construction; new rows stamp at
// escrow and never reach this pass. Converges: every walked item id stamps
// non-null (a def the catalog no longer names stamps 'other', unreachable by
// the category filters and honest about it), so a second boot reads an empty
// worklist. The sibling-module pattern (woc_market_budgets.ts): woc_market.ts
// stays untouched and main.ts calls this once at boot, enabled-gated.

import { ITEMS } from '../src/sim/data';
import { exchangeBrowseCategory, exchangeBrowseSubcategory } from '../src/sim/exchange_eligibility';

export interface WocCategoryBackfillDb {
  listingItemIdsMissingCategory(): Promise<string[]>;
  stampListingCategory(
    itemId: string,
    category: string,
    subcategory: string | null,
  ): Promise<number>;
}

/** Returns the number of rows stamped (0 on an already-converged database). */
export async function backfillListingCategoryStamps(db: WocCategoryBackfillDb): Promise<number> {
  const itemIds = await db.listingItemIdsMissingCategory();
  let stamped = 0;
  for (const itemId of itemIds) {
    const def = ITEMS[itemId];
    const category = def ? exchangeBrowseCategory(def) : 'other';
    const subcategory = def ? exchangeBrowseSubcategory(def) : null;
    stamped += await db.stampListingCategory(itemId, category, subcategory);
  }
  return stamped;
}
