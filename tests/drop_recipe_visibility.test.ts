// Drop-acquired recipes and formulas are INVISIBLE until learned (raid
// professions, docs/prd/ignivar-raid-professions.md): the crafting window
// lists only known recipes (isRecipeKnownForViewer), the train ladder and
// the station learn-hint only ever surface 'trainer' acquisition, and the
// Apply Enchant picker hides acquisition-gated formulas the viewer has not
// learned. These pins hold every surface to that rule so a future authored
// drop recipe cannot leak into a trainer surface or spoil itself.
import { afterAll, describe, expect, it } from 'vitest';
import { ENCHANTS, type EnchantDef } from '../src/sim/content/enchants';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, STATIONS } from '../src/sim/data';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { craftLearnHints } from '../src/ui/crafting_view';
import { enchantsForReagent } from '../src/ui/enchant_apply_view';
import { buildTrainView, isRecipeKnownForViewer } from '../src/ui/hud/vendor/train_view';

const DROP_RECIPE: ProfessionRecipeRecord = {
  id: 'test_drop_visibility_recipe',
  professionId: 'armorcrafting',
  resultItemId: 'iron_ore',
  resultCount: 1,
  reagents: [],
  skillReq: 100,
  itemLevelBudget: 31,
  level: 31,
  acquisition: ['drop'],
};

const GATED_FORMULA_ID = 'test_picker_gate_formula';
ENCHANTS[GATED_FORMULA_ID] = {
  id: GATED_FORMULA_ID,
  name: 'Test Picker Gate',
  itemSlot: 'mainhand',
  reagents: [{ itemId: 'arcane_dust', count: 3 }],
  statBonus: { str: 1 },
  acquisition: ['drop'],
  skillReq: 100,
} as EnchantDef;
afterAll(() => {
  delete ENCHANTS[GATED_FORMULA_ID];
});

const dustSlot = [{ itemId: 'arcane_dust', count: 20 }] as any;

describe('drop recipe visibility', () => {
  it('an unlearned drop recipe is not known to the viewer (the window filter)', () => {
    expect(isRecipeKnownForViewer(DROP_RECIPE, new Set())).toBe(false);
    expect(isRecipeKnownForViewer(DROP_RECIPE, new Set([DROP_RECIPE.id]))).toBe(true);
  });

  it('the train ladder never surfaces a drop-only recipe, even at max skill', () => {
    // The drop recipe's teaching home would be the forge (armorcrafting), so
    // build the forge master's ladder with it injected into the content
    // table: trainer rows render, the drop recipe never does.
    ALL_RECIPES.push(DROP_RECIPE);
    try {
      const view = buildTrainView('forgemistress_darva', {
        stations: STATIONS,
        knownRecipes: [],
        craftSkills: { armorcrafting: 125, weaponcrafting: 125 },
        copper: 1_000_000,
        items: ITEMS,
      });
      expect(view.stationType).toBe('forge');
      expect(view.rows.length).toBeGreaterThan(0);
      expect(view.rows.some((row) => row.recipeId === DROP_RECIPE.id)).toBe(false);
    } finally {
      ALL_RECIPES.splice(ALL_RECIPES.indexOf(DROP_RECIPE), 1);
    }
  });

  it('the station learn-hint never points at a drop-only recipe', () => {
    // The hint rule is the trainer-acquisition filter: feed a known set
    // containing every trainer recipe id and no hints remain, proving no
    // OTHER acquisition (the drop recipes to come) can ever mint one.
    const everyTrainer = ALL_RECIPES.filter((r: ProfessionRecipeRecord) =>
      r.acquisition?.includes('trainer'),
    ).map((r: ProfessionRecipeRecord) => r.id);
    const hints = craftLearnHints(everyTrainer, STATIONS);
    expect(hints.size).toBe(0);
  });

  it('the enchant picker hides an unlearned gated formula and shows it once learned', () => {
    const hidden = enchantsForReagent(dustSlot, 'arcane_dust');
    expect(hidden.some((row) => row.enchantId === GATED_FORMULA_ID)).toBe(false);
    // Grandfathered dust enchants still show with no known set at all.
    expect(hidden.length).toBeGreaterThan(0);
    const shown = enchantsForReagent(dustSlot, 'arcane_dust', [GATED_FORMULA_ID]);
    expect(shown.some((row) => row.enchantId === GATED_FORMULA_ID)).toBe(true);
  });
});
