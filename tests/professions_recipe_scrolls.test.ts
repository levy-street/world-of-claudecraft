// Recipe scrolls: the drop-taught learn path (raid professions,
// docs/prd/ignivar-raid-professions.md). Every arm exercised against
// synthetic gated recipes through the ForRecipe split (the
// acquireRecipeForRecipe test convention), plus one integration arm against
// real trainer-gated content. The items.ts use-arm end-to-end (a real scroll
// item in the bags) lands with the content wave, which authors the first
// teachRecipe items.
import { describe, expect, it } from 'vitest';
import { TOOL_EFFECT_RECIPES } from '../src/sim/content/recipes';
import {
  resolveScrollTeach,
  useRecipeScroll,
  useRecipeScrollForRecipe,
} from '../src/sim/professions/recipe_scrolls';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function metaOf(sim: Sim) {
  const meta = (sim as any).players.get(sim.playerId);
  if (!meta) throw new Error('player meta missing');
  return meta;
}

/** Drain the sim's queued events via a tick and return the scroll results. */
function scrollEvents(sim: Sim) {
  return sim.tick().filter((ev: any) => ev.type === 'recipeScrollResult') as Array<{
    type: 'recipeScrollResult';
    ok: boolean;
    recipeId: string;
    reason?: string;
    pid?: number;
  }>;
}

const DROP_RECIPE: ProfessionRecipeRecord = {
  id: 'test_scroll_recipe',
  professionId: 'armorcrafting',
  resultItemId: 'iron_ore',
  resultCount: 1,
  reagents: [],
  skillReq: 100,
  itemLevelBudget: 31,
  level: 31,
  acquisition: ['drop'],
};

describe('recipe scrolls: the teach decision', () => {
  it('teaches at the tier floor and refuses below it', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.craftSkills.armorcrafting = 99;
    expect(resolveScrollTeach(meta, DROP_RECIPE)).toBe('scroll_tier_unmet');
    meta.craftSkills.armorcrafting = 100;
    expect(resolveScrollTeach(meta, DROP_RECIPE)).toBeNull();
  });

  it('refuses an already-known recipe', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.craftSkills.armorcrafting = 100;
    meta.knownRecipes.add(DROP_RECIPE.id);
    expect(resolveScrollTeach(meta, DROP_RECIPE)).toBe('scroll_already_known');
  });

  it('refuses a recipe whose acquisition does not list drop', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.craftSkills.enchanting = 125;
    const trainerOnly: ProfessionRecipeRecord = {
      ...DROP_RECIPE,
      id: 'test_trainer_recipe',
      professionId: 'enchanting',
      acquisition: ['trainer'],
    };
    expect(resolveScrollTeach(meta, trainerOnly)).toBe('scroll_wrong_source');
  });
});

describe('recipe scrolls: the use command body', () => {
  it('success: learns, consumes exactly one scroll, emits ok', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.craftSkills.armorcrafting = 100;
    let consumed = 0;
    useRecipeScrollForRecipe(sim.ctx, meta, DROP_RECIPE, () => consumed++);
    expect(consumed).toBe(1);
    expect(meta.knownRecipes.has(DROP_RECIPE.id)).toBe(true);
    const events = scrollEvents(sim);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      ok: true,
      recipeId: DROP_RECIPE.id,
      pid: sim.playerId,
    });
    expect(events[0].reason).toBeUndefined();
  });

  it('every deny leaves the scroll unconsumed and the recipe unlearned', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    let consumed = 0;
    // Below the floor.
    meta.craftSkills.armorcrafting = 0;
    useRecipeScrollForRecipe(sim.ctx, meta, DROP_RECIPE, () => consumed++);
    // Already known (floor met, pre-known).
    meta.craftSkills.armorcrafting = 100;
    meta.knownRecipes.add(DROP_RECIPE.id);
    useRecipeScrollForRecipe(sim.ctx, meta, DROP_RECIPE, () => consumed++);
    expect(consumed).toBe(0);
    const events = scrollEvents(sim);
    expect(events.map((ev) => ev.reason)).toEqual(['scroll_tier_unmet', 'scroll_already_known']);
    expect(events.every((ev) => !ev.ok)).toBe(true);
  });

  it('an unknown recipe id emits the silent-deny arm and never consumes', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    let consumed = 0;
    useRecipeScroll(sim.ctx, meta, 'no_such_recipe', () => consumed++);
    expect(consumed).toBe(0);
    const events = scrollEvents(sim);
    expect(events).toHaveLength(1);
    expect(events[0].ok).toBe(false);
    expect(events[0].reason).toBeUndefined();
  });

  it('integration: a real trainer-gated recipe refuses as wrong_source', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    const trainerRecipe = TOOL_EFFECT_RECIPES[0];
    expect(trainerRecipe.acquisition).toEqual(['trainer']);
    meta.craftSkills[trainerRecipe.professionId] = 125;
    let consumed = 0;
    useRecipeScroll(sim.ctx, meta, trainerRecipe.id, () => consumed++);
    expect(consumed).toBe(0);
    expect(meta.knownRecipes.has(trainerRecipe.id)).toBe(false);
    const events = scrollEvents(sim);
    expect(events[0].reason).toBe('scroll_wrong_source');
  });

  it('the scroll floor and the trainer floor are the same rule', () => {
    // The scroll path reuses teachTierMet, so a recipe learnable at a
    // trainer tier is learnable from a scroll at the same skill, per craft.
    const sim = makeSim();
    const meta = metaOf(sim);
    for (const skillReq of [0, 25, 50, 75, 100, 125]) {
      const recipe: ProfessionRecipeRecord = {
        ...DROP_RECIPE,
        id: `test_floor_${skillReq}`,
        skillReq,
      };
      meta.craftSkills.armorcrafting = Math.max(0, skillReq - 1);
      const below = skillReq === 0 ? null : (resolveScrollTeach(meta, recipe) as string | null);
      meta.craftSkills.armorcrafting = skillReq;
      const at = resolveScrollTeach(meta, recipe);
      if (skillReq > 0) expect(below).toBe('scroll_tier_unmet');
      expect(at).toBeNull();
      meta.knownRecipes.delete(recipe.id);
    }
  });
});
