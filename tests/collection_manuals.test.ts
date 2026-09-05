import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { Sim } from '../src/sim/sim';
import type { RecipeItemDef } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const ID = 'test_crucible_collection_manual';
const recipes: ProfessionRecipeRecord[] = ['chest', 'waist', 'feet'].map((slot) => ({
  id: `test_collection_recipe_${slot}`,
  professionId: 'armorcrafting',
  resultItemId: 'eastbrook_arming_sword',
  resultCount: 1,
  reagents: [],
  skillReq: 100,
  itemLevelBudget: 29,
  level: 29,
  acquisition: ['drop'],
}));
const manual: RecipeItemDef = {
  id: ID,
  name: 'Test Collection Manual',
  kind: 'recipe',
  sellValue: 0,
  teachesRecipeId: recipes[0].id,
  teachesRecipeIds: recipes.map((recipe) => recipe.id),
};

beforeAll(() => {
  ALL_RECIPES.push(...recipes);
  ITEMS[ID] = manual;
});
afterAll(() => {
  for (const recipe of recipes) ALL_RECIPES.splice(ALL_RECIPES.indexOf(recipe), 1);
  delete ITEMS[ID];
});

function setup(skill = 100) {
  const sim = new Sim({ seed: 83, noPlayer: true, world: EMPTY_TEST_WORLD });
  const pid = sim.addPlayer('warrior', 'Manual Reader');
  const meta = sim.meta(pid)!;
  meta.autoEquip = false;
  meta.craftSkills.armorcrafting = skill;
  sim.addItem(ID, 1, pid);
  sim.drainEvents();
  return { sim, pid, meta };
}

describe('collection manuals through item use', () => {
  it('teaches all three recipes and consumes exactly one manual', () => {
    const { sim, pid, meta } = setup();
    sim.addItem(ID, 1, pid);
    sim.useItem(ID, pid);
    for (const recipe of recipes) expect(meta.knownRecipes.has(recipe.id)).toBe(true);
    expect(sim.countItem(ID, pid)).toBe(1);
    const learned = sim.drainEvents().filter((event) => event.type === 'trainResult');
    expect(learned.map((event) => event.recipeId)).toEqual(recipes.map((recipe) => recipe.id));
  });

  it('learns the missing members when the first recipe is already known', () => {
    const { sim, pid, meta } = setup();
    meta.knownRecipes.add(recipes[0].id);
    sim.useItem(ID, pid);
    expect(recipes.every((recipe) => meta.knownRecipes.has(recipe.id))).toBe(true);
    expect(sim.countItem(ID, pid)).toBe(0);
  });

  it('keeps the manual when every member is already known', () => {
    const { sim, pid, meta } = setup();
    for (const recipe of recipes) meta.knownRecipes.add(recipe.id);
    sim.useItem(ID, pid);
    expect(sim.countItem(ID, pid)).toBe(1);
    expect(sim.drainEvents().some((event) => event.type === 'trainResult')).toBe(false);
  });

  it('denies the whole manual below the learn floor', () => {
    const { sim, pid, meta } = setup(99);
    sim.useItem(ID, pid);
    expect(recipes.some((recipe) => meta.knownRecipes.has(recipe.id))).toBe(false);
    expect(sim.countItem(ID, pid)).toBe(1);
  });

  it('does not partly teach a malformed collection', () => {
    const { sim, pid, meta } = setup();
    ITEMS[ID] = { ...manual, teachesRecipeIds: [recipes[0].id, 'missing_collection_recipe'] };
    try {
      sim.useItem(ID, pid);
      expect(meta.knownRecipes.has(recipes[0].id)).toBe(false);
      expect(sim.countItem(ID, pid)).toBe(1);
    } finally {
      ITEMS[ID] = manual;
    }
  });

  it('does not teach from an invalid selected copy', () => {
    const { sim, pid, meta } = setup();
    sim.useItem(ID, pid, { slotIndex: 999 });
    expect(recipes.some((recipe) => meta.knownRecipes.has(recipe.id))).toBe(false);
    expect(sim.countItem(ID, pid)).toBe(1);
  });
});
