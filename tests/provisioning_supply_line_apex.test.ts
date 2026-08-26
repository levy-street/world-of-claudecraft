// THE PROVISIONING SUPPLY LINE AT THE APEX TIER (masterwrought Phase 11h):
// farm produce reaches the bills a raid actually eats and drinks.
//
// WHAT THIS FILE OWNS, and what it deliberately does not. The CROSS-PACKET
// RULES live in tests/provisioning_supply_line.test.ts (masterwrought R17's
// tier gate, the accent rule and the displacement guard) and the GEAR FIREWALL
// lives in tests/provisioner_firewall.test.ts under its own
// one-file-for-one-invariant header. Both are SWEEPS over derived sets, so this
// phase's eight rows are governed by them the moment they ship and neither file
// is forked here. What this file pins is what this phase actually AUTHORED: the
// eight bills, per row and in order, the two ruled family shapes, the derived
// obtainability of every crop it names, the arithmetic above each row, and the
// craft itself driven through the real sim.
//
// WHY A PER-ROW TABLE BESIDE THE DERIVED SWEEPS. The sweeps prove the rules hold
// over whatever ships; only a literal proves what shipped. A phase that walked
// one row back would keep every derived arm green as long as a sibling still
// covered the rung, which is the partial-walk-back class the packet keeps
// hitting. The ORDER column is here for the same reason it exists one rung down
// (qr-11G-ORDER): the crafting window and the wiki render a bill in authored
// order, so an interleaving change is player-visible and nothing else sees it.
import { describe, expect, it } from 'vitest';
import { FARM_CROPS, farmCropSkillThreshold } from '../src/sim/content/farm_crops';
import { GATHERING_PROFESSIONS } from '../src/sim/content/professions';
import {
  ALL_RECIPES,
  APEX_ARMOR_RECIPES,
  APEX_CONSUMABLE_RECIPES,
  APEX_GEAR_RECIPES,
  INTERMEDIATE_RECIPES,
} from '../src/sim/content/recipes';
import { ITEMS, NPCS, STATIONS } from '../src/sim/data';
import { requiredReagentCountFor, resolveCraft } from '../src/sim/professions/crafting';
import { stationsOfType } from '../src/sim/professions/stations';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { materialCostMultiplier } from '../src/sim/professions/wheel';
import {
  TIER3_TOOL_WIELD_PROFICIENCY,
  TIER4_TOOL_WIELD_PROFICIENCY,
  wieldRequirementForTier,
} from '../src/sim/professions/wield_gate';
import { Sim } from '../src/sim/sim';

/** Every farm PRODUCE id and its fine twin, derived from the crop catalog, the
 *  same derivation the sweeps one rung down use. Seeds are deliberately out:
 *  a seed is the INPUT side of the farming loop. */
const PRODUCE_IDS: ReadonlySet<string> = new Set(
  Object.values(FARM_CROPS).flatMap((crop) => [crop.produceItemId, crop.fineProduceItemId]),
);

/** The economy unit basis, the same rule tests/recipe_economy.test.ts reads:
 *  buyValue when the def carries a positive one, else sellValue. */
function reagentUnitValue(itemId: string): number {
  const def = ITEMS[itemId];
  if (!def) throw new Error(`reagent ${itemId} has no ItemDef`);
  return typeof def.buyValue === 'number' && def.buyValue > 0 ? def.buyValue : def.sellValue;
}

function requireRecipe(id: string): ProfessionRecipeRecord {
  const recipe = ALL_RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`recipe ${id} is missing from the merged table`);
  return recipe;
}

/** Narrow an ItemDef to its FOOD arm, the same way tests/masterwrought_budget.test.ts
 *  does: `wellFed`/`foodHp` live on one member of the union, so a bare read is a
 *  type error even though the value is there at runtime. */
function foodDef(id: string): { foodHp?: number; wellFed?: { value: number; duration: number } } {
  const def = ITEMS[id];
  if (!def || def.kind !== 'food') throw new Error(`${id} is not a food`);
  return def;
}

/** The same narrowing for the FLASK arm and its elixir payload. */
function flaskDef(id: string): { elixir?: { value: number; duration: number } } {
  const def = ITEMS[id];
  if (!def || def.kind !== 'flask') throw new Error(`${id} is not a flask`);
  return def;
}

const inputValue = (recipe: ProfessionRecipeRecord): number =>
  recipe.reagents.reduce((t, g) => t + g.count * reagentUnitValue(g.itemId), 0);

const outputValue = (recipe: ProfessionRecipeRecord): number => {
  const def = ITEMS[recipe.resultItemId];
  if (!def) throw new Error(`recipe ${recipe.id} has no output def`);
  return def.sellValue * recipe.resultCount;
};

/** ALL produce on a row, summed on the economy basis. Equal to "the produce
 *  this phase added" only because none of these eight rows carried produce
 *  before it; Phase 11i or 11k adding a second crop to any of them changes what
 *  every `inputBefore` check means, so that phase re-reads this note. */
const addedProduceValue = (recipe: ProfessionRecipeRecord): number =>
  recipe.reagents
    .filter((g) => PRODUCE_IDS.has(g.itemId))
    .reduce((t, g) => t + g.count * reagentUnitValue(g.itemId), 0);

/** THE AMENDED UNIFORM-BILL RULE AS ONE EXPRESSION, read by the two food-family
 *  arms below AND by their control. Written once for the reason the Phase 11g QA
 *  recorded against the accent rule (qr-11G-ACCENT): a control that drives its
 *  own copy of a rule proves the copy can say no, never the enforcer.
 *
 *  `remaindersEqual` is the "identical in every other reagent" half, measured on
 *  each bill with its PRODUCE entries stripped; `cropRowsPerPlate` is the
 *  "differ by exactly one crop row" half. They are separate fields rather than
 *  one boolean so each can be refused on its own. */
function foodFamilyShape(bills: ReadonlyArray<ReadonlyArray<{ itemId: string; count: number }>>): {
  remaindersEqual: boolean;
  cropRowsPerPlate: number[];
} {
  const remainders = bills.map((bill) =>
    bill.filter((g) => !PRODUCE_IDS.has(g.itemId)).map((g) => [g.itemId, g.count] as const),
  );
  const first = JSON.stringify(remainders[0]);
  return {
    remaindersEqual: remainders.every((r) => JSON.stringify(r) === first),
    cropRowsPerPlate: bills.map((bill) => bill.filter((g) => PRODUCE_IDS.has(g.itemId)).length),
  };
}

const THREE_PLATES = ['recipe_stonepot_stew', 'recipe_warspice_skewers', 'recipe_sageleaf_chowder'];
const THREE_FLASKS = ['recipe_ironhusk_flask', 'recipe_warboar_flask', 'recipe_runewater_flask'];
const TWO_CAPSTONES = ['recipe_grand_cauldron', 'recipe_laden_hearth'];

// ---------------------------------------------------------------------------
// THE ROWS THIS PHASE TOUCHED
// ---------------------------------------------------------------------------

/** The eight shipped rows Phase 11h put produce into.
 *
 *  `produce` is the exact produce entries authored; `untouched` is every
 *  NON-produce reagent as shipped, so masterwrought R18's "add, never
 *  substitute" is a fact about each row rather than only about six global
 *  totals (totals alone can be gamed by moving a reagent between rows); `order`
 *  is the EXACT shipped reagent sequence, produce interleaved where it was
 *  authored, because two separately ordered lists leave the interleaving free
 *  and the interleaving is what the tooltip renders.
 *
 *  `inputBefore` is the row's input value BEFORE this phase. NO ARM READS GIT,
 *  so this literal is not evidence about the pre-phase tree and the header used
 *  to overclaim that it was. What the arms below actually pin is the DELTA: with
 *  `inputAfter` pinned independently, checking (input now - added produce)
 *  against `inputBefore` pins the added produce's economy value, which is the
 *  half a later retune would move. The pre-phase values themselves were read off
 *  the parent commit at authoring time. */
const APEX_ROWS: ReadonlyArray<{
  readonly id: string;
  readonly craft: 'cooking' | 'alchemy';
  readonly rung: number;
  readonly produce: ReadonlyArray<readonly [string, number]>;
  readonly untouched: ReadonlyArray<readonly [string, number]>;
  // The row masterwrought Phase 11i added to this bill, EMPTY where it added
  // none. Kept as its own column rather than folded into `untouched`, which
  // means "what shipped before 11h" and would stop meaning that: the arms
  // below compose the two, so 11h's own claim about what it did not move is
  // still readable on its own line.
  readonly fish: ReadonlyArray<readonly [string, number]>;
  readonly order: readonly string[];
  readonly inputBefore: number;
  readonly inputAfter: number;
  // The input after 11i's fish row, where it added one. 11h's own
  // before-and-after pair above is untouched, so its margin claim still reads
  // as the statement 11h made.
  readonly inputAfter11i: number;
  readonly output: number;
}> = [
  {
    id: 'recipe_stonepot_stew',
    craft: 'cooking',
    rung: 100,
    produce: [['frost_gourd', 2]],
    untouched: [
      ['seasoned_stock', 1],
      ['prime_cut', 2],
      ['game_meat', 4],
      ['sunpetal_herb', 2],
      ['cooking_salt', 2],
    ],
    fish: [['raw_deepbarb_catfish', 4]],
    order: [
      'seasoned_stock',
      'prime_cut',
      'game_meat',
      'frost_gourd',
      'sunpetal_herb',
      'cooking_salt',
      'raw_deepbarb_catfish',
    ],
    inputBefore: 422,
    inputAfter: 452,
    inputAfter11i: 508,
    output: 360,
  },
  {
    id: 'recipe_warspice_skewers',
    craft: 'cooking',
    rung: 100,
    produce: [['highland_barley', 2]],
    untouched: [
      ['seasoned_stock', 1],
      ['prime_cut', 2],
      ['game_meat', 4],
      ['sunpetal_herb', 2],
      ['cooking_salt', 2],
    ],
    fish: [['raw_deepbarb_catfish', 4]],
    order: [
      'seasoned_stock',
      'prime_cut',
      'game_meat',
      'highland_barley',
      'sunpetal_herb',
      'cooking_salt',
      'raw_deepbarb_catfish',
    ],
    inputBefore: 422,
    inputAfter: 452,
    inputAfter11i: 508,
    output: 360,
  },
  {
    id: 'recipe_sageleaf_chowder',
    craft: 'cooking',
    rung: 100,
    produce: [['thornpeak_cabbage', 2]],
    untouched: [
      ['seasoned_stock', 1],
      ['prime_cut', 2],
      ['game_meat', 4],
      ['sunpetal_herb', 2],
      ['cooking_salt', 2],
    ],
    fish: [['raw_deepbarb_catfish', 4]],
    order: [
      'seasoned_stock',
      'prime_cut',
      'game_meat',
      'thornpeak_cabbage',
      'sunpetal_herb',
      'cooking_salt',
      'raw_deepbarb_catfish',
    ],
    inputBefore: 422,
    inputAfter: 452,
    inputAfter11i: 508,
    output: 360,
  },
  {
    id: 'recipe_ironhusk_flask',
    craft: 'alchemy',
    rung: 100,
    produce: [['highland_barley', 1]],
    untouched: [
      ['quickening_catalyst', 1],
      ['pristine_venom_gland', 1],
      ['venom_gland', 2],
      ['sunpetal_herb', 2],
      ['glass_vial', 1],
    ],
    fish: [],
    order: [
      'quickening_catalyst',
      'pristine_venom_gland',
      'venom_gland',
      'sunpetal_herb',
      'highland_barley',
      'glass_vial',
    ],
    inputBefore: 424,
    inputAfter: 439,
    inputAfter11i: 439,
    output: 50,
  },
  {
    id: 'recipe_warboar_flask',
    craft: 'alchemy',
    rung: 100,
    produce: [['highland_barley', 1]],
    untouched: [
      ['quickening_catalyst', 1],
      ['pristine_venom_gland', 1],
      ['venom_gland', 2],
      ['sunpetal_herb', 2],
      ['glass_vial', 1],
    ],
    fish: [],
    order: [
      'quickening_catalyst',
      'pristine_venom_gland',
      'venom_gland',
      'sunpetal_herb',
      'highland_barley',
      'glass_vial',
    ],
    inputBefore: 424,
    inputAfter: 439,
    inputAfter11i: 439,
    output: 50,
  },
  {
    id: 'recipe_runewater_flask',
    craft: 'alchemy',
    rung: 100,
    produce: [['highland_barley', 1]],
    untouched: [
      ['quickening_catalyst', 1],
      ['pristine_venom_gland', 1],
      ['venom_gland', 2],
      ['sunpetal_herb', 2],
      ['glass_vial', 1],
    ],
    fish: [],
    order: [
      'quickening_catalyst',
      'pristine_venom_gland',
      'venom_gland',
      'sunpetal_herb',
      'highland_barley',
      'glass_vial',
    ],
    inputBefore: 424,
    inputAfter: 439,
    inputAfter11i: 439,
    output: 50,
  },
  {
    id: 'recipe_grand_cauldron',
    craft: 'alchemy',
    rung: 125,
    produce: [
      ['gilded_sunmelon', 2],
      ['fine_gilded_sunmelon', 1],
    ],
    untouched: [
      ['quickening_catalyst', 3],
      ['wyrmfall_core', 2],
      ['sunpetal_herb', 4],
      ['goldleaf_herb', 2],
    ],
    fish: [],
    order: [
      'quickening_catalyst',
      'wyrmfall_core',
      'gilded_sunmelon',
      'fine_gilded_sunmelon',
      'sunpetal_herb',
      'goldleaf_herb',
    ],
    inputBefore: 1010,
    inputAfter: 1410,
    inputAfter11i: 1410,
    output: 380,
  },
  {
    id: 'recipe_laden_hearth',
    craft: 'cooking',
    rung: 125,
    produce: [
      ['evergarden_greens', 2],
      ['fine_evergarden_greens', 1],
    ],
    untouched: [
      ['seasoned_stock', 3],
      ['wyrmfall_core', 2],
      ['prime_cut', 4],
      ['game_meat', 4],
      ['sunpetal_herb', 2],
    ],
    fish: [['raw_deepbarb_catfish', 4]],
    order: [
      'seasoned_stock',
      'wyrmfall_core',
      'prime_cut',
      'game_meat',
      'evergarden_greens',
      'fine_evergarden_greens',
      'sunpetal_herb',
      'raw_deepbarb_catfish',
    ],
    inputBefore: 606,
    inputAfter: 1006,
    inputAfter11i: 1062,
    output: 380,
  },
];

describe('masterwrought Phase 11h: the eight rows, per row', () => {
  it('the table covers exactly this phase, and every row is a real merged recipe', () => {
    expect(APEX_ROWS.length, 'the touched-row table').toBe(8);
    // THIS TABLE IS 11h's EIGHT ROWS, and since masterwrought Phase 11i that is
    // a strict SUBSET of APEX_CONSUMABLE_RECIPES rather than the whole of it:
    // 11i appended three angler rows to the same array. The equality is split
    // into containment plus an exact complement so neither half can drift: a
    // row vanishing from the live table still reds the first, and a FOURTH row
    // appearing without a decision still reds the second.
    const liveApexIds = APEX_CONSUMABLE_RECIPES.map((r) => r.id).sort();
    for (const row of APEX_ROWS) {
      expect(liveApexIds, `${row.id} must still be a live apex row`).toContain(row.id);
    }
    expect(
      liveApexIds.filter((id) => !APEX_ROWS.some((r) => r.id === id)),
      "the rows 11h did not touch: 11i's two surviving angler rows plus 11k's " +
        'three apex feasts',
    ).toEqual([
      'recipe_peppered_deepbarb_catfish',
      'recipe_roast_hollowgill_sturgeon',
      'recipe_sageleaf_feast',
      'recipe_stonepot_feast',
      'recipe_warspice_feast',
    ]);
    for (const row of APEX_ROWS) {
      const recipe = requireRecipe(row.id);
      expect(recipe.professionId, `${row.id} craft`).toBe(row.craft);
      expect(recipe.skillReq, `${row.id} rung`).toBe(row.rung);
    }
  });

  it('carries exactly the produce entries this phase authored', () => {
    for (const row of APEX_ROWS) {
      const actual = requireRecipe(row.id)
        .reagents.filter((g) => PRODUCE_IDS.has(g.itemId))
        .map((g) => [g.itemId, g.count]);
      expect(actual, `${row.id} produce entries`).toEqual(row.produce.map(([id, n]) => [id, n]));
    }
  });

  it('and every NON-produce reagent is exactly what shipped before (add, never substitute)', () => {
    // masterwrought R18 and farming D24 per row. The six global demand totals in
    // tests/provisioning_supply_line.test.ts close the same claim across the
    // whole table; this closes it row by row, so a reduction paid for by an
    // increase somewhere else cannot pass both.
    for (const row of APEX_ROWS) {
      const actual = requireRecipe(row.id)
        .reagents.filter((g) => !PRODUCE_IDS.has(g.itemId))
        .map((g) => [g.itemId, g.count]);
      // untouched PLUS 11i's fish row, in that order: 11h's claim is that it
      // moved no non-produce reagent, and 11i's is that it only ADDED one.
      // Composing the two columns keeps both statements checkable separately.
      expect(actual, `${row.id} non-produce bill`).toEqual(
        [...row.untouched, ...row.fish].map(([id, n]) => [id, n]),
      );
    }
  });

  it('and the reagent ORDER on every row, produce interleaved where it was authored', () => {
    for (const row of APEX_ROWS) {
      const recipe = requireRecipe(row.id);
      expect(
        recipe.reagents.map((g) => g.itemId),
        `${row.id} reagent order (the crafting window and the wiki render this sequence)`,
      ).toEqual(row.order);
      // The order column already accounts for the WHOLE bill: the toEqual above
      // is array equality, which forces equal length, so the separate
      // length check that used to sit here could never fail and was removed at
      // the Phase 11h QA. The Set check below is NOT redundant with it: array
      // equality is satisfied by a duplicated reagent id appearing on both
      // sides, and this forbids the table ever describing one.
      expect(new Set(row.order).size, `${row.id} order must name each reagent once`).toBe(
        row.order.length,
      );
    }
  });

  it('the longest bill in the game is EIGHT, and exactly four rows hold it', () => {
    // Recorded as a fact about the merged table rather than a note, because it
    // is the one shape claim this phase makes that no other arm would notice:
    // nothing caps a reagent list, so the eighth row renders by existing.
    // SEVEN at 11h, EIGHT since masterwrought Phase 11i put its uniform fish
    // row on recipe_laden_hearth's bill, which held the record alone until
    // masterwrought Phase 11k. The apex feast tier TIES it at eight rather than
    // beating it, and the tie is the design statement: the consumed
    // provisioning capstone asks for as much as the permanent station does.
    // The title no longer names one row, because a superlative held by a set is
    // a set claim, and the enumeration below is what keeps the render trace
    // above meaningful for every holder rather than only the first.
    const longest = Math.max(...ALL_RECIPES.map((r) => r.reagents.length));
    expect(longest, 'the longest bill in the merged table').toBe(8);
    expect(
      ALL_RECIPES.filter((r) => r.reagents.length === 8)
        .map((r) => r.id)
        .sort(),
      'and these are exactly the rows that hold it',
    ).toEqual([
      'recipe_laden_hearth',
      'recipe_sageleaf_feast',
      'recipe_stonepot_feast',
      'recipe_warspice_feast',
    ]);
    // THE SIX-ENTRY TIER, pinned by id rather than counted, because a floor
    // here was satisfied by this phase's OWN rows: seven of the nine six-entry
    // rows are 11h's (three flasks, three plates, the alchemy capstone reached
    // six by gaining an entry), and only two are Phase 11g's. A `>= 6` floor
    // therefore recorded nothing about the history it claimed to record.
    // THE SEVEN-ENTRY TIER, which is where the three role plates landed once
    // 11i's fish row joined them, plus 11i's own capstone feast at six. Pinned
    // by id for the reason the six-entry list below is: a floor here would be
    // satisfied by a phase's own rows and record nothing about the history it
    // claims to record.
    expect(
      ALL_RECIPES.filter((r) => r.reagents.length === 7)
        .map((r) => r.id)
        .sort(),
      "the seven-entry rows: the three role plates, at seven since 11i's fish row",
    ).toEqual(['recipe_sageleaf_chowder', 'recipe_stonepot_stew', 'recipe_warspice_skewers']);
    expect(
      ALL_RECIPES.filter((r) => r.reagents.length === 6)
        .map((r) => r.id)
        .sort(),
      'the six-entry rows: two from Phase 11g and four 11h reached. It briefly ' +
        "carried 11i's capstone feast, retired at Phase 11k.",
    ).toEqual([
      'recipe_grand_cauldron',
      'recipe_ironhusk_flask',
      'recipe_marlows_grand_roast',
      'recipe_runewater_flask',
      'recipe_seasoned_stock',
      'recipe_warboar_flask',
    ]);
  });
});

describe('masterwrought Phase 11h GATE A: the amended uniform-bill rule', () => {
  it('the three role plates differ by EXACTLY ONE crop row and in nothing else', () => {
    // The amendment's exact scope, asserted rather than trusted to the header
    // comment that states it, and routed through foodFamilyShape so the control
    // below drives exactly this expression.
    const shape = foodFamilyShape(THREE_PLATES.map((id) => requireRecipe(id).reagents));
    expect(shape.remaindersEqual, 'the three plates, produce aside, must be identical').toBe(true);
    // EXACTLY ONE crop ROW each, not merely "some produce": two crop rows on one
    // plate would satisfy a looser reading and break the amendment as written.
    expect(shape.cropRowsPerPlate, 'one crop row per plate').toEqual([1, 1, 1]);
    // And the remainder is not empty, or "identical in every other reagent"
    // would be a claim about nothing. Also stated per plate, so a bill emptied
    // down to its crop cannot satisfy the equality by having nothing to compare.
    for (const id of THREE_PLATES) {
      // SIX since masterwrought Phase 11i, which appended the same fish row to
      // all three. It grew the shared remainder rather than the differing part,
      // which is exactly why remaindersEqual above still holds: the crop row
      // differentiates, the fish row unifies.
      expect(
        requireRecipe(id).reagents.filter((g) => !PRODUCE_IDS.has(g.itemId)).length,
        `${id} shared bill`,
      ).toBe(6);
    }
    // And the fish really IS in the shared half rather than merely absent from
    // the differing one: without this, emptying the fish row off all three
    // plates together would leave every assertion above green.
    for (const id of THREE_PLATES) {
      expect(
        requireRecipe(id).reagents.map((g) => [g.itemId, g.count]),
        `${id} carries the uniform fish row`,
      ).toContainEqual(['raw_deepbarb_catfish', 4]);
    }
  });

  it('the three flask bills stay BYTE-IDENTICAL to each other', () => {
    // The other half of the amendment, and the reason it is scoped by family:
    // the flask chain is daily-gated through recipe_quickening_catalyst, so a
    // bill difference between the three roles there would be a real gate rather
    // than flavor. Whole bills, produce included, unlike the plates above.
    const bills = THREE_FLASKS.map((id) =>
      requireRecipe(id).reagents.map((g) => [g.itemId, g.count]),
    );
    expect(bills[1], 'warboar vs ironhusk').toEqual(bills[0]);
    expect(bills[2], 'runewater vs ironhusk').toEqual(bills[0]);
    // EXACT, not a floor: the value is knowable and the order column one arm
    // up already forces a table visit for any change, so a floor here only
    // bought slack. Six entries since this phase added the grain.
    expect(bills[0].length, 'the shared flask bill').toBe(6);
    // The daily gate really is what makes the family uniform, so pin the fact
    // the reasoning rests on rather than restating the reasoning.
    expect(
      requireRecipe('recipe_quickening_catalyst').oncePerDay,
      'the flask chain is daily-gated transitively through the catalyst',
    ).toBe(true);
    for (const id of THREE_FLASKS) {
      expect(
        requireRecipe(id).reagents.some((g) => g.itemId === 'quickening_catalyst'),
        `${id} pays a catalyst-day`,
      ).toBe(true);
    }
  });

  it('THE COST SPREAD ACROSS THE FOOD FAMILY IS ZERO, derived and pinned', () => {
    // GATE A requires the differentiation to be flavor and never cost, and pins
    // the spread so a later retune cannot widen it. Derived from the live bills
    // on the economy basis, never typed: each plate's crop row is worth exactly
    // 30 copper because every tier-3 base crop carries sellValue 15 and no
    // buyValue, so all three plates land on the same input value.
    const added = THREE_PLATES.map((id) => addedProduceValue(requireRecipe(id)));
    expect(new Set(added).size, 'the three added crop rows must be worth the same').toBe(1);
    expect(added[0], 'the value of one plate crop row').toBe(30);
    expect(Math.max(...added) - Math.min(...added), 'THE COST SPREAD').toBe(0);
    const inputs = THREE_PLATES.map((id) => inputValue(requireRecipe(id)));
    expect(new Set(inputs).size, 'so the three plates cost the same to craft').toBe(1);
    // 508 since masterwrought Phase 11i, and the SPREAD is what this gate is
    // about rather than the level: the fish row is the SAME id at the SAME
    // count on all three plates, so it raises every input by an identical 56
    // and leaves the spread at zero. A fish row that differed by plate would
    // red the Set size above, which is the assertion that actually carries
    // GATE A; this literal is its non-vacuity sibling.
    expect(inputs[0]).toBe(508);
    // DERIVED, not two literals. `508 - 452` against `4 * 14` was 56 === 56,
    // unfailable, and worse it would have stayed green while becoming false if
    // the catfish sellValue ever moved. Reading the count off the live bill and
    // the unit value off the live item makes the same claim decisively.
    const fishRow = requireRecipe(THREE_PLATES[0]).reagents.find(
      (g) => g.itemId === 'raw_deepbarb_catfish',
    );
    expect(fishRow, "11i's fish row is on the plate").toBeDefined();
    expect(508 - fishRow!.count * reagentUnitValue(fishRow!.itemId)).toBe(452);
  });

  it('and the WALL-CLOCK spread is 12.5 percent, the honest half of the same gate', () => {
    // GATE A rules on summed VALUE and the arm above is that half. The record
    // beside it (src/sim/content/recipes.ts, and the packet ledger) also states
    // a growth-timer spread and says it is "recorded and pinned beside the
    // copper one" -- and until the Phase 11h QA nothing pinned it, in this file
    // or anywhere: no arm in the phase read durationMs at all. That is the
    // overclaim class this phase's own review round swept eight times, so the
    // sentence is made true here rather than struck.
    //
    // RESOLVED BACK THROUGH THE LIVE BILL, never off a crop-id literal: the
    // claim is about the three crops the three PLATES actually name, so
    // swapping a plate's crop for another tier-3 one moves this arm even though
    // the copper spread would not budge.
    const durations = THREE_PLATES.map((id) => {
      const entry = requireRecipe(id).reagents.find((g) => PRODUCE_IDS.has(g.itemId));
      const crop = Object.values(FARM_CROPS).find((c) => c.produceItemId === entry?.itemId);
      if (!crop) throw new Error(`${id} crop is not on the roster`);
      return crop.durationMs;
    });
    expect(
      [...durations].sort((a, b) => a - b),
      'the three plate crops grow at',
    ).toEqual([14_400_000, 15_000_000, 16_200_000]);
    // THE THREE LITERALS ARE THE CLAIM: 4h, 4h10m and 4h30m, a 12.5 percent
    // spread from cheapest to dearest (16,200,000 / 14,400,000 = 1.125), and
    // three distinct timers rather than one shared, which is the crop ladder's
    // own composition rule. A ratio assertion and a set-size assertion used to
    // restate both facts beneath this line; the literals fully determine them,
    // so neither could fail independently and both are gone. The figures belong
    // in the sentence a reader reads, not in an assertion that cannot fire.
  });

  it("the amendment's predicate REFUSES the shapes it forbids, and admits 11i's fish row", () => {
    // THE CONTROL FOR THE TWO ARMS ABOVE, and it exists because without one they
    // are sweeps over a shipped table that happens to satisfy them: nothing
    // would prove the shape check can ever say no. Driven through
    // foodFamilyShape, the same expression the arms read, rather than a local
    // re-implementation of it, so an edit to the shape check moves this control
    // with it. (The first version of this arm appended an identical entry to
    // three identical lists and asserted they stayed identical, which is true of
    // any three lists and proved nothing. Kept as a note because that shape is
    // easy to write and reads like coverage.)
    const live = THREE_PLATES.map((id) => requireRecipe(id).reagents);

    // ADMITTED: the shipped table, and the same table with Phase 11i's UNIFORM
    // fish row on all three plates (11i DECISION D). That row is the reason the
    // amendment was scoped to "differ by exactly one CROP row" rather than
    // "differ by exactly one row", so admitting it is the load-bearing case.
    const shipped = foodFamilyShape(live);
    expect(shipped.remaindersEqual, 'the shipped plates').toBe(true);
    expect(shipped.cropRowsPerPlate, 'the shipped plates').toEqual([1, 1, 1]);
    // THE FISH COUNT IS 3, NOT 2, AND THAT IS THE INTERLOCK (Phase 11h QA).
    // The first version of this control appended the carp at count 2 and
    // certified it legal, which was true of the amendment predicate and FALSE
    // of the merged rule set: a plate carrying a fish becomes a member of
    // fishRows() in tests/provisioning_supply_line.test.ts, whose standing arm
    // requires fish to STRICTLY OUTNUMBER produce on a fish dish. Each plate
    // carries its crop at 2, so a carp at 2 ties and reds that sweep. Handing
    // 11i a control that says "your row is legal" at a count the tree refuses
    // is worse than having no control, so the count that ships here is the
    // lowest one that clears BOTH rules, and the fish-forward half is asserted
    // rather than left to the sibling file.
    const FISH_ROW = { itemId: 'raw_stonescale_carp', count: 3 } as const;
    const withFish = foodFamilyShape(live.map((bill) => [...bill, { ...FISH_ROW }]));
    expect(withFish.remaindersEqual, "11i's uniform fish row stays legal").toBe(true);
    expect(withFish.cropRowsPerPlate, 'and does not count as a crop row').toEqual([1, 1, 1]);
    // THE SECOND RULE THE SAME ROW HAS TO CLEAR, driven here so the interlock
    // is a fact about the merged rule set rather than about one predicate.
    //
    // THE LOOP IS THE WHOLE GUARD, and saying so is the point: it is what reds
    // if FISH_ROW.count is walked back to 2, because it puts the count on one
    // side and the LIVE plate produce on the other. A companion assertion used
    // to sit under it claiming to stop that walk-back, and it did nothing of the
    // sort: it hardcoded 2 instead of reading FISH_ROW.count, and the toEqual
    // below already determines the value it read, so it could not fail and
    // would not have caught the thing it named. Deleted rather than reworded.
    //
    // FISH_ROW.count is a LITERAL, not derived: a crop retune reds the toEqual
    // below and the next author raises the count by hand, which is the intended
    // cost. An earlier comment here claimed the count moved with the crop; it
    // does not.
    const plateProduce = live.map((bill) =>
      bill.filter((g) => PRODUCE_IDS.has(g.itemId)).reduce((t, g) => t + g.count, 0),
    );
    expect(plateProduce, 'each plate carries its crop at 2').toEqual([2, 2, 2]);
    for (const produce of plateProduce) {
      expect(
        FISH_ROW.count,
        `a uniform fish row must outnumber the plate's produce ${produce} to stay fish-forward`,
      ).toBeGreaterThan(produce);
    }

    // REFUSED: a fish row on only TWO of the three, which is the mistake 11i
    // could actually make.
    const partialFish = foodFamilyShape([
      [...live[0], { itemId: 'raw_stonescale_carp', count: 2 }],
      [...live[1], { itemId: 'raw_stonescale_carp', count: 2 }],
      [...live[2]],
    ]);
    expect(partialFish.remaindersEqual, 'a row on two plates of three must be refused').toBe(false);

    // REFUSED: a SECOND crop row on one plate, the "open season" reading the
    // amendment was narrowed to prevent.
    const twoCrops = foodFamilyShape([
      [...live[0], { itemId: 'marsh_rice', count: 1 }],
      [...live[1]],
      [...live[2]],
    ]);
    expect(twoCrops.cropRowsPerPlate, 'two crop rows on one plate must be refused').toEqual([
      2, 1, 1,
    ]);
    // The two halves refuse INDEPENDENTLY: the partial-fish case passes the crop
    // count and fails only on the remainder, and the two-crop case passes the
    // remainder (produce is stripped from it) and fails only on the count. So a
    // shape check that had lost either half entirely cannot look healthy.
    expect(partialFish.cropRowsPerPlate, 'the fish case isolates the REMAINDER half').toEqual([
      1, 1, 1,
    ]);
    expect(twoCrops.remaindersEqual, 'the two-crop case isolates the COUNT half').toBe(true);
  });
});

describe('masterwrought Phase 11h GATE B: which crop goes on which plate', () => {
  it('three DISTINCT crop ids, one per plate', () => {
    const crops = THREE_PLATES.map(
      (id) => requireRecipe(id).reagents.find((g) => PRODUCE_IDS.has(g.itemId))?.itemId,
    );
    expect(crops.every((c) => typeof c === 'string')).toBe(true);
    expect(new Set(crops).size, 'the plates must not read off the same crop line').toBe(3);
    expect(crops).toEqual(['frost_gourd', 'highland_barley', 'thornpeak_cabbage']);
  });

  it('the three crops are all tier 3, distinct, and leave the legume unused', () => {
    // The leaf is what 11e's roster composition existed to provide, so it is
    // resolved through the catalog rather than typed: tier 3's four crops are
    // the grain, the gourd, the leaf and the legume, and the plates take three
    // of them. Asserting the TIER (from the shipped roster) plus distinctness is
    // what a test can check; the plant-class mapping is named in the recipe
    // comments where a reader meets the bill.
    const tierOf = (produceId: string): number | undefined =>
      Object.values(FARM_CROPS).find((c) => c.produceItemId === produceId)?.tier;
    for (const id of THREE_PLATES) {
      const crop = requireRecipe(id).reagents.find((g) => PRODUCE_IDS.has(g.itemId));
      expect(tierOf(crop?.itemId ?? ''), `${id} takes a tier-3 crop`).toBe(3);
    }
    // The legume is the one tier-3 crop NO plate took, which is the negative
    // half: without it, a change handing two plates the same tier would still
    // read as "three distinct tier-3 crops".
    const tierThree = Object.values(FARM_CROPS)
      .filter((c) => c.tier === 3)
      .map((c) => c.produceItemId);
    expect(tierThree.length, 'tier 3 must carry four crops').toBe(4);
    const taken = new Set(
      THREE_PLATES.map(
        (id) => requireRecipe(id).reagents.find((g) => PRODUCE_IDS.has(g.itemId))?.itemId,
      ),
    );
    expect(
      tierThree.filter((c) => !taken.has(c)),
      'the crop left over',
    ).toEqual(['frost_lentils']);
  });

  it('all three ask farming 50 and nothing else, so a role choice is not a gate choice', () => {
    // DERIVED BY CALLING farmCropSkillThreshold, never by re-typing its
    // (tier - 1) * 25 arithmetic: a re-typed copy compared against itself is a
    // constant self-comparison and would pass even if the band math moved.
    const gates = THREE_PLATES.map((id) => {
      const crop = requireRecipe(id).reagents.find((g) => PRODUCE_IDS.has(g.itemId));
      const def = Object.values(FARM_CROPS).find((c) => c.produceItemId === crop?.itemId);
      if (!def) throw new Error(`${id} crop is not on the roster`);
      return farmCropSkillThreshold(def.tier);
    });
    expect(new Set(gates).size, 'one gate for all three plates').toBe(1);
    expect(gates[0], 'farming 50').toBe(50);
    // And the gate is reachable rather than merely small, which is the claim
    // that matters and is NOT implied by the line above: it is the SHIPPED
    // farming cap this is measured against, read from the profession table.
    expect(gates[0], 'the plate gate must sit under the shipped farming cap').toBeLessThan(
      GATHERING_PROFESSIONS.farming.maxSkill,
    );
  });
});

describe('masterwrought Phase 11h GATE C: the flask crop', () => {
  it('one tier-3 GRAIN, identical on all three flask bills', () => {
    for (const id of THREE_FLASKS) {
      const produce = requireRecipe(id).reagents.filter((g) => PRODUCE_IDS.has(g.itemId));
      expect(produce.length, `${id} takes exactly one crop row`).toBe(1);
      expect(produce[0].itemId, `${id} crop`).toBe('highland_barley');
      expect(produce[0].count, `${id} crop count`).toBe(1);
    }
    const def = Object.values(FARM_CROPS).find((c) => c.produceItemId === 'highland_barley');
    expect(def?.tier, 'the flask grain is tier 3').toBe(3);
    expect(farmCropSkillThreshold(def?.tier ?? 0), 'gated at farming 50').toBe(50);
  });

  it('sunpetal_herb did NOT move on any flask bill: added, never substituted', () => {
    // masterwrought R18 and farming D24, and GATE C calls this the single most
    // checkable line in the phase. The BEFORE value is the shipped Phase 10
    // count, stated as a literal because it predates this phase and nothing in
    // the merged tree can re-derive it.
    for (const id of THREE_FLASKS) {
      const herb = requireRecipe(id).reagents.find((g) => g.itemId === 'sunpetal_herb');
      expect(herb?.count, `${id} sunpetal_herb before and after: 2`).toBe(2);
    }
    // The whole herb line, not only the flasks' own rows: a reduction paid for
    // elsewhere in alchemy would keep the three counts above at 2.
    //
    // PER RECIPE, NOT ONE TOTAL, and this is the fishing-line lesson applied one
    // craft over: sixteen alchemy rows under a single number is an aggregate a
    // COMPENSATING move keeps green (cut the sunpetal draught's silverleaf by
    // two and pay for it on the growth tonic and the sum is still 44). Eight of
    // the sixteen are pinned per row elsewhere in this file and in the economy
    // suite; the other eight were the exploitable half until now. The map and
    // the total check each other so neither can drift alone.
    const alchemyHerbPerRecipe: Record<string, number> = {
      recipe_elixir_of_the_boar: 2,
      recipe_elixir_of_the_serpent: 1,
      recipe_goldleaf_healing_draught: 4,
      recipe_goldleaf_mana_draught: 2,
      recipe_grand_cauldron: 6,
      recipe_growth_tonic: 2,
      // Masterwrought phase 11l: the trophy consumer recipe_lesser_healing_potion
      // (tallow trophy plus goldleaf and a vial; re-picked by the 11l QA from
      // the 320 HP potion, the bill unchanged) joined alchemy's herb line.
      recipe_lesser_healing_potion: 1,
      recipe_ironhusk_flask: 2,
      recipe_minor_healing_potion: 2,
      recipe_quickening_catalyst: 3,
      recipe_runewater_flask: 2,
      recipe_silverleaf_healing_draught: 4,
      recipe_silverleaf_mana_draught: 3,
      recipe_sunpetal_healing_draught: 5,
      recipe_sunpetal_mana_draught: 3,
      recipe_venomfire_elixir: 1,
      recipe_warboar_flask: 2,
    };
    const liveAlchemyHerb: Record<string, number> = {};
    for (const recipe of ALL_RECIPES) {
      if (recipe.professionId !== 'alchemy') continue;
      const n = recipe.reagents
        .filter((g) => g.itemId.endsWith('_herb') && !g.itemId.startsWith('fine_'))
        .reduce((t, g) => t + g.count, 0);
      if (n > 0) liveAlchemyHerb[recipe.id] = n;
    }
    expect(liveAlchemyHerb, "alchemy's herb demand, per row").toEqual(alchemyHerbPerRecipe);
    // 44 was a MEASUREMENT of the merged table, taken here rather than
    // predicted: 11h adds no herb anywhere, so the number it pinned is
    // whatever shipped, and the three global herb totals in
    // tests/provisioning_supply_line.test.ts (28 / 27 / 39 then, green and
    // unmoved by 11h) were the independent evidence. 45 since Masterwrought
    // phase 11l, whose trophy row recipe_lesser_healing_potion (re-picked by
    // the 11l QA from recipe_healing_potion) added goldleaf 1 (a
    // pure addition, so R18's no-reduction direction still holds).
    expect(
      Object.values(alchemyHerbPerRecipe).reduce((t, n) => t + n, 0),
      "alchemy's whole herb demand",
    ).toBe(45);
  });

  it('every apex alchemy row that took a crop still consumes an herb', () => {
    // The displacement guardrail stated over the rows this phase added, so a
    // later edit that swapped a herb out for the grain reds here as well as in
    // tests/farm_seed_channels.test.ts.
    for (const id of [...THREE_FLASKS, 'recipe_grand_cauldron']) {
      const recipe = requireRecipe(id);
      expect(
        recipe.reagents.some((g) => g.itemId.endsWith('_herb') && !g.itemId.startsWith('fine_')),
        `${id} took farm output without keeping an herb`,
      ).toBe(true);
    }
  });
});

describe('masterwrought Phase 11h GATE D: the capstones and the tier-4 fine twins', () => {
  it('each capstone takes ONE tier-4 showcase crop and its own fine twin', () => {
    const expected: Record<string, [string, string]> = {
      recipe_grand_cauldron: ['gilded_sunmelon', 'fine_gilded_sunmelon'],
      recipe_laden_hearth: ['evergarden_greens', 'fine_evergarden_greens'],
    };
    for (const id of TWO_CAPSTONES) {
      const recipe = requireRecipe(id);
      const [base, fine] = expected[id];
      expect(recipe.reagents.find((g) => g.itemId === base)?.count, `${id} base`).toBe(2);
      expect(recipe.reagents.find((g) => g.itemId === fine)?.count, `${id} fine twin`).toBe(1);
      // ONE crop FAMILY per capstone, so the two do not read off the same line
      // and neither turns into a produce shopping list.
      const families = new Set(
        recipe.reagents
          .filter((g) => PRODUCE_IDS.has(g.itemId))
          .map(
            (g) =>
              Object.values(FARM_CROPS).find(
                (c) => c.produceItemId === g.itemId || c.fineProduceItemId === g.itemId,
              )?.id,
          ),
      );
      expect(families.size, `${id} takes one crop family`).toBe(1);
    }
    // SPLIT, not shared: the two capstones must not name the same crop.
    const cauldron = new Set(
      requireRecipe('recipe_grand_cauldron')
        .reagents.filter((g) => PRODUCE_IDS.has(g.itemId))
        .map((g) => g.itemId),
    );
    const hearth = requireRecipe('recipe_laden_hearth')
      .reagents.filter((g) => PRODUCE_IDS.has(g.itemId))
      .map((g) => g.itemId);
    expect(
      hearth.filter((id) => cauldron.has(id)),
      'the two capstones share no crop',
    ).toEqual([]);
  });

  it('BOTH tier-4 fine twins now have a consumer at skillReq 125, the top consumable rung', () => {
    // The masterwrought R20 shape this gate exists to close. Before this phase
    // each twin was consumed by exactly one recipe, farming's own tier-4 dish
    // at cooking 100, so every consumer the twins had was one farming wrote.
    //
    // STATED THAT WAY ON PURPOSE (Phase 11h QA). The earlier wording here read
    // "the tier-4 twins had no endgame consumer at all", which is false under
    // this repo's own definition: tests/farm_recipes.test.ts calls a bill
    // ENDGAME at skillReq >= 75, and both tier-4 dishes sit at cooking 100, so
    // they were endgame consumers already. What the twins lacked was a consumer
    // OUTSIDE farming, and a consumer at the top consumable rung.
    //
    // AND 125 IS NOT THE CATALOG CEILING, which four comments in this phase
    // claimed. ALL_RECIPES ships three engineering rows at skillReq 150 (the
    // apex gathering-tool family, which the phase file itself records as Phase
    // 11j's), and the packet's own rung census says so: "3 at 125, 3 at 150".
    // 125 is the top of COOKING and ALCHEMY, which is the claim that matters
    // here and the one this arm actually proves.
    const capstoneOf: Record<string, string> = {
      fine_gilded_sunmelon: 'recipe_grand_cauldron',
      fine_evergarden_greens: 'recipe_laden_hearth',
    };
    // THE COUNTS DIVERGED AT masterwrought Phase 11j, which is why they are per
    // twin now rather than one shared 2. The apex hoe consumes
    // fine_evergarden_greens, so that twin gained a THIRD consumer while the
    // sunmelon kept its two.
    // UNMOVED AT masterwrought Phase 11k, and that is a derived outcome rather
    // than an omission: the apex feast tier's bill takes the BASE crop, not a
    // fine twin, because RULE 2's value half puts a 320-buyValue twin above any
    // plausible non-produce reference on a fish row (only recipe_laden_hearth
    // reaches it, and it TIES). The claim 11h's gate actually makes is
    // untouched: each twin still has its own capstone at the 125 rung, which is
    // the ID pin below and the thing a count alone never proved.
    const expectedConsumers: Record<string, number> = {
      fine_gilded_sunmelon: 2,
      fine_evergarden_greens: 3,
    };
    for (const twin of ['fine_gilded_sunmelon', 'fine_evergarden_greens']) {
      const consumers = ALL_RECIPES.filter((r) => r.reagents.some((g) => g.itemId === twin));
      expect(consumers.length, `${twin} consumers`).toBe(expectedConsumers[twin]);
      // The ID, not merely the count: a length pin stays green if the two twins
      // swap capstones, which is exactly the split this gate rules on. Scoped to
      // the CONSUMABLE crafts, because 11j's apex hoe is an engineering row at
      // the same 125 rung and would otherwise join this list.
      // Scoped by MEMBERSHIP in the apex consumable set rather than by a
      // hardcoded craft allowlist: the concept is "the consumable capstones",
      // and a capstone authored under a third craft would drift out of a
      // profession list while staying in the set it belongs to. 11j's apex hoe
      // is an engineering TOOL at the same 125 rung, excluded for that reason.
      //
      // AND NAME WHAT THE NARROWING GIVES UP (masterwrought Phase 11j QA), so
      // it is not read as free: a NON-capstone 125-rung consumer of either twin
      // is now invisible to this line. The count pin above covers most of that,
      // since it counts consumers at EVERY rung against a literal, so a new
      // consumer of either twin reds there. What survives both is swapping one
      // non-capstone consumer for another non-capstone consumer at the same
      // count. That is outside this gate's claim, which is about the capstones,
      // and it is recorded rather than described as covered.
      // AND masterwrought Phase 11k's three apex feasts do NOT appear here,
      // which is worth stating because they ARE apex-consumable rows at exactly
      // this rung: their bill takes the BASE crop rather than a fine twin, so
      // the station capstones remain the twins' only 125-rung consumers and
      // this exact-id assertion still discriminates.
      const apexConsumableIds = new Set(APEX_CONSUMABLE_RECIPES.map((r) => r.id));
      expect(
        consumers.filter((r) => r.skillReq >= 125 && apexConsumableIds.has(r.id)).map((r) => r.id),
        `${twin} must have its own capstone consumer at the 125 rung`,
      ).toEqual([capstoneOf[twin]]);
    }
    // The tier is derived, not assumed: both twins really are tier 4.
    for (const twin of ['fine_gilded_sunmelon', 'fine_evergarden_greens']) {
      const def = Object.values(FARM_CROPS).find((c) => c.fineProduceItemId === twin);
      expect(def?.tier, `${twin} tier`).toBe(4);
      expect(farmCropSkillThreshold(def?.tier ?? 0), `${twin} gate`).toBe(75);
    }
    // THE SUPERLATIVE, SCOPED AND DERIVED rather than asserted in prose, which
    // is what the four "top of the whole catalog" comments were missing. Both
    // halves are stated: 125 really is the ceiling for cooking and alchemy, and
    // it really is NOT the ceiling for the table, so neither claim can rot into
    // the other. A phase that adds a cooking or alchemy row above 125 visits
    // the first line; Phase 11j's 150 rung is already covered by the second.
    const rungsFor = (craft: string) =>
      ALL_RECIPES.filter((r) => r.professionId === craft).map((r) => r.skillReq);
    expect(Math.max(...rungsFor('cooking')), 'the top cooking rung').toBe(125);
    expect(Math.max(...rungsFor('alchemy')), 'the top alchemy rung').toBe(125);
    expect(
      Math.max(...ALL_RECIPES.map((r) => r.skillReq)),
      'and 125 is NOT the catalog ceiling: the apex tool family ships at 150',
    ).toBe(150);
  });

  it('the hoe twins are NOT what this phase consumed, so nothing is double-booked', () => {
    // The reading tests/farm_recipes.test.ts's hoe-twin arm rests on, recorded
    // here rather than relied on by accident: that arm asserts the hoe twins
    // get no FARM DISH slot, and this phase puts TIER-4 twins into
    // APEX_CONSUMABLE_RECIPES rows, which are neither hoe twins nor farm
    // dishes. It neither trips nor should.
    //
    // AMENDED at masterwrought Phase 11j, which added the apex hoe and so
    // added a FOURTH hoe twin. BE PRECISE ABOUT WHAT THAT BROKE, because an
    // earlier draft of this comment got it backwards and claimed 11h's rows
    // were untouched: they are not. `recipe_laden_hearth` IS an
    // APEX_CONSUMABLE row and it DOES consume fine_evergarden_greens, which
    // the apex rung promoted into this set, so the old "no apex row consumes a
    // hoe twin" sweep is genuinely FALSIFIED rather than merely re-scoped.
    // That is why it is retired below rather than re-pinned, and the same
    // collision retired the exclusivity clause in farm_recipes: the apex rung
    // consumes a TIER-4 twin under the ladder's one-tier-below invariant, and
    // 11h had already given every tier-4 twin a consumer, so no unbooked twin
    // existed for it to take.
    const hoeTwins = new Set(
      ALL_RECIPES.filter((r) => r.resultItemId.endsWith('_hoe')).flatMap((r) =>
        r.reagents.filter((g) => PRODUCE_IDS.has(g.itemId)).map((g) => g.itemId),
      ),
    );
    expect([...hoeTwins].sort(), 'the hoe ladder still takes exactly these').toEqual([
      'fine_evergarden_greens',
      'fine_highland_barley',
      'fine_marsh_rice',
      'fine_vale_wheat',
    ]);
    // THE NO-OVERLAP SWEEP IS RETIRED, and its reason went with the arm it was
    // defending. It used to assert no APEX_CONSUMABLE row consumes a hoe twin,
    // which existed only to show 11h's rows did not trip the twin-EXCLUSIVITY
    // clause in tests/farm_recipes.test.ts. masterwrought Phase 11j retired
    // that clause (its apex rung consumes a tier-4 twin under the hoe ladder's
    // one-tier-below invariant, and 11h had already given every tier-4 twin a
    // consumer, so no unbooked twin existed), and with it the overlap stopped
    // being a hazard to defend against. Keeping the sweep would now assert that
    // 11j may not exist.
    //
    // WHAT 11h ACTUALLY DID is pinned instead, which is the durable claim and
    // is unaffected by anything 11j added: its apex rows consume exactly the
    // two tier-4 twins it chose, one per capstone. That is the gate's real
    // content, and it reds if a later phase re-points either capstone.
    const apexTwins = new Set(
      APEX_ROWS.flatMap((row) =>
        requireRecipe(row.id)
          .reagents.filter((g) => PRODUCE_IDS.has(g.itemId))
          .map((g) => g.itemId),
      ),
    );
    expect(
      [...apexTwins].filter((id) => id.startsWith('fine_')).sort(),
      "11h's capstones take exactly these two tier-4 twins",
    ).toEqual(['fine_evergarden_greens', 'fine_gilded_sunmelon']);
    // THE OCCURRENCE BOUND OVER THE WHOLE TABLE (Phase 11h QA), re-scoped at
    // masterwrought Phase 11j rather than deleted. It was written because the
    // two arms carrying the exclusivity claim were both narrow (farm_recipes
    // checks FARM DISHES, the loop above checked APEX_CONSUMABLE_RECIPES), so
    // the trainer ladder, the intermediates and every future bill sat outside
    // both, and 11h was the first phase to put a tier-4 twin in a bill farming
    // did not write.
    //
    // EXCLUSIVITY IS GONE AND THE BOUND SURVIVES IT. 11j's apex hoe consumes
    // fine_evergarden_greens, which 11h had already given a capstone, so "a hoe
    // twin is consumed by the hoe ladder and nothing else" is now false and
    // cannot be made true without re-pointing one of the two phases' bills.
    // What the arm still does, and what it was really for, is refuse a SILENT
    // third consumer: the non-hoe consumers of a hoe twin are enumerated
    // exactly, so a later bill quietly reaching for one reds here with its own
    // id named.
    const hoeTwinConsumers = ALL_RECIPES.filter((r) =>
      r.reagents.some((g) => hoeTwins.has(g.itemId)),
    ).map((r) => r.id);
    // THE ARM'S SUBJECT MOVED, not just its expected value, and that is worth
    // stating: recipe_evergarden_harvest_platter is a PRE-11j cooking row that
    // became a non-hoe consumer of a hoe twin only because the apex rung grew
    // the hoeTwins set underneath it. Neither row was edited by any phase; the
    // set they are measured against was.
    expect(
      hoeTwinConsumers.filter((id) => !requireRecipe(id).resultItemId.endsWith('_hoe')).sort(),
      'exactly these non-hoe bills may consume a hoe twin, and no others',
    ).toEqual(['recipe_evergarden_harvest_platter', 'recipe_laden_hearth']);
    // Positive control: the sweep must actually SEE the ladder, or the pin
    // above is satisfied by a matcher that finds nothing anywhere. FOUR hoe
    // rungs consume a twin since 11j added the apex.
    expect(
      hoeTwinConsumers.filter((id) => requireRecipe(id).resultItemId.endsWith('_hoe')).length,
      'and the hoe ladder really is matched',
    ).toBe(4);
  });
});

describe('masterwrought Phase 11h: obtainability, derived rather than argued', () => {
  it('every crop this phase names is planted at or below the rung its recipe unlocks', () => {
    // masterwrought R17 RULE 1 restated over THIS phase's rows. The sweep in
    // tests/provisioning_supply_line.test.ts covers the whole table; this one
    // fails with the row name when a Phase 11h bill is the one that broke it,
    // and it counts what it checked so a table that lost its produce cannot
    // pass by sweeping nothing.
    let checked = 0;
    for (const row of APEX_ROWS) {
      const recipe = requireRecipe(row.id);
      for (const reagent of recipe.reagents) {
        const crop = Object.values(FARM_CROPS).find(
          (c) => c.produceItemId === reagent.itemId || c.fineProduceItemId === reagent.itemId,
        );
        if (!crop) continue;
        checked += 1;
        expect(
          farmCropSkillThreshold(crop.tier),
          `${row.id} takes ${reagent.itemId} (tier ${crop.tier}) at skillReq ${recipe.skillReq}`,
        ).toBeLessThanOrEqual(recipe.skillReq);
      }
    }
    expect(checked, 'this phase authored ten produce entries across eight rows').toBe(10);
  });

  it('and the plant path has a THIRD gate the threshold alone cannot see: the hoe', () => {
    // ADDED AT THE PHASE 11h QA, because the sweep above and the seed sweep
    // below prove two of the three gates the shipped plant path runs and the
    // third is the binding one. src/sim/professions/farming.ts step 12 calls
    // bestWieldableGatherToolTierOrNone(inventory, 'farming', skill, ITEMS) and
    // then canGatherTier(hoeTier, crop.tier), and that scan DROPS any hoe whose
    // wield requirement exceeds the player's own farming counter. So the real
    // floor for a crop is max(farmCropSkillThreshold(tier),
    // wieldRequirementForTier(tier)), which is the composition the repo already
    // states in tests/farming_plant_sheet_view.test.ts.
    //
    // WHY IT MATTERS TO THIS PHASE rather than to farming: the numbers are 70
    // for tier 3 and 85 for tier 4, not 50 and 75, and this phase shipped
    // player-facing wiki prose saying the plate crops "ask Farming 50 and
    // nothing more". That sentence is corrected in the same change; this arm is
    // what stops the next one being written.
    // EVERY NUMBER HERE IS A LITERAL, and that is the whole design of the arm.
    // The first version read `expect(wieldRequirementForTier(3)).toBe(
    // TIER3_TOOL_WIELD_PROFICIENCY)`, which is the constant compared against
    // itself: the resolver RETURNS that constant, so editing it moved both
    // sides and the arm survived its own mutation (proven, not assumed: the
    // Phase 11h QA ran 70 to 50 and the file stayed green). The literals are
    // what make a retune visit this file, and the exported constants are
    // asserted against the same literals so a renamed or re-pointed resolver
    // cannot drift away from them either.
    expect(TIER3_TOOL_WIELD_PROFICIENCY, 'the tier-3 hoe wield rung').toBe(70);
    expect(TIER4_TOOL_WIELD_PROFICIENCY, 'the tier-4 hoe wield rung').toBe(85);
    for (const [tier, threshold, wield] of [
      [3, 50, 70],
      [4, 75, 85],
    ] as const) {
      expect(farmCropSkillThreshold(tier), `tier ${tier} plant threshold`).toBe(threshold);
      expect(wieldRequirementForTier(tier), `tier ${tier} hoe wield requirement`).toBe(wield);
      // The gate that actually binds is the HOE, not the threshold, and that is
      // the claim the corrected wiki copy rests on. PRODUCTION ON BOTH SIDES:
      // the first repair of this arm put the tuple's own literals on both sides
      // here (`expect(wield).toBeGreaterThan(threshold)` reduces to
      // `expect(70).toBeGreaterThan(50)`), which is the second dead assertion
      // this one arm has produced. It reads the two resolvers instead, so
      // moving either one moves exactly one side. The redundant Math.max form
      // that sat beside it is gone: the two pins above already determine it.
      expect(
        wieldRequirementForTier(tier),
        `tier ${tier}: the hoe rung must bind, not the plant threshold`,
      ).toBeGreaterThan(farmCropSkillThreshold(tier));
    }
    // And both floors still sit under the shipped farming cap, so the crops
    // this phase names stay reachable rather than merely dearer.
    expect(
      wieldRequirementForTier(4),
      'the tier-4 floor must sit under the farming cap',
    ).toBeLessThanOrEqual(GATHERING_PROFESSIONS.farming.maxSkill);
  });

  it('and every seed those crops need is stocked by a live vendor row', () => {
    // The half a threshold cannot prove: a crop gated at farming 50 that no
    // counter seeds is not a reagent, it is a wall. Read off the merged NPC
    // tables through the shipped catalog rather than a ledger claim.
    const seedFor = (produceId: string): string => {
      const crop = Object.values(FARM_CROPS).find(
        (c) => c.produceItemId === produceId || c.fineProduceItemId === produceId,
      );
      if (!crop) throw new Error(`${produceId} is not on the crop roster`);
      return crop.seedItemId;
    };
    const stocked = new Set<string>();
    for (const npc of Object.values(NPCS)) {
      for (const id of npc.vendorItems ?? []) stocked.add(id);
    }
    expect(stocked.size, 'the live vendor surface').toBeGreaterThan(20);
    // Live bills again, for the same reason as the hoe sweep above.
    for (const row of APEX_ROWS) {
      for (const reagent of requireRecipe(row.id).reagents) {
        if (!PRODUCE_IDS.has(reagent.itemId)) continue;
        const produceId = reagent.itemId;
        const seed = seedFor(produceId);
        expect(
          stocked.has(seed),
          `${row.id} needs ${produceId}, whose seed ${seed} is unstocked`,
        ).toBe(true);
        // A stocked row without a positive buyValue renders and then refuses,
        // which is farming's D11 trap and would make the faucet a lie.
        expect(ITEMS[seed]?.buyValue ?? 0, `${seed} buyValue`).toBeGreaterThan(0);
      }
    }
  });
});

describe('masterwrought Phase 11h: the arithmetic above every row', () => {
  it('every touched row is gold-negative and its margin WIDENED', () => {
    // Adding a reagent raises inputValue and cannot touch outputValue, which is
    // resultCount times the output def's sellValue, and this phase changed no
    // output def and no resultCount. Re-derived anyway, and the BEFORE value is
    // recomputed as (input now - the added produce) rather than carried, so the
    // literal in the table and the live bill check each other.
    for (const row of APEX_ROWS) {
      const recipe = requireRecipe(row.id);
      const after = inputValue(recipe);
      const added = addedProduceValue(recipe);
      // 11i's fish row is NOT produce, so addedProduceValue cannot see it and
      // `after - added` would no longer reach 11h's before-value on the four
      // rows it touched. Subtract the 11i column too, from the table rather
      // than from the bill, so 11h's two literals still check each other
      // against the live row.
      const fishValue = row.fish.reduce((sum, [id, n]) => sum + reagentUnitValue(id) * n, 0);
      const before = after - added - fishValue;
      expect(after, `${row.id} input after`).toBe(row.inputAfter11i);
      expect(row.inputAfter11i - row.inputAfter, `${row.id} 11i delta`).toBe(fishValue);
      expect(before, `${row.id} input before`).toBe(row.inputBefore);
      expect(outputValue(recipe), `${row.id} output`).toBe(row.output);
      expect(after, `${row.id}: output ${row.output} vs input ${after}`).toBeGreaterThan(
        row.output,
      );
      // THE MARGIN DELTA IS ALREADY PINNED by the two assertions above, and
      // saying it a third time cannot fail (Phase 11h QA). This arm used to
      // carry `expect(row.inputAfter - row.inputBefore).toBe(added)`, moved off
      // `before` and onto the table's two literals to escape an algebraic
      // identity. It did not escape one: line 2 pins `after === inputAfter` and
      // line 3 pins `after - added === inputBefore`, so inputAfter - inputBefore
      // reduces to `added` identically whenever both pass, and vitest aborts
      // the arm at the first failing expect so it can never run against a
      // broken pair. What actually pins the added produce's economy value is
      // the inputBefore assertion above: reprice a crop and `before` moves off
      // its literal. The dead line is gone rather than reworded, because a
      // comment explaining why an unfalsifiable assertion is really falsifiable
      // is the exact shape this phase's own review round retired three times.
      expect(added, `${row.id} must actually have added something`).toBeGreaterThan(0);
    }
  });

  it('and nothing on the OUTPUT side moved anywhere in this phase (masterwrought R5)', () => {
    // R5 measures the full kit's throughput, so an input-cost change cannot
    // reach it. Stated as an assertion rather than a claim: the kit is still
    // flask 15 plus food 6, exactly the number Phase 15 was authored against.
    for (const row of APEX_ROWS) {
      const recipe = requireRecipe(row.id);
      const def = ITEMS[recipe.resultItemId];
      expect(def, `${row.id} output def`).toBeDefined();
      expect(def.slot, `${row.id} must not output an equippable`).toBeUndefined();
    }
    // The two numbers R5 is measured against: flask 15 plus food 6 equals 21
    // stamina, exactly what Phase 15 was authored on. Pinned per row so a
    // magnitude change on any one of the six is a red HERE, in the phase that
    // must not have moved it, and not only in the budget suite.
    for (const id of ['ironhusk_flask', 'warboar_flask', 'runewater_flask']) {
      const flask = flaskDef(id);
      expect(flask.elixir?.value, `${id} flask magnitude`).toBe(15);
      expect(flask.elixir?.duration, `${id} flask duration`).toBe(1200);
    }
    for (const id of ['stonepot_stew', 'warspice_skewers', 'sageleaf_chowder']) {
      const food = foodDef(id);
      expect(ITEMS[id]?.sellValue, `${id} sellValue`).toBe(90);
      expect(food.foodHp, `${id} foodHp`).toBe(1392);
      expect(food.wellFed?.value, `${id} Well Fed magnitude`).toBe(6);
      expect(food.wellFed?.duration, `${id} Well Fed duration`).toBe(900);
    }
    for (const id of ['grand_cauldron', 'laden_hearth']) {
      expect(ITEMS[id]?.sellValue, `${id} sellValue`).toBe(380);
    }
    for (const id of ['ironhusk_flask', 'warboar_flask', 'runewater_flask']) {
      expect(ITEMS[id]?.sellValue, `${id} sellValue`).toBe(25);
    }
    for (const row of APEX_ROWS) {
      const recipe = requireRecipe(row.id);
      expect(recipe.itemLevelBudget, `${row.id} itemLevelBudget`).toBe(25);
      expect(recipe.acquisition, `${row.id} acquisition`).toEqual(['drop']);
    }
  });
});

describe('masterwrought Phase 11h: what it did NOT touch', () => {
  it('recipe_seasoned_stock is 11g DECISION C exactly, and this phase edited it for nothing', () => {
    // The 75 rung is VERIFY ONLY (11h-GATE-F). The bill is taken as given and
    // the arithmetic above it is re-derived from the merged table rather than
    // from any plan doc.
    const stock = requireRecipe('recipe_seasoned_stock');
    expect(stock.reagents.map((g) => [g.itemId, g.count])).toEqual([
      ['prime_cut', 1],
      ['game_meat', 3],
      ['marsh_rice', 2],
      ['bog_beet', 2],
      ['cooking_salt', 2],
      ['quickening_catalyst', 1],
    ]);
    expect(inputValue(stock), 'the merged stock input, re-derived').toBe(130);
    expect(outputValue(stock), 'against an output of').toBe(30);
    // What the rungs above inherit from it: the stock is 30 of every plate's
    // 452 and 90 of the hearth's 1006, so 11g's edit moved the plates' input by
    // nothing at all (it changed the stock's own bill, not its sellValue).
    expect(reagentUnitValue('seasoned_stock'), 'the stock prices into its consumers at').toBe(30);
    const consumers = ALL_RECIPES.filter((r) =>
      r.reagents.some((g) => g.itemId === 'seasoned_stock'),
    ).map((r) => r.id);
    // masterwrought Phase 11i's capstone feast joins the list by taking the
    // stock too, which is the point of the stock: everything in the cooking
    // apex flows through it, and a new apex cooking row that did NOT would be
    // the thing worth noticing here.
    expect(consumers.sort(), 'everything in the cooking apex flows through it').toEqual(
      [
        ...THREE_PLATES,
        'recipe_laden_hearth',
        // masterwrought Phase 11k: the apex feast tier takes the capstone idiom
        // of THREE seasoned_stock, replacing 11i's retired capstone feast (which
        // took two). Every cooking apex row still flows through the
        // intermediate, which is the claim, and it is now true of seven rows.
        'recipe_sageleaf_feast',
        'recipe_stonepot_feast',
        'recipe_warspice_feast',
      ].sort(),
    );
  });

  it('recipe_quickening_catalyst is untouched: the pacing gate takes no produce', () => {
    // The mechanical refusal, restated over this phase's diff. The standing
    // fence is tests/provisioner_firewall.test.ts's; this says THIS phase did
    // not breach it, and says why in the arm rather than only in a ledger:
    // routing produce into the one oncePerDay gate would put a wall-clock-gated
    // input in front of the gate that paces the entire packet.
    const catalyst = requireRecipe('recipe_quickening_catalyst');
    expect(catalyst.oncePerDay, 'the packet pacing gate').toBe(true);
    expect(catalyst.reagents.map((g) => [g.itemId, g.count])).toEqual([
      ['sunpetal_herb', 1],
      ['goldleaf_herb', 2],
      ['venom_gland', 2],
      ['glass_vial', 1],
    ]);
    for (const reagent of catalyst.reagents) {
      expect(PRODUCE_IDS.has(reagent.itemId), `${reagent.itemId} must not pace the gate`).toBe(
        false,
      );
    }
  });

  it('the gear firewall needs no widening: all eight rows sit OUTSIDE the gear chain', () => {
    // masterwrought R17 VERIFIED rather than re-asserted. The derived sweep and
    // its consumable-intermediate carve-out already exist in
    // tests/provisioner_firewall.test.ts and this phase forks neither. What it
    // owes is the proof that its own eight rows are outside the four sources
    // that sweep reads, so the carve-out did not have to widen to admit them.
    const GEAR_WORDS = ['billet', 'plating', 'cording', 'bolt', 'setting', 'chassis'];
    const gearChain = new Set(
      [
        ...INTERMEDIATE_RECIPES,
        ...APEX_ARMOR_RECIPES,
        ...APEX_GEAR_RECIPES,
        ...ALL_RECIPES.filter((r) => GEAR_WORDS.some((w) => r.resultItemId.includes(w))),
      ].map((r) => r.id),
    );
    expect(gearChain.size, 'the gear-chain sweep must be non-empty').toBeGreaterThan(20);
    // THE POSITIVE CONTROL, because APEX_CONSUMABLE_RECIPES is a disjoint array
    // and the negative sweep below is structurally satisfiable by a matcher that
    // recognizes nothing. These four cover one source each: an intermediate, an
    // armor row, a gear row, and a word match.
    expect(gearChain.has('recipe_duskforged_billet'), 'an intermediate').toBe(true);
    expect(gearChain.has('recipe_prismglass_setting'), 'a word match and an intermediate').toBe(
      true,
    );
    expect(
      [...gearChain].some((id) => APEX_ARMOR_RECIPES.some((r) => r.id === id)),
      'an apex armor row',
    ).toBe(true);
    expect(
      [...gearChain].some((id) => APEX_GEAR_RECIPES.some((r) => r.id === id)),
      'an apex gear row',
    ).toBe(true);
    for (const row of APEX_ROWS) {
      expect(gearChain.has(row.id), `${row.id} must not be a gear-chain row`).toBe(false);
    }
    // And no farm id reached a Perfecting material. The shipped constant is the
    // authority: the planning doc names prismglass_setting, which is a GEAR
    // INTERMEDIATE consumed by apex gear bills, not a Perfecting material.
    for (const id of ['wyrmfall_core', 'sundered_essence', 'makers_ember']) {
      expect(ITEMS[id], `${id} must be a real ItemDef`).toBeDefined();
      expect(PRODUCE_IDS.has(id), `${id} must not be farm output`).toBe(false);
    }
    expect(
      ALL_RECIPES.find((r) => r.id === 'recipe_prismglass_setting')?.professionId,
      'prismglass_setting is a gear intermediate, not a Perfecting material',
    ).toBe('jewelcrafting');
  });

  it('this phase minted NOTHING: no recipe row, no item id, no rung moved', () => {
    // The count pins the phase file asks to be ASSERTED unchanged rather than
    // expected. Each lives in its own suite too; naming them here is what makes
    // "no count pin moved" a checked claim in the phase's own file.
    // ELEVEN and 153 since masterwrought Phase 11i, which DID mint rows, then
    // 154 at masterwrought Phase 11j, which minted the apex hoe, then THIRTEEN
    // and 156 at masterwrought Phase 11k, which retired 11i's capstone feast
    // row and minted three apex role feasts in its place (net plus two on both
    // counts). The claim this arm makes is 11h's and it stays 11h's: what it
    // pins is that 11h's own eight rungs never moved (the loop below) and that
    // every id 11h added already existed. The table sizes are re-pinned rather
    // than deleted because their job here is to make a later phase's mint
    // VISIBLE in 11h's own file rather than silent, which is exactly what has
    // now happened three times. The two counts moved TOGETHER at 11k, where
    // 11j moved only ALL_RECIPES: that divergence, and its absence, is itself
    // the record of what kind of row each later phase added. Then 164 at
    // Masterwrought phase 11l, which minted the eight trophy consumer rows:
    // ALL_RECIPES alone moved again (no apex row, no new item id, every
    // output an already-shipped def). Then 166 at that phase's second review
    // round, which adopted the two already-common leather trophies (ten
    // trophy consumer rows in all), the same shape: ALL_RECIPES alone. Then
    // 165 at that phase's sixth fix round, which output-excluded the chipped
    // tusk and deleted its weaponcrafting row (nine trophy consumer rows):
    // again ALL_RECIPES alone, this time downward. Then 163 at the 11l QA,
    // which excluded the cracked fetish and the bogiron nugget under the same
    // standard and deleted their rows (seven trophy consumer rows):
    // ALL_RECIPES alone, downward again. Then 165 at masterwrought Phase
    // 11o, which minted the two engineering on-ramp rows (the skill-0
    // cogwheel and the skill-25 ocular, qr-11o-ENG): ALL_RECIPES alone,
    // upward, with two NEW item ids (the first mint since 11k to add ids).
    expect(APEX_CONSUMABLE_RECIPES).toHaveLength(13);
    expect(INTERMEDIATE_RECIPES).toHaveLength(10);
    expect(ALL_RECIPES).toHaveLength(165);
    for (const row of APEX_ROWS) {
      expect(requireRecipe(row.id).skillReq, `${row.id} rung`).toBe(row.rung);
    }
    // Every reagent this phase added is an id that already shipped, which is the
    // structural reason no art, no M16 fill and no golden row is owed.
    for (const row of APEX_ROWS) {
      for (const [id] of row.produce) {
        expect(ITEMS[id], `${id} must already exist`).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// THE CRAFT ITSELF, DRIVEN THROUGH THE REAL SIM
// ---------------------------------------------------------------------------

/** The craft rig. A SECOND copy of the shape
 *  tests/provisioning_supply_line.test.ts uses, deliberately: the rule of three
 *  says two similar blocks are left alone, and a shared helper here would bind
 *  two phase suites to one fixture for no gain. Reaching into Sim internals is
 *  the established idiom for a craft harness in this tree. */
type CraftHarness = { sim: Sim; pid: number };

function craftRig(recipe: ProfessionRecipeRecord): CraftHarness {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
  const pid = sim.playerId;
  const meta = (sim as unknown as { players: Map<number, Record<string, unknown>> }).players.get(
    pid,
  );
  if (!meta) throw new Error('player meta missing');
  (meta.knownRecipes as Set<string>).add(recipe.id);
  (meta.craftSkills as Record<string, number>)[recipe.professionId] = recipe.skillReq;
  if (recipe.stationType) {
    const station = stationsOfType(STATIONS, recipe.stationType)[0];
    const entity = (
      sim as unknown as { entities: Map<number, Record<string, unknown>> }
    ).entities.get(pid);
    if (!entity) throw new Error('player entity missing');
    entity.pos = { ...(station.pos as Record<string, number>) };
    entity.prevPos = { ...(entity.pos as Record<string, number>) };
  }
  return { sim, pid };
}

const runCraft = (rig: CraftHarness, recipe: ProfessionRecipeRecord) =>
  resolveCraft((rig.sim as unknown as { ctx: never }).ctx, rig.pid, recipe.id);

describe('masterwrought Phase 11h: every apex bill still CRAFTS', () => {
  // Every arm above reads tables. A bill can satisfy all of them and still
  // refuse at the counter, because resolveCraft is what decides whether a
  // reagent list is actually consumable, and this phase changed eight of them.
  // NOT ONE of the eight was crafted by any test in the tree before this file:
  // the collateral sweep found zero hand-granted craft sites for them, so the
  // rows the raid actually eats were the least exercised in the catalog.
  //
  // THE GRANT IS DERIVED FROM THE LIVE REAGENT LIST, which is the point: the two
  // suites Phase 11g had to hand-edit broke precisely because their grants were
  // literals. This one grows with the bill.
  it.each(APEX_ROWS.map((row) => row.id))('%s crafts from its live bill', (recipeId) => {
    const recipe = requireRecipe(recipeId);
    const rig = craftRig(recipe);
    for (const reagent of recipe.reagents) {
      for (let i = 0; i < reagent.count; i++) rig.sim.addItem(reagent.itemId, 1, rig.pid);
    }

    const result = runCraft(rig, recipe);

    expect(result.ok, `${recipe.id} must craft from its own reagent list`).toBe(true);
    expect(rig.sim.countItem(recipe.resultItemId, rig.pid), `${recipe.id} output`).toBe(
      recipe.resultCount,
    );
    // EVERY reagent is drawn on, which is the half that says the produce really
    // entered the bill rather than sitting in it decoratively.
    //
    // THE EXPECTED LEFTOVER IS NOT ZERO, and on these rows it never is: every
    // one sits at skillReq 100 or 125, well past the 75 specialization
    // threshold, so the #1134 discount takes 20 percent off every count. The
    // expectation is DERIVED through requiredReagentCountFor, the same rule the
    // production path applies, rather than assuming a full draw.
    const craftSkills = { [recipe.professionId]: recipe.skillReq };
    for (const reagent of recipe.reagents) {
      const required = requiredReagentCountFor(
        false,
        reagent,
        craftSkills,
        recipe.professionId,
      ).count;
      expect(
        rig.sim.countItem(reagent.itemId, rig.pid),
        `${recipe.id} must consume ${required} of its ${reagent.itemId}`,
      ).toBe(reagent.count - required);
    }
    // AND ONE LEFTOVER PER ROW AGAINST A LITERAL, because the loop above shares
    // requiredReagentCountFor with the production path and would stay green if
    // the #1134 discount itself moved (both sides shift together). Every row
    // here sits at skillReq 100 or 125, past the 75 specialization threshold, so
    // the shipped discount is 20 percent and the draw is floor(count * 0.8),
    // minimum 1. The literal is the crop entry, which is the one this phase
    // authored: a plate's 2 draws 1 and leaves 1; a flask's 1 draws 1 and leaves
    // 0. Move the discount and this reds while the derived loop does not.
    // SWEPT OVER EVERY REAGENT, not just the crop (Phase 11h QA). The crop-only
    // version could not see a discount RETUNE, only its removal, and its
    // comment claimed otherwise: every produce entry on these eight rows is
    // count 1 or 2, and Math.max(1, Math.floor(n * m)) is 1 for n in {1,2} at
    // EVERY multiplier in (0,1), so 0.8 to 0.7 to 0.5 all leave the expected
    // leftover exactly where it was. A count-4 reagent is what discriminates:
    // floor(4 * 0.8) is 3 and floor(4 * 0.7) is 2, so the leftover moves 1 to
    // 2. The plates and the hearth carry game_meat 4, the hearth prime_cut 4
    // and the cauldron sunpetal_herb 4, so the sweep reaches a count-4 row on
    // five of the eight; the three flasks top out at 2 and are covered by the
    // removal case alone, which is stated rather than hidden.
    // THE MULTIPLIER ITSELF, pinned to its literal, and this is what actually
    // makes a retune visit this file. The leftover sweep below catches a
    // discount REMOVED and a discount deepened past 25 percent, and nothing in
    // between: with leftover(n) = n - max(1, floor(n * m)) over the counts these
    // eight bills carry (1, 2, 3, 4), every m from 0.75 to 0.9 yields exactly
    // the leftovers 0.8 does, so 0.2 to 0.1 or 0.2 to 0.25 would slip through
    // the whole sweep. One line closes the entire neighbourhood.
    // Pinned at both sides of the specialization threshold, so the constant and
    // the threshold's position both have to move deliberately. Every row here
    // sits at 100 or 125, well past it, which is why the leftovers below are
    // discounted at all.
    const craft = recipe.professionId;
    expect(
      materialCostMultiplier(craftSkills, craft),
      'the shipped specialization discount is 20 percent',
    ).toBe(0.8);
    expect(
      materialCostMultiplier({ [craft]: 50 }, craft),
      'and there is no discount below the threshold',
    ).toBe(1);
    for (const reagent of recipe.reagents) {
      expect(
        rig.sim.countItem(reagent.itemId, rig.pid),
        `${recipe.id} leftover ${reagent.itemId} at the shipped 20 percent discount`,
      ).toBe(reagent.count - Math.max(1, Math.floor(reagent.count * 0.8)));
    }
    // And the sweep reaches a count that can move under a DEEP retune, which is
    // the second signal rather than the only one now that the multiplier above
    // is pinned directly.
    const discriminating = recipe.reagents.filter((g) => g.count >= 4).length;
    expect(
      discriminating > 0 || THREE_FLASKS.includes(recipe.id),
      `${recipe.id} must carry a count-4 reagent, or be one of the three flasks`,
    ).toBe(true);
  });

  it.each(APEX_ROWS.map((row) => row.id))(
    '%s REFUSES when only its produce is withheld',
    (recipeId) => {
      // The non-vacuity half. Every arm in this file would pass if resolveCraft
      // ignored reagents entirely, and so would the eight cases above.
      const recipe = requireRecipe(recipeId);
      const rig = craftRig(recipe);
      for (const reagent of recipe.reagents) {
        if (PRODUCE_IDS.has(reagent.itemId)) continue;
        for (let i = 0; i < reagent.count; i++) rig.sim.addItem(reagent.itemId, 1, rig.pid);
      }

      expect(runCraft(rig, recipe).ok, `${recipe.id} must REFUSE without its produce`).toBe(false);
    },
  );
});
