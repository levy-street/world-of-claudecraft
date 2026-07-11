// Coverage for three professions-completion issues:
// - #1299 recipe acquisition layer (a recipe must be known before it can be
//   crafted, orthogonal to tier; existing content is grandfathered).
// - #1300 salvage/disenchant (break an eligible item back into materials).
// - #1301 gold sink + output throttle on crafting.

import { describe, expect, it } from 'vitest';
import {
  CRAFT_GOLD_SINK_COPPER_PER_BUDGET,
  CRAFT_THROTTLE_MAX_PER_WINDOW,
  CRAFT_THROTTLE_WINDOW_SECONDS,
} from '../src/sim/content/professions';
import { COMMON_RECIPES } from '../src/sim/content/recipes';
import {
  acquireRecipeForRecipe,
  isRecipeKnown,
  resolveCraftForRecipe,
} from '../src/sim/professions/crafting';
import { isSalvageable, resolveSalvage, salvageYield } from '../src/sim/professions/salvage';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 7) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function grantItem(sim: Sim, itemId: string, count: number, pid: number) {
  for (let i = 0; i < count; i++) sim.addItem(itemId, 1, pid);
}

const GATED_RECIPE: ProfessionRecipeRecord = {
  id: 'recipe_test_gated',
  professionId: 'weaponcrafting',
  resultItemId: 'eastbrook_arming_sword',
  resultCount: 1,
  reagents: [{ itemId: 'bone_fragments', count: 1 }],
  skillReq: 0,
  trivialAt: 25,
  itemLevelBudget: 1,
  acquisition: ['trainer'],
};

describe('#1299 recipe acquisition', () => {
  it('existing content recipes are grandfathered (no acquisition field = known)', () => {
    for (const recipe of COMMON_RECIPES) {
      expect(isRecipeKnown(undefined, recipe)).toBe(true);
    }
  });

  it('denies crafting a gated recipe the player has not acquired, even with materials and gold', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantItem(sim, 'bone_fragments', 5, pid);
    const result = resolveCraftForRecipe(sim.ctx, pid, GATED_RECIPE);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('recipe_not_learned');
  });

  it('acquireRecipe on an unregistered recipe id is denied as unknown_recipe', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // GATED_RECIPE is a synthetic test fixture, not registered in
    // content/recipes.ts, so recipeById cannot resolve it: this exercises the
    // unknown_recipe arm of the acquireRecipe delegate.
    const bad = sim.acquireRecipe(GATED_RECIPE.id, 'trainer', pid);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('unknown_recipe');
  });

  it('acquireRecipe on a grandfathered (non-gated) recipe is denied as already_known', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const result = sim.acquireRecipe(COMMON_RECIPES[0].id, 'trainer', pid);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('already_known');
  });

  it('acquiring from a source the recipe does not list is denied as wrong_source, learning nothing', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    // GATED_RECIPE lists only 'trainer'; a drop can never teach it.
    const result = acquireRecipeForRecipe(sim.ctx, pid, GATED_RECIPE, 'drop');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_source');
    expect(meta.knownRecipes.size).toBe(0);
    expect(isRecipeKnown(meta, GATED_RECIPE)).toBe(false);
  });

  it('acquiring from the correct source marks the recipe known, and it persists across a reload', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    expect(meta).toBeTruthy();
    if (!meta) return;
    expect(isRecipeKnown(meta, GATED_RECIPE)).toBe(false);
    // Drive the REAL success arm (via the ForRecipe split, since no content
    // recipe carries an acquisition list yet), not a direct Set mutation.
    const learned = acquireRecipeForRecipe(sim.ctx, pid, GATED_RECIPE, 'trainer');
    expect(learned.ok).toBe(true);
    expect(learned.reason).toBeUndefined();
    meta.copper = 1000;
    expect(isRecipeKnown(meta, GATED_RECIPE)).toBe(true);
    grantItem(sim, 'bone_fragments', 5, pid);
    const result = resolveCraftForRecipe(sim.ctx, pid, GATED_RECIPE);
    expect(result.ok).toBe(true);

    // Learning twice is denied as already_known.
    const again = acquireRecipeForRecipe(sim.ctx, pid, GATED_RECIPE, 'trainer');
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('already_known');

    // Persistence round-trip: serialize then reload into a fresh Sim.
    const saved = sim.serializeCharacter(pid);
    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('warrior', 'Reloaded', { state: saved ?? undefined });
    const meta2 = (sim2 as any).players.get(pid2);
    expect(meta2?.knownRecipes.has(GATED_RECIPE.id)).toBe(true);
  });

  it('a save with no knownRecipes field loads cleanly with an empty set (back-compat)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const saved = sim.serializeCharacter(pid);
    (saved as { knownRecipes?: string[] }).knownRecipes = undefined;
    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('warrior', 'Legacy', { state: saved ?? undefined });
    expect((sim2 as any).players.get(pid2)?.knownRecipes.size).toBe(0);
  });
});

describe('#1300 salvage/disenchant', () => {
  it('an ineligible item (consumable/junk) cannot be salvaged', () => {
    expect(isSalvageable(undefined)).toBe(false);
    const sim = makeSim();
    const pid = sim.playerId;
    grantItem(sim, 'tough_jerky', 1, pid);
    const result = resolveSalvage(sim.ctx, pid, 'tough_jerky');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_salvageable');
  });

  it('denies salvaging an item the player does not hold', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const result = resolveSalvage(sim.ctx, pid, 'eastbrook_arming_sword');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_held');
  });

  it('salvaging an eligible item consumes it and yields a scripted material via Rng', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantItem(sim, 'eastbrook_arming_sword', 1, pid);
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(1);
    const result = resolveSalvage(sim.ctx, pid, 'eastbrook_arming_sword');
    expect(result.ok).toBe(true);
    // Pinned literal: a common-quality piece salvages into bone_fragments per
    // SALVAGE_MATERIAL_BY_QUALITY, so a remap cannot pass silently.
    expect(result.materialItemId).toBe('bone_fragments');
    expect(result.count).toBeGreaterThan(0);
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(0);
    if (result.materialItemId) {
      expect(sim.countItem(result.materialItemId, pid)).toBe(result.count);
    }
  });

  it('yield scales with rarity: a higher-quality item never yields less than a lower one, all else equal', () => {
    // Two identically-seeded rng instances, one draw each, so the bonus draw
    // itself is identical between the two calls: isolates quality as the only
    // variable instead of letting a shared rng's second draw differ from its
    // first.
    const low = salvageYield(
      { id: 'a', name: 'a', sellValue: 0, quality: 'common', kind: 'weapon' } as never,
      makeSim().ctx.rng,
    );
    const high = salvageYield(
      { id: 'b', name: 'b', sellValue: 0, quality: 'legendary', kind: 'weapon' } as never,
      makeSim().ctx.rng,
    );
    // With the bonus draws identical, the yields differ by the quality term
    // (legendary index 4 minus common index 0 = 4) PLUS the derived-tier term
    // (#1712 round-3 review point 11: salvageYield's tier axis now reads
    // requiredLevelFor, not raw requiredLevel, so it engages for every item,
    // not just the ones with an explicit level pinned). Neither fake item has
    // an explicit requiredLevel or a derivable itemSourceLevel, so
    // requiredLevelFor falls back per-quality: common -> 1 (tierBonus 0),
    // legendary -> MAX_LEVEL 20 (tierBonus 2). Total delta = 4 + 2 = 6. A
    // strict delta, not >=, so dropping or neutering either term cannot pass.
    expect(high - low).toBe(6);
  });
});

describe('#1301 gold sink and output throttle', () => {
  it('charges a gold fee proportional to the recipe budget on a successful craft', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    if (!meta) throw new Error('no meta');
    meta.copper = 1000;
    const recipe = COMMON_RECIPES[0];
    for (const reagent of recipe.reagents) grantItem(sim, reagent.itemId, 10, pid);
    const before = meta.copper;
    const result = resolveCraftForRecipe(sim.ctx, pid, recipe);
    expect(result.ok).toBe(true);
    // Pinned to literals (not recomputed from the constants under test): a
    // rate change to CRAFT_GOLD_SINK_COPPER_PER_BUDGET or recipe.itemLevelBudget
    // would otherwise slip past this assertion silently.
    expect(CRAFT_GOLD_SINK_COPPER_PER_BUDGET).toBe(2);
    expect(recipe.itemLevelBudget).toBe(10);
    expect(meta.copper).toBe(before - 20);
  });

  it('a broke player can still craft (the sink never gates a craft), floored at 0 copper', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    if (!meta) throw new Error('no meta');
    meta.copper = 0;
    const recipe = COMMON_RECIPES[0];
    for (const reagent of recipe.reagents) grantItem(sim, reagent.itemId, 10, pid);
    const result = resolveCraftForRecipe(sim.ctx, pid, recipe);
    expect(result.ok).toBe(true);
    expect(meta.copper).toBe(0);
  });

  it('throttles a maxed specialist to CRAFT_THROTTLE_MAX_PER_WINDOW crafts per window', () => {
    // Pinned to literals so a re-tune of either constant cannot pass silently.
    expect(CRAFT_THROTTLE_MAX_PER_WINDOW).toBe(10);
    expect(CRAFT_THROTTLE_WINDOW_SECONDS).toBe(60);
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    if (!meta) throw new Error('no meta');
    meta.copper = 1_000_000;
    const recipe = COMMON_RECIPES[0];
    let successCount = 0;
    for (let i = 0; i < CRAFT_THROTTLE_MAX_PER_WINDOW + 5; i++) {
      for (const reagent of recipe.reagents) grantItem(sim, reagent.itemId, reagent.count, pid);
      const result = resolveCraftForRecipe(sim.ctx, pid, recipe);
      if (result.ok) successCount++;
      else expect(result.reason).toBe('throttled');
    }
    expect(successCount).toBe(CRAFT_THROTTLE_MAX_PER_WINDOW);
    // The gold sink charges SUCCESSFUL crafts only: the 5 throttled denials
    // above must not have drained a copper (fee = budget 10 * rate 2 = 20).
    expect(meta.copper).toBe(1_000_000 - CRAFT_THROTTLE_MAX_PER_WINDOW * 20);
  });

  it('the throttle window resets after CRAFT_THROTTLE_WINDOW_SECONDS of sim time', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    if (!meta) throw new Error('no meta');
    meta.copper = 1_000_000;
    const recipe = COMMON_RECIPES[0];
    for (let i = 0; i < CRAFT_THROTTLE_MAX_PER_WINDOW; i++) {
      for (const reagent of recipe.reagents) grantItem(sim, reagent.itemId, reagent.count, pid);
      expect(resolveCraftForRecipe(sim.ctx, pid, recipe).ok).toBe(true);
    }
    for (const reagent of recipe.reagents) grantItem(sim, reagent.itemId, reagent.count, pid);
    expect(resolveCraftForRecipe(sim.ctx, pid, recipe).reason).toBe('throttled');
    meta.craftThrottle.windowStart -= CRAFT_THROTTLE_WINDOW_SECONDS;
    for (const reagent of recipe.reagents) grantItem(sim, reagent.itemId, reagent.count, pid);
    expect(resolveCraftForRecipe(sim.ctx, pid, recipe).ok).toBe(true);
  });
});
