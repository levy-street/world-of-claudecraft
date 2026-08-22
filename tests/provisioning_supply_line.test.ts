// THE PROVISIONING SUPPLY LINE (Phase 11g): farm produce is a real reagent
// family at the rungs players actually level through.
//
// THE GROUNDING FACT, and the reason this phase was additive rather than a
// rebalance. Before it the entire cooking tree used 17 distinct reagents and
// NOT ONE was a vegetable or a grain: spider_leg, cooking_salt, game_meat,
// prime_cut, the three herbs, ashwood_log, the six raw fish, seasoned_stock,
// quickening_catalyst and wyrmfall_core. Farming was not competing for a slot
// in a full pantry, it was filling a class that had never existed, which is
// what made "add, never substitute" cheap to honor: nothing had to move over.
//
// THIS FILE OWNS THE CROSS-PACKET RULE THE PHASE CREATES, and it is deliberately
// NOT a second copy of the masterwrought R17 firewall. That fence lives in
// tests/provisioner_firewall.test.ts under its own one-file-for-one-invariant
// rule (this phase EXTENDED it with the consumable-intermediate carve-out
// rather than forking its carve-out shape here). What this file asserts is the
// positive claim: produce reaches the leveling ladder, at a gate a player can
// actually clear, as an accent rather than a body, and without costing
// herbalism, fishing or skinning a single reagent.
//
// EVERY SET BELOW IS DERIVED FROM THE LIVE TABLES, never from a hand list, so a
// later roster widening (Phase 11e took the crop ladder from eight crops to
// twelve without touching a line of this shape) is covered by existing.
import { describe, expect, it } from 'vitest';
import { FARM_CROPS, farmCropSkillThreshold } from '../src/sim/content/farm_crops';
import { RAW_COOKING_CATCH_IDS } from '../src/sim/content/items';
import { ALL_RECIPES, FARM_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';

/** Every farm PRODUCE id and its fine twin, derived from the crop catalog. The
 *  seed ids are deliberately NOT here: a seed is the input side of the farming
 *  loop and is vendor-stocked at tiers 1 to 3, so folding it in would let a
 *  recipe satisfy "consumes produce" by consuming a vendor good. */
const PRODUCE_IDS: ReadonlySet<string> = new Set(
  Object.values(FARM_CROPS).flatMap((crop) => [crop.produceItemId, crop.fineProduceItemId]),
);

/** The tier a produce id belongs to, resolved through the catalog rather than
 *  parsed out of the id. Returns undefined for anything that is not produce. */
function produceTier(itemId: string): number | undefined {
  for (const crop of Object.values(FARM_CROPS)) {
    if (crop.produceItemId === itemId || crop.fineProduceItemId === itemId) return crop.tier;
  }
  return undefined;
}

/** The economy unit basis, the same rule tests/recipe_economy.test.ts reads:
 *  buyValue when the def carries a positive one, else sellValue. */
function reagentUnitValue(itemId: string): number {
  const def = ITEMS[itemId];
  if (!def) throw new Error(`reagent ${itemId} has no ItemDef`);
  return typeof def.buyValue === 'number' && def.buyValue > 0 ? def.buyValue : def.sellValue;
}

const produceConsumers = (): ProfessionRecipeRecord[] =>
  ALL_RECIPES.filter((r) => r.reagents.some((g) => PRODUCE_IDS.has(g.itemId)));

const LEVELING_RUNGS = [0, 25, 50] as const;

describe('the provisioning supply line: derivation floors', () => {
  it('sweeps a non-empty produce family and a non-empty recipe table', () => {
    // The vacuity floor every arm below rests on. Both sides are derived, so a
    // catalog rename that emptied either would otherwise make this whole file
    // pass over nothing.
    expect(PRODUCE_IDS.size, 'the produce family (base plus fine twins)').toBeGreaterThanOrEqual(
      24,
    );
    expect(Object.keys(FARM_CROPS).length, 'the crop roster').toBeGreaterThanOrEqual(12);
    expect(ALL_RECIPES.length, 'the merged recipe table').toBeGreaterThan(100);
    for (const id of PRODUCE_IDS) {
      expect(ITEMS[id], `${id} must be a real ItemDef`).toBeDefined();
      expect(produceTier(id), `${id} must resolve a tier`).toBeDefined();
    }
  });
});

describe('masterwrought R17 RULE 1: the tier gate', () => {
  it('no recipe asks for produce gated above its own rung', () => {
    // THE WHOLE ANSWER to "obtainable at the tier where the recipe unlocks": a
    // crop's plant gate must sit at or below the recipe's skillReq, so a player
    // levelling both skills together is never blocked by the pantry.
    //
    // DERIVED BY CALLING farmCropSkillThreshold, never by re-typing its
    // (tier - 1) * 25 arithmetic. A re-typed copy compared against itself is a
    // constant-self-comparison and would pass even if the shipped band math
    // changed underneath it.
    const consumers = produceConsumers();
    expect(
      consumers.length,
      'produce must have consumers for this sweep to mean anything',
    ).toBeGreaterThan(20);
    let checked = 0;
    for (const recipe of consumers) {
      for (const reagent of recipe.reagents) {
        const tier = produceTier(reagent.itemId);
        if (tier === undefined) continue;
        checked += 1;
        expect(
          farmCropSkillThreshold(tier),
          `${recipe.id} takes ${reagent.itemId} (tier ${tier}) at skillReq ${recipe.skillReq}`,
        ).toBeLessThanOrEqual(recipe.skillReq);
      }
    }
    expect(checked, 'the reagent-level sweep must be non-empty').toBeGreaterThan(25);
  });

  it('the gate really is the shipped band math, tier by tier', () => {
    // Non-vacuity for the arm above: if farmCropSkillThreshold ever returned a
    // constant the sweep would pass over nothing meaningful, so pin what the
    // four tiers actually gate at.
    expect(farmCropSkillThreshold(1)).toBe(0);
    expect(farmCropSkillThreshold(2)).toBe(25);
    expect(farmCropSkillThreshold(3)).toBe(50);
    expect(farmCropSkillThreshold(4)).toBe(75);
  });
});

describe('masterwrought R17: rung coverage on the leveling ladder', () => {
  it('cooking and alchemy each consume produce at skillReq 0, 25 and 50', () => {
    for (const craft of ['cooking', 'alchemy'] as const) {
      for (const rung of LEVELING_RUNGS) {
        const rows = produceConsumers().filter(
          (r) => r.professionId === craft && r.skillReq === rung,
        );
        expect(
          rows.map((r) => r.id),
          `${craft} must consume produce at rung ${rung}`,
        ).not.toHaveLength(0);
      }
    }
  });

  it('THE SUPPLY LINE IS REAL, NOT SELF-REFERENTIAL: a consumer outside FARM_RECIPES at every rung', () => {
    // THIS IS THE PHASE'S THESIS and the arm that goes red if a future edit
    // quietly walks it back. Farming feeding farming's own dishes proves
    // nothing: before this phase every produce-consuming row in the game was
    // one farming wrote for itself, plus the hoe ladder. What makes a supply
    // LINE is a buyer on a ladder somebody else built.
    const farmOwnIds = new Set(FARM_RECIPES.map((r) => r.id));
    const outside = produceConsumers().filter((r) => !farmOwnIds.has(r.id));
    for (const craft of ['cooking', 'alchemy'] as const) {
      for (const rung of LEVELING_RUNGS) {
        const rows = outside.filter((r) => r.professionId === craft && r.skillReq === rung);
        expect(
          rows.map((r) => r.id),
          `${craft} rung ${rung} needs a produce consumer farming did not write`,
        ).not.toHaveLength(0);
      }
    }
    // And the set really excludes something, so the filter above is doing work
    // rather than passing everything through.
    expect(farmOwnIds.size, 'FARM_RECIPES must be non-empty').toBeGreaterThan(10);
    expect(
      produceConsumers().filter((r) => farmOwnIds.has(r.id)).length,
      'farming rows must still be produce consumers too',
    ).toBeGreaterThan(5);
  });
});

describe('masterwrought R17: fish dishes stay fish-forward', () => {
  it('every cooking row carrying a raw fish keeps more fish than produce', () => {
    // Stated as a mechanic rather than a taste: a chowder taking a root is
    // still a fish dish; a fish row whose vegetables outnumber its fish is not.
    //
    // THE FISH SET COMES FROM THE SHIPPED CONTENT EXPORT, not a copy, so this
    // list and the one tests/recipe_economy.test.ts sweeps cannot diverge: both
    // rest on RAW_COOKING_CATCH_IDS, and a new catch joins by existing.
    expect([...RAW_COOKING_CATCH_IDS].sort()).toEqual([
      'glimmerfin_koi',
      'raw_bog_eel',
      'raw_frostgill_trout',
      'raw_marsh_pike',
      'raw_mirror_trout',
      'raw_river_perch',
      'raw_stonescale_carp',
    ]);
    const fishRows = ALL_RECIPES.filter(
      (r) =>
        r.professionId === 'cooking' && r.reagents.some((g) => RAW_COOKING_CATCH_IDS.has(g.itemId)),
    );
    expect(fishRows.length, 'the fish-dish sweep must be non-empty').toBeGreaterThan(4);
    let withProduce = 0;
    for (const recipe of fishRows) {
      const fish = recipe.reagents
        .filter((g) => RAW_COOKING_CATCH_IDS.has(g.itemId))
        .reduce((t, g) => t + g.count, 0);
      const produce = recipe.reagents
        .filter((g) => PRODUCE_IDS.has(g.itemId))
        .reduce((t, g) => t + g.count, 0);
      if (produce > 0) withProduce += 1;
      expect(
        fish,
        `${recipe.id}: fish ${fish} must outnumber produce ${produce} on a fish dish`,
      ).toBeGreaterThan(produce);
    }
    // NON-VACUITY, and it is the whole point of this arm: the strictly-greater
    // comparison is trivially true on a fish row carrying no produce at all, so
    // without this floor the sweep would stay green if the phase were reverted.
    expect(
      withProduce,
      'at least one fish dish must actually carry produce, or this arm proves nothing',
    ).toBeGreaterThanOrEqual(2);
  });

  it('at most one crop family joins a fish row', () => {
    const fishRows = ALL_RECIPES.filter(
      (r) =>
        r.professionId === 'cooking' && r.reagents.some((g) => RAW_COOKING_CATCH_IDS.has(g.itemId)),
    );
    for (const recipe of fishRows) {
      const families = new Set(
        recipe.reagents
          .filter((g) => PRODUCE_IDS.has(g.itemId))
          .map((g) => {
            for (const crop of Object.values(FARM_CROPS)) {
              if (crop.produceItemId === g.itemId || crop.fineProduceItemId === g.itemId) {
                return crop.id;
              }
            }
            return g.itemId;
          }),
      );
      expect(
        families.size,
        `${recipe.id} may take at most one crop family beside its fish`,
      ).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// THE ROWS THIS PHASE TOUCHED, and everything pinned per-row.
// ---------------------------------------------------------------------------

/** The nine shipped rows Phase 11g put produce into, with the EXACT produce
 *  entries authored. A literal on purpose: the derived sweeps above prove the
 *  rules hold over whatever ships, and this proves what actually shipped. A
 *  phase that walked one row back would keep every derived arm green as long as
 *  the other rungs still had a member; only this table sees it. */
const TOUCHED_ROWS: ReadonlyArray<{
  readonly id: string;
  readonly produce: ReadonlyArray<readonly [string, number]>;
  /** Every NON-produce reagent as shipped, so masterwrought R18's "add, never
   *  substitute" is a fact about each row and not just about three herb totals.
   *  Totals alone can be gamed by moving a reagent between rows; this closes it
   *  for the herb, fish, meat and salt lines at once. */
  readonly untouched: ReadonlyArray<readonly [string, number]>;
}> = [
  {
    id: 'recipe_hunters_game_skewer',
    produce: [['vale_wheat', 1]],
    untouched: [
      ['game_meat', 2],
      ['cooking_salt', 1],
    ],
  },
  {
    id: 'recipe_goldleaf_game_stew',
    produce: [
      ['vale_wheat', 2],
      ['bog_beet', 1],
    ],
    untouched: [
      ['game_meat', 3],
      ['goldleaf_herb', 1],
      ['cooking_salt', 1],
    ],
  },
  {
    id: 'recipe_frostgill_chowder',
    produce: [['brook_carrot', 1]],
    untouched: [
      ['raw_frostgill_trout', 2],
      ['silverleaf_herb', 2],
      ['cooking_salt', 2],
    ],
  },
  {
    id: 'recipe_silvered_carp_supper',
    produce: [['marsh_rice', 2]],
    untouched: [
      ['raw_stonescale_carp', 3],
      ['raw_mirror_trout', 1],
      ['goldleaf_herb', 1],
      ['cooking_salt', 1],
    ],
  },
  {
    id: 'recipe_marlows_grand_roast',
    produce: [
      ['highland_barley', 2],
      ['frost_gourd', 2],
    ],
    untouched: [
      ['prime_cut', 1],
      ['game_meat', 4],
      ['sunpetal_herb', 1],
      ['cooking_salt', 2],
    ],
  },
  {
    id: 'recipe_elixir_of_the_boar',
    produce: [['vale_wheat', 1]],
    untouched: [
      ['venom_gland', 2],
      ['silverleaf_herb', 2],
      ['glass_vial', 1],
    ],
  },
  {
    id: 'recipe_venomfire_elixir',
    produce: [['bog_beet', 2]],
    untouched: [
      ['venom_gland', 3],
      ['goldleaf_herb', 1],
      ['glass_vial', 1],
    ],
  },
  {
    id: 'recipe_elixir_of_the_serpent',
    produce: [['frost_gourd', 1]],
    untouched: [
      ['pristine_venom_gland', 1],
      ['venom_gland', 2],
      ['sunpetal_herb', 1],
      ['glass_vial', 1],
    ],
  },
  {
    id: 'recipe_seasoned_stock',
    produce: [
      ['marsh_rice', 2],
      ['bog_beet', 2],
    ],
    untouched: [
      ['prime_cut', 1],
      ['game_meat', 3],
      ['cooking_salt', 2],
      ['quickening_catalyst', 1],
    ],
  },
];

function requireRecipe(id: string): ProfessionRecipeRecord {
  const recipe = ALL_RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`recipe ${id} missing`);
  return recipe;
}

describe('masterwrought R17 RULE 2: the accent rule', () => {
  it('every touched row carries exactly the produce entries this phase authored', () => {
    expect(TOUCHED_ROWS.length, 'the touched-row table').toBe(9);
    for (const row of TOUCHED_ROWS) {
      const recipe = requireRecipe(row.id);
      const actual = recipe.reagents
        .filter((g) => PRODUCE_IDS.has(g.itemId))
        .map((g) => [g.itemId, g.count]);
      expect(actual, `${row.id} produce entries`).toEqual(row.produce.map(([id, n]) => [id, n]));
    }
  });

  it('a crop is a seasoning and never the body, by COUNT', () => {
    // A crop's count stays STRICTLY below the row's largest non-produce count.
    // Farming's own dishes own the body role (the hearth loaf takes wheat 3,
    // the barley bannock takes barley 4); a shipped ladder row takes 1 or 2.
    for (const row of TOUCHED_ROWS) {
      const recipe = requireRecipe(row.id);
      const largest = Math.max(
        ...recipe.reagents.filter((g) => !PRODUCE_IDS.has(g.itemId)).map((g) => g.count),
      );
      for (const reagent of recipe.reagents) {
        if (!PRODUCE_IDS.has(reagent.itemId)) continue;
        expect(
          reagent.count,
          `${row.id}: ${reagent.itemId} at ${reagent.count} must stay under the row's largest non-produce count ${largest}`,
        ).toBeLessThan(largest);
        expect(reagent.count, `${row.id}: ${reagent.itemId} is an accent`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('a crop is a seasoning and never the body, by VALUE', () => {
    // The value half, and the reading is recorded because the rule names a
    // single reagent and a row can have several: the reference is the row's
    // DOMINANT non-produce reagent by share of inputValue, which is what "the
    // body" means when a bill is priced. That reading is the one masterwrought
    // DECISION C is executable under: the settled seasoned stock takes
    // marsh_rice 2 plus bog_beet 2 (16 each) against a quickening_catalyst
    // worth 50, and a largest-COUNT reading would have measured it against
    // game_meat's 12 and forbidden the decision's own authored counts.
    //
    // IT STILL HAS TEETH, and the phase proved it in authoring rather than
    // claiming it: brook_carrot was REFUSED on recipe_hunters_game_skewer and
    // on recipe_elixir_of_the_boar because its farming D9 buyValue of 16 puts
    // it above those rows' dominant reagents (8 and 12), which is exactly this
    // arm firing. Both rows took vale_wheat at 4 instead.
    for (const row of TOUCHED_ROWS) {
      const recipe = requireRecipe(row.id);
      const dominant = Math.max(
        ...recipe.reagents
          .filter((g) => !PRODUCE_IDS.has(g.itemId))
          .map((g) => g.count * reagentUnitValue(g.itemId)),
      );
      for (const reagent of recipe.reagents) {
        if (!PRODUCE_IDS.has(reagent.itemId)) continue;
        const value = reagent.count * reagentUnitValue(reagent.itemId);
        expect(
          value,
          `${row.id}: ${reagent.itemId} contributes ${value} and must not exceed the row's dominant non-produce reagent at ${dominant}`,
        ).toBeLessThanOrEqual(dominant);
      }
    }
  });
});

describe('masterwrought R18 and farming D24: the displacement guard', () => {
  it('herbalism loses nothing: the three herb totals are unchanged', () => {
    // THE PIN THAT MAKES "HERBALISM LOSES NOTHING" A FACT INSTEAD OF A PROMISE.
    // Predicted before the edits and observed after: this phase adds reagents
    // and reduces none, so all three totals had to stand still. BASE herbs
    // only, matching the scope tests/farm_seed_channels.test.ts already uses
    // and for the same recorded reason: the three fine_* herb twins have no
    // recipe consumer anywhere on the merged tree, which predates this phase.
    const totals: Record<string, number> = {};
    for (const herb of ['silverleaf_herb', 'goldleaf_herb', 'sunpetal_herb']) {
      totals[herb] = ALL_RECIPES.reduce(
        (sum, r) =>
          sum + r.reagents.filter((g) => g.itemId === herb).reduce((t, g) => t + g.count, 0),
        0,
      );
    }
    expect(totals).toEqual({
      silverleaf_herb: 28,
      goldleaf_herb: 27,
      sunpetal_herb: 39,
    });
  });

  it('and no touched row lost a herb, fish, meat or salt entry to make room', () => {
    // Totals alone can be gamed by moving a reagent between rows, so the exact
    // non-produce bill of every touched row is pinned too. This is the arm that
    // makes masterwrought R18's "ADD, never substitute" checkable per row.
    for (const row of TOUCHED_ROWS) {
      const recipe = requireRecipe(row.id);
      const actual = recipe.reagents
        .filter((g) => !PRODUCE_IDS.has(g.itemId))
        .map((g) => [g.itemId, g.count]);
      expect(actual, `${row.id} non-produce bill`).toEqual(row.untouched.map(([id, n]) => [id, n]));
    }
  });
});

describe('the touched rows stay gold-negative and stay off the gear chain', () => {
  it('every touched bill vendors strictly below its input value', () => {
    // SAFE BY CONSTRUCTION and re-run anyway: adding a reagent raises
    // inputValue and cannot touch outputValue, which is resultCount times the
    // output def's sellValue, and this phase changed no output def and no
    // resultCount. Every touched margin therefore widened monotonically.
    for (const row of TOUCHED_ROWS) {
      const recipe = requireRecipe(row.id);
      const input = recipe.reagents.reduce((t, g) => t + g.count * reagentUnitValue(g.itemId), 0);
      const outDef = ITEMS[recipe.resultItemId];
      expect(outDef, `${row.id} output def`).toBeDefined();
      const output = outDef.sellValue * recipe.resultCount;
      expect(output, `${row.id}: output ${output} vs input ${input}`).toBeLessThan(input);
    }
  });

  it('every touched row belongs to a CONSUMABLE profession', () => {
    // The scoped statement about this phase's own diff. The standing
    // masterwrought R17 fence (produce never reaches recipe_quickening_catalyst,
    // a gear intermediate, or a Perfecting material) lives in
    // tests/provisioner_firewall.test.ts, which this phase EXTENDED rather than
    // copied: that file's header requires one file for that invariant so the
    // carve-out shape cannot fork.
    for (const row of TOUCHED_ROWS) {
      const recipe = requireRecipe(row.id);
      expect(['cooking', 'alchemy'], `${row.id} profession`).toContain(recipe.professionId);
      expect(
        ITEMS[recipe.resultItemId]?.slot,
        `${row.id} must not output an equippable`,
      ).toBeUndefined();
    }
  });

  it('this phase minted no recipe row and no rung moved', () => {
    // masterwrought R13 and the closed LADDER_RECIPES shape, restated where the
    // phase that could have broken them is pinned. Every touched row keeps the
    // skillReq it shipped with.
    const expected: Record<string, number> = {
      recipe_hunters_game_skewer: 0,
      recipe_goldleaf_game_stew: 25,
      recipe_frostgill_chowder: 25,
      recipe_silvered_carp_supper: 50,
      recipe_marlows_grand_roast: 50,
      recipe_elixir_of_the_boar: 0,
      recipe_venomfire_elixir: 25,
      recipe_elixir_of_the_serpent: 50,
      recipe_seasoned_stock: 75,
    };
    for (const row of TOUCHED_ROWS) {
      expect(requireRecipe(row.id).skillReq, `${row.id} rung`).toBe(expected[row.id]);
    }
  });
});
