import { describe, expect, it } from 'vitest';
import { HARVEST_COMPONENT_ITEMS } from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { GATHER_NODES, GROUND_OBJECTS, ITEMS, MOBS, NPCS } from '../src/sim/data';
import { NODE_HARVEST_TABLE, nodeHarvestEntryFor } from '../src/sim/professions/gathering';
import { itemNames } from '../src/ui/i18n.catalog/items';

const QUEST_ONLY_COLLECTIBLES = new Set(['boar_hide', 'webwood_silk', 'widow_venom_sac']);
const PRE_EXISTING_UNOBTAINABLE_REAGENTS = new Set([
  // Already unobtainable on release/v0.23.0; intentionally not fixed in PR #1664.
  'arcanite_bar',
]);

function obtainableItemIds(): Set<string> {
  const itemIds = new Set<string>();

  for (const node of GATHER_NODES) {
    itemIds.add(nodeHarvestEntryFor(node).itemId);
  }

  for (const fallback of Object.values(NODE_HARVEST_TABLE)) {
    itemIds.add(fallback.itemId);
  }

  for (const itemId of Object.values(HARVEST_COMPONENT_ITEMS)) {
    itemIds.add(itemId);
  }

  for (const recipe of ALL_RECIPES) {
    itemIds.add(recipe.resultItemId);
  }

  for (const mob of Object.values(MOBS)) {
    for (const loot of mob.loot) {
      if (loot.itemId) itemIds.add(loot.itemId);
    }
  }

  for (const npc of Object.values(NPCS)) {
    for (const itemId of npc.vendorItems ?? []) {
      itemIds.add(itemId);
    }
  }

  for (const object of GROUND_OBJECTS) {
    itemIds.add(object.itemId);
  }

  return itemIds;
}

describe('profession material content', () => {
  it('registers every new material and crafted output in item content and English i18n', () => {
    for (const itemId of [
      'tin_bar',
      'bronze_bar',
      'bronzeclasp_gauntlets',
      'clawspur_dirk',
    ] as const) {
      expect(ITEMS[itemId]).toBeDefined();
      expect(itemNames.en.entities.items[itemId]?.name).toBe(ITEMS[itemId].name);
    }
  });

  it('connects tin ore and beast claws to live recipes, with two bronze consumers', () => {
    const recipesUsing = (itemId: string) =>
      ALL_RECIPES.filter((recipe) => recipe.reagents.some((reagent) => reagent.itemId === itemId));

    expect(recipesUsing('tin_ore').map((recipe) => recipe.id)).toContain('recipe_tin_bar');
    expect(recipesUsing('beast_claw').map((recipe) => recipe.id)).toContain('recipe_clawspur_dirk');
    expect(recipesUsing('bronze_bar').map((recipe) => recipe.id)).toEqual(
      expect.arrayContaining(['recipe_bronzeclasp_gauntlets', 'recipe_clawspur_dirk']),
    );
  });

  it('every node output and fallback harvest-table output exists in ITEMS', () => {
    for (const fallback of Object.values(NODE_HARVEST_TABLE)) {
      expect(ITEMS[fallback.itemId]).toBeDefined();
    }

    for (const node of GATHER_NODES) {
      const entry = nodeHarvestEntryFor(node);
      expect(ITEMS[entry.itemId]).toBeDefined();
    }
  });

  it('every recipe reagent and result exists in ITEMS', () => {
    for (const recipe of ALL_RECIPES) {
      expect(ITEMS[recipe.resultItemId]).toBeDefined();
      for (const reagent of recipe.reagents) {
        expect(ITEMS[reagent.itemId]).toBeDefined();
      }
    }
  });

  it('every recipe reagent is obtainable from a live item source', () => {
    const obtainable = obtainableItemIds();

    for (const recipe of ALL_RECIPES) {
      for (const reagent of recipe.reagents) {
        if (PRE_EXISTING_UNOBTAINABLE_REAGENTS.has(reagent.itemId)) continue;
        expect(obtainable.has(reagent.itemId), `${recipe.id} reagent ${reagent.itemId}`).toBe(true);
      }
    }
  });

  it('monster profession harvesting maps components to profession materials, not quest-only items', () => {
    for (const [componentTag, itemId] of Object.entries(HARVEST_COMPONENT_ITEMS)) {
      expect(ITEMS[itemId], componentTag).toBeDefined();
      expect(ITEMS[itemId].kind).not.toBe('quest');
      expect(QUEST_ONLY_COLLECTIBLES.has(itemId)).toBe(false);
    }
  });
});
