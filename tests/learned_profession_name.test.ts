import { describe, expect, it } from 'vitest';
import { ALL_RECIPES, ITEMS } from '../src/sim/data';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { learnedProfessionMessage, learnedProfessionName } from '../src/ui/hud/professions/learned_profession_name';
import { t } from '../src/ui/i18n';

describe('shared learned profession feedback', () => {
  it('resolves a formula name before composing the existing learned message', () => {
    expect(learnedProfessionMessage('enchant_weapon_lastflame_zeal')).toBe(
      t('hudChrome.training.learned', { recipe: "Last Flame's Zeal" }),
    );
  });

  it('keeps ordinary recipe and unknown-id feedback unchanged', () => {
    const recipe = ALL_RECIPES.find((entry) => ITEMS[entry.resultItemId]);
    if (!recipe) throw new Error('missing live recipe');
    expect(learnedProfessionName(recipe.id)).toBe(itemDisplayName(ITEMS[recipe.resultItemId]));
    for (const id of [recipe.id, 'future_recipe']) {
      expect(learnedProfessionMessage(id)).toBe(t('hudChrome.training.learned', { recipe: learnedProfessionName(id) }));
    }
  });
});
