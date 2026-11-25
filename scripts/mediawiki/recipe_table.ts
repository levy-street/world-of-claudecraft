import { ALL_RECIPES, ITEMS } from '../../src/sim/data';
import type { ProfessionRecipeRecord } from '../../src/sim/professions/types';
import { itemArtPath } from './article_art';
import { type RecipeSourceLinks, recipeLearnedFrom } from './recipe_sources';
import { wikiQualityName } from './wiki_item_kind';

// The recipe table on each crafting profession's page: every recipe of that
// profession, sorted by the skill it lists, with what it makes, what it uses and
// where to learn it. Same wikitable markup as the item tables, so the reader can
// sort and filter it.

export interface RecipeTableLinks extends RecipeSourceLinks {
  /** The recipe's own page link, labelled with its name. */
  recipe(recipe: ProfessionRecipeRecord): string;
}

/** A profession's recipes in table order: lowest listed skill first, then by name. */
export function professionRecipes(
  professionId: string,
  name: (recipe: ProfessionRecipeRecord) => string,
): ProfessionRecipeRecord[] {
  return ALL_RECIPES.filter((r) => r.professionId === professionId).sort(
    (a, b) =>
      a.skillReq - b.skillReq || name(a).localeCompare(name(b), 'en') || a.id.localeCompare(b.id),
  );
}

export function recipeTableRow(recipe: ProfessionRecipeRecord, links: RecipeTableLinks): string[] {
  const art = itemArtPath(recipe.resultItemId);
  const made = ITEMS[recipe.resultItemId];
  return [
    String(recipe.skillReq),
    (art ? `<woc-art path="${art}" size="icon" /> ` : '') + links.recipe(recipe),
    `${recipe.resultCount} x ${links.item(recipe.resultItemId)} (${wikiQualityName(made?.quality)})`,
    recipe.reagents.map((r) => `${r.count} x ${links.item(r.itemId)}`).join(', '),
    recipeLearnedFrom(recipe, links),
  ];
}

export const RECIPE_TABLE_HEADINGS = ['Skill', 'Recipe', 'Makes', 'Materials', 'Learned from'];

/** The whole table for a list of recipes, in the order given. */
export function recipeTable(
  recipes: readonly ProfessionRecipeRecord[],
  links: RecipeTableLinks,
): string {
  return (
    '{| class="wikitable recipe-table"\n|-\n! ' +
    RECIPE_TABLE_HEADINGS.join(' !! ') +
    '\n' +
    recipes.map((r) => '|-\n| ' + recipeTableRow(r, links).join(' || ')).join('\n') +
    '\n|}'
  );
}
