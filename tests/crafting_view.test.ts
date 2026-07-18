import { describe, expect, it } from 'vitest';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { buildCraftingView, type RecipeDefLike } from '../src/ui/crafting_view';

function item(id: string): ItemDef {
  return {
    id,
    name: id,
    quality: 'common',
    kind: 'junk',
    sellValue: 0,
  } as unknown as ItemDef;
}

function table(...items: ItemDef[]): Record<string, ItemDef> {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

function recipe(id: string, reagents: { itemId: string; count: number }[]): RecipeDefLike {
  return {
    id,
    professionId: 'cooking',
    resultItemId: `${id}_result`,
    resultCount: 1,
    reagents,
    skillReq: 0,
  };
}

describe('buildCraftingView', () => {
  it('marks a recipe craftable when the player holds every required reagent', () => {
    const items = table(item('bone_fragments'), item('recipe_a_result'));
    const inventory: InvSlot[] = [{ itemId: 'bone_fragments', count: 3 }];
    const view = buildCraftingView(
      [recipe('recipe_a', [{ itemId: 'bone_fragments', count: 2 }])],
      inventory,
      items,
    );
    expect(view.recipes[0].craftable).toBe(true);
    expect(view.recipes[0].reagents[0]).toMatchObject({ required: 2, have: 3, satisfied: true });
  });

  it('marks a recipe not craftable when any single reagent is short', () => {
    const items = table(item('bone_fragments'), item('linen_scrap'), item('recipe_b_result'));
    const inventory: InvSlot[] = [
      { itemId: 'bone_fragments', count: 2 },
      { itemId: 'linen_scrap', count: 0 },
    ];
    const view = buildCraftingView(
      [
        recipe('recipe_b', [
          { itemId: 'bone_fragments', count: 2 },
          { itemId: 'linen_scrap', count: 1 },
        ]),
      ],
      inventory,
      items,
    );
    expect(view.recipes[0].craftable).toBe(false);
    const linen = view.recipes[0].reagents.find((r) => r.itemId === 'linen_scrap')!;
    expect(linen.satisfied).toBe(false);
    expect(linen.have).toBe(0);
  });

  it('sums count across multiple inventory slots of the same reagent', () => {
    const items = table(item('spider_leg'), item('recipe_c_result'));
    const inventory: InvSlot[] = [
      { itemId: 'spider_leg', count: 1 },
      { itemId: 'spider_leg', count: 1 },
    ];
    const view = buildCraftingView(
      [recipe('recipe_c', [{ itemId: 'spider_leg', count: 2 }])],
      inventory,
      items,
    );
    expect(view.recipes[0].reagents[0].have).toBe(2);
    expect(view.recipes[0].craftable).toBe(true);
  });

  it('never mutates the inventory or recipe inputs passed in', () => {
    const items = table(item('bone_fragments'), item('recipe_d_result'));
    const inventory: InvSlot[] = [{ itemId: 'bone_fragments', count: 5 }];
    const recipes = [recipe('recipe_d', [{ itemId: 'bone_fragments', count: 2 }])];
    const inventorySnapshot = JSON.stringify(inventory);
    const recipesSnapshot = JSON.stringify(recipes);
    buildCraftingView(recipes, inventory, items);
    expect(JSON.stringify(inventory)).toBe(inventorySnapshot);
    expect(JSON.stringify(recipes)).toBe(recipesSnapshot);
  });
});

describe('buildCraftingView combo-recipe gate (#1132 review)', () => {
  function comboRecipe(id: string): RecipeDefLike {
    return {
      ...recipe(id, []),
      comboRequirement: { craftA: 'armorcrafting', craftB: 'weaponcrafting', minTier: 1 },
    };
  }

  it('marks a combo recipe not craftable when the player lacks tier capability in either named craft', () => {
    const items = table(item('recipe_combo_result'));
    const view = buildCraftingView([comboRecipe('recipe_combo')], [], items, {
      armorcrafting: 25,
      weaponcrafting: 0,
    });
    expect(view.recipes[0].craftable).toBe(false);
  });

  it('marks a combo recipe craftable once the player meets tier capability in both named crafts', () => {
    const items = table(item('recipe_combo_result'));
    const view = buildCraftingView(
      [comboRecipe('recipe_combo')],
      [],
      items,
      {
        armorcrafting: 25,
        weaponcrafting: 25,
      },
      {
        synced: true,
        activeArchetype: 'armorcrafting',
        pairedMajor: 'weaponcrafting',
        hobbyCraft: 'leatherworking',
      },
    );
    expect(view.recipes[0].craftable).toBe(true);
    expect(view.recipes[0].comboRequirement).toMatchObject({ met: true, reason: null });
  });

  it('an unrelated craft, however high, never substitutes for a required craft', () => {
    const items = table(item('recipe_combo_result'));
    const view = buildCraftingView([comboRecipe('recipe_combo')], [], items, {
      armorcrafting: 25,
      cooking: 500,
    });
    expect(view.recipes[0].craftable).toBe(false);
  });

  it('a recipe with no comboRequirement ignores craftSkills entirely', () => {
    const items = table(item('bone_fragments'), item('recipe_plain_result'));
    const inventory: InvSlot[] = [{ itemId: 'bone_fragments', count: 2 }];
    const view = buildCraftingView(
      [recipe('recipe_plain', [{ itemId: 'bone_fragments', count: 2 }])],
      inventory,
      items,
      {},
    );
    expect(view.recipes[0].craftable).toBe(true);
  });

  it('high raw skills do not unlock a combo without the exact active pair', () => {
    const items = table(item('recipe_combo_result'));
    const view = buildCraftingView(
      [comboRecipe('recipe_combo')],
      [],
      items,
      { armorcrafting: 100, weaponcrafting: 100 },
      { synced: true, activeArchetype: null, pairedMajor: null, hobbyCraft: null },
    );
    expect(view.recipes[0].craftable).toBe(false);
    expect(view.recipes[0].comboRequirement).toMatchObject({
      met: false,
      reason: 'not_attuned',
    });
  });

  it('keeps the action available while the online crafting identity is still syncing', () => {
    const items = table(item('recipe_combo_result'));
    const view = buildCraftingView(
      [comboRecipe('recipe_combo')],
      [],
      items,
      {},
      { synced: false, activeArchetype: null, pairedMajor: null, hobbyCraft: null },
    );
    expect(view.recipes[0].craftable).toBe(true);
    expect(view.recipes[0].comboRequirement).toMatchObject({ met: null, reason: 'syncing' });
  });
});
