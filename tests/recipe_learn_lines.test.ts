// The shared learn-outcome line core (src/ui/recipe_learn_lines.ts): both
// the trainResult and recipeScrollResult hud arms build their one chat line
// here, through the SAME training keys. Pins the success name resolution,
// the tier-unmet threshold math, the reason mapping on both paths, and the
// null (render-nothing) arms.
import { describe, expect, it } from 'vitest';
import { COMMON_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { t } from '../src/ui/i18n';
import { recipeScrollResultLine, trainResultLine } from '../src/ui/recipe_learn_lines_view';

const REAL_RECIPE = COMMON_RECIPES[0];

describe('recipe_learn_lines', () => {
  it('success renders the learned line with the result item name, on both paths', () => {
    const itemName = itemDisplayName(ITEMS[REAL_RECIPE.resultItemId]);
    for (const line of [
      trainResultLine({ ok: true, recipeId: REAL_RECIPE.id }),
      recipeScrollResultLine({ ok: true, recipeId: REAL_RECIPE.id }),
    ]) {
      expect(line).not.toBeNull();
      expect(line?.text).toBe(t('hudChrome.training.learned', { recipe: itemName }));
      expect(line?.color).toBe('#7fdc4f');
    }
  });

  it('tier-unmet renders the threshold from the recipe skillReq, on both paths', () => {
    // recipe_wardweave_cowl sits at skillReq 75 (tier 3), so the line names
    // the 75 threshold.
    const trainLine = trainResultLine({
      ok: false,
      recipeId: 'recipe_wardweave_cowl',
      reason: 'train_tier_unmet',
    });
    const scrollLine = recipeScrollResultLine({
      ok: false,
      recipeId: 'recipe_wardweave_cowl',
      reason: 'scroll_tier_unmet',
    });
    expect(trainLine?.text).toContain('75');
    expect(scrollLine?.text).toBe(trainLine?.text);
    expect(scrollLine?.color).toBe('#ff6b6b');
  });

  it('already-known maps to the training key on both paths', () => {
    const expected = t('hudChrome.training.alreadyKnown');
    expect(
      trainResultLine({ ok: false, recipeId: REAL_RECIPE.id, reason: 'train_already_known' })?.text,
    ).toBe(expected);
    expect(
      recipeScrollResultLine({
        ok: false,
        recipeId: REAL_RECIPE.id,
        reason: 'scroll_already_known',
      })?.text,
    ).toBe(expected);
  });

  it('the train-only reasons keep their keys', () => {
    const cases = [
      ['train_cannot_afford', 'hudChrome.training.cannotAfford'],
      ['train_not_taught_here', 'hudChrome.training.notTaughtHere'],
      ['train_out_of_range', 'hudChrome.training.outOfRange'],
    ] as const;
    for (const [reason, key] of cases) {
      expect(trainResultLine({ ok: false, recipeId: REAL_RECIPE.id, reason })?.text).toBe(t(key));
    }
  });

  it('the render-nothing arms return null', () => {
    // Reason-less denies (the malformed-id probe answer) on both paths, and
    // the scroll authoring-error arm.
    expect(trainResultLine({ ok: false, recipeId: 'no_such' })).toBeNull();
    expect(recipeScrollResultLine({ ok: false, recipeId: 'no_such' })).toBeNull();
    expect(
      recipeScrollResultLine({
        ok: false,
        recipeId: REAL_RECIPE.id,
        reason: 'scroll_wrong_source',
      }),
    ).toBeNull();
  });
});
