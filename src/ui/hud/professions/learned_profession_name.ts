import { ENCHANTS } from '../../../sim/content/enchants';
import { recipeById } from '../../../sim/content/recipes';
import { ITEMS } from '../../../sim/data';
import { itemDisplayName } from '../../entity_i18n';
import { t } from '../../i18n';
import { enchantNameKey } from './enchant_apply_view';

/** Shared trainer/pattern/formula feedback keeps internal enchant ids out of chat. */
export function learnedProfessionName(recipeId: string): string {
  if (ENCHANTS[recipeId]) return t(enchantNameKey(recipeId));
  const recipe = recipeById(recipeId);
  const item = recipe ? ITEMS[recipe.resultItemId] : undefined;
  return item ? itemDisplayName(item) : recipeId;
}

/** One localized success line for trainer recipes, manuals and enchant formulas. */
export function learnedProfessionMessage(recipeId: string): string {
  return t('hudChrome.training.learned', { recipe: learnedProfessionName(recipeId) });
}
