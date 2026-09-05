// Pure planning for a multi-recipe manual. Validate the entire authored group
// before the use command grants knowledge or consumes its selected copy.
import type { RecipeItemDef } from '../types';
import type { ProfessionRecipeRecord } from './types';

export function collectionManualRecipes(
  def: RecipeItemDef,
  lookup: (id: string) => ProfessionRecipeRecord | undefined,
): ProfessionRecipeRecord[] | null {
  const ids = def.teachesRecipeIds ?? [def.teachesRecipeId];
  if (ids.length === 0 || ids[0] !== def.teachesRecipeId || new Set(ids).size !== ids.length) {
    return null;
  }
  const recipes: ProfessionRecipeRecord[] = [];
  for (const id of ids) {
    const recipe = lookup(id);
    if (!recipe?.acquisition?.includes('drop')) return null;
    recipes.push(recipe);
  }
  return recipes;
}
