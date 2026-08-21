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
  it('is exactly the three rungs above the vendor hoe, each producing the next tier up', () => {
    expect(HOE_RECIPES).toHaveLength(3);
    const producedTiers = HOE_RECIPES.map((r) => hoeTierOf(r.resultItemId));
    expect(producedTiers).toEqual([2, 3, 4]);
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
    expect(checked).toBe(3);
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
    expect(fineTwins).toBe(3);
  });

  it('all three rungs are trainer-taught, at a skill a learner can actually reach', () => {
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
    expect(HOE_RECIPES.map((r) => r.skillReq)).toEqual([25, 50, 75]);
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

  it('rungs 2 to 4 are CRAFT-ONLY: no copper price, no counter, and deliberately no Marks row', () => {
    // The divergence from the rod ladder, pinned so it cannot be mistaken
    // for an oversight: the rods leave rungs 2 and 3 vendor-priced and keep
    // a delve Marks fallback for the crafted pair, but the hoe pricing table
    // locks buyValue OFF rungs 2 to 4 and the phase ships NO Marks row (the
    // hoe block in content/items.ts, flagged for the maintainer), so craft
    // is the only mint above rung 1 and a non-engineer farmer buys from
    // players via market or trade.
    const delveStocked = new Set(
      Object.values(DELVE_SHOPS).flatMap((entries) => entries.map((e) => e.itemId)),
    );
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
      expect(
        delveStocked.has(recipe.resultItemId),
        `${recipe.resultItemId} gained a Marks row: re-pin this arm deliberately`,
      ).toBe(false);
    }
    // The entry rung stays the 20-copper vendor purchase, which is what
    // gives the craft-only ladder its entry point (the acquisition-coverage
    // note in content/recipes.ts).
    expect(ITEMS.garden_hoe.buyValue).toBe(20);
  });
});
