// The locked reagent-value rule the recipe economy is priced on, stated here
// for every suite that prices a bill through the SHARED basis:
// tests/recipe_economy.test.ts (owns the invariant), tests/guide.test.ts
// (player-copy claims), tests/provisioning_supply_line.test.ts and its apex
// twin (the accent rule's value half), tests/professions_tool_effect_recharge
// .test.ts (the R39 inequality).
//
// unit value: buyValue when the def carries a finite buyValue > 0 (a vendor
// staple the player pays for), else sellValue (a harvested or dropped
// material the player realizes at the vendor floor). A bill is the sum over
// reagents of count times unit value.
//
// TWO SUITES RESTATE IT ON PURPOSE and must keep their own copy:
// tests/farm_recipes.test.ts (its header says so: it must red on a reagent
// retune and must not inherit a future relaxation of this helper) and the
// apex-bill arm of tests/masterwrought_budget.test.ts (an inline variant
// that defaults a missing sellValue to 0). Everywhere else, import this;
// a Phase 19G read found six restatements before this file existed.

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
