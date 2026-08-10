// FARM_RECIPES (the Phase 6 farm-economy hook set): conformance pins for the
// eight cooking dishes that turn crop produce into something a player wants,
// plus the one alchemy row, the growth tonic brewed from wild herbs.
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
  it('is exactly eight cooking dishes inside a nine-row list', () => {
    // The whole-list pin and the cooking-filter pin are BOTH stated: the
    // alchemy row moved the first and left the second at 8, and keeping them
    // separate is what makes any further addition a visible, deliberate edit.
    expect(FARM_RECIPES).toHaveLength(9);
    expect(dishes, 'the cooking dishes are eight of the nine farm rows').toHaveLength(8);
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

describe('FARM_RECIPES: the dish ItemDef shape is closed until Phase 11 reopens it', () => {
  it('every dish def carries EXACTLY the six plain-food keys, nothing more', () => {
    // The acceptance criterion "foodHp only, NO buff machinery" as an
    // absence pin, not a comment: Phase 11 is the well-fed phase, so the
    // field these dishes must not carry is SCHEDULED to exist. This exact
    // key-set pin makes attaching it to a shipped dish a deliberate re-pin
    // here instead of a silent def edit.
    const PLAIN_FOOD_KEYS = ['foodHp', 'id', 'kind', 'name', 'quality', 'sellValue'];
    for (const dish of dishes) {
      const def = ITEMS[dish.resultItemId];
      expect(
        Object.keys(def).sort(),
        `${dish.resultItemId} grew beyond the plain-food shape; Phase 11 must re-pin this deliberately`,
      ).toEqual(PLAIN_FOOD_KEYS);
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
});

describe('FARM_RECIPES: trainable before go-live is the INTENDED dormant-visible state', () => {
  // Deviation (aj): the phase's binding Live-surface note makes the recipes
  // "visible in the crafting window" before Phase 9, and trainer acquisition
  // is the only mechanism that puts them there, so every row is trainable AND
  // fee-charging in the live game while the farm itself is dormant (the
  // garden_hoe priced-but-unstocked precedent, deviation (aa), extended to
  // recipes). This arm pins that ruling so a future availability gate cannot
  // land silently, and so the ruling itself stays falsifiable: if the
  // maintainer wants training gated to go-live instead, THIS test is the one
  // that reds and names the decision to revisit.
  it('rung-0 rows train free and a rung-50 dish charges, all resolving ok at their stations', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    const meta = (sim as any).players.get(sim.playerId);
    meta.copper = 100000;
    meta.craftSkills.cooking = 50; // teach tier for the rung-50 dish
    // Fees come from the settled exception-free curve (TRAINING_FEE_BY_TIER,
    // ruling R8): tier 0 is genuinely FREE, tier 2 charges 10000 copper. Both
    // shapes are pinned so neither a surprise fee at the starter rung nor a
    // silently-freed premium rung can land unnoticed.
    for (const [recipeId, stationType, fee] of [
      ['recipe_vale_hearth_loaf', 'kitchens', 0],
      ['recipe_growth_tonic', 'apothecary', 0],
      ['recipe_evergarden_harvest_platter', 'kitchens', 10000],
    ] as const) {
      const station = stationsOfType(STATIONS, stationType)[0];
      expect(station, `no placed ${stationType} station to train at`).toBeDefined();
      const result = resolveTrain(STATIONS, meta, station.pos, recipeId);
      expect(result.ok, `${recipeId} must be trainable pre-go-live (deviation (aj))`).toBe(true);
      expect(result.fee, `${recipeId} fee off the settled R8 curve`).toBe(fee);
    }
  });
});
