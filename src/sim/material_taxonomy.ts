// The honest material taxonomy behind the bank "Deposit materials" sweep and
// the shared bags/bank Materials chip. It is derived from the content tables
// that make an item a material: node yields, fine grades, corpse components,
// pristine specimens, salvage returns, recipes, and enchants. The union is
// filtered to kind 'junk', so tools, vendor trash, and unclassified trophies
// cannot enter by approximation. Tests/material_taxonomy.test.ts pins the
// exact census and exercises every source independently.
//
// Deliberately not consulted by bankDeposit itself: the direct command stores
// any non-quest item, while only the presentation sweep and chips narrow to
// honest materials. material_ids.ts owns the one eager runtime-immutable
// registry used by simulation and presentation; this compatibility module
// adds the ItemDef predicate and injectable derivation re-export.
//
// No src/sim production module should import this presentation-facing
// predicate. Sim consumers use isMaterialItemId from material_ids.ts instead,
// and tests/material_taxonomy.test.ts enforces that scope.

import { MATERIAL_ITEM_IDS } from './material_ids';
import type { ItemDef } from './types';

export type { MaterialSourceTables } from './material_derivation';
export { deriveMaterialItemIds } from './material_derivation';
export { MATERIAL_ITEM_IDS } from './material_ids';

/** True when `item` is an honest material in the canonical registry. */
export function isMaterialItem(item: ItemDef): boolean {
  return MATERIAL_ITEM_IDS.has(item.id);
}
