// Recipe content (issue #1127): common-tier crafting recipes, one or two per
// craft on the ring (src/sim/content/professions.ts CRAFT_RING). Data-as-code,
// exempt from module-first size rules per root CLAUDE.md (a declarative table,
// not logic): the resolution logic lives in ../professions/crafting.ts behind
// the SimContext seam.
//
// Scope: COMMON TIER ONLY. Every recipe below has skillReq 0 (the free floor:
// a common-tier recipe is craftable with zero craft skill, gated only by
// having the materials). Higher-tier gating (P4), the wheel (P5), and
// archetype-exclusive combos (P8) build on this path later; itemLevelBudget is
// carried now so those follow-ups have a stable field to read.
//
// Inputs are existing harvested-material item ids from the gathering content
// (src/sim/professions/gathering.ts NODE_HARVEST_TABLE): bone_fragments
// (mining), linen_scrap (logging), spider_leg (herbalism). Outputs reuse
// existing low-tier BASE_ITEMS entries (src/sim/content/items.ts) rather than
// introducing new item ids, to avoid expanding the positional item-name arrays
// in src/ui/i18n.catalog/items.ts for this issue.

import type { ProfessionRecipeRecord } from '../professions/types';

export const COMMON_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_eastbrook_arming_sword',
    professionId: 'weaponcrafting',
    resultItemId: 'eastbrook_arming_sword',
    resultCount: 1,
    reagents: [
      { itemId: 'bone_fragments', count: 2 },
      { itemId: 'linen_scrap', count: 1 },
    ],
    skillReq: 0,
    trivialAt: 25,
    itemLevelBudget: 10,
  },
  {
    id: 'recipe_eastbrook_chain_vest',
    professionId: 'armorcrafting',
    resultItemId: 'eastbrook_chain_vest',
    resultCount: 1,
    reagents: [{ itemId: 'bone_fragments', count: 3 }],
    skillReq: 0,
    trivialAt: 25,
    itemLevelBudget: 10,
  },
  {
    id: 'recipe_eastbrook_wool_trousers',
    professionId: 'tailoring',
    resultItemId: 'eastbrook_wool_trousers',
    resultCount: 1,
    reagents: [{ itemId: 'linen_scrap', count: 3 }],
    skillReq: 0,
    trivialAt: 25,
    itemLevelBudget: 8,
  },
  {
    id: 'recipe_tanned_leather_jerkin',
    professionId: 'leatherworking',
    resultItemId: 'tanned_leather_jerkin',
    resultCount: 1,
    reagents: [
      { itemId: 'spider_leg', count: 2 },
      { itemId: 'bone_fragments', count: 1 },
    ],
    skillReq: 0,
    trivialAt: 25,
    itemLevelBudget: 9,
  },
  {
    id: 'recipe_tough_jerky',
    professionId: 'cooking',
    resultItemId: 'tough_jerky',
    resultCount: 1,
    reagents: [{ itemId: 'spider_leg', count: 1 }],
    skillReq: 0,
    trivialAt: 25,
    itemLevelBudget: 1,
  },
  {
    id: 'recipe_minor_healing_potion',
    professionId: 'alchemy',
    resultItemId: 'minor_healing_potion',
    resultCount: 1,
    reagents: [
      { itemId: 'linen_scrap', count: 1 },
      { itemId: 'spider_leg', count: 1 },
    ],
    skillReq: 0,
    trivialAt: 25,
    itemLevelBudget: 1,
  },
];

export function recipeById(recipeId: string): ProfessionRecipeRecord | undefined {
  return COMMON_RECIPES.find((r) => r.id === recipeId);
}
