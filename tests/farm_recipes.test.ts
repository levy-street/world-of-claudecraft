// FARM_RECIPES (the Phase 6 farm-economy hook set): conformance pins for the
// eight cooking dishes that turn crop produce into something a player wants.
//
// A SEPARATE LIST FROM LADDER_RECIPES, so it needs its own conformance suite:
// the ladder is closed at three rungs x three recipes per craft (pinned in
// tests/recipe_economy.test.ts), and four rung-50 dishes could not live inside
// that shape. Everything the ladder pins about its own rows is re-stated here
// for the farm rows: trainer acquisition, the kitchens station, the rung
// scaffolding convention, and rung-matched output quality.
//
// What is NEW here, and the reason this file exists rather than a few extra
// arms elsewhere:
//   - the fine-twin closure. Farming fine twins get NO downward grade
//     substitution (materialGradeIds walks MATERIAL_GRADES only, and no farm
//     row is a member), so a fine twin gains a consumer ONLY through its own
//     reagent slot. The hoe ladder took three of the eight; these dishes take
//     the remaining five, which is the Phase 5 deferral closing.
//   - the counterfactual vendor-fed exclusion. A recipe whose reagents ALL
//     carry a copper buyValue joins a sorted literal pin plus a discounted
//     input bound in tests/recipe_economy.test.ts; a dish grown from produce
//     must never be that shape, so every row is pinned to carry at least one
//     reagent with no buyValue.
//
// STRUCTURED FOR THE ALCHEMY ROW that joins FARM_RECIPES later in the same
// phase: every arm below runs over `dishes` (the cooking filter), not over
// FARM_RECIPES directly, so adding a non-cooking row is a clean edit to the
// list-level pins alone.
import { describe, expect, it } from 'vitest';
import { FARM_RECIPES } from '../src/sim/content/recipes';
// ITEMS and ALL_RECIPES from data (the merged view the sim, the trainer, the
// crafting window and the guide all read), not from content: a row authored in
// content but never joined into the merged table would be unreachable in play,
// and this suite would still pass reading content directly.
import { ALL_RECIPES, ITEMS } from '../src/sim/data';

const dishes = FARM_RECIPES.filter((r) => r.professionId === 'cooking');

// The rung scaffolding convention, shared with every other ladder in
// content/recipes.ts: skillReq -> [itemLevelBudget, level].
const SCAFFOLDING_BY_RUNG: Record<number, [number, number]> = {
  0: [10, 10],
  25: [16, 15],
  50: [20, 20],
};

// Output quality is decided by the rung, never authored per dish.
const QUALITY_BY_RUNG: Record<number, string> = { 0: 'common', 25: 'uncommon', 50: 'rare' };

// The points the shipped food curve already carries (content/profession_items.ts
// crafted cooking ladder plus the vendor foods): [foodHp, sellValue]. 980 is
// the ceiling (conjured_bread4). A farm dish must REUSE one of these, so the
// farm line adds no new rung to the curve.
const ALLOWED_FOOD_CURVE_POINTS: readonly (readonly [number, number])[] = [
  [90, 6],
  [117, 12],
  [243, 25],
  [432, 40],
  [552, 60],
  [552, 75],
  [980, 150],
];

// The five fine twins the hoe ladder did NOT take. Each must gain a dedicated
// reagent slot here or it has no consumer at all (no downward substitution).
// fine_vale_wheat, fine_marsh_rice and fine_highland_barley are deliberately
// absent: those three are hoe reagents already (HOE_RECIPES).
const FINE_TWINS_CLOSED_HERE = [
  'fine_brook_carrot',
  'fine_bog_beet',
  'fine_frost_gourd',
  'fine_gilded_sunmelon',
  'fine_evergarden_greens',
];

// All eight base produce rows. Every one must have a dish consumer, so no crop
// on the ladder grows into a vendor-sell-only good.
const BASE_PRODUCE = [
  'vale_wheat',
  'brook_carrot',
  'marsh_rice',
  'bog_beet',
  'highland_barley',
  'frost_gourd',
  'gilded_sunmelon',
  'evergarden_greens',
];

// The economy rule, re-derived here rather than imported, on purpose: this
// suite must red on a REAGENT retune (a produce price moving) as well as on a
// recipe edit, and it must not silently inherit a future relaxation of the
// shared helper in tests/recipe_economy.test.ts.
function reagentUnitValue(itemId: string): number {
  const def = ITEMS[itemId];
  if (!def) throw new Error(`farm dish reagent ${itemId} has no ItemDef`);
  return typeof def.buyValue === 'number' && def.buyValue > 0 ? def.buyValue : def.sellValue;
}

function inputValue(recipeId: string): number {
  const recipe = dishes.find((r) => r.id === recipeId);
  if (!recipe) throw new Error(`farm dish ${recipeId} missing`);
  let total = 0;
  for (const reagent of recipe.reagents) total += reagent.count * reagentUnitValue(reagent.itemId);
  return total;
}

function outputValue(recipeId: string): number {
  const recipe = dishes.find((r) => r.id === recipeId);
  if (!recipe) throw new Error(`farm dish ${recipeId} missing`);
  const def = ITEMS[recipe.resultItemId];
  if (!def) throw new Error(`farm dish result ${recipe.resultItemId} has no ItemDef`);
  return def.sellValue * recipe.resultCount;
}

// Each dish's input value spelled out as a literal, matching the "Input N vs
// output M" authoring comment on its row. The strict bound below is the
// invariant; these are the anti-drift arm: a produce or staple re-price moves
// the sum here even when the bound still clears, so the comments cannot rot
// into a lie and a silent economy change cannot pass unnoticed.
const EXPECTED_INPUT_VALUE: Record<string, number> = {
  recipe_vale_hearth_loaf: 20,
  recipe_eastbrook_root_pottage: 68,
  recipe_fenbridge_rice_bowl: 40,
  recipe_fenbridge_beet_braise: 88,
  recipe_highwatch_barley_bannock: 76,
  recipe_highwatch_gourd_soup: 173,
  recipe_evergarden_sunmelon_tart: 448,
  recipe_evergarden_harvest_platter: 456,
};

describe('FARM_RECIPES: the farm-economy hook set', () => {
  it('is exactly eight cooking dishes today, all of them', () => {
    // The whole-list pin and the cooking-filter pin are BOTH stated: the
    // alchemy row joining later in this phase moves the first and must leave
    // the second at 8, which is what makes that a clean, visible edit.
    expect(FARM_RECIPES).toHaveLength(8);
    expect(dishes, 'every FARM_RECIPES row is a cooking dish today').toHaveLength(8);
  });

  it('every dish is reachable through the merged ALL_RECIPES table', () => {
    const merged = new Set(ALL_RECIPES.map((r) => r.id));
    for (const dish of dishes) {
      expect(merged.has(dish.id), `${dish.id} is not joined into ALL_RECIPES`).toBe(true);
    }
    // Non-vacuity: the merged table really is the bigger one, so the sweep
    // above is a containment check and not a comparison of a list with itself.
    expect(ALL_RECIPES.length).toBeGreaterThan(FARM_RECIPES.length);
  });

  it('every dish has the fixed shape (id, trainer, kitchens, single output)', () => {
    for (const dish of dishes) {
      expect(dish.id, `${dish.resultItemId} recipe id`).toBe(`recipe_${dish.resultItemId}`);
      expect(dish.acquisition, `${dish.id} acquisition`).toEqual(['trainer']);
      expect(dish.stationType, `${dish.id} stationType`).toBe('kitchens');
      expect(dish.resultCount, `${dish.id} resultCount`).toBe(1);
    }
  });

  it('every dish sits on a real rung with the shared scaffolding values', () => {
    for (const dish of dishes) {
      const scaffolding = SCAFFOLDING_BY_RUNG[dish.skillReq];
      expect(
        scaffolding,
        `${dish.id}: skillReq ${dish.skillReq} is not a rung (0, 25, 50)`,
      ).toBeDefined();
      const [budget, level] = scaffolding;
      expect(dish.itemLevelBudget, `${dish.id} itemLevelBudget for rung ${dish.skillReq}`).toBe(
        budget,
      );
      expect(dish.level, `${dish.id} level for rung ${dish.skillReq}`).toBe(level);
    }
    // Non-vacuity: the set really spans more than one rung, so the mapping
    // above is exercised at more than a single key.
    expect(new Set(dishes.map((d) => d.skillReq)).size).toBeGreaterThan(1);
  });

  it('every dish output is plain food: kind, foodHp, no vendor price, rung quality', () => {
    for (const dish of dishes) {
      const def = ITEMS[dish.resultItemId];
      expect(def, `${dish.id}: output ${dish.resultItemId} has no ItemDef`).toBeDefined();
      expect(def.kind, `${dish.resultItemId} kind`).toBe('food');
      expect(def.foodHp, `${dish.resultItemId} foodHp`).toBeGreaterThan(0);
      // No buff machinery and no new effect field: foodHp is the whole effect.
      expect(def.buyValue, `${dish.resultItemId} must never be vendor-stocked`).toBeUndefined();
      expect(def.quality, `${dish.resultItemId} quality for rung ${dish.skillReq}`).toBe(
        QUALITY_BY_RUNG[dish.skillReq],
      );
    }
  });

  it('every dish reuses a shipped point on the food curve (no new rung)', () => {
    const allowed = new Set(ALLOWED_FOOD_CURVE_POINTS.map(([hp, sell]) => `${hp}/${sell}`));
    const used = new Set<string>();
    for (const dish of dishes) {
      const def = ITEMS[dish.resultItemId];
      const point = `${def.foodHp}/${def.sellValue}`;
      expect(
        allowed.has(point),
        `${dish.resultItemId}: ${point} is not a shipped food-curve point ` +
          `(${[...allowed].join(', ')}); reuse one or re-pin the curve deliberately`,
      ).toBe(true);
      used.add(point);
    }
    // Non-vacuity in both directions: the dishes really spread across the
    // curve (a single-point set would satisfy the sweep above trivially), and
    // the ceiling is genuinely reached, so the cap is a tested bound.
    expect(used.size).toBeGreaterThanOrEqual(6);
    expect(used.has('980/150'), 'the top band reaches the shipped ceiling').toBe(true);
  });

  it('every dish vendors strictly below its input value, at the exact input pinned', () => {
    let checked = 0;
    for (const dish of dishes) {
      expect(inputValue(dish.id), `${dish.id} input value`).toBe(EXPECTED_INPUT_VALUE[dish.id]);
      expect(
        outputValue(dish.id),
        `${dish.id}: output ${outputValue(dish.id)} must be below input ${inputValue(dish.id)}`,
      ).toBeLessThan(inputValue(dish.id));
      checked += 1;
    }
    expect(checked).toBe(dishes.length);
    // The literal table must not have drifted past the list it describes.
    expect(Object.keys(EXPECTED_INPUT_VALUE).sort()).toEqual(dishes.map((d) => d.id).sort());
  });

  it('every dish carries a reagent with NO buyValue (stays out of the vendor-fed arm)', () => {
    for (const dish of dishes) {
      const unpriced = dish.reagents.filter((reagent) => {
        const def = ITEMS[reagent.itemId];
        return !def || typeof def.buyValue !== 'number' || def.buyValue <= 0;
      });
      expect(
        unpriced.length,
        `${dish.id}: every reagent carries a copper buyValue, so it would join the ` +
          'counterfactual vendor-fed set in tests/recipe_economy.test.ts (a sorted literal ' +
          'pin plus a discounted-input bound). Give it a produce reagent with no buyValue.',
      ).toBeGreaterThan(0);
    }
  });

  it('closes the five fine twins the hoe ladder left without a consumer', () => {
    const dishReagents = new Set(dishes.flatMap((d) => d.reagents.map((r) => r.itemId)));
    for (const twin of FINE_TWINS_CLOSED_HERE) {
      expect(
        dishReagents.has(twin),
        `${twin} has no dish slot, and farming fine twins get no downward grade ` +
          'substitution, so it would have no consumer at all',
      ).toBe(true);
    }
    // The three the hoe ladder already consumes must NOT have quietly been
    // folded in here as well: this pin states which list owns which twin.
    for (const hoeTwin of ['fine_vale_wheat', 'fine_marsh_rice', 'fine_highland_barley']) {
      expect(
        dishReagents.has(hoeTwin),
        `${hoeTwin} is a hoe reagent; a dish slot for it would double-book the twin`,
      ).toBe(false);
    }
  });

  it('gives all eight base produce rows a dish consumer', () => {
    const dishReagents = new Set(dishes.flatMap((d) => d.reagents.map((r) => r.itemId)));
    for (const produce of BASE_PRODUCE) {
      expect(dishReagents.has(produce), `${produce} is never cooked into any dish`).toBe(true);
    }
    expect(BASE_PRODUCE).toHaveLength(8);
  });

  it('resolves every reagent to a real ItemDef', () => {
    for (const dish of dishes) {
      expect(dish.reagents.length, `${dish.id} must consume something`).toBeGreaterThan(0);
      for (const reagent of dish.reagents) {
        expect(ITEMS[reagent.itemId], `reagent ${reagent.itemId} in ${dish.id}`).toBeDefined();
        expect(reagent.count, `${dish.id} reagent ${reagent.itemId} count`).toBeGreaterThan(0);
      }
    }
  });
});
