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
//
// COMBO_RECIPES (issue #1132): tier-1 recipes exclusive to one specific
// adjacent pair on the CRAFT_RING (src/sim/content/professions.ts
// adjacentCrafts). Each carries a `comboRequirement` naming both crafts and
// the minimum tier both must independently meet; crafting.ts denies the
// craft if either is unmet, regardless of skill in any other craft. Pairs
// used here were confirmed via adjacentCrafts: armorcrafting is adjacent to
// weaponcrafting (both Material pole), and alchemy is adjacent to
// engineering (both Experimental pole). Reagents reuse the same harvested
// materials as the common tier; outputs reuse existing BASE_ITEMS entries
// (boundstone_helm, gravewyrm_gauntlets, elixir_of_the_bear) for the same
// i18n reason as above.

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

// Combo recipes (issue #1132): each requires BOTH crafts of one specific
// adjacent pair at the recipe's tier (comboRequirement.minTier), on top of the
// normal reagent/skillReq gating above. See the module comment for why these
// two pairs were chosen.
export const COMBO_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_ironbound_warplate_helm',
    professionId: 'armorcrafting',
    resultItemId: 'boundstone_helm',
    resultCount: 1,
    reagents: [
      { itemId: 'bone_fragments', count: 4 },
      { itemId: 'linen_scrap', count: 2 },
    ],
    skillReq: 25,
    trivialAt: 50,
    itemLevelBudget: 20,
    comboRequirement: { craftA: 'armorcrafting', craftB: 'weaponcrafting', minTier: 1 },
  },
  {
    id: 'recipe_forgeguard_bulwark_gauntlets',
    professionId: 'weaponcrafting',
    resultItemId: 'gravewyrm_gauntlets',
    resultCount: 1,
    reagents: [
      { itemId: 'bone_fragments', count: 3 },
      { itemId: 'linen_scrap', count: 3 },
    ],
    skillReq: 25,
    trivialAt: 50,
    itemLevelBudget: 18,
    comboRequirement: { craftA: 'armorcrafting', craftB: 'weaponcrafting', minTier: 1 },
  },
  {
    id: 'recipe_volatile_flux_elixir',
    professionId: 'alchemy',
    resultItemId: 'elixir_of_the_bear',
    resultCount: 1,
    reagents: [
      { itemId: 'linen_scrap', count: 2 },
      { itemId: 'spider_leg', count: 2 },
    ],
    skillReq: 25,
    trivialAt: 50,
    itemLevelBudget: 16,
    comboRequirement: { craftA: 'alchemy', craftB: 'engineering', minTier: 1 },
  },
];

// Exported (not just used internally by recipeById below) so the IWorld
// recipeList read surface (Sim.recipeList / ClientWorld.recipeList) can list
// every recipe, common and combo alike: see PR #1209 review, a combo recipe
// omitted from recipeList was unreachable in normal play.
export const ALL_RECIPES: ProfessionRecipeRecord[] = [...COMMON_RECIPES, ...COMBO_RECIPES];

export function recipeById(recipeId: string): ProfessionRecipeRecord | undefined {
  return ALL_RECIPES.find((r) => r.id === recipeId);
}
