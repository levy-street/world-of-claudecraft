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
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import { STATIONS } from '../src/sim/content/professions';
import { FARM_DROP_RUNG_FLOOR, FARM_RECIPES, LADDER_RECIPES } from '../src/sim/content/recipes';
// ITEMS and ALL_RECIPES from data (the merged view the sim, the trainer, the
// crafting window and the guide all read), not from content: a row authored in
// content but never joined into the merged table would be unreachable in play,
// and this suite would still pass reading content directly.
import { ALL_RECIPES, ITEMS } from '../src/sim/data';
import { itemLevel } from '../src/sim/item_level';
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
// content/recipes.ts: skillReq -> [itemLevelBudget, level]. The 75 and 100
// entries are the SHIPPED points those rungs already carry elsewhere in
// ALL_RECIPES (the intermediates and the crafted hoes at 75, the apex
// consumables at 100), reused by Phase 11f's rung climb rather than minted:
// the derivation is asserted below, not just asserted here.
const SCAFFOLDING_BY_RUNG: Record<number, [number, number]> = {
  0: [10, 10],
  25: [16, 15],
  50: [20, 20],
  75: [20, 20],
  100: [25, 25],
};

// Output quality is decided by the rung, never authored per dish.
//
// 75 AND 100 BOTH READ 'rare', and that is MEASURED off the shipped defs, not
// assigned. Phase 11f moved six rows up two bands and changed NO magnitude,
// aura, charge or quality (11c owns those and masterwrought R5 is measured against them), so
// the six arrive on their new rungs carrying the quality they already had.
// Predicted before the climb and observed after: every one of the six is
// 'rare'. That makes the farm ladder's top two bands read a lower quality than
// masterwrought's rung-100 apex consumables, which is correct and recorded
// rather than fixed: farming's dishes are not apex-flagged and the climb is
// about ACCESS and ladder shape, never power. The two arms below stop this
// literal from being the only thing holding the rule up.
const QUALITY_BY_RUNG: Record<number, string> = {
  0: 'common',
  25: 'uncommon',
  50: 'rare',
  75: 'rare',
  100: 'rare',
};

// The rungs Phase 11f's band-completeness pin expects, and the ladder's own
// quality order for the monotonicity arm below.
const EXPECTED_BAND_COUNTS: Record<number, number> = { 0: 4, 25: 3, 50: 1, 75: 2, 100: 4 };
const QUALITY_ORDER = ['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary'];

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

// The fine twins the hoe ladder did NOT take. Each must gain a dedicated
// reagent slot here or it has no consumer at all (no downward substitution).
// DERIVED from the live catalog minus the hoe reagents, not listed: a hand
// list stops spanning its own domain the moment a crop is added, and then this
// suite passes over a twin with no consumer while still claiming to cover
// every one. Phase 11e is exactly that case (five twins became nine).
// DERIVED from the hoe recipes, not hand-listed (corrected at the 11e QA: as a
// hand list of three, a hoe recipe that stopped consuming fine_vale_wheat would
// have left the twin with no consumer anywhere while both arms below stayed
// green, because each only ever checked the list against itself). The literal
// stays as a pin beneath it, so the derivation moving is a visible edit.
const HOE_REAGENT_TWINS = [
  ...new Set(
    ALL_RECIPES.filter((r) => r.resultItemId.endsWith('_hoe'))
      .flatMap((r) => r.reagents.map((g) => g.itemId))
      .filter((id) => id.startsWith('fine_')),
  ),
].sort();
const FINE_TWINS_CLOSED_HERE = Object.values(FARM_CROPS)
  .map((c) => c.fineProduceItemId)
  .filter((id) => !HOE_REAGENT_TWINS.includes(id));

// Every base produce row. Each must have a dish consumer, so no crop on the
// ladder grows into a vendor-sell-only good. Derived for the same reason.
const BASE_PRODUCE = Object.values(FARM_CROPS).map((c) => c.produceItemId);

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
  // The four bills Phase 11e widened with a base-plus-fine pair each. Every
  // value below is the OLD one plus the pair's own cost, computed from the
  // merged items table rather than read off a run:
  //   bannock  76 + (15 x2) + 120 = 226
  //   soup    173 + (15 x2) + 120 = 323
  //   tart    448 + (40 x2) + 320 = 848
  //   platter 456 + (40 x2) + 320 = 856
  // The fine twin dominates each pair because reagentUnitValue prefers
  // buyValue, and a fine twin carries the four-times-sell staple. Input rises,
  // output is untouched, so every dish stays gold-negative by MORE than before.
  recipe_highwatch_barley_bannock: 226,
  recipe_highwatch_gourd_soup: 323,
  recipe_evergarden_sunmelon_tart: 848,
  recipe_evergarden_harvest_platter: 856,
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

  it('every dish has the fixed shape (id, rung-derived channel, kitchens, single output)', () => {
    for (const dish of dishes) {
      expect(dish.id, `${dish.resultItemId} recipe id`).toBe(`recipe_${dish.resultItemId}`);
      // THE CHANNEL IS DERIVED FROM THE RUNG, never listed per row (ruling
      // 11f-GATE-B). Written this way so a future row cannot land on the
      // wrong channel silently: the expectation is the RULE, and a row that
      // climbs past the floor without flipping (or flips without climbing)
      // reds here rather than needing someone to remember to edit a list.
      expect(dish.acquisition, `${dish.id} acquisition at rung ${dish.skillReq}`).toEqual(
        dish.skillReq >= FARM_DROP_RUNG_FLOOR ? ['drop'] : ['trainer'],
      );
      expect(dish.stationType, `${dish.id} stationType`).toBe('kitchens');
      expect(dish.resultCount, `${dish.id} resultCount`).toBe(1);
    }
    // Non-vacuity: the rule is exercised on BOTH sides. A set that drifted
    // entirely onto one channel would still satisfy the loop above while
    // proving nothing about the boundary that does the work.
    const flipped = dishes.filter((d) => d.skillReq >= FARM_DROP_RUNG_FLOOR);
    expect(flipped.length, 'dishes at or above the drop floor').toBeGreaterThan(0);
    expect(dishes.length - flipped.length, 'dishes below the drop floor').toBeGreaterThan(0);
  });

  it('every dish sits on a real rung with the shared scaffolding values', () => {
    for (const dish of dishes) {
      const scaffolding = SCAFFOLDING_BY_RUNG[dish.skillReq];
      expect(
        scaffolding,
        `${dish.id}: skillReq ${dish.skillReq} is not a rung ` +
          `(${Object.keys(SCAFFOLDING_BY_RUNG).join(', ')})`,
      ).toBeDefined();
      const [budget, level] = scaffolding;
      expect(dish.itemLevelBudget, `${dish.id} itemLevelBudget for rung ${dish.skillReq}`).toBe(
        budget,
      );
      expect(dish.level, `${dish.id} level for rung ${dish.skillReq}`).toBe(level);
    }
    // Non-vacuity: the set really spans more than one rung, so the mapping
    // above is exercised at more than a single key. Widened by Phase 11f from
    // three rungs to five, since the ladder it climbed onto is what makes the
    // mapping worth having.
    expect(new Set(dishes.map((d) => d.skillReq)).size).toBeGreaterThan(3);
  });

  it('reuses SHIPPED scaffolding tuples: the farm ladder mints no new rung point', () => {
    // The rule Phase 11f had to obey when it moved rows onto 75 and 100:
    // reuse the point the rung already carries somewhere in ALL_RECIPES,
    // never author a new one. Derived from the merged table with the farm
    // rows themselves EXCLUDED, so a farm row cannot be its own witness.
    const nonFarmIds = new Set(FARM_RECIPES.map((r) => r.id));
    for (const rung of Object.keys(SCAFFOLDING_BY_RUNG).map(Number)) {
      const [budget, level] = SCAFFOLDING_BY_RUNG[rung];
      const witnesses = ALL_RECIPES.filter(
        (r) =>
          !nonFarmIds.has(r.id) &&
          r.skillReq === rung &&
          r.itemLevelBudget === budget &&
          r.level === level,
      );
      expect(
        witnesses.length,
        `rung ${rung} -> [${budget}, ${level}] must already ship on a NON-farm recipe`,
      ).toBeGreaterThan(0);
    }
  });

  it('is band-complete from 0 through 100: the exact map, and no band may empty', () => {
    // ARM (i), the exact derived map, predicted then observed (ruling
    // 11f-GATE-A): 0:4, 25:3, 50:1, 75:2, 100:4, with nothing at 125. Run
    // over the WHOLE fourteen-row list, the tonic and the feast included,
    // because the band claim is about the farm ladder, not about the dish
    // filter.
    const byBand: Record<number, number> = {};
    for (const row of FARM_RECIPES) byBand[row.skillReq] = (byBand[row.skillReq] ?? 0) + 1;
    expect(byBand).toEqual(EXPECTED_BAND_COUNTS);
    expect(
      Object.values(byBand).reduce((a, b) => a + b, 0),
      'the band map must account for every farm row',
    ).toBe(FARM_RECIPES.length);
    expect(
      byBand[125],
      'nothing farming owns reaches cooking 125 (11k owns that band)',
    ).toBeUndefined();

    // ARM (ii), farming's half of masterwrought R20: every 25-point band from
    // 0 THROUGH 100 is non-empty. This is the arm that must keep biting if a
    // later phase adds a row at 125 and the exact map above legitimately
    // moves: emptying a band reds immediately either way.
    for (let rung = 0; rung <= 100; rung += 25) {
      expect(
        FARM_RECIPES.filter((r) => r.skillReq === rung).length,
        `band ${rung} is empty: the farm ladder must stay band-complete from 0 through 100`,
      ).toBeGreaterThan(0);
    }
  });

  it("masterwrought R20: farming's endgame-bill count, measured here and handed forward", () => {
    // masterwrought R20 asks whether every gathering profession reaches the
    // endgame, and its census spans five OTHER professions this phase does not
    // touch, so the cross-profession count is another phase's deliverable. What
    // THIS phase owes is farming's own number, measured rather than estimated,
    // so whoever runs that census reads something somebody computed.
    //
    // The measure: recipes at skillReq 75 or above, anywhere in the merged
    // table, that name a farm reagent. Before the Phase 11f rung climb the only
    // one was a crafted hoe, which is exactly the hole masterwrought R20 exists to find:
    // farming's whole FOOD output was trapped below cooking 50 while mining fed
    // 21 endgame bills.
    const farmItemIds = new Set(
      Object.values(FARM_CROPS).flatMap((crop) => [
        crop.seedItemId,
        crop.produceItemId,
        crop.fineProduceItemId,
      ]),
    );
    const endgameBills = ALL_RECIPES.filter(
      (r) => r.skillReq >= 75 && r.reagents.some((g) => farmItemIds.has(g.itemId)),
    );
    // Predicted then observed at the climb: the six flipped farm rows, plus the
    // one shipped hoe rung that already consumed a fine twin at 75.
    // PHASE 11g ADDS THE EIGHTH, recipe_seasoned_stock, and it is the most
    // load-bearing member of the list even though it arrived last: every other
    // consumable row here is one of farming's OWN dishes, so before it the
    // census could be read as farming buying from itself at the endgame. The
    // stock is a shipped cooking intermediate that farming did not write, and
    // the whole cooking apex flows through it.
    //
    // PHASE 11h DOUBLES IT, 8 TO 16, and this is the number masterwrought R20
    // was written to move. The eight it adds are the whole apex consumable
    // tier: the three role plates and the three flasks at rung 100, and both
    // skill-125 capstones, the top of the CONSUMABLE catalog (cooking and
    // alchemy top out at 125; the table tops out at 150, the apex tool family). Every one
    // of them is a row farming did not write, so the half of this census that
    // is not farming buying from itself goes from ONE member to NINE.
    expect(endgameBills.map((r) => r.id).sort()).toEqual(
      [
        'recipe_evergarden_braised_greens',
        'recipe_evergarden_harvest_platter',
        'recipe_evergarden_sunmelon_tart',
        'recipe_grand_cauldron',
        'recipe_harvest_feast',
        'recipe_highwatch_barley_porridge',
        'recipe_highwatch_gourd_soup',
        'recipe_ironhusk_flask',
        'recipe_laden_hearth',
        'recipe_osmium_hoe',
        'recipe_runewater_flask',
        'recipe_sageleaf_chowder',
        'recipe_seasoned_stock',
        'recipe_stonepot_stew',
        'recipe_warboar_flask',
        'recipe_warspice_skewers',
      ].sort(),
    );
    expect(
      endgameBills,
      "farming's endgame-bill count for the masterwrought R20 census",
    ).toHaveLength(16);
    // THE TOP RUNG SPECIFICALLY, kept as its own clause because the count above
    // can be satisfied entirely at 75 and 100. masterwrought R13 puts the
    // catalog's ceiling at 125 and until Phase 11h nothing farming grows
    // reached it, so a census that stops at 100 leaves the exact hole R20 names.
    expect(
      endgameBills
        .filter((r) => r.skillReq >= 125)
        .map((r) => r.id)
        .sort(),
      'produce must reach the 125 rung, the top consumable rung',
    ).toEqual(['recipe_grand_cauldron', 'recipe_laden_hearth']);
    // The claim masterwrought R20 actually cares about, stated separately from the literal
    // above so a future re-tier that moves WHICH rows qualify still has to keep
    // the property true: produce reaches a CONSUMABLE endgame bill, not only a
    // tool. Without this clause the count could be satisfied by the hoe alone,
    // which is the state masterwrought R20 was written against.
    const consumableEndgame = endgameBills.filter(
      (r) => r.professionId === 'cooking' || r.professionId === 'alchemy',
    );
    expect(consumableEndgame.length, 'produce must feed a consumable endgame bill').toBe(15);
    // AND THE CLAUSE PHASE 11g MAKES CHECKABLE, kept separate for the same
    // reason the one above is: a consumable endgame bill that is not one of
    // farming's own dishes. Satisfying masterwrought R20 entirely out of
    // FARM_RECIPES would mean farming feeds only itself at 75 and above, which
    // is the self-referential reading the supply line exists to end. 11g put
    // ONE row here; 11h took it to nine, which is the whole apex consumable
    // tier.
    const farmOwnIds = new Set(FARM_RECIPES.map((r) => r.id));
    expect(
      consumableEndgame
        .filter((r) => !farmOwnIds.has(r.id))
        .map((r) => r.id)
        .sort(),
      'produce must reach an endgame consumable bill farming did not write',
    ).toEqual([
      'recipe_grand_cauldron',
      'recipe_ironhusk_flask',
      'recipe_laden_hearth',
      'recipe_runewater_flask',
      'recipe_sageleaf_chowder',
      'recipe_seasoned_stock',
      'recipe_stonepot_stew',
      'recipe_warboar_flask',
      'recipe_warspice_skewers',
    ]);
    // BOTH CRAFTS, not one. The nine above are FIVE cooking rows (the stock,
    // the three role plates and the hearth) and FOUR alchemy rows (the three
    // flasks and the cauldron); without this clause a later walk-back that left
    // every non-farm endgame consumer in ONE craft would keep the list long and
    // the claim hollow.
    expect(
      new Set(consumableEndgame.filter((r) => !farmOwnIds.has(r.id)).map((r) => r.professionId)),
      'produce must reach the endgame of BOTH consumable crafts',
    ).toEqual(new Set(['alchemy', 'cooking']));
  });

  it('no farm output is item-level ELIGIBLE, so the scaffolding climb moves no budget pin', () => {
    // The rung climb raised itemLevelBudget from 20 to 25 on four rows, and
    // itemLevelBudget is an input to the item-level system. This asserts the
    // reason that is harmless rather than assuming it: item level is only
    // defined for equippable combat gear, every farm output is a kind 'food'
    // or kind 'junk' item with NO slot, so itemLevel() is undefined for all of
    // them and no budget pin anywhere can read the moved number. If a farm row
    // ever outputs something slotted, this reds and the climb has to be
    // re-checked against tests/item_level.test.ts.
    for (const row of FARM_RECIPES) {
      const def = ITEMS[row.resultItemId];
      expect(def, `${row.id}: output ${row.resultItemId}`).toBeDefined();
      expect(def.slot, `${row.resultItemId} must carry no equip slot`).toBeUndefined();
      expect(itemLevel(def), `${row.resultItemId} must not be item-level eligible`).toBeUndefined();
    }
    // Non-vacuity: itemLevel really does answer for something, so the sweep
    // above is not passing because the function returns undefined for all
    // input.
    expect(itemLevel(ITEMS.thorium_warblade), 'the probe item IS eligible').toBeGreaterThan(0);
  });

  it('output quality is one value per band and never falls as the ladder climbs', () => {
    // The two arms that stop QUALITY_BY_RUNG from being a bare literal. The
    // uniformity arm says the band really decides the quality (one value per
    // rung), and the monotone arm says the ladder never grades DOWN as it
    // climbs, which is the property recipe rarity is pinned to across the
    // whole catalog. Together they are why the 'rare' at 75 and 100 reads as
    // measured rather than asserted.
    const byBand = new Map<number, Set<string>>();
    for (const row of FARM_RECIPES) {
      const quality = ITEMS[row.resultItemId]?.quality as string;
      expect(quality, `${row.resultItemId} has no quality`).toBeDefined();
      const seen = byBand.get(row.skillReq) ?? new Set<string>();
      seen.add(quality);
      byBand.set(row.skillReq, seen);
    }
    for (const [rung, seen] of byBand) {
      expect([...seen], `rung ${rung} must carry exactly one output quality`).toHaveLength(1);
      expect([...seen][0], `rung ${rung} output quality`).toBe(QUALITY_BY_RUNG[rung]);
    }
    const rungs = [...byBand.keys()].sort((a, b) => a - b);
    expect(
      rungs.length,
      'the monotone arm needs more than one band to be worth running',
    ).toBeGreaterThan(1);
    for (let i = 1; i < rungs.length; i++) {
      expect(
        QUALITY_ORDER.indexOf(QUALITY_BY_RUNG[rungs[i]]),
        `rung ${rungs[i]} grades below rung ${rungs[i - 1]}`,
      ).toBeGreaterThanOrEqual(QUALITY_ORDER.indexOf(QUALITY_BY_RUNG[rungs[i - 1]]));
    }
  });

  it('every dish output is food: kind, foodHp, no vendor price, rung quality', () => {
    for (const dish of dishes) {
      const def = ITEMS[dish.resultItemId];
      expect(def, `${dish.id}: output ${dish.resultItemId} has no ItemDef`).toBeDefined();
      expect(def.kind, `${dish.resultItemId} kind`).toBe('food');
      expect(def.foodHp, `${dish.resultItemId} foodHp`).toBeGreaterThan(0);
      // foodHp is the shared floor; among FARM_RECIPES outputs the wellFed field
      // is allowed ONLY on the four Phase 11 buff dishes, which the closed-shape
      // describe below pins.
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

  it('closes every fine twin the hoe ladder left without a consumer', () => {
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
    for (const hoeTwin of HOE_REAGENT_TWINS) {
      expect(
        dishReagents.has(hoeTwin),
        `${hoeTwin} is a hoe reagent; a dish slot for it would double-book the twin`,
      ).toBe(false);
    }
    // Non-vacuity. Nine dish-closed plus three hoe reagents, and BOTH counts
    // are the teeth: the union assertion below is a tautology by construction
    // (FINE_TWINS_CLOSED_HERE is defined as the twin column MINUS the hoe
    // list), noted at the 11e QA so it is not mistaken for coverage, and kept
    // only because it states the partition the two loops rely on. What
    // actually catches a forgotten twin is the pair of lengths, now that the
    // hoe half is derived from the recipes rather than hand-written.
    expect(FINE_TWINS_CLOSED_HERE).toHaveLength(9);
    expect(HOE_REAGENT_TWINS).toEqual([
      'fine_highland_barley',
      'fine_marsh_rice',
      'fine_vale_wheat',
    ]);
    expect([...FINE_TWINS_CLOSED_HERE, ...HOE_REAGENT_TWINS].sort()).toEqual(
      Object.values(FARM_CROPS)
        .map((c) => c.fineProduceItemId)
        .sort(),
    );
  });

  it('gives every base produce row a dish consumer', () => {
    const dishReagents = new Set(dishes.flatMap((d) => d.reagents.map((r) => r.itemId)));
    for (const produce of BASE_PRODUCE) {
      expect(dishReagents.has(produce), `${produce} is never cooked into any dish`).toBe(true);
    }
    expect(BASE_PRODUCE).toHaveLength(12);
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

  it('shares the dish scaffolding: kitchens, a drop, rung 100, one feast per craft', () => {
    const feast = requireFeast();
    expect(feast.professionId, `${FEAST_ID} professionId`).toBe('cooking');
    expect(feast.stationType, `${FEAST_ID} stationType`).toBe('kitchens');
    // Rung 100 and therefore a drop, by the same rule every dish obeys.
    expect(feast.acquisition, `${FEAST_ID} acquisition at rung ${feast.skillReq}`).toEqual(
      feast.skillReq >= FARM_DROP_RUNG_FLOOR ? ['drop'] : ['trainer'],
    );
    expect(feast.resultItemId, `${FEAST_ID} resultItemId`).toBe(FEAST_ITEM_ID);
    expect(feast.resultCount, `${FEAST_ID} resultCount`).toBe(1);
    // Phase 11f moved the feast off the flat rung-50 band to cooking 100, and
    // 100 rather than 125 is the ruled placement (11f-GATE-A): at 125 it would
    // collide with 11k's apex feasts and falsify their "the party-tier rung
    // below" premise, so the feast ladder climbs 100 -> 125 instead. No second
    // cooking-125 capstone exception was recorded anywhere.
    expect(feast.skillReq, 'the party feast is capstone content on the rung-100 band').toBe(100);
    expect(feast.skillReq, 'no farm row reaches cooking 125').toBeLessThan(125);
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
      dishDef?.kind === 'food' ? dishDef.wellFed : undefined,
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
  // buff dishes carry the well-fed field (unified onto `wellFed` by
  // Masterwrought 11c), and NOTHING else moved. The shape is closed again
  // until the next consumable phase reopens it here.
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
  const BUFF_FOOD_KEYS = ['foodHp', 'id', 'kind', 'name', 'quality', 'sellValue', 'wellFed'];

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

  it('the four buff dishes carry EXACTLY the seven keys (plain plus wellFed)', () => {
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

  it('every buff dish wellFed field sits on the derived 11c ladder rung', () => {
    // The five-rung Well Fed ladder (Masterwrought 11c, ruling 11c-D-2), the
    // farming rungs DERIVED rather than pasted: one point of stamina per crop
    // tier starting at 2 (carrots / pudding / porridge / greens = 2/3/4/5),
    // every rung at the consumable family's own entry duration, read LIVE
    // off elixir_of_the_boar so the anchor cannot drift apart from the
    // ladder it calibrates. The apex plates (6 / entry + step) live in
    // profession_items.ts's apex block; their dominance over these rungs is
    // pinned in tests/masterwrought_budget.test.ts over the live catalog.
    const boar = ITEMS.elixir_of_the_boar;
    const entryDuration = boar.elixir?.duration;
    expect(entryDuration, 'the elixir entry rung anchors the dish duration').toBeDefined();
    const TIER_ORDER = [
      'eastbrook_glazed_carrots',
      'fenbridge_rice_pudding',
      'highwatch_barley_porridge',
      'evergarden_braised_greens',
    ];
    const buff = dishes.filter((d) => BUFF_DISH_IDS.includes(d.resultItemId));
    expect(buff, 'the buff sweep really covers the four Phase 11 dishes').toHaveLength(4);
    for (const dish of buff) {
      const def = ITEMS[dish.resultItemId];
      const wellFed = def.kind === 'food' ? def.wellFed : undefined;
      expect(wellFed, `${dish.resultItemId} lost its wellFed field`).toBeDefined();
      if (!wellFed) continue;
      // One aura name and ONE shared aura id for the whole food family
      // (WELL_FED_AURA_ID, src/sim/wellfed.ts): last eaten always wins,
      // dish or role plate alike, while elixir_<kind> coexists because the
      // ids can never collide.
      expect(wellFed.aura, `${dish.resultItemId} aura name`).toBe('Well Fed');
      expect(wellFed.kind, `${dish.resultItemId} aura kind`).toBe('buff_sta');
      const tier = TIER_ORDER.indexOf(dish.resultItemId);
      expect(tier, `${dish.resultItemId} sits on the crop-tier ladder`).toBeGreaterThanOrEqual(0);
      expect(wellFed.value, `${dish.resultItemId} ladder value (tier + 2)`).toBe(tier + 2);
      expect(wellFed.duration, `${dish.resultItemId} entry-rung duration`).toBe(entryDuration);
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

// The R8 named across this describe is the PROFESSIONS-TUNING one (ruling R8 in
// docs/design/professions-tuning-packet-review.md, cited at
// professions/training.ts's TRAINING_FEE_BY_TIER), never masterwrought R8, which
// is the recipe-channel doctrine. It stays bare for that reason.
describe('FARM_RECIPES: the trainer on-ramp on the settled R8 fee curve', () => {
  // Deviation (aj) is DISCHARGED by Phase 11f and this describe is what proves
  // both halves. The deviation recorded that every farm row shipped trainable
  // before the farm opened; its Phase 6 QA addendum recorded the FEE half as a
  // ruling owed, since the rung-25 and rung-50 rows charged 2500 and 10000
  // copper for recipes nobody could yet cook. Phase 11e retired the dormancy
  // (all eight upper seeds stocked), and Phase 11f moved every one of the
  // formerly dormant priced rows off the trainer entirely. What is left below
  // the drop floor is the on-ramp, and it is fee-charging for dishes a player
  // can actually make. The arms still pin the acquisition shape so a future
  // availability gate cannot land silently.
  it('the on-ramp trains: rung-0 free, rung-25 and rung-50 charging, all resolving at their stations', () => {
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
      // The held band-50 anchor, and the ONE farm row still paying the tier-2
      // fee. Phase 11e made it non-dormant, which is what retires the (aj)
      // addendum's premise for it: a player who pays the 10000 can cook it.
      ['recipe_highwatch_barley_bannock', 'kitchens', 10000],
    ] as const) {
      const station = stationsOfType(STATIONS, stationType)[0];
      expect(station, `no placed ${stationType} station to train at`).toBeDefined();
      const result = resolveTrain(STATIONS, meta, station.pos, recipeId);
      expect(result.ok, `${recipeId} must be trainable at its station`).toBe(true);
      expect(result.fee, `${recipeId} fee off the settled R8 curve`).toBe(fee);
    }
  });

  it('every row at or above the drop floor is REFUSED by the trainer, at full skill', () => {
    // The other half of the (aj) discharge, and the arm that makes the fee
    // claim above true rather than merely unstated: a flipped row must not be
    // learnable at a counter for copper at all. Driven at cooking 100 so the
    // refusal is provably about the CHANNEL and not about a skill gate, and
    // derived from the rung rule so it covers every flipped row rather than a
    // sample.
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    const meta = (sim as any).players.get(sim.playerId);
    meta.copper = 1000000;
    meta.craftSkills.cooking = 100;
    meta.craftSkills.alchemy = 100;
    const flipped = FARM_RECIPES.filter((r) => r.skillReq >= FARM_DROP_RUNG_FLOOR);
    expect(flipped.length, 'the refusal sweep must run over a non-empty set').toBe(6);
    for (const row of flipped) {
      const station = stationsOfType(STATIONS, row.stationType as 'kitchens')[0];
      const result = resolveTrain(STATIONS, meta, station.pos, row.id);
      expect(result.ok, `${row.id} is a drop and must NOT be trainable`).toBe(false);
    }
    // And the mirror, so the sweep is not passing because resolveTrain refuses
    // everything: the on-ramp rows still resolve for the same player.
    for (const row of FARM_RECIPES.filter((r) => r.skillReq < FARM_DROP_RUNG_FLOOR)) {
      const station = stationsOfType(STATIONS, row.stationType as 'kitchens')[0];
      expect(
        resolveTrain(STATIONS, meta, station.pos, row.id).ok,
        `${row.id} is on the on-ramp and must stay trainable`,
      ).toBe(true);
    }
  });
});
