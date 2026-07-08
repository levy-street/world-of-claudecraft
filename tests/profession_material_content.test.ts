import { describe, expect, it } from 'vitest';
import { HARVEST_COMPONENT_ITEMS } from '../src/sim/content/professions';
import { COMBO_RECIPES, COMMON_RECIPES, TOOL_RECIPES } from '../src/sim/content/recipes';
import { GATHER_NODES, ITEMS } from '../src/sim/data';
import { NODE_HARVEST_TABLE, nodeHarvestEntryFor } from '../src/sim/professions/gathering';

const QUEST_ONLY_COLLECTIBLES = new Set(['boar_hide', 'webwood_silk', 'widow_venom_sac']);

describe('profession material content', () => {
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
    for (const recipe of [...COMMON_RECIPES, ...TOOL_RECIPES, ...COMBO_RECIPES]) {
      expect(ITEMS[recipe.resultItemId]).toBeDefined();
      for (const reagent of recipe.reagents) {
        expect(ITEMS[reagent.itemId]).toBeDefined();
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
