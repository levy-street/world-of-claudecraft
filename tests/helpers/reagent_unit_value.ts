// The locked reagent-value rule the recipe economy is priced on, stated ONCE
// for every suite that computes a bill (tests/recipe_economy.test.ts owns the
// invariant; tests/guide.test.ts derives player-copy claims through it).
//
// unit value: buyValue when the def carries a finite buyValue > 0 (a vendor
// staple the player pays for), else sellValue (a harvested or dropped
// material the player realizes at the vendor floor). A bill is the sum over
// reagents of count times unit value. Two copies of this rule drifted apart
// once before a Phase 19G read caught the second one; import it, never
// restate it.

import { ITEMS } from '../../src/sim/data';

export function reagentUnitValue(itemId: string): number {
  const def = ITEMS[itemId];
  if (!def) throw new Error(`recipe reagent ${itemId} has no ItemDef`);
  return typeof def.buyValue === 'number' && def.buyValue > 0 ? def.buyValue : def.sellValue;
}

export function recipeInputValue(recipe: {
  reagents: ReadonlyArray<{ itemId: string; count: number }>;
}): number {
  let total = 0;
  for (const reagent of recipe.reagents) total += reagent.count * reagentUnitValue(reagent.itemId);
  return total;
}
