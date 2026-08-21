// FARM_RECIPES (the Phase 6 farm-economy hook set, reopened by Phase 11 and
// again by Phase 12): conformance pins for the twelve cooking dishes that turn
// crop produce into something a player wants (eight plain, four Phase 11
// well-fed buff dishes), plus the one alchemy row (the growth tonic brewed
// from wild herbs) and the one placeable cooking row (the Phase 12 shared
// feast, whose kind-'junk' output is NOT a dish; its own describe below).
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
// THE COOKING ARMS RUN OVER `dishes` (the cooking filter), never over
// FARM_RECIPES directly, which is what let the alchemy row join the list as a
// clean edit to the list-level pins alone. The tonic states its own shape in
// the second describe below: it shares the list, not the dish contract (a
// different craft, a different station, a kind 'junk' output rather than food).
import { describe, expect, it } from 'vitest';
import { STATIONS } from '../src/sim/content/professions';
import { FARM_RECIPES, LADDER_RECIPES } from '../src/sim/content/recipes';
// ITEMS and ALL_RECIPES from data (the merged view the sim, the trainer, the
// crafting window and the guide all read), not from content: a row authored in
// content but never joined into the merged table would be unreachable in play,
// and this suite would still pass reading content directly.
import { ALL_RECIPES, ITEMS } from '../src/sim/data';
import { stationsOfType } from '../src/sim/professions/stations';
import { resolveTrain } from '../src/sim/professions/training';
import { Sim } from '../src/sim/sim';
import { itemNames } from '../src/ui/i18n.catalog/items';

// The Phase 12 shared feast is a COOKING row whose output is NOT a dish (kind
// 'junk', no foodHp: using it places a world entity instead of eating), so the
// dish contract below excludes it by id; its own describe re-states everything
// it shares with the dishes and pins the feast-specific shape. The exclusion
// is honest only while the output stays non-food, which that describe pins.
const FEAST_ID = 'recipe_harvest_feast';
const dishes = FARM_RECIPES.filter((r) => r.professionId === 'cooking' && r.id !== FEAST_ID);

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
  // The four Phase 11 buff dishes (produce x4 plus one salt each; the tier-1
  // row also carries the pottage-precedent vale_wheat binder, see its row).
  recipe_eastbrook_glazed_carrots: 76,
  recipe_fenbridge_rice_pudding: 40,
  recipe_highwatch_barley_porridge: 68,
  recipe_evergarden_braised_greens: 168,
};

describe('FARM_RECIPES: the farm-economy hook set', () => {
  it('is exactly twelve cooking dishes inside a fourteen-row list', () => {
    // The whole-list pin and the dish-filter pin are BOTH stated: the alchemy
    // row moved the first and left the second behind it, and keeping them
    // separate is what makes any further addition a visible, deliberate edit.
    // Re-pinned 9 -> 13 by Phase 11 (the four well-fed buff dishes), then
    // 13 -> 14 by Phase 12 (the shared feast). The dish filter counts the
    // cooking rows MINUS the feast (its junk output fails every dish arm and
    // is pinned separately), so it stays at twelve.
    expect(FARM_RECIPES).toHaveLength(14);
    expect(dishes, 'the cooking dishes are twelve of the fourteen farm rows').toHaveLength(12);
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

  it('every dish output is food: kind, foodHp, no vendor price, rung quality', () => {
    for (const dish of dishes) {
      const def = ITEMS[dish.resultItemId];
      expect(def, `${dish.id}: output ${dish.resultItemId} has no ItemDef`).toBeDefined();
      expect(def.kind, `${dish.resultItemId} kind`).toBe('food');
      expect(def.foodHp, `${dish.resultItemId} foodHp`).toBeGreaterThan(0);
      // foodHp is the shared floor; the wellfed field is allowed ONLY on the
      // four Phase 11 buff dishes, which the closed-shape describe below pins.
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

  it('no farm row mints copper on the RAW sell basis: cooking converts produce, never prints', () => {
    // The unitValue arm above uses buyValue where one exists, which leaves a
    // second, thinner margin unpinned: a player who GREW the produce paid its
    // sell floor, not a vendor price, so if a dish vendored above the raw
    // sellValue of its reagents the farm loop would mint copper from thin
    // air. The authoring header calls the beet braise "exactly break-even,
    // which converts produce without minting copper"; this arm makes that
    // prose executable for every row, tonic included, so a one-copper
    // re-price of frost_gourd, highland_barley, cooking_salt, or a dish
    // cannot silently flip a margin (soup is at 2, bannock at 4, braise at 0).
    let exactlyBreakEven = 0;
    for (const recipe of FARM_RECIPES) {
      let rawInput = 0;
      for (const reagent of recipe.reagents) {
        const def = ITEMS[reagent.itemId];
        expect(def, `${recipe.id} reagent ${reagent.itemId} has no ItemDef`).toBeDefined();
        rawInput += reagent.count * def.sellValue;
      }
      const output = ITEMS[recipe.resultItemId].sellValue * recipe.resultCount;
      expect(
        output,
        `${recipe.id}: output ${output} vendors above its raw reagent sell value ${rawInput}, ` +
          'so crafting it mints copper from grown produce',
      ).toBeLessThanOrEqual(rawInput);
      if (output === rawInput) exactlyBreakEven += 1;
    }
    // Non-vacuity: the bound is genuinely reached (the braise sits exactly at
    // break-even by design), so <= is a tested edge and not a slack pass.
    expect(exactlyBreakEven, 'the intended exactly-break-even row exists').toBeGreaterThan(0);
  });

  it('every dish, buff dishes included, carries a reagent with NO buyValue', () => {
    // The Phase 6 invariant held whole through Phase 11: brook_carrot is the
    // D9 vegetable (the ONE produce row with a buyValue), so the tier-1 buff
    // dish carries the pottage-precedent vale_wheat binder rather than an
    // exemption, and every farm dish keeps at least one priceless reagent.
    // A row drifting fully-priced would join the counterfactual vendor-fed
    // set in tests/recipe_economy.test.ts (a sorted literal pin plus a
    // discounted-input bound), so the drift breaks two suites, not one.
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
    // Non-vacuity: the tier-1 buff dish really is a live dish under the sweep.
    expect(dishes.map((d) => d.id)).toContain('recipe_eastbrook_glazed_carrots');
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

const TONIC_ID = 'recipe_growth_tonic';

// The tonic's input value spelled out as a literal, the same anti-drift arm the
// dishes carry: 2 Sheenleaf at 4 each (no buyValue, so the sell floor is the
// basis) plus one glass vial at its 12-copper buyValue. A re-price of either
// reagent reds HERE, not only if it happens to cross the strict bound.
const TONIC_EXPECTED_INPUT_VALUE = 20;

function requireTonic() {
  const row = FARM_RECIPES.find((r) => r.id === TONIC_ID);
  if (!row) throw new Error(`${TONIC_ID} is missing from FARM_RECIPES`);
  return row;
}

describe('FARM_RECIPES: the growth tonic, the farming-alchemy trade (D7)', () => {
  it('is one alchemy row on the farm list and reachable through merged ALL_RECIPES', () => {
    expect(
      FARM_RECIPES.filter((r) => r.id === TONIC_ID),
      'exactly one growth tonic recipe on FARM_RECIPES',
    ).toHaveLength(1);
    const merged = ALL_RECIPES.filter((r) => r.id === TONIC_ID);
    expect(
      merged,
      `${TONIC_ID} is authored in content but not joined into the merged ALL_RECIPES ` +
        'table, so it would be unreachable in play',
    ).toHaveLength(1);
    expect(
      FARM_RECIPES.filter((r) => r.professionId === 'alchemy').map((r) => r.id),
      'the tonic is the only non-cooking row on the farm list',
    ).toEqual([TONIC_ID]);
  });

  it('is brewed by an alchemist at the apothecary, trainer-taught, one tonic per craft', () => {
    const tonic = requireTonic();
    expect(tonic.professionId, `${TONIC_ID} professionId`).toBe('alchemy');
    expect(tonic.stationType, `${TONIC_ID} stationType`).toBe('apothecary');
    expect(tonic.acquisition, `${TONIC_ID} acquisition`).toEqual(['trainer']);
    expect(tonic.resultItemId, `${TONIC_ID} resultItemId`).toBe('growth_tonic');
    expect(tonic.resultCount, `${TONIC_ID} resultCount`).toBe(1);
  });

  it('sits on the accessible rung with the shared scaffolding values', () => {
    const tonic = requireTonic();
    // skillReq 0: the tonic is a plant-time knob for EVERY farm tier, so it
    // must not be gated behind a mid or late alchemy rung.
    expect(tonic.skillReq, `${TONIC_ID} must stay on the rung-0 (accessible) band`).toBe(0);
    const scaffolding = SCAFFOLDING_BY_RUNG[tonic.skillReq];
    expect(
      scaffolding,
      `${TONIC_ID}: skillReq ${tonic.skillReq} is not a rung (0, 25, 50)`,
    ).toBeDefined();
    const [budget, level] = scaffolding;
    expect(tonic.itemLevelBudget, `${TONIC_ID} itemLevelBudget for rung 0`).toBe(budget);
    expect(tonic.level, `${TONIC_ID} level for rung 0`).toBe(level);
  });

  it('is brewed FROM HERBS, the cross-profession trade, in a vial like every alchemy row', () => {
    const tonic = requireTonic();
    const byId = new Map(tonic.reagents.map((reagent) => [reagent.itemId, reagent.count]));
    // The D7 requirement made falsifiable: swap the herb out for a farm-grown
    // input and the trade this recipe exists to create disappears, so the id
    // is pinned as a literal rather than as "some herb".
    expect(
      byId.get('silverleaf_herb'),
      'the tonic must be brewed from Sheenleaf, the rung-0 herb: without a HERB reagent ' +
        'there is no farming-to-alchemy trade (D7) left in the recipe',
    ).toBe(2);
    expect(
      byId.get('glass_vial'),
      'every shipped alchemy row decants into one glass vial; the tonic follows it',
    ).toBe(1);
    expect(tonic.reagents, `${TONIC_ID} reagent count`).toHaveLength(2);
    for (const reagent of tonic.reagents) {
      expect(ITEMS[reagent.itemId], `reagent ${reagent.itemId} in ${TONIC_ID}`).toBeDefined();
      expect(reagent.count, `${TONIC_ID} reagent ${reagent.itemId} count`).toBeGreaterThan(0);
    }
  });

  it('keeps a reagent with NO buyValue, so it stays out of the vendor-fed arm', () => {
    const tonic = requireTonic();
    // Sheenleaf specifically: it is the gathered reagent, and it is the ONLY
    // one here without a copper faucet (the vial is a vendor staple). If it
    // ever gained a buyValue the whole recipe would become counterfactually
    // vendor-fed and would have to join the sorted literal pin plus the
    // discounted-input bound in tests/recipe_economy.test.ts.
    const herb = ITEMS.silverleaf_herb;
    expect(herb, 'silverleaf_herb has no ItemDef').toBeDefined();
    expect(
      herb.buyValue,
      'silverleaf_herb must stay unpriced at vendors, or recipe_growth_tonic joins the ' +
        'counterfactual vendor-fed set in tests/recipe_economy.test.ts',
    ).toBeUndefined();
    const unpriced = tonic.reagents.filter((reagent) => {
      const def = ITEMS[reagent.itemId];
      return !def || typeof def.buyValue !== 'number' || def.buyValue <= 0;
    });
    expect(
      unpriced.map((reagent) => reagent.itemId),
      `${TONIC_ID} unpriced reagents`,
    ).toEqual(['silverleaf_herb']);
  });

  it('vendors strictly below its input value, at the exact input pinned', () => {
    const tonic = requireTonic();
    let input = 0;
    for (const reagent of tonic.reagents) input += reagent.count * reagentUnitValue(reagent.itemId);
    expect(input, `${TONIC_ID} input value`).toBe(TONIC_EXPECTED_INPUT_VALUE);
    const def = ITEMS[tonic.resultItemId];
    expect(def, `${TONIC_ID}: output ${tonic.resultItemId} has no ItemDef`).toBeDefined();
    const output = def.sellValue * tonic.resultCount;
    expect(output, `${TONIC_ID}: output ${output} must be below input ${input}`).toBeLessThan(
      input,
    );
  });

  it('outputs the plant-time knob itself: kind junk, never vendor-stocked', () => {
    const def = ITEMS.growth_tonic;
    expect(def, 'growth_tonic has no ItemDef').toBeDefined();
    // Kind 'junk' on purpose: the tonic is consumed by the plant_crop command's
    // knob payload, NOT by an ItemDef.use arm, so it carries no potion/elixir
    // machinery and gains none by being craftable.
    expect(def.kind, 'growth_tonic kind').toBe('junk');
    expect(
      def.buyValue,
      'the growth tonic is NEVER vendor-stocked (this recipe is its only faucet), so a ' +
        'buyValue here would price a faucet that must not exist',
    ).toBeUndefined();
    expect(def.sellValue, 'growth_tonic sellValue').toBeGreaterThan(0);
  });

  it('does NOT join LADDER_RECIPES, whose consumable convention it would fail', () => {
    // The negative arm. LADDER_RECIPES is closed at three rungs x three recipes
    // per craft, and its "cooking and alchemy have a consumable output at every
    // rung" pin (tests/recipe_economy.test.ts) walks that list only. A junk
    // output is fine on the sibling farm list and would be wrong on the ladder,
    // so this states which list owns the row.
    expect(
      LADDER_RECIPES.map((r) => r.id),
      `${TONIC_ID} must live on FARM_RECIPES, never on the closed ladder`,
    ).not.toContain(TONIC_ID);
    expect(
      LADDER_RECIPES.some((r) => r.resultItemId === 'growth_tonic'),
      'no ladder row may produce the growth tonic either',
    ).toBe(false);
    // Non-vacuity: the ladder really is a populated list with alchemy rows in
    // it, so the two absences above are facts and not an empty-list artifact.
    expect(LADDER_RECIPES.filter((r) => r.professionId === 'alchemy').length).toBeGreaterThan(0);
  });
});

const FEAST_ITEM_ID = 'harvest_feast';

// The feast's input value spelled out as a literal, the dishes' anti-drift
// arm: greens 40x4 (sell floor, no buyValue) + sunmelon 40x4 (same) + salt at
// its 8-copper buyValue x2 = 336. A re-price of any reagent reds HERE, not
// only if it happens to cross the strict bound.
const FEAST_EXPECTED_INPUT_VALUE = 336;

describe('FARM_RECIPES: the shared feast, the Phase 12 placeable cooking row', () => {
  function requireFeast() {
    const row = FARM_RECIPES.find((r) => r.id === FEAST_ID);
    if (!row) throw new Error(`${FEAST_ID} is missing from FARM_RECIPES`);
    return row;
  }

  it('is one cooking row on the farm list, merged into ALL_RECIPES, and NOT a dish', () => {
    expect(
      FARM_RECIPES.filter((r) => r.id === FEAST_ID),
      'exactly one shared-feast recipe on FARM_RECIPES',
    ).toHaveLength(1);
    expect(
      ALL_RECIPES.filter((r) => r.id === FEAST_ID),
      `${FEAST_ID} is authored in content but not joined into the merged ALL_RECIPES ` +
        'table, so it would be unreachable in play',
    ).toHaveLength(1);
    // The dish-filter exclusion at the top of this file is honest only while
    // the output is genuinely non-food (using it PLACES a world entity
    // instead of eating): if the feast ever became a kind-'food' item it
    // would belong under the dish contract, and these pins are what force
    // that re-classification to be a deliberate edit here.
    expect(ITEMS[FEAST_ITEM_ID].kind, 'the feast output must stay non-food').toBe('junk');
    expect(ITEMS[FEAST_ITEM_ID].foodHp, 'a foodHp would make it a dish').toBeUndefined();
    expect(
      dishes.map((r) => r.id),
      'the feast never counts as a dish',
    ).not.toContain(FEAST_ID);
  });

  it('shares the dish scaffolding: kitchens, trainer, rung 50, one feast per craft', () => {
    const feast = requireFeast();
    expect(feast.professionId, `${FEAST_ID} professionId`).toBe('cooking');
    expect(feast.stationType, `${FEAST_ID} stationType`).toBe('kitchens');
    expect(feast.acquisition, `${FEAST_ID} acquisition`).toEqual(['trainer']);
    expect(feast.resultItemId, `${FEAST_ID} resultItemId`).toBe(FEAST_ITEM_ID);
    expect(feast.resultCount, `${FEAST_ID} resultCount`).toBe(1);
    expect(feast.skillReq, 'the feast is capstone content on the rung-50 band').toBe(50);
    const [budget, level] = SCAFFOLDING_BY_RUNG[feast.skillReq];
    expect(feast.itemLevelBudget, `${FEAST_ID} itemLevelBudget for rung 50`).toBe(budget);
    expect(feast.level, `${FEAST_ID} level for rung 50`).toBe(level);
  });

  it('asks BOTH tier-4 produce lines plus salt, at the exact proposed counts', () => {
    // The reagent counts (4 + 4 + 2) are maintainer-flagged tuning (the row
    // comment); pinned as literals so a silent retune is a visible edit.
    const feast = requireFeast();
    const byId = new Map(feast.reagents.map((reagent) => [reagent.itemId, reagent.count]));
    expect(byId.get('evergarden_greens'), 'the greens line').toBe(4);
    expect(byId.get('gilded_sunmelon'), 'the sunmelon line').toBe(4);
    expect(byId.get('cooking_salt'), 'the staple binder').toBe(2);
    expect(feast.reagents, `${FEAST_ID} reagent count`).toHaveLength(3);
    for (const reagent of feast.reagents) {
      expect(ITEMS[reagent.itemId], `reagent ${reagent.itemId} in ${FEAST_ID}`).toBeDefined();
    }
  });

  it('vendors strictly below its input value, at the exact input pinned', () => {
    const feast = requireFeast();
    let input = 0;
    for (const reagent of feast.reagents) input += reagent.count * reagentUnitValue(reagent.itemId);
    expect(input, `${FEAST_ID} input value`).toBe(FEAST_EXPECTED_INPUT_VALUE);
    const output = ITEMS[feast.resultItemId].sellValue * feast.resultCount;
    // The 250 is maintainer-flagged tuning (the ItemDef comment); the literal
    // keeps the row comment's "336 in vs 250 out" arithmetic executable.
    expect(output, `${FEAST_ID} output value`).toBe(250);
    expect(output, `${FEAST_ID}: output ${output} must be below input ${input}`).toBeLessThan(
      input,
    );
  });

  it('keeps BOTH produce reagents free of a buyValue, the (bz) whole-list invariant', () => {
    // No counter stocks either tier-4 produce line and neither carries a
    // copper price, so the feast can never be cooked from vendor stock alone
    // and stays out of the counterfactual vendor-fed set in
    // tests/recipe_economy.test.ts.
    const feast = requireFeast();
    const unpriced = feast.reagents.filter((reagent) => {
      const def = ITEMS[reagent.itemId];
      return !def || typeof def.buyValue !== 'number' || def.buyValue <= 0;
    });
    expect(
      unpriced.map((reagent) => reagent.itemId).sort(),
      `${FEAST_ID} unpriced reagents`,
    ).toEqual(['evergarden_greens', 'gilded_sunmelon']);
  });

  it('outputs the placeable feast itself: rung quality, never vendor-stocked, a live feast record', () => {
    const def = ITEMS[FEAST_ITEM_ID];
    expect(def, `${FEAST_ITEM_ID} has no ItemDef`).toBeDefined();
    expect(def.quality, 'rung-50 output quality, like every rung-50 row').toBe('rare');
    expect(
      def.buyValue,
      'the feast is never vendor-stocked (REAGENT-DORMANT rows must not gain a copper faucet)',
    ).toBeUndefined();
    // charges 10 and durationTicks 3600 are maintainer-flagged tuning (the
    // ItemDef comment); the dishItemId is load-bearing: the bite pays one
    // serving of the CAPSTONE DISH, so the Well Fed mint stays the Phase 11
    // completion path.
    const feastRecord = 'feast' in def ? def.feast : undefined;
    expect(feastRecord, `${FEAST_ITEM_ID} feast record`).toEqual({
      charges: 10,
      durationTicks: 3600,
      dishItemId: 'evergarden_braised_greens',
    });
    const dishDef = ITEMS[feastRecord?.dishItemId ?? ''];
    expect(
      dishDef && 'wellfed' in dishDef ? dishDef.wellfed : undefined,
      'the feast dish must be a live buff dish',
    ).toBeDefined();
    // Closed key shape, the dish-shape doctrine below applied to the feast:
    // the feast field beside the five junk keys, nothing more.
    expect(Object.keys(def).sort()).toEqual([
      'feast',
      'id',
      'kind',
      'name',
      'quality',
      'sellValue',
    ]);
  });

  it('does NOT join LADDER_RECIPES, whose consumable convention it would fail', () => {
    // The tonic's negative arm re-stated for the feast: a junk output is
    // fine on the farm list and would break the ladder's "cooking has a
    // consumable output at every rung" pin.
    expect(
      LADDER_RECIPES.map((r) => r.id),
      `${FEAST_ID} must live on FARM_RECIPES, never on the closed ladder`,
    ).not.toContain(FEAST_ID);
    expect(
      LADDER_RECIPES.some((r) => r.resultItemId === FEAST_ITEM_ID),
      'no ladder row may produce the feast either',
    ).toBe(false);
  });
});

describe('FARM_RECIPES: the dish ItemDef shape, reopened by Phase 11 and closed again', () => {
  // Phase 11 (well-fed food) is the reopening the old pin scheduled: the four
  // buff dishes now carry the `wellfed` field, and NOTHING else moved. The
  // shape is closed again until the next consumable phase reopens it here.
  //
  // The buff-dish id set is an explicit sorted literal, so a FIFTH buff dish
  // is a deliberate re-pin in this file, never a silent def edit; both sweeps
  // below derive their row sets from FARM_RECIPES, so a new cooking row
  // cannot escape one of the two arms.
  const BUFF_DISH_IDS = [
    'eastbrook_glazed_carrots',
    'evergarden_braised_greens',
    'fenbridge_rice_pudding',
    'highwatch_barley_porridge',
  ];
  const PLAIN_FOOD_KEYS = ['foodHp', 'id', 'kind', 'name', 'quality', 'sellValue'];
  const BUFF_FOOD_KEYS = ['foodHp', 'id', 'kind', 'name', 'quality', 'sellValue', 'wellfed'];

  it('the eight plain dishes keep EXACTLY the six plain-food keys, nothing more', () => {
    const plain = dishes.filter((d) => !BUFF_DISH_IDS.includes(d.resultItemId));
    expect(plain, 'the plain sweep really covers the eight Phase 6 dishes').toHaveLength(8);
    for (const dish of plain) {
      const def = ITEMS[dish.resultItemId];
      expect(
        Object.keys(def).sort(),
        `${dish.resultItemId} grew beyond the plain-food shape; the next consumable phase ` +
          'must re-pin this deliberately',
      ).toEqual(PLAIN_FOOD_KEYS);
    }
  });

  it('the four buff dishes carry EXACTLY the seven keys (plain plus wellfed)', () => {
    const buff = dishes.filter((d) => BUFF_DISH_IDS.includes(d.resultItemId));
    // Derived from FARM_RECIPES and matched against the literal, so a buff
    // dish authored without a recipe row (or the reverse) reds here too.
    expect(buff.map((d) => d.resultItemId).sort()).toEqual(BUFF_DISH_IDS);
    for (const dish of buff) {
      const def = ITEMS[dish.resultItemId];
      expect(
        Object.keys(def).sort(),
        `${dish.resultItemId} drifted off the buff-dish shape; the next consumable phase ` +
          'must re-pin this deliberately',
      ).toEqual(BUFF_FOOD_KEYS);
    }
  });

  it('every buff dish wellfed field is well-formed, at the exact proposed tuning', () => {
    // The ceiling comes from the documented elixir budget (the alchemy ladder
    // header in content/profession_items.ts): buff_sta value <= 12 for
    // duration <= 900s. The exact pairs are pinned so a silent retune is a
    // visible edit; VALUES ARE PROPOSED AND MAINTAINER-FLAGGED at the defs.
    const EXPECTED_WELLFED: Record<string, [number, number]> = {
      eastbrook_glazed_carrots: [3, 600],
      fenbridge_rice_pudding: [6, 900],
      highwatch_barley_porridge: [9, 900],
      evergarden_braised_greens: [12, 900],
    };
    const buff = dishes.filter((d) => BUFF_DISH_IDS.includes(d.resultItemId));
    expect(buff, 'the buff sweep really covers the four Phase 11 dishes').toHaveLength(4);
    for (const dish of buff) {
      const def = ITEMS[dish.resultItemId];
      const wellfed = 'wellfed' in def ? def.wellfed : undefined;
      expect(wellfed, `${dish.resultItemId} lost its wellfed field`).toBeDefined();
      if (!wellfed) continue;
      // The shared namespace: one aura name, therefore ONE aura id
      // (wellfed_buff_sta), so last eaten always wins within food while the
      // distinct wellfed_ prefix keeps elixir_<kind> buffs coexisting.
      expect(wellfed.aura, `${dish.resultItemId} aura name`).toBe('Well Fed');
      expect(wellfed.kind, `${dish.resultItemId} aura kind`).toBe('buff_sta');
      expect(Number.isInteger(wellfed.value), `${dish.resultItemId} value integer`).toBe(true);
      expect(wellfed.value, `${dish.resultItemId} value floor`).toBeGreaterThan(0);
      expect(
        wellfed.value,
        `${dish.resultItemId} value ceiling (elixir budget)`,
      ).toBeLessThanOrEqual(12);
      expect(Number.isInteger(wellfed.duration), `${dish.resultItemId} duration integer`).toBe(
        true,
      );
      expect(wellfed.duration, `${dish.resultItemId} duration floor`).toBeGreaterThan(0);
      expect(
        wellfed.duration,
        `${dish.resultItemId} duration ceiling (elixir budget)`,
      ).toBeLessThanOrEqual(900);
      const [value, duration] = EXPECTED_WELLFED[dish.resultItemId];
      expect(wellfed.value, `${dish.resultItemId} proposed value retuned silently`).toBe(value);
      expect(wellfed.duration, `${dish.resultItemId} proposed duration retuned silently`).toBe(
        duration,
      );
    }
  });

  it('every new item id keeps its catalog English byte-identical to its ItemDef name', () => {
    // The def name is what sim/server text uses; the catalog row is what the
    // HUD renders. The catalog comment states the stay-in-step rule, but no
    // pin held it: an English reword on one side would drift the other
    // silently. Scoped to the phase ids (the thirteen this suite owns).
    const enNames = itemNames.en.entities.items as Record<string, { name?: string } | undefined>;
    for (const recipe of FARM_RECIPES) {
      const def = ITEMS[recipe.resultItemId];
      const row = enNames[recipe.resultItemId];
      expect(row?.name, `${recipe.resultItemId} has no catalog English name row`).toBeDefined();
      expect(
        row?.name,
        `${recipe.resultItemId}: catalog English and ItemDef.name drifted apart`,
      ).toBe(def.name);
    }
  });

  it('every allowed curve point is carried by a live non-dish food, so the reuse claim stays true', () => {
    // ALLOWED_FOOD_CURVE_POINTS is hand-authored; this arm backs each pair
    // against the live ITEMS table so a re-price of the owning shipped food
    // reds here instead of silently orphaning the "reuses a shipped point"
    // claim.
    const dishIds = new Set(dishes.map((d) => d.resultItemId));
    for (const [foodHp, sellValue] of ALLOWED_FOOD_CURVE_POINTS) {
      const owner = Object.entries(ITEMS).find(
        ([id, def]) => !dishIds.has(id) && def.foodHp === foodHp && def.sellValue === sellValue,
      );
      expect(
        owner,
        `no shipped non-dish food carries the ${foodHp}/${sellValue} point anymore; re-anchor or retire it`,
      ).toBeDefined();
    }
  });
});

describe('FARM_RECIPES: a dish crafts for real, and fine twins never substitute for base produce', () => {
  function countOf(sim: Sim, itemId: string): number {
    const meta = (sim as any).players.get(sim.playerId);
    let total = 0;
    for (const slot of meta.inventory) {
      if (slot?.itemId === itemId) total += slot.count ?? 1;
    }
    return total;
  }

  it('the pottage refuses an all-fine-twin payment, then crafts from the true reagents', () => {
    // The fine-twin closure argument rests on NO downward grade substitution
    // for farm rows (materialGradeIds walks MATERIAL_GRADES only, and no
    // farm item is a member). Executed here rather than trusted: a bag full
    // of fine twins must NOT satisfy the base-produce slots, and the true
    // reagents must. recipe_eastbrook_root_pottage asks brook_carrot x2 +
    // fine_brook_carrot x1 + vale_wheat x1 at skillReq 0.
    const sim = new Sim({ seed: 11, playerClass: 'warrior' });
    const pid = sim.playerId;
    const recipe = dishes.find((r) => r.id === 'recipe_eastbrook_root_pottage');
    expect(recipe, 'the pottage row exists').toBeDefined();
    if (!recipe) return;
    const station = stationsOfType(STATIONS, recipe.stationType as never)[0];
    const entity = (sim as any).entities.get(pid);
    entity.pos.x = station.pos.x;
    entity.pos.z = station.pos.z;
    entity.prevPos = { ...entity.pos };
    // Learn the trainer-taught row up front, so BOTH attempts below are
    // decided by the reagent check alone: the refusal must be attributable
    // to the missing base produce, never to an unknown recipe.
    (sim as any).players.get(pid).knownRecipes.add(recipe.id);

    // Fine twins standing in for BOTH base slots: refused, bags untouched.
    sim.addItem('fine_brook_carrot', 3, pid); // covers its own slot and dwarfs the base ask
    sim.addItem('fine_vale_wheat', 2, pid);
    sim.craftItem(recipe.id, false, pid, 1);
    expect(
      countOf(sim, recipe.resultItemId),
      'a fine-twin-only bag must never cook the pottage',
    ).toBe(0);
    expect(countOf(sim, 'fine_brook_carrot'), 'refusal consumes nothing').toBe(3);
    expect(countOf(sim, 'fine_vale_wheat'), 'refusal consumes nothing').toBe(2);

    // The true reagents: the craft starts, completes, and pays exactly once.
    sim.addItem('brook_carrot', 2, pid);
    sim.addItem('vale_wheat', 1, pid);
    sim.craftItem(recipe.id, false, pid, 1);
    const player = (sim as any).entities.get(pid);
    const meta = (sim as any).players.get(pid);
    player.castingAbility = null;
    player.castRemaining = 0;
    sim.ctx.completeCraftCast(player, meta);
    expect(countOf(sim, recipe.resultItemId), 'the pottage lands in the bag').toBe(1);
    expect(countOf(sim, 'brook_carrot'), 'base produce spent').toBe(0);
    expect(countOf(sim, 'vale_wheat'), 'base produce spent').toBe(0);
    expect(countOf(sim, 'fine_brook_carrot'), 'exactly one fine twin spent').toBe(2);
    expect(countOf(sim, 'fine_vale_wheat'), 'the wheat twin is not a reagent here').toBe(2);
  });

  it('the tonic brews end to end through real ticks: refuse short herbs, then craft and spend', () => {
    // Deviation (ai)'s load-bearing claim is that the tonic IS craftable
    // TODAY from wild herbs, and it is the only Phase 6 recipe with a live
    // faucet, so its craft is executed rather than trusted: the one alchemy
    // row on the farm list, the apothecary station, and a kind-'junk' output
    // through the ordinary craft machinery (the exact combination deviation
    // (ak) exists for). Unlike the pottage arm above, the cast here finishes
    // through sim.tick(), so the tick-phase completion slot
    // (casting_lifecycle routing CRAFT_CAST_ID to ctx.completeCraftCast) is
    // exercised for farm rows, not hand-driven around.
    const sim = new Sim({ seed: 13, playerClass: 'warrior' });
    const pid = sim.playerId;
    const tonic = requireTonic();
    const station = stationsOfType(STATIONS, tonic.stationType as never)[0];
    expect(station, 'a placed apothecary station exists').toBeDefined();
    const entity = (sim as any).entities.get(pid);
    entity.pos.x = station.pos.x;
    entity.pos.z = station.pos.z;
    entity.prevPos = { ...entity.pos };
    const meta = (sim as any).players.get(pid);
    meta.knownRecipes.add(tonic.id);

    // Short one herb: refused at start, no cast begins, nothing is consumed.
    sim.addItem('silverleaf_herb', 1, pid);
    sim.addItem('glass_vial', 1, pid);
    sim.craftItem(tonic.id, false, pid, 1);
    expect(entity.castingAbility, 'a short-reagent craft must not start a cast').toBeNull();
    expect(countOf(sim, 'growth_tonic'), 'a short-reagent craft brews nothing').toBe(0);
    expect(countOf(sim, 'silverleaf_herb'), 'refusal consumes nothing').toBe(1);
    expect(countOf(sim, 'glass_vial'), 'refusal consumes nothing').toBe(1);

    // The true reagents: start the cast and let REAL ticks finish it.
    sim.addItem('silverleaf_herb', 1, pid);
    sim.craftItem(tonic.id, false, pid, 1);
    expect(entity.castingAbility, 'the tonic craft starts a real cast').not.toBeNull();
    for (let i = 0; i < 200 && entity.castingAbility !== null; i++) sim.tick();
    // Non-vacuity: the cast genuinely completed through the tick path.
    expect(entity.castingAbility, 'the craft cast completes within 10 sim-seconds').toBeNull();
    expect(countOf(sim, 'growth_tonic'), 'the tonic lands in the bag').toBe(1);
    expect(countOf(sim, 'silverleaf_herb'), 'both herbs spent').toBe(0);
    expect(countOf(sim, 'glass_vial'), 'the vial spent').toBe(0);
    // The rung-0 craft teaches alchemy deterministically (gainCraftSkill has
    // no draw), so the skill-up faucet the recipe opens is pinned live.
    expect(meta.craftSkills.alchemy ?? 0, 'the craft teaches alchemy').toBeGreaterThan(0);
  });
});

describe('FARM_RECIPES: trainable at the stations on the settled R8 fee curve', () => {
  // Deviation (aj), now historical: the rows were trainable AND fee-charging
  // from Phase 6 on (the Live-surface note wanted them visible in the crafting
  // window ahead of the go-live, and trainer acquisition is the only path
  // there); the farm opened in Phase 9 and the ruling stands unchanged. This
  // arm pins the acquisition shape so a future availability gate cannot land
  // silently: if training is ever gated by farming skill or the intro quest,
  // THIS test is the one that reds and names the decision to revisit.
  it('rung-0 rows train free and the rung-25/50 dishes charge, all resolving ok at their stations', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    const meta = (sim as any).players.get(sim.playerId);
    meta.copper = 100000;
    meta.craftSkills.cooking = 50; // teach tier for the rung-50 dish
    // Fees come from the settled exception-free curve (TRAINING_FEE_BY_TIER,
    // ruling R8): tier 0 is genuinely FREE, tier 1 charges 2500 and tier 2
    // charges 10000 copper. All three shapes are pinned so neither a surprise
    // fee at the starter rung nor a silently-freed mid or premium rung can
    // land unnoticed.
    for (const [recipeId, stationType, fee] of [
      ['recipe_vale_hearth_loaf', 'kitchens', 0],
      ['recipe_growth_tonic', 'apothecary', 0],
      ['recipe_fenbridge_rice_bowl', 'kitchens', 2500],
      ['recipe_evergarden_harvest_platter', 'kitchens', 10000],
      // The Phase 12 shared feast joins the rung-50 fee shape: a premium
      // trainer row like the platter, charging the tier-2 fee.
      ['recipe_harvest_feast', 'kitchens', 10000],
    ] as const) {
      const station = stationsOfType(STATIONS, stationType)[0];
      expect(station, `no placed ${stationType} station to train at`).toBeDefined();
      const result = resolveTrain(STATIONS, meta, station.pos, recipeId);
      expect(result.ok, `${recipeId} must be trainable at its station (deviation (aj))`).toBe(true);
      expect(result.fee, `${recipeId} fee off the settled R8 curve`).toBe(fee);
    }
  });
});
