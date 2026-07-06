import { describe, expect, it } from 'vitest';
import { COMMON_RECIPES, recipeById } from '../src/sim/content/recipes';
import {
  hasRecipeMaterials,
  resolveCraft,
  resolveCraftForRecipe,
} from '../src/sim/professions/crafting';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import type { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function grantItem(sim: Sim, itemId: string, count: number, pid: number) {
  for (let i = 0; i < count; i++) sim.addItem(itemId, 1, pid);
}

describe('recipe content (#1127)', () => {
  it('defines at least one recipe per craft on the ring, all common tier', () => {
    expect(COMMON_RECIPES.length).toBeGreaterThanOrEqual(5);
    for (const recipe of COMMON_RECIPES) {
      expect(recipe.skillReq).toBe(0); // free-floor: common tier costs zero skill
      expect(recipe.reagents.length).toBeGreaterThan(0);
      expect(recipe.resultCount).toBeGreaterThan(0);
    }
  });

  it('recipeById resolves a known id and returns undefined for an unknown one', () => {
    expect(recipeById(COMMON_RECIPES[0].id)?.id).toBe(COMMON_RECIPES[0].id);
    expect(recipeById('not_a_real_recipe')).toBeUndefined();
  });
});

describe('resolveCraft (#1127)', () => {
  it('consumes exactly the required materials and produces the correct output', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_tough_jerky')!;
    grantItem(sim, 'spider_leg', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(true);
    expect(result.itemId).toBe('tough_jerky');
    expect(result.count).toBe(1);
    expect(sim.countItem('spider_leg', pid)).toBe(0);
    expect(sim.countItem('tough_jerky', pid)).toBe(1);
  });

  it('consumes multi-reagent recipes down to exactly zero, never over- or under-consuming', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_eastbrook_arming_sword')!;
    grantItem(sim, 'bone_fragments', 2, pid);
    grantItem(sim, 'linen_scrap', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(true);
    expect(sim.countItem('bone_fragments', pid)).toBe(0);
    expect(sim.countItem('linen_scrap', pid)).toBe(0);
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(1);
  });

  it('denies and consumes NOTHING when any single reagent is short', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_eastbrook_arming_sword')!;
    // One bone_fragments short of the required 2.
    grantItem(sim, 'bone_fragments', 1, pid);
    grantItem(sim, 'linen_scrap', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    // Partial consumption never happens: both reagents untouched.
    expect(sim.countItem('bone_fragments', pid)).toBe(1);
    expect(sim.countItem('linen_scrap', pid)).toBe(1);
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(0);
  });

  it('denies and consumes NOTHING when a LATER reagent is short (mirror of the first-reagent-short case)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_eastbrook_arming_sword')!;
    // Held bone_fragments (reagents[0]) in full, short on linen_scrap (reagents[1]).
    grantItem(sim, 'bone_fragments', 2, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    expect(sim.countItem('bone_fragments', pid)).toBe(2);
    expect(sim.countItem('linen_scrap', pid)).toBe(0);
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(0);
  });

  it('denies an unknown recipe id with no side effects', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const result = resolveCraft((sim as any).ctx, pid, 'not_a_real_recipe');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown_recipe');
  });

  it('hasRecipeMaterials matches resolveCraft admission without mutating state', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_tough_jerky')!;
    expect(hasRecipeMaterials((sim as any).ctx, recipe, pid)).toBe(false);
    grantItem(sim, 'spider_leg', 1, pid);
    expect(hasRecipeMaterials((sim as any).ctx, recipe, pid)).toBe(true);
    // Read-only: no reagent was consumed by the check itself.
    expect(sim.countItem('spider_leg', pid)).toBe(1);
  });

  it('grants a flat point of craft skill for the crafted recipe only', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_tough_jerky')!;
    grantItem(sim, 'spider_leg', 2, pid);
    const meta = (sim as any).players.get(pid);

    resolveCraft((sim as any).ctx, pid, recipe.id);
    expect(meta.craftSkills.cooking).toBe(1);
    expect(meta.craftSkills.weaponcrafting).toBe(0);

    resolveCraft((sim as any).ctx, pid, recipe.id);
    expect(meta.craftSkills.cooking).toBe(2);
  });

  it('the quality roll is deterministic under a fixed seed and consumes exactly one rng draw', () => {
    const runOnce = () => {
      const sim = makeSim(7);
      const pid = sim.playerId;
      grantItem(sim, 'spider_leg', 1, pid);
      const recipe = recipeById('recipe_tough_jerky')!;
      const drawsBefore = (sim as any).rng.draws ?? 0;
      const result = resolveCraft((sim as any).ctx, pid, recipe.id);
      return { result, drawsBefore };
    };
    const a = runOnce();
    const b = runOnce();
    expect(a.result.quality).toBe(b.result.quality);
    expect(typeof a.result.quality).toBe('string');
  });

  it('grants no craft skill on a denied craft', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_tough_jerky')!;
    const meta = (sim as any).players.get(pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(false);
    expect(meta.craftSkills.cooking).toBe(0);
  });

  it('the quality roll is pinned for a fixed seed and consumes exactly one rng draw on success, zero on denial', () => {
    const sim = makeSim(7);
    const pid = sim.playerId;
    const recipe = recipeById('recipe_tough_jerky')!;

    let draws = 0;
    const rng: Rng = (sim as any).ctx.rng;
    rng.setObserver(() => {
      draws++;
    });

    const denied = resolveCraft((sim as any).ctx, pid, recipe.id);
    expect(denied.ok).toBe(false);
    expect(draws).toBe(0);

    grantItem(sim, 'spider_leg', 1, pid);
    const result = resolveCraft((sim as any).ctx, pid, recipe.id);
    rng.setObserver(null);

    expect(result.ok).toBe(true);
    // Fresh cooking skill (0) at seed 7: the roll is pinned to this rarity.
    expect(result.quality).toBe('common');
    expect(draws).toBe(1);
  });
});

describe('craftItem command (#1127)', () => {
  it('resolves server-side via Sim.craftItem, stashing the result on lastCraftResult', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantItem(sim, 'spider_leg', 1, pid);
    sim.craftItem('recipe_tough_jerky', pid);
    expect(sim.lastCraftResult?.ok).toBe(true);
    expect(sim.lastCraftResult?.itemId).toBe('tough_jerky');
    expect(sim.countItem('tough_jerky', pid)).toBe(1);
  });

  it('the IWorld recipeList read surface exposes the common-tier recipe content', () => {
    const sim = makeSim();
    expect(sim.recipeList.length).toBe(COMMON_RECIPES.length);
    expect(sim.recipeList.map((r) => r.id).sort()).toEqual(COMMON_RECIPES.map((r) => r.id).sort());
  });

  it('denies a craft with an error event and leaves lastCraftResult reflecting the denial', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.craftItem('recipe_tough_jerky', pid);
    expect(sim.lastCraftResult?.ok).toBe(false);
    expect(sim.lastCraftResult?.reason).toBe('insufficient_materials');
  });
});

describe('tiered mastery gating (#1128)', () => {
  // A synthetic tier-1 recipe (skillReq 25, one bucket above common) reusing an
  // existing harvested reagent, so these tests can drive the tier curve without
  // needing higher-tier content in content/recipes.ts (that is a later issue).
  const tier1Recipe: ProfessionRecipeRecord = {
    id: 'test_tier1_recipe',
    professionId: 'weaponcrafting',
    resultItemId: 'eastbrook_arming_sword',
    resultCount: 1,
    reagents: [{ itemId: 'bone_fragments', count: 1 }],
    skillReq: 25,
    trivialAt: 50,
    itemLevelBudget: 10,
  };

  function setSkill(sim: Sim, pid: number, craftId: string, value: number) {
    const meta = (sim as any).players.get(pid);
    meta.craftSkills[craftId] = value;
  }

  it('crafting at the player tier capability grants full skill progress', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    setSkill(sim, pid, 'weaponcrafting', 25); // tier-1 capability
    grantItem(sim, 'bone_fragments', 1, pid);

    const result = resolveCraftForRecipe((sim as any).ctx, pid, tier1Recipe);

    expect(result.ok).toBe(true);
    const meta = (sim as any).players.get(pid);
    expect(meta.craftSkills.weaponcrafting).toBe(26); // 25 + full 1 point
  });

  it('crafting one tier below capability grants reduced (but non-zero) skill progress', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    setSkill(sim, pid, 'weaponcrafting', 50); // tier-2 capability, recipe is tier-1
    grantItem(sim, 'bone_fragments', 1, pid);

    const result = resolveCraftForRecipe((sim as any).ctx, pid, tier1Recipe);

    expect(result.ok).toBe(true);
    const meta = (sim as any).players.get(pid);
    const gained = meta.craftSkills.weaponcrafting - 50;
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThan(1);
  });

  it('crafting two or more tiers below capability grants zero skill progress', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    setSkill(sim, pid, 'weaponcrafting', 75); // tier-3 capability, recipe is tier-1
    grantItem(sim, 'bone_fragments', 1, pid);

    const result = resolveCraftForRecipe((sim as any).ctx, pid, tier1Recipe);

    expect(result.ok).toBe(true);
    const meta = (sim as any).players.get(pid);
    expect(meta.craftSkills.weaponcrafting).toBe(75);
  });

  it('common-tier crafting always grants its full floor, regardless of capability', () => {
    const lowCapSim = makeSim();
    const lowPid = lowCapSim.playerId;
    grantItem(lowCapSim, 'spider_leg', 1, lowPid);
    const commonRecipe = recipeById('recipe_tough_jerky')!;
    expect(commonRecipe.skillReq).toBe(0);

    resolveCraftForRecipe((lowCapSim as any).ctx, lowPid, commonRecipe);
    const lowMeta = (lowCapSim as any).players.get(lowPid);
    expect(lowMeta.craftSkills.cooking).toBe(1);

    const highCapSim = makeSim();
    const highPid = highCapSim.playerId;
    setSkill(highCapSim, highPid, 'cooking', 100); // high tier capability
    grantItem(highCapSim, 'spider_leg', 1, highPid);

    resolveCraftForRecipe((highCapSim as any).ctx, highPid, commonRecipe);
    const highMeta = (highCapSim as any).players.get(highPid);
    expect(highMeta.craftSkills.cooking).toBe(101); // still the full floor point
  });
});
