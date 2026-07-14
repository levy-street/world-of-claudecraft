// Recipe content (issue #1127): common-tier crafting recipes, one or two per
// craft on the ring (src/sim/content/professions.ts CRAFT_RING). Data-as-code,
// exempt from module-first size rules per root CLAUDE.md (a declarative table,
// not logic): the resolution logic lives in ../professions/crafting.ts behind
// the SimContext seam.
//
// Scope: COMMON_RECIPES all carry skillReq 0 (the free floor: a common-tier
// recipe is craftable with zero craft skill, gated only by having the
// materials). The file has since grown past that floor: TOOL_RECIPES
// (skillReq 75/150, station-bound at the level-20 hub) and COMBO_RECIPES
// (skillReq 25, the #1132 dual-craft gate) sit alongside it. There is still
// no skillReq admission gate anywhere: crafting.ts reads skillReq only for
// skill-gain scaling, and itemLevelBudget feeds the #1301 gold sink.
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
    level: 10,
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
    level: 10,
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
    level: 8,
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
    level: 9,
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
    level: 1,
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
    level: 1,
  },
];

// Tier 4/5 tool recipes (#1135's crafted base tools), de-stubbed from the
// former `TOOL_RECIPE_STUBS` in content/professions.ts now that #1127's
// crafting action exists to consume them. Kept out of COMMON_RECIPES (whose
// module doc and tests fix skillReq at 0 for every entry): these carry a
// non-zero skillReq the way itemLevelBudget was already carried on the
// common-tier recipes above. resolveCraft reads skillReq only to scale
// skill gain (#1128's soft tier mastery: full at/above capability, reduced
// one tier under, zero two-plus under, and zero above the #1129 archetype
// ceiling), never as an admission gate: these are craftable on having the
// reagents and standing at the hub station, same as any common recipe.
//
// requiresHubStation (issue #1297): every recipe below is also station-bound,
// gated on presence at the level-20 crafting hub (content/professions.ts
// CRAFTING_HUB_*, checked by ../professions/crafting_hub.ts). These are the
// natural first station-bound recipes: real tier-4/5 gear already tier-gated
// well past the common free floor, unlike COMMON_RECIPES/COMBO_RECIPES above
// (both free-field-craftable, deliberately left ungated here).
export const TOOL_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_thorium_mining_pick',
    professionId: 'engineering',
    resultItemId: 'thorium_mining_pick',
    resultCount: 1,
    reagents: [
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'mithril_mining_pick', count: 1 },
    ],
    skillReq: 75,
    trivialAt: 125,
    itemLevelBudget: 20,
    level: 20,
    requiresHubStation: true,
  },
  {
    id: 'recipe_arcanite_mining_pick',
    professionId: 'engineering',
    resultItemId: 'arcanite_mining_pick',
    resultCount: 1,
    reagents: [
      { itemId: 'arcanite_bar', count: 2 },
      { itemId: 'thorium_mining_pick', count: 1 },
    ],
    skillReq: 150,
    trivialAt: 200,
    itemLevelBudget: 30,
    level: 20,
    requiresHubStation: true,
  },
  {
    id: 'recipe_ashwood_axe',
    professionId: 'engineering',
    resultItemId: 'ashwood_axe',
    resultCount: 1,
    reagents: [
      { itemId: 'ashwood_log', count: 4 },
      { itemId: 'ironbark_axe', count: 1 },
    ],
    skillReq: 75,
    trivialAt: 125,
    itemLevelBudget: 20,
    level: 20,
    requiresHubStation: true,
  },
  {
    id: 'recipe_elderwood_axe',
    professionId: 'engineering',
    resultItemId: 'elderwood_axe',
    resultCount: 1,
    reagents: [
      { itemId: 'elderwood_log', count: 2 },
      { itemId: 'ashwood_axe', count: 1 },
    ],
    skillReq: 150,
    trivialAt: 200,
    itemLevelBudget: 30,
    level: 20,
    requiresHubStation: true,
  },
  {
    id: 'recipe_goldleaf_sickle',
    professionId: 'engineering',
    resultItemId: 'goldleaf_sickle',
    resultCount: 1,
    reagents: [
      { itemId: 'goldleaf_herb', count: 4 },
      { itemId: 'silverleaf_sickle', count: 1 },
    ],
    skillReq: 75,
    trivialAt: 125,
    itemLevelBudget: 20,
    level: 20,
    requiresHubStation: true,
  },
  {
    id: 'recipe_sunpetal_sickle',
    professionId: 'engineering',
    resultItemId: 'sunpetal_sickle',
    resultCount: 1,
    reagents: [
      { itemId: 'sunpetal_herb', count: 2 },
      { itemId: 'goldleaf_sickle', count: 1 },
    ],
    skillReq: 150,
    trivialAt: 200,
    itemLevelBudget: 30,
    level: 20,
    requiresHubStation: true,
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
    level: 15,
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
    level: 15,
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
    level: 15,
    comboRequirement: { craftA: 'alchemy', craftB: 'engineering', minTier: 1 },
  },
];

// Exported (not just used internally by recipeById below) so the IWorld
// recipeList read surface (Sim.recipeList / ClientWorld.recipeList) can list
// every recipe, common, tool, and combo alike: see PR #1209 review, a combo
// recipe omitted from recipeList was unreachable in normal play; the same
// applies to the tool recipes de-stubbed here (#1135's crafted base tools).
export const ALL_RECIPES: ProfessionRecipeRecord[] = [
  ...COMMON_RECIPES,
  ...TOOL_RECIPES,
  ...COMBO_RECIPES,
];

export function recipeById(recipeId: string): ProfessionRecipeRecord | undefined {
  return ALL_RECIPES.find((r) => r.id === recipeId);
}

// Reverse lookup (#1149, Battlefield Experience): the recipe whose crafting
// produced a given result item id, so a tracked-event handler holding only an
// item instance can resolve back to the craft (professionId) that made it.
// First match wins: no two recipes in this table share a resultItemId today.
export function recipeForResultItem(itemId: string): ProfessionRecipeRecord | undefined {
  return COMMON_RECIPES.find((r) => r.resultItemId === itemId);
}
