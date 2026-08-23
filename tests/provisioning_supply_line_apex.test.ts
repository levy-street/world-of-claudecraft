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

const inputValue = (recipe: ProfessionRecipeRecord): number =>
  recipe.reagents.reduce((t, g) => t + g.count * reagentUnitValue(g.itemId), 0);

const outputValue = (recipe: ProfessionRecipeRecord): number => {
  const def = ITEMS[recipe.resultItemId];
  if (!def) throw new Error(`recipe ${recipe.id} has no output def`);
  return def.sellValue * recipe.resultCount;
};

/** The produce this phase added to a row, summed on the economy basis. */
const addedProduceValue = (recipe: ProfessionRecipeRecord): number =>
  recipe.reagents
    .filter((g) => PRODUCE_IDS.has(g.itemId))
    .reduce((t, g) => t + g.count * reagentUnitValue(g.itemId), 0);

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
 *  `inputBefore` is the row's input value BEFORE this phase, and it is not
 *  carried from a planning doc: the arms below re-derive it as
 *  (input now - added produce) and check it against this literal, so the two
 *  cannot drift and neither is a restatement of the other. */
const APEX_ROWS: ReadonlyArray<{
  readonly id: string;
  readonly craft: 'cooking' | 'alchemy';
  readonly rung: number;
  readonly produce: ReadonlyArray<readonly [string, number]>;
  readonly untouched: ReadonlyArray<readonly [string, number]>;
  readonly order: readonly string[];
  readonly inputBefore: number;
  readonly inputAfter: number;
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
    order: ['seasoned_stock', 'prime_cut', 'game_meat', 'frost_gourd', 'sunpetal_herb', 'cooking_salt'],
    inputBefore: 422,
    inputAfter: 452,
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
    order: [
      'seasoned_stock',
      'prime_cut',
      'game_meat',
      'highland_barley',
      'sunpetal_herb',
      'cooking_salt',
    ],
    inputBefore: 422,
    inputAfter: 452,
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
    order: [
      'seasoned_stock',
      'prime_cut',
      'game_meat',
      'thornpeak_cabbage',
      'sunpetal_herb',
      'cooking_salt',
    ],
    inputBefore: 422,
    inputAfter: 452,
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
    order: [
      'seasoned_stock',
      'wyrmfall_core',
      'prime_cut',
      'game_meat',
      'evergarden_greens',
      'fine_evergarden_greens',
      'sunpetal_herb',
    ],
    inputBefore: 606,
    inputAfter: 1006,
    output: 380,
  },
];

describe('masterwrought Phase 11h: the eight rows, per row', () => {
  it('the table covers exactly this phase, and every row is a real merged recipe', () => {
    expect(APEX_ROWS.length, 'the touched-row table').toBe(8);
    expect(
      APEX_ROWS.map((r) => r.id).sort(),
      'the table is exactly APEX_CONSUMABLE_RECIPES',
    ).toEqual(APEX_CONSUMABLE_RECIPES.map((r) => r.id).sort());
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
      expect(actual, `${row.id} non-produce bill`).toEqual(row.untouched.map(([id, n]) => [id, n]));
    }
  });

  it('and the reagent ORDER on every row, produce interleaved where it was authored', () => {
    for (const row of APEX_ROWS) {
      const recipe = requireRecipe(row.id);
      expect(
        recipe.reagents.map((g) => g.itemId),
        `${row.id} reagent order (the crafting window and the wiki render this sequence)`,
      ).toEqual(row.order);
      // The order column must account for the WHOLE bill, so a reagent added
      // without a table visit cannot hide past the end of the pinned sequence.
      expect(row.order.length, `${row.id} order must cover every entry`).toBe(
        recipe.reagents.length,
      );
      expect(
        new Set(row.order).size,
        `${row.id} order must name each reagent once`,
      ).toBe(row.order.length);
    }
  });

  it('recipe_laden_hearth is the first SEVEN-reagent bill in the game', () => {
    // Recorded as a fact about the merged table rather than a note, because it
    // is the one shape claim this phase makes that no other arm would notice:
    // nothing caps a reagent list, so the seventh row renders by existing.
    const longest = Math.max(...ALL_RECIPES.map((r) => r.reagents.length));
    expect(longest, 'the longest bill in the merged table').toBe(7);
    expect(
      ALL_RECIPES.filter((r) => r.reagents.length === 7).map((r) => r.id),
      'and it is the only one',
    ).toEqual(['recipe_laden_hearth']);
    // The previous maximum was six, and both six-entry rows are Phase 11g's, so
    // this really is a new shape rather than a re-count of an old one.
    expect(
      ALL_RECIPES.filter((r) => r.reagents.length === 6).length,
      'the six-entry rows',
    ).toBeGreaterThanOrEqual(6);
  });
});

describe('masterwrought Phase 11h GATE A: the amended uniform-bill rule', () => {
  it('the three role plates differ by EXACTLY ONE crop row and in nothing else', () => {
    // The amendment's exact scope, asserted rather than trusted to the header
    // comment that states it. Derived pairwise from the live bills: strip each
    // plate's produce entries and the three remainders must be identical, in
    // order and in count.
    const remainders = THREE_PLATES.map((id) =>
      requireRecipe(id)
        .reagents.filter((g) => !PRODUCE_IDS.has(g.itemId))
        .map((g) => [g.itemId, g.count]),
    );
    expect(remainders[1], 'skewers vs stew, produce aside').toEqual(remainders[0]);
    expect(remainders[2], 'chowder vs stew, produce aside').toEqual(remainders[0]);
    // EXACTLY ONE crop ROW each, not merely "some produce": two crop rows on one
    // plate would satisfy a looser reading and break the amendment as written.
    for (const id of THREE_PLATES) {
      expect(
        requireRecipe(id).reagents.filter((g) => PRODUCE_IDS.has(g.itemId)).length,
        `${id} must carry exactly one crop row`,
      ).toBe(1);
    }
    // And the remainder is not empty, or "identical in every other reagent"
    // would be a claim about nothing.
    expect(remainders[0].length, 'the shared bill').toBeGreaterThanOrEqual(5);
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
    expect(bills[0].length, 'the shared flask bill').toBeGreaterThanOrEqual(6);
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
    expect(inputs[0]).toBe(452);
  });

  it("11i's uniform fish row is still legal under the amendment", () => {
    // Recorded as an arm rather than a sentence because the amendment was
    // scoped narrowly for exactly this: Phase 11i appends the SAME raw fish row
    // to all three plates (11i DECISION D), which leaves them differing by one
    // crop row and identical in every other reagent, still. The check is that
    // the property this file asserts is stated over PRODUCE, so a non-produce
    // row added uniformly to all three cannot break it: simulate that by
    // appending an identical synthetic entry to each remainder.
    const withFish = THREE_PLATES.map((id) => [
      ...requireRecipe(id)
        .reagents.filter((g) => !PRODUCE_IDS.has(g.itemId))
        .map((g) => [g.itemId, g.count]),
      ['raw_stonescale_carp', 2],
    ]);
    expect(withFish[1]).toEqual(withFish[0]);
    expect(withFish[2]).toEqual(withFish[0]);
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

  it('the three crops are the tier-3 GOURD, GRAIN and LEAF, derived from the roster', () => {
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
    expect(tierThree.filter((c) => !taken.has(c)), 'the crop left over').toEqual([
      'frost_lentils',
    ]);
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
    // And that gate is reachable: farming's own ladder runs to 100, so a
    // cook at the apex rung is never blocked by a crop they cannot plant.
    expect(gates[0]).toBeLessThanOrEqual(100);
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
    const alchemyHerb = ALL_RECIPES.filter((r) => r.professionId === 'alchemy').reduce(
      (sum, r) =>
        sum +
        r.reagents
          .filter((g) => g.itemId.endsWith('_herb') && !g.itemId.startsWith('fine_'))
          .reduce((t, g) => t + g.count, 0),
      0,
    );
    // 44 is a MEASUREMENT of the merged table, taken here rather than predicted:
    // this phase adds no herb anywhere, so the number it pins is whatever
    // shipped, and the three global herb totals in
    // tests/provisioning_supply_line.test.ts (28 / 27 / 39, green and unmoved)
    // are the independent evidence that the phase did not change it.
    expect(alchemyHerb, "alchemy's whole herb demand, unchanged by this phase").toBe(44);
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
    expect(hearth.filter((id) => cauldron.has(id)), 'the two capstones share no crop').toEqual([]);
  });

  it('BOTH tier-4 fine twins now have a consumer at skillReq 125, the top of the catalog', () => {
    // The masterwrought R20 shape this gate exists to close. Before this phase
    // each twin was consumed by exactly one recipe, farming's own tier-4 dish
    // at cooking 100, so the tier-4 twins had no endgame consumer at all.
    for (const twin of ['fine_gilded_sunmelon', 'fine_evergarden_greens']) {
      const consumers = ALL_RECIPES.filter((r) =>
        r.reagents.some((g) => g.itemId === twin),
      );
      expect(consumers.length, `${twin} consumers`).toBe(2);
      expect(
        consumers.filter((r) => r.skillReq >= 125).map((r) => r.id),
        `${twin} must have a consumer at the 125 rung`,
      ).toHaveLength(1);
    }
    // The tier is derived, not assumed: both twins really are tier 4.
    for (const twin of ['fine_gilded_sunmelon', 'fine_evergarden_greens']) {
      const def = Object.values(FARM_CROPS).find((c) => c.fineProduceItemId === twin);
      expect(def?.tier, `${twin} tier`).toBe(4);
      expect(farmCropSkillThreshold(def?.tier ?? 0), `${twin} gate`).toBe(75);
    }
  });

  it('the hoe twins are NOT what this phase consumed, so nothing is double-booked', () => {
    // The reading tests/farm_recipes.test.ts's hoe-twin arm rests on, recorded
    // here rather than relied on by accident: that arm asserts the three HOE
    // twins get no FARM DISH slot, and this phase puts TIER-4 twins into
    // APEX_CONSUMABLE_RECIPES rows, which are neither hoe twins nor farm
    // dishes. It neither trips nor should.
    const hoeTwins = new Set(
      ALL_RECIPES.filter((r) => r.resultItemId.endsWith('_hoe')).flatMap((r) =>
        r.reagents.filter((g) => PRODUCE_IDS.has(g.itemId)).map((g) => g.itemId),
      ),
    );
    expect([...hoeTwins].sort(), 'the hoe ladder still takes exactly these').toEqual([
      'fine_highland_barley',
      'fine_marsh_rice',
      'fine_vale_wheat',
    ]);
    for (const row of APEX_ROWS) {
      for (const [id] of row.produce) {
        expect(hoeTwins.has(id), `${row.id} must not consume a hoe twin`).toBe(false);
      }
    }
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
    for (const row of APEX_ROWS) {
      for (const [produceId] of row.produce) {
        const seed = seedFor(produceId);
        expect(stocked.has(seed), `${row.id} needs ${produceId}, whose seed ${seed} is unstocked`).toBe(
          true,
        );
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
      const before = after - added;
      expect(after, `${row.id} input after`).toBe(row.inputAfter);
      expect(before, `${row.id} input before`).toBe(row.inputBefore);
      expect(outputValue(recipe), `${row.id} output`).toBe(row.output);
      expect(after, `${row.id}: output ${row.output} vs input ${after}`).toBeGreaterThan(row.output);
      // The margin widened by exactly the produce this phase added, which is
      // the whole safety argument for putting a reagent on a tight row.
      expect(after - row.output - (before - row.output), `${row.id} margin delta`).toBe(added);
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
      expect(ITEMS[id]?.elixir?.value, `${id} flask magnitude`).toBe(15);
      expect(ITEMS[id]?.elixir?.duration, `${id} flask duration`).toBe(1200);
    }
    for (const id of ['stonepot_stew', 'warspice_skewers', 'sageleaf_chowder']) {
      expect(ITEMS[id]?.sellValue, `${id} sellValue`).toBe(90);
      expect(ITEMS[id]?.foodHp, `${id} foodHp`).toBe(1392);
      expect(ITEMS[id]?.wellFed?.value, `${id} Well Fed magnitude`).toBe(6);
      expect(ITEMS[id]?.wellFed?.duration, `${id} Well Fed duration`).toBe(900);
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
    expect(consumers.sort(), 'everything in the cooking apex flows through it').toEqual(
      [...THREE_PLATES, 'recipe_laden_hearth'].sort(),
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
    expect(APEX_CONSUMABLE_RECIPES).toHaveLength(8);
    expect(INTERMEDIATE_RECIPES).toHaveLength(10);
    expect(ALL_RECIPES).toHaveLength(149);
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
      expect(required, `${recipe.id} must really need its ${reagent.itemId}`).toBeGreaterThan(0);
      expect(
        rig.sim.countItem(reagent.itemId, rig.pid),
        `${recipe.id} must consume ${required} of its ${reagent.itemId}`,
      ).toBe(reagent.count - required);
    }
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
