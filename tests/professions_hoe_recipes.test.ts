// The crafted hoe ladder (the crop-ladder phase's tool half): what each rung
// consumes, why it is a separate list from TOOL_RECIPES, and where it
// deliberately diverges from the rod ladder.
//
// The land ladder's invariant (tests/material_grades.test.ts) is that every
// crafted tool consumes a FINE gathered grade plus the tool one rung down.
// Farming has no world nodes, so it has no node fine grades; its ladder
// states its OWN invariant here instead of widening that one into a
// disjunction both could satisfy for different reasons: every member
// consumes the fine TWIN of a crop ONE TIER BELOW its result plus the hoe
// one rung down, at the toolworks. One tier below is the closed-circuit
// resolution recorded in content/recipes.ts: the step-12 hoe gate reads
// canGatherTier(hoe tier, crop tier), so a tier-N crop's fine twin cannot be
// grown without the tier-N hoe already owned, and a matching-tier reagent
// would be a circuit with no entry.
import { describe, expect, it } from 'vitest';
import { DELVE_SHOPS } from '../src/sim/content/delves/shop';
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { craftMaxSkillFor } from '../src/sim/content/professions';
import { ALL_RECIPES, HOE_RECIPES, TOOL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, NPCS } from '../src/sim/data';
import { baseMaterialFor } from '../src/sim/professions/material_grades';
import { isGatherToolUse } from '../src/sim/professions/tools';
import { tierForSkill } from '../src/sim/professions/wheel';

const hoeTierOf = (itemId: string): number | undefined => {
  const use = ITEMS[itemId]?.use;
  return isGatherToolUse(use) && use.professionId === 'farming' ? use.tier : undefined;
};

/** The farm crop whose FINE twin this item is, or undefined. */
const cropOfFineTwin = (itemId: string) =>
  Object.values(FARM_CROPS).find((crop) => crop.fineProduceItemId === itemId);

describe('the crafted hoe ladder', () => {
  it('is exactly the four rungs above the vendor hoe, each producing the next tier up', () => {
    // FOUR since masterwrought Phase 11j added the apex rung, which made
    // farming the fifth member of the shipped tier-5 base-tool family rather
    // than the one gathering profession whose ladder stopped at 4.
    expect(HOE_RECIPES).toHaveLength(4);
    const producedTiers = HOE_RECIPES.map((r) => hoeTierOf(r.resultItemId));
    expect(producedTiers).toEqual([2, 3, 4, 5]);
    for (const recipe of HOE_RECIPES) {
      expect(recipe.professionId).toBe('engineering');
      expect(recipe.stationType).toBe('toolworks');
      expect(recipe.resultCount).toBe(1);
    }
  });

  it('each rung consumes the hoe one rung down, and exactly one hoe', () => {
    let checked = 0;
    for (const recipe of HOE_RECIPES) {
      const outputTier = hoeTierOf(recipe.resultItemId) as number;
      const hoeReagents = recipe.reagents.filter((r) => hoeTierOf(r.itemId) !== undefined);
      expect(hoeReagents, `${recipe.id} must consume exactly one hoe`).toHaveLength(1);
      expect(hoeTierOf(hoeReagents[0].itemId), `${recipe.id} rung below`).toBe(outputTier - 1);
      expect(hoeReagents[0].count).toBe(1);
      checked += 1;
    }
    expect(checked).toBe(4);
  });

  it('every rung consumes the fine twin of a crop ONE TIER BELOW its result, and no node grade', () => {
    // The positive half is the ladder's own material story: a hoe is made of
    // what a hoe grows, one rung behind itself (the closed-circuit rule in
    // the banner above). The negative half is what keeps this list out of
    // TOOL_RECIPES' way: a NODE fine grade outside that list would red the
    // "only TOOL_RECIPES consumes a fine grade" sweep in
    // tests/material_grades.test.ts.
    let fineTwins = 0;
    for (const recipe of HOE_RECIPES) {
      const outputTier = hoeTierOf(recipe.resultItemId) as number;
      const twins = recipe.reagents.filter((r) => cropOfFineTwin(r.itemId) !== undefined);
      expect(twins, `${recipe.id} must consume exactly one crop fine twin`).toHaveLength(1);
      const crop = cropOfFineTwin(twins[0].itemId);
      expect(crop?.tier, `${recipe.id} twin tier`).toBe(outputTier - 1);
      fineTwins += twins.length;
      for (const reagent of recipe.reagents) {
        expect(
          baseMaterialFor(reagent.itemId),
          `${recipe.id} consumes the node fine grade ${reagent.itemId}`,
        ).toBeUndefined();
      }
    }
    expect(fineTwins).toBe(4);
  });

  it('all four rungs are trainer-taught, at a skill a learner can actually reach', () => {
    // The ROD_RECIPES lesson restated for the hoes: the pre-training id list
    // is frozen, so anything authored after that switch has to be learned,
    // and a trainer only teaches a recipe whose TIER the learner has
    // reached, so a requirement above the craft's own cap is unlearnable.
    const cap = craftMaxSkillFor('engineering');
    for (const recipe of HOE_RECIPES) {
      expect(recipe.acquisition, `${recipe.id} acquisition`).toEqual(['trainer']);
      expect(
        tierForSkill(recipe.skillReq),
        `${recipe.id} skillReq ${recipe.skillReq} is above the reachable tier`,
      ).toBeLessThanOrEqual(tierForSkill(cap));
    }
    // Rung 1 re-tiered 25 to 0 at masterwrought Phase 11o (qr-11o-ENG): the
    // on-ramp row must be learnable at skill 0.
    expect(HOE_RECIPES.map((r) => r.skillReq)).toEqual([0, 50, 75, 125]);
  });

  it('the apex rung takes the greens at COUNT 2, both of which are arguable and neither derived', () => {
    // The general arms above cannot pin either half. "Exactly one crop fine
    // twin one tier below the result" is satisfied by all FOUR shipped tier-4
    // twins, so swapping fine_evergarden_greens for the yam leaves them green;
    // and no arm reads the count at all, so 4 would pass too. Both are
    // argued at length in the row comment (the halving the tier-5 family
    // applies, and the naming CONVENTION that picked this twin over the other
    // three the invariant admits: two of the four shipped tier-5 tools do not
    // follow it, so it is a tie-breaker rather than a rule), so both get a
    // literal.
    const apex = HOE_RECIPES.find((r) => r.id === 'recipe_evergarden_hoe');
    expect(apex?.reagents).toEqual([
      { itemId: 'fine_evergarden_greens', count: 2 },
      { itemId: 'osmium_hoe', count: 1 },
    ]);
    // THE HALVING, derived rather than restated: the tier-5 rung takes half
    // what the tier-4 rung takes of its own grade, which is the rule the count
    // comes from and the reason 4 would have been wrong.
    const rung4 = HOE_RECIPES.find((r) => r.id === 'recipe_osmium_hoe');
    const twinCount = (recipe: typeof apex) =>
      recipe?.reagents.find((r) => cropOfFineTwin(r.itemId) !== undefined)?.count;
    expect(twinCount(apex)).toBe((twinCount(rung4) as number) / 2);
  });

  it('rides ALL_RECIPES, and stays out of TOOL_RECIPES', () => {
    const hoeIds = new Set(HOE_RECIPES.map((r) => r.id));
    for (const id of hoeIds) {
      expect(
        ALL_RECIPES.some((r) => r.id === id),
        `${id} must be craftable`,
      ).toBe(true);
      expect(
        TOOL_RECIPES.some((r) => r.id === id),
        `${id} must not join TOOL_RECIPES`,
      ).toBe(false);
    }
    expect(TOOL_RECIPES).toHaveLength(6);
  });

  it('no hoe rung is ever sold for COPPER above the entry rung', () => {
    // The half of the old craft-only pin that did NOT narrow, kept whole: no
    // copper price and no NPC counter, at every crafted rung. This is the
    // claim the hoe pricing table actually makes, and Marks are a delve
    // currency rather than copper, so the two Marks rows below leave it
    // untouched.
    for (const recipe of HOE_RECIPES) {
      expect(ITEMS[recipe.resultItemId].buyValue).toBeUndefined();
      for (const npc of Object.values(NPCS)) {
        expect(npc.vendorItems ?? [], `${npc.id} stocks ${recipe.resultItemId}`).not.toContain(
          recipe.resultItemId,
        );
      }
      expect(
        HEROIC_VENDOR_STOCK.map((o) => o.itemId),
        `the heroic counter stocks ${recipe.resultItemId}`,
      ).not.toContain(recipe.resultItemId);
    }
    // The entry rung stays the 20-copper vendor purchase, which is what
    // gives the ladder its entry point (the acquisition-coverage note in
    // content/recipes.ts).
    expect(ITEMS.garden_hoe.buyValue).toBe(20);
  });

  it('the no-Marks rule NARROWED to hoe rungs 1 to 3, and rungs 4 and 5 carry their rows', () => {
    // THE TRIPWIRE WAS DISCHARGED BY RE-DECIDING, NOT BY WIDENING
    // (masterwrought Phase 11j, decision B). The old arm asserted no hoe rung
    // anywhere had a Marks row, and carried a deliberate self-clearing message
    // telling whoever added one to re-pin the arm rather than delete it. That
    // is what happened: farming was the only gathering profession with no
    // non-crafter route at the tier-4 rung, which masterwrought R18 forbids,
    // so BOTH the tier-4 and tier-5 hoes joined the Drowned Litany counter
    // beside their land and rod siblings.
    //
    // What survives is the rule for rungs 1 to 3, which really are craft-only
    // (rung 1 is the copper entry purchase, rungs 2 and 3 have no route but
    // the toolworks or another player). Asserted BOTH ways so neither half can
    // rot: the low rungs must stay off the counter, and the top two must stay
    // on it at the price and gate their tier earns.
    const delveStocked = new Map(
      Object.values(DELVE_SHOPS).flatMap((entries) => entries.map((e) => [e.itemId, e] as const)),
    );
    for (const recipe of HOE_RECIPES) {
      const tier = hoeTierOf(recipe.resultItemId) as number;
      if (tier <= 3) {
        expect(
          delveStocked.has(recipe.resultItemId),
          `${recipe.resultItemId} is a rung-1-to-3 hoe and gained a Marks row: re-decide this arm deliberately, never widen it`,
        ).toBe(false);
      }
    }
    expect(delveStocked.get('garden_hoe')).toBeUndefined();
    expect(delveStocked.get('bronze_hoe')).toBeUndefined();
    expect(delveStocked.get('skysilver_hoe')).toBeUndefined();
    // The two that DID join, on the counter's own existing rungs: no new price
    // point and no new gate was invented for either.
    expect(delveStocked.get('osmium_hoe')).toMatchObject({ marks: 24, gate: 'clears:3' });
    expect(delveStocked.get('evergarden_hoe')).toMatchObject({
      marks: 56,
      gate: 'heroicClear',
    });
  });
});
