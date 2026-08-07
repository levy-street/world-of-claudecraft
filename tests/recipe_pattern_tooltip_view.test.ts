// Recipe PATTERN tooltip core: the model resolution plus the three rendered
// lines. English copy is asserted directly (the gather_tool_tooltip.test.ts
// idiom), and the numbers/ids come from the REAL recipe table rather than a
// synthetic one, so a recipe whose skillReq or result item moves fails here
// instead of shipping a tooltip that quotes a number the crafting window
// disagrees with. Only the pattern ITEM def is synthetic (patterns are content
// the phase adds separately; the core takes any ItemDef).
import { describe, expect, it } from 'vitest';
import { recipeById } from '../src/sim/content/recipes';
import type { ItemDef, RecipeItemDef } from '../src/sim/types';
import {
  type RecipePatternViewerInput,
  recipePatternTooltipLines,
  recipePatternTooltipModel,
} from '../src/ui/recipe_pattern_tooltip_view';

// An alchemy recipe with a real skill gate (skillReq 50) and a resolvable
// result item, and a common-tier weaponcrafting recipe gated at 0.
const GATED_RECIPE = 'recipe_sunpetal_mana_draught';
const FREE_RECIPE = 'recipe_eastbrook_arming_sword';

function pattern(teachesRecipeId: string): RecipeItemDef {
  return {
    id: `pattern_${teachesRecipeId}`,
    name: 'Test Pattern',
    kind: 'recipe',
    quality: 'uncommon',
    sellValue: 100,
    teachesRecipeId,
  };
}

function viewer(over: Partial<RecipePatternViewerInput> = {}): RecipePatternViewerInput {
  return { knownRecipes: [], craftSkills: {}, ...over };
}

describe('recipePatternTooltipModel', () => {
  it('resolves the taught recipe off the real table', () => {
    const recipe = recipeById(GATED_RECIPE);
    expect(recipe).toBeDefined();
    const model = recipePatternTooltipModel(pattern(GATED_RECIPE), viewer());
    expect(model).toEqual({
      recipeId: GATED_RECIPE,
      resultItemId: 'sunpetal_mana_draught',
      professionId: 'alchemy',
      skillReq: 50,
      skillMet: false,
      known: false,
    });
    // The model quotes the table, never a second copy of these numbers.
    expect(model?.skillReq).toBe(recipe?.skillReq);
    expect(model?.resultItemId).toBe(recipe?.resultItemId);
  });

  it('answers null for every non-pattern kind', () => {
    const potion: ItemDef = {
      id: 'qa_potion',
      name: 'QA Potion',
      kind: 'potion',
      quality: 'common',
      sellValue: 1,
    };
    expect(recipePatternTooltipModel(potion, viewer())).toBeNull();
    expect(recipePatternTooltipLines(potion, viewer())).toBe('');
  });

  it('answers null for a teachesRecipeId this bundle cannot resolve', () => {
    // The R34 stale-client arm: no invented line for unknown content.
    expect(recipePatternTooltipModel(pattern('recipe_from_a_newer_build'), viewer())).toBeNull();
    expect(recipePatternTooltipLines(pattern('recipe_from_a_newer_build'), viewer())).toBe('');
  });

  it('reads skillMet off the viewer craft skill, per craft', () => {
    const under = recipePatternTooltipModel(
      pattern(GATED_RECIPE),
      viewer({ craftSkills: { alchemy: 49 } }),
    );
    const exact = recipePatternTooltipModel(
      pattern(GATED_RECIPE),
      viewer({ craftSkills: { alchemy: 50 } }),
    );
    // A different craft's skill must not satisfy an alchemy gate.
    const wrongCraft = recipePatternTooltipModel(
      pattern(GATED_RECIPE),
      viewer({ craftSkills: { tailoring: 300 } }),
    );
    expect(under?.skillMet).toBe(false);
    expect(exact?.skillMet).toBe(true);
    expect(wrongCraft?.skillMet).toBe(false);
  });

  it('reads known off the viewer known-recipe list', () => {
    expect(
      recipePatternTooltipModel(pattern(GATED_RECIPE), viewer({ knownRecipes: [GATED_RECIPE] }))
        ?.known,
    ).toBe(true);
    expect(
      recipePatternTooltipModel(pattern(GATED_RECIPE), viewer({ knownRecipes: [FREE_RECIPE] }))
        ?.known,
    ).toBe(false);
  });
});

describe('recipePatternTooltipLines', () => {
  it('states what the pattern teaches, in the item name, not the recipe id', () => {
    const html = recipePatternTooltipLines(pattern(GATED_RECIPE), viewer());
    expect(html).toContain('<div class="tt-desc">Use: Teaches you Sunpetal Mana Draught.</div>');
    expect(html).not.toContain(GATED_RECIPE);
  });

  it('paints the requirement line red below the gate and plain at or above it', () => {
    expect(recipePatternTooltipLines(pattern(GATED_RECIPE), viewer())).toContain(
      '<div class="tt-red">Requires Alchemy 50</div>',
    );
    expect(
      recipePatternTooltipLines(pattern(GATED_RECIPE), viewer({ craftSkills: { alchemy: 50 } })),
    ).toContain('<div class="tt-sub">Requires Alchemy 50</div>');
  });

  it('renders no requirement line for a recipe gated at 0', () => {
    const html = recipePatternTooltipLines(pattern(FREE_RECIPE), viewer());
    expect(html).toContain('Use: Teaches you');
    expect(html).not.toContain('Requires');
  });

  it('adds the trainer already-known line only when the recipe is known', () => {
    const unknown = recipePatternTooltipLines(pattern(GATED_RECIPE), viewer());
    const known = recipePatternTooltipLines(
      pattern(GATED_RECIPE),
      viewer({ knownRecipes: [GATED_RECIPE] }),
    );
    expect(unknown).not.toContain('You already know that recipe.');
    // The trainer's own wording, reused rather than reworded.
    expect(known).toContain('<div class="tt-red">You already know that recipe.</div>');
  });

  it('orders the block teaches, then requirement, then known', () => {
    // The hover reads top-down as what it grants, what it costs in skill, and
    // whether it is already spent; a reordered block would bury the refusal.
    const html = recipePatternTooltipLines(
      pattern(GATED_RECIPE),
      viewer({ knownRecipes: [GATED_RECIPE] }),
    );
    const teaches = html.indexOf('Teaches you');
    const requires = html.indexOf('Requires Alchemy');
    const known = html.indexOf('You already know');
    expect(teaches).toBeGreaterThanOrEqual(0);
    expect(requires).toBeGreaterThan(teaches);
    expect(known).toBeGreaterThan(requires);
  });
});
