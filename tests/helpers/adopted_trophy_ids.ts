import { ALL_RECIPES, TROPHY_RECIPES } from '../../src/sim/content/recipes';
import type { ItemDef } from '../../src/sim/types';

// The adopted-trophy derivation the Masterwrought phase 11l suites share
// (tests/items.test.ts, tests/bags_view.test.ts, tests/inventory_sort.test.ts):
// the junk-kind reagents of the TROPHY_RECIPES rows that no OTHER recipe
// consumes, sorted. Extracted on the rule of three, byte-for-byte the block
// each suite carried, so the three cannot drift apart.
//
// It pins two directions at once when a suite holds its literal adopted list
// equal to this output. A de-adopted trophy (its row dropped, or re-picked off
// it) leaves the derived set while the literal keeps it, so the suite reds. A
// non-trophy recipe that starts consuming an adopted trophy drops it from the
// derived set too (the "no other recipe consumes" clause), which is a
// deliberate tripwire: the trophy is still adopted in that case, so the fix is
// to widen this derivation and name the second consumer, never to de-adopt
// the trophy. The shared reagents a trophy row lists beside its trophy (iron
// ore, pristine hide, the vendor staples) never derive in, because every one
// of them is consumed by a non-trophy recipe.
//
// `items` is a parameter rather than the merged ITEMS table so a suite can
// hand in a synthetic catalog (the kind filter is what a test overrides to
// prove the non-junk arm), and so the helper stays a pure function of its
// inputs.
export function adoptedTrophyIds(items: Record<string, ItemDef>): string[] {
  const trophyRecipeIds = new Set(TROPHY_RECIPES.map((r) => r.id));
  const sharedReagents = new Set<string>();
  for (const recipe of ALL_RECIPES) {
    if (trophyRecipeIds.has(recipe.id)) continue;
    for (const reagent of recipe.reagents) sharedReagents.add(reagent.itemId);
  }
  const derived = new Set<string>();
  for (const recipe of TROPHY_RECIPES) {
    for (const reagent of recipe.reagents) {
      if (items[reagent.itemId]?.kind !== 'junk') continue;
      if (!sharedReagents.has(reagent.itemId)) derived.add(reagent.itemId);
    }
  }
  return [...derived].sort();
}
