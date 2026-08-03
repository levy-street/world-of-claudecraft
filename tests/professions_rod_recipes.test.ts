// The crafted rod ladder (D9): what each rung consumes, how far its self-gate
// actually reaches, and why it is a separate list from TOOL_RECIPES rather
// than two more rows in it.
//
// The land ladder's invariant (tests/material_grades.test.ts) is that every
// crafted tool consumes a FINE gathered grade plus the tool one rung down.
// Fishing has no world nodes, so it has no fine grades, and this file states
// the fishing ladder's own invariant instead of widening that one into a
// disjunction both could satisfy for different reasons.
import { describe, expect, it } from 'vitest';
import { DELVE_SHOPS } from '../src/sim/content/delves/shop';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { FISHING_RARE_ID, FISHING_TABLES_BY_BAND } from '../src/sim/content/items';
import { craftMaxSkillFor } from '../src/sim/content/professions';
import { ALL_RECIPES, ROD_RECIPES, TOOL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, NPCS } from '../src/sim/data';
import { rodTierRequiredForZone } from '../src/sim/professions/fishing_zones';
import { baseMaterialFor } from '../src/sim/professions/material_grades';
import { isGatherToolUse } from '../src/sim/professions/tools';
import { tierForSkill } from '../src/sim/professions/wheel';

const rodTierOf = (itemId: string): number | undefined => {
  const use = ITEMS[itemId]?.use;
  return isGatherToolUse(use) && use.professionId === 'fishing' ? use.tier : undefined;
};

describe('the crafted rod ladder', () => {
  it('is exactly the two rungs above the vendor rods, each producing the next tier up', () => {
    expect(ROD_RECIPES).toHaveLength(2);
    const producedTiers = ROD_RECIPES.map((r) => rodTierOf(r.resultItemId));
    expect(producedTiers).toEqual([4, 5]);
    for (const recipe of ROD_RECIPES) {
      expect(recipe.professionId).toBe('engineering');
      expect(recipe.stationType).toBe('toolworks');
      expect(recipe.resultCount).toBe(1);
    }
  });

  it('each rung consumes the rod one rung down, and exactly one rod', () => {
    let checked = 0;
    for (const recipe of ROD_RECIPES) {
      const outputTier = rodTierOf(recipe.resultItemId) as number;
      const rodReagents = recipe.reagents.filter((r) => rodTierOf(r.itemId) !== undefined);
      expect(rodReagents, `${recipe.id} must consume exactly one rod`).toHaveLength(1);
      expect(rodTierOf(rodReagents[0].itemId), `${recipe.id} rung below`).toBe(outputTier - 1);
      expect(rodReagents[0].count).toBe(1);
      checked += 1;
    }
    expect(checked).toBe(2);
  });

  it('every rung consumes a catch, and no rung consumes a fine grade', () => {
    // The positive half is the ladder's own material story: a rod is made of
    // what a rod pulls out of the water, the same way a pick is made of ore.
    // The negative half is what keeps this list out of TOOL_RECIPES' way: a
    // fine grade outside that list would red the "only TOOL_RECIPES consumes
    // a fine grade" sweep in tests/material_grades.test.ts.
    let catchReagents = 0;
    for (const recipe of ROD_RECIPES) {
      const fromWater = recipe.reagents.filter(
        (r) => ITEMS[r.itemId]?.kind === 'food' || r.itemId === FISHING_RARE_ID,
      );
      expect(fromWater.length, `${recipe.id} must consume a catch`).toBeGreaterThan(0);
      catchReagents += fromWater.length;
      for (const reagent of recipe.reagents) {
        expect(
          baseMaterialFor(reagent.itemId),
          `${recipe.id} consumes the fine grade ${reagent.itemId}`,
        ).toBeUndefined();
      }
    }
    expect(catchReagents).toBe(3);
  });

  it('the tier-5 rung is HARD self-gated: its catch cannot be landed without the rung below', () => {
    // The land ladder's fine grades only drop for a tool already above them.
    // The rod ladder gets the same property here, and only here, through the
    // zone gate: the Slatefin Carp is a Thornpeak-only row, and Thornpeak
    // water takes a tier-3 rod, which is what the tier-4 rod descends from.
    const tier5 = ROD_RECIPES.find((r) => rodTierOf(r.resultItemId) === 5);
    expect(tier5).toBeDefined();
    const gatedCatch = 'raw_stonescale_carp';
    expect(tier5?.reagents.some((r) => r.itemId === gatedCatch)).toBe(true);
    // Derived, not asserted by hand: the carp really is Thornpeak-only, in
    // every band, so re-tabling it into Vale water reds this instead of
    // quietly opening the ladder.
    const zonesHolding = new Set<string>();
    for (const byZone of FISHING_TABLES_BY_BAND) {
      for (const [zoneId, rows] of Object.entries(byZone)) {
        if (rows.some((r) => r.itemId === gatedCatch)) zonesHolding.add(zoneId);
      }
    }
    expect([...zonesHolding]).toEqual(['thornpeak_heights']);
    expect(rodTierRequiredForZone('thornpeak_heights')).toBe(3);
    // And the water is the ONLY route to it, which is what makes the two
    // facts above compose into a gate. A vendor row, a mob drop, or another
    // recipe's output would open the ladder with the rest of this test green.
    expect(ITEMS[gatedCatch].buyValue).toBeUndefined();
    for (const npc of Object.values(NPCS)) {
      expect(npc.vendorItems ?? [], `${npc.id} stocks the gated catch`).not.toContain(gatedCatch);
    }
    expect(
      ALL_RECIPES.filter((r) => r.resultItemId === gatedCatch),
      'the gated catch must not be craftable',
    ).toEqual([]);
  });

  it('the tier-4 rung is PACED, not gated, and says so: the koi is landable at every band', () => {
    // The deliberate divergence from the land ladder, pinned so it cannot be
    // mistaken for an oversight. The rare catch pays six times better at band
    // 2, but it is never impossible: it is also the low-level thrill and a
    // collection deed, and gating it behind fishing's 200 cap would have put
    // the tier-4 rod past the end of the climb rather than partway up it.
    const tier4 = ROD_RECIPES.find((r) => rodTierOf(r.resultItemId) === 4);
    expect(tier4?.reagents.some((r) => r.itemId === FISHING_RARE_ID)).toBe(true);
    let bandsWhereLandable = 0;
    for (const byZone of FISHING_TABLES_BY_BAND) {
      const row = byZone.eastbrook_vale.find((r) => r.itemId === FISHING_RARE_ID);
      expect(row, 'the koi must stay on the starter table').toBeDefined();
      expect(row?.weight).toBeGreaterThan(0);
      bandsWhereLandable += 1;
    }
    expect(bandsWhereLandable).toBe(3);
  });

  it('both rungs are trainer-taught, at a skill a learner can actually reach', () => {
    // The pre-training id list is frozen, so anything authored after that
    // switch has to be learned. That makes the skill requirement load-bearing
    // in a way it is not for the grandfathered land tools: a trainer only
    // teaches a recipe whose TIER the learner has reached, so a requirement
    // above the craft's own cap is unlearnable rather than merely expensive.
    const cap = craftMaxSkillFor('engineering');
    for (const recipe of ROD_RECIPES) {
      expect(recipe.acquisition, `${recipe.id} acquisition`).toEqual(['trainer']);
      expect(
        tierForSkill(recipe.skillReq),
        `${recipe.id} skillReq ${recipe.skillReq} is above the reachable tier`,
      ).toBeLessThanOrEqual(tierForSkill(cap));
    }
    expect(ROD_RECIPES.map((r) => r.skillReq)).toEqual([75, 125]);
    // The trap this guards, stated as the arithmetic rather than as prose:
    // the shipped land tier-5 recipes sit at 150, which resolves ABOVE the
    // cap's tier, and they only work because they predate training.
    expect(tierForSkill(150)).toBeGreaterThan(tierForSkill(cap));
    expect(TOOL_RECIPES.some((r) => r.skillReq === 150 && !r.acquisition)).toBe(true);
  });

  it('rides ALL_RECIPES, and stays out of TOOL_RECIPES', () => {
    const rodIds = new Set(ROD_RECIPES.map((r) => r.id));
    for (const id of rodIds) {
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

  it('neither rung is counterfactually vendor-fed, because the koi carries no price', () => {
    // Why the six-id literal in tests/recipe_economy.test.ts did not move.
    // This is a property of the reagent, not an exemption, so it is asserted
    // where it is caused rather than assumed where it is consumed.
    expect(ITEMS[FISHING_RARE_ID].buyValue).toBeUndefined();
    for (const recipe of ROD_RECIPES) {
      const allPriced = recipe.reagents.every((r) => typeof ITEMS[r.itemId]?.buyValue === 'number');
      expect(allPriced, `${recipe.id} would join the vendor-fed set`).toBe(false);
    }
  });

  it('neither rod is ever sold for copper, on any of the three stock tables', () => {
    for (const recipe of ROD_RECIPES) {
      expect(ITEMS[recipe.resultItemId].buyValue).toBeUndefined();
      // The price convention alone is not the claim in the title: sweep the
      // real vendor lists too, the way tests/professions_tools.test.ts does
      // for the crafted land tools.
      for (const npc of Object.values(NPCS)) {
        expect(npc.vendorItems ?? [], `${npc.id} stocks ${recipe.resultItemId}`).not.toContain(
          recipe.resultItemId,
        );
      }
      // The two tables an NPCS-only sweep cannot see. The heroic
      // quartermaster's vendorItems is undefined and its real stock lives in
      // HEROIC_VENDOR_STOCK, so this arm was blind to the counter most likely
      // to be handed a top-tier item.
      expect(
        HEROIC_VENDOR_STOCK.map((o) => o.itemId),
        `the heroic counter stocks ${recipe.resultItemId}`,
      ).not.toContain(recipe.resultItemId);
    }
  });

  it('both rods ARE reachable without engineering, priced in Marks', () => {
    // The other half of the restated claim. "Craft-only" stopped being true
    // when the delve counter gained a Marks route, and a guard that only ever
    // says where a thing is absent cannot notice that its one source vanished.
    const delveRows = Object.values(DELVE_SHOPS).flat();
    for (const recipe of ROD_RECIPES) {
      const row = delveRows.find((e) => e.itemId === recipe.resultItemId);
      expect(row, `${recipe.resultItemId} needs a non-crafter route`).toBeDefined();
      expect(row?.marks).toBeGreaterThan(0);
      // Marks, and still no copper price on the def itself.
      expect(ITEMS[recipe.resultItemId].buyValue).toBeUndefined();
    }
  });
});
