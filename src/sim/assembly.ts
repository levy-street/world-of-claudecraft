// The Assemble decision for a kind:'assembled' item: does the player hold every
// reagent the recipe consumes? Counting only, no mutation, so the sim command
// (items.ts assembleItem) owns the removal/grant and this stays a leaf a Vitest
// can drive directly against a plain slot list.
//
// Reagents are counted across every stack of an id, since bags split a stack
// freely, and a slot carrying an instance payload counts like any other: nothing
// authored as a reagent is instanced today, and consuming the plain copies first
// is what removeItem already does. Only the recipe's count is taken, so a player
// holding spares keeps them.
import type { AssemblyRecipe, InvSlot } from './types';

export interface AssemblyCheck {
  ok: boolean;
  /** Reagents the player is short of, in recipe order. Empty when ok. */
  missing: { itemId: string; required: number; held: number }[];
}

export function heldCount(inventory: readonly InvSlot[], itemId: string): number {
  let held = 0;
  for (const slot of inventory) {
    if (slot.itemId === itemId && slot.count > 0) held += slot.count;
  }
  return held;
}

// Whether `recipe` can be assembled from `inventory`, and what is short if not.
export function checkAssembly(
  inventory: readonly InvSlot[],
  recipe: AssemblyRecipe,
): AssemblyCheck {
  const missing: AssemblyCheck['missing'] = [];
  for (const reagent of recipe.reagents) {
    const held = heldCount(inventory, reagent.itemId);
    if (held < reagent.count) {
      missing.push({ itemId: reagent.itemId, required: reagent.count, held });
    }
  }
  return { ok: missing.length === 0, missing };
}
