// Recipe content (issue #1127): common-tier crafting recipes, one or two per
// craft on the ring (src/sim/content/professions.ts CRAFT_RING). Data-as-code,
// exempt from module-first size rules per root CLAUDE.md (a declarative table,
// not logic): the resolution logic lives in ../professions/crafting.ts behind
// the SimContext seam.
//
// Scope: COMMON_RECIPES all carry skillReq 0 (the free floor: a common-tier
// recipe is craftable with zero craft skill, gated only by having the
// materials). The file has since grown past that floor: TOOL_RECIPES
// (skillReq 75/150, station-bound at the toolworks) and COMBO_RECIPES
// (skillReq 25, the #1132 dual-craft gate) sit alongside it. There is still
// no skillReq admission gate anywhere: crafting.ts reads skillReq only for
// skill-gain scaling, and itemLevelBudget feeds the #1301 gold sink.
//
// Inputs are existing junk-material item ids (src/sim/content/items.ts):
// bone_fragments, linen_scrap, spider_leg. Since Professions 2.0 Phase 4
// nodes grant real materials (NODE_MATERIAL_TABLE in
// src/sim/professions/gathering.ts) and these junk items drop only from
// mobs/corpses; the recipes still consume them. Outputs reuse
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
//
// Acquisition (Professions 2.0 Phase 9, locked scope): ONLY the three
// COMBO_RECIPES carry `acquisition: ['trainer']`, learned from the resident
// master at their craft's station (professions/training.ts resolveTrain).
// COMMON_RECIPES, TOOL_RECIPES, and CASTER_HUB_RECIPES deliberately keep NO
// acquisition field: state.md locks them grandfathered, known to everyone via
// the empty-acquisition arm of crafting.ts isRecipeKnown. Existing characters
// keep the combo recipes too, via the one-time grandfather union
// (training.ts PRE_TRAINING_RECIPE_IDS / grandfatherKnownRecipes); every
// recipe authored AFTER Phase 9 must carry a non-empty acquisition list (see
// the field doc in ../professions/types.ts).

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
    itemLevelBudget: 1,
    level: 1,
  },
  // Caster-stat (int/spi) common-tier recipes: one per
  // tailoring/leatherworking/armorcrafting, alongside the armor-only pieces
  // above. Reuses the same harvested reagents as the rest of COMMON_RECIPES.
  {
    id: 'recipe_eastbrook_ritual_vestments',
    professionId: 'tailoring',
    resultItemId: 'eastbrook_ritual_vestments',
    resultCount: 1,
    reagents: [
      { itemId: 'linen_scrap', count: 3 },
      { itemId: 'spider_leg', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 9,
    level: 9,
  },
  {
    id: 'recipe_eastbrook_druids_hide',
    professionId: 'leatherworking',
    resultItemId: 'eastbrook_druids_hide',
    resultCount: 1,
    reagents: [
      { itemId: 'spider_leg', count: 2 },
      { itemId: 'bone_fragments', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 9,
    level: 9,
  },
  {
    id: 'recipe_eastbrook_warded_leggings',
    professionId: 'armorcrafting',
    resultItemId: 'eastbrook_warded_leggings',
    resultCount: 1,
    reagents: [
      { itemId: 'bone_fragments', count: 3 },
      { itemId: 'linen_scrap', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
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
// stationType (Professions 2.0 Phase 8, formerly #1297's requiresHubStation):
// every recipe below is station-bound at the toolworks (content/professions.ts
// STATIONS, checked by ../professions/stations.ts). These are the natural
// first station-bound recipes: real tier-4/5 gear already tier-gated well
// past the common free floor, unlike COMMON_RECIPES/COMBO_RECIPES above
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
    itemLevelBudget: 20,
    level: 20,
    stationType: 'toolworks',
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
    itemLevelBudget: 30,
    level: 20,
    stationType: 'toolworks',
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
    itemLevelBudget: 20,
    level: 20,
    stationType: 'toolworks',
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
    itemLevelBudget: 30,
    level: 20,
    stationType: 'toolworks',
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
    itemLevelBudget: 20,
    level: 20,
    stationType: 'toolworks',
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
    itemLevelBudget: 30,
    level: 20,
    stationType: 'toolworks',
  },
];

// Station-tier caster-stat (int/spi) recipes (crafting content follow-up to
// the COMMON_RECIPES caster pieces above): one per tailoring/leatherworking/
// armorcrafting, at the same thorium tier as TOOL_RECIPES, each bound to its
// own craft's station type (loom/tannery/forge).
export const CASTER_HUB_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_wardweave_cowl',
    professionId: 'tailoring',
    resultItemId: 'wardweave_cowl',
    resultCount: 1,
    reagents: [
      { itemId: 'thorium_ore', count: 3 },
      { itemId: 'linen_scrap', count: 2 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    stationType: 'loom',
  },
  {
    id: 'recipe_duskhide_wraps',
    professionId: 'leatherworking',
    resultItemId: 'duskhide_wraps',
    resultCount: 1,
    reagents: [
      { itemId: 'thorium_ore', count: 3 },
      { itemId: 'spider_leg', count: 2 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    stationType: 'tannery',
  },
  {
    id: 'recipe_sootscale_mantle',
    professionId: 'armorcrafting',
    resultItemId: 'sootscale_mantle',
    resultCount: 1,
    reagents: [
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'bone_fragments', count: 2 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    stationType: 'forge',
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
    itemLevelBudget: 20,
    level: 15,
    comboRequirement: { craftA: 'armorcrafting', craftB: 'weaponcrafting', minTier: 1 },
    acquisition: ['trainer'],
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
    itemLevelBudget: 18,
    level: 15,
    comboRequirement: { craftA: 'armorcrafting', craftB: 'weaponcrafting', minTier: 1 },
    acquisition: ['trainer'],
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
    itemLevelBudget: 16,
    level: 15,
    comboRequirement: { craftA: 'alchemy', craftB: 'engineering', minTier: 1 },
    acquisition: ['trainer'],
  },
];

// Phase 10 trained ladder set (Professions 2.0): the weaponcrafting,
// armorcrafting, tailoring, leatherworking, cooking, and alchemy recipe
// ladders, three rungs per craft at skillReq 0/25/50, all trainer-taught and
// station-bound (forge for the weapon/armor crafts, loom for tailoring at
// weaver_ottilie, tannery for leatherworking at tanner_hesk, kitchens for
// cooking at cook_marlow, apothecary for alchemy at alchemist_verane). Outputs
// are the new crafted weapon/armor/bag/food/potion/elixir ItemDefs in
// content/profession_items.ts. Post-Phase-9 content, so every record carries a
// non-empty `acquisition` list (never grandfathered). The two scaffolding
// fields are normalized to one cross-craft convention shared by all ladders
// (skillReq 0 -> 10/10, skillReq 25 -> 16/15, skillReq 50 -> 20/20); the outputs'
// stats and values were budgeted against real comparables and are authored
// unchanged in profession_items.ts.
export const LADDER_RECIPES: ProfessionRecipeRecord[] = [
  // --- weaponcrafting ------------------------------------------------------
  {
    id: 'recipe_copper_bearded_axe',
    professionId: 'weaponcrafting',
    resultItemId: 'copper_bearded_axe',
    resultCount: 1,
    reagents: [
      { itemId: 'copper_ore', count: 4 },
      { itemId: 'ironbark_log', count: 2 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_copper_flanged_mace',
    professionId: 'weaponcrafting',
    resultItemId: 'copper_flanged_mace',
    resultCount: 1,
    reagents: [
      { itemId: 'copper_ore', count: 3 },
      { itemId: 'bone_fragments', count: 2 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_ironbark_boar_spear',
    professionId: 'weaponcrafting',
    resultItemId: 'ironbark_boar_spear',
    resultCount: 1,
    reagents: [
      { itemId: 'ironbark_log', count: 3 },
      { itemId: 'copper_ore', count: 2 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_ironedge_longsword',
    professionId: 'weaponcrafting',
    resultItemId: 'ironedge_longsword',
    resultCount: 1,
    reagents: [
      { itemId: 'iron_ore', count: 4 },
      { itemId: 'rough_hide', count: 1 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_ironshod_maul',
    professionId: 'weaponcrafting',
    resultItemId: 'ironshod_maul',
    resultCount: 1,
    reagents: [
      { itemId: 'iron_ore', count: 3 },
      { itemId: 'ashwood_log', count: 1 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_whetted_iron_dirk',
    professionId: 'weaponcrafting',
    resultItemId: 'whetted_iron_dirk',
    resultCount: 1,
    reagents: [
      { itemId: 'iron_ore', count: 2 },
      { itemId: 'bone_fragments', count: 2 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_thorium_warblade',
    professionId: 'weaponcrafting',
    resultItemId: 'thorium_warblade',
    resultCount: 1,
    reagents: [
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'iron_ore', count: 2 },
      { itemId: 'smithing_flux', count: 2 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_arcanite_war_axe',
    professionId: 'weaponcrafting',
    resultItemId: 'arcanite_war_axe',
    resultCount: 1,
    reagents: [
      { itemId: 'arcanite_bar', count: 1 },
      { itemId: 'thorium_ore', count: 2 },
      { itemId: 'bone_fragments', count: 4 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_elderwood_battle_staff',
    professionId: 'weaponcrafting',
    resultItemId: 'elderwood_battle_staff',
    resultCount: 1,
    reagents: [
      { itemId: 'elderwood_log', count: 1 },
      { itemId: 'thorium_ore', count: 2 },
      { itemId: 'rough_hide', count: 2 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  // --- armorcrafting -------------------------------------------------------
  {
    id: 'recipe_riveted_copper_girdle',
    professionId: 'armorcrafting',
    resultItemId: 'riveted_copper_girdle',
    resultCount: 1,
    reagents: [
      { itemId: 'copper_ore', count: 4 },
      { itemId: 'bone_fragments', count: 2 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_coppermail_sabatons',
    professionId: 'armorcrafting',
    resultItemId: 'coppermail_sabatons',
    resultCount: 1,
    reagents: [
      { itemId: 'copper_ore', count: 4 },
      { itemId: 'rough_hide', count: 2 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_coppermail_gauntlets',
    professionId: 'armorcrafting',
    resultItemId: 'coppermail_gauntlets',
    resultCount: 1,
    reagents: [
      { itemId: 'copper_ore', count: 3 },
      { itemId: 'bone_fragments', count: 2 },
      { itemId: 'rough_hide', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_ironlink_hauberk',
    professionId: 'armorcrafting',
    resultItemId: 'ironlink_hauberk',
    resultCount: 1,
    reagents: [
      { itemId: 'iron_ore', count: 5 },
      { itemId: 'rough_hide', count: 2 },
      { itemId: 'smithing_flux', count: 2 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_ironlink_legguards',
    professionId: 'armorcrafting',
    resultItemId: 'ironlink_legguards',
    resultCount: 1,
    reagents: [
      { itemId: 'iron_ore', count: 4 },
      { itemId: 'bone_fragments', count: 3 },
      { itemId: 'smithing_flux', count: 2 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_ironlink_spaulders',
    professionId: 'armorcrafting',
    resultItemId: 'ironlink_spaulders',
    resultCount: 1,
    reagents: [
      { itemId: 'iron_ore', count: 4 },
      { itemId: 'rough_hide', count: 1 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_thoriumscale_greathelm',
    professionId: 'armorcrafting',
    resultItemId: 'thoriumscale_greathelm',
    resultCount: 1,
    reagents: [
      { itemId: 'thorium_ore', count: 3 },
      { itemId: 'arcanite_bar', count: 1 },
      { itemId: 'rough_hide', count: 2 },
      { itemId: 'smithing_flux', count: 2 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_thoriumscale_cuirass',
    professionId: 'armorcrafting',
    resultItemId: 'thoriumscale_cuirass',
    resultCount: 1,
    reagents: [
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'arcanite_bar', count: 1 },
      { itemId: 'iron_ore', count: 4 },
      { itemId: 'smithing_flux', count: 2 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_thoriumscale_leggings',
    professionId: 'armorcrafting',
    resultItemId: 'thoriumscale_leggings',
    resultCount: 1,
    reagents: [
      { itemId: 'thorium_ore', count: 3 },
      { itemId: 'arcanite_bar', count: 1 },
      { itemId: 'bone_fragments', count: 4 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  // --- tailoring -----------------------------------------------------------
  {
    id: 'recipe_homespun_hood',
    professionId: 'tailoring',
    resultItemId: 'homespun_hood',
    resultCount: 1,
    reagents: [
      { itemId: 'homespun_cloth', count: 4 },
      { itemId: 'linen_scrap', count: 2 },
      { itemId: 'spool_of_thread', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'loom',
  },
  {
    id: 'recipe_homespun_mitts',
    professionId: 'tailoring',
    resultItemId: 'homespun_mitts',
    resultCount: 1,
    reagents: [
      { itemId: 'homespun_cloth', count: 3 },
      { itemId: 'spool_of_thread', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'loom',
  },
  {
    id: 'recipe_silverthread_slippers',
    professionId: 'tailoring',
    resultItemId: 'silverthread_slippers',
    resultCount: 1,
    reagents: [
      { itemId: 'linen_scrap', count: 3 },
      { itemId: 'silverleaf_herb', count: 2 },
      { itemId: 'spool_of_thread', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'loom',
  },
  {
    id: 'recipe_goldweave_robe',
    professionId: 'tailoring',
    resultItemId: 'goldweave_robe',
    resultCount: 1,
    reagents: [
      { itemId: 'spider_silk', count: 4 },
      { itemId: 'goldleaf_herb', count: 2 },
      { itemId: 'spool_of_thread', count: 2 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'loom',
  },
  {
    id: 'recipe_goldweave_leggings',
    professionId: 'tailoring',
    resultItemId: 'goldweave_leggings',
    resultCount: 1,
    reagents: [
      { itemId: 'homespun_cloth', count: 4 },
      { itemId: 'goldleaf_herb', count: 2 },
      { itemId: 'spool_of_thread', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'loom',
  },
  {
    id: 'recipe_silkspun_satchel',
    professionId: 'tailoring',
    resultItemId: 'silkspun_satchel',
    resultCount: 1,
    reagents: [
      { itemId: 'spider_silk', count: 6 },
      { itemId: 'goldleaf_herb', count: 2 },
      { itemId: 'spool_of_thread', count: 2 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'loom',
  },
  {
    id: 'recipe_silkbinders_raiment',
    professionId: 'tailoring',
    resultItemId: 'silkbinders_raiment',
    resultCount: 1,
    reagents: [
      { itemId: 'pristine_silk', count: 1 },
      { itemId: 'sunpetal_herb', count: 2 },
      { itemId: 'spider_silk', count: 4 },
      { itemId: 'spool_of_thread', count: 2 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'loom',
  },
  {
    id: 'recipe_sunweave_mantle',
    professionId: 'tailoring',
    resultItemId: 'sunweave_mantle',
    resultCount: 1,
    reagents: [
      { itemId: 'sunpetal_herb', count: 1 },
      { itemId: 'homespun_cloth', count: 4 },
      { itemId: 'spool_of_thread', count: 2 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'loom',
  },
  {
    id: 'recipe_sunweave_treads',
    professionId: 'tailoring',
    resultItemId: 'sunweave_treads',
    resultCount: 1,
    reagents: [
      { itemId: 'sunpetal_herb', count: 1 },
      { itemId: 'goldleaf_herb', count: 2 },
      { itemId: 'spider_silk', count: 3 },
      { itemId: 'spool_of_thread', count: 1 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'loom',
  },
  // --- leatherworking ------------------------------------------------------
  {
    id: 'recipe_fenbridge_hide_leggings',
    professionId: 'leatherworking',
    resultItemId: 'fenbridge_hide_leggings',
    resultCount: 1,
    reagents: [
      { itemId: 'rough_hide', count: 3 },
      { itemId: 'spider_leg', count: 2 },
      { itemId: 'tanning_agent', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'tannery',
  },
  {
    id: 'recipe_fenbridge_hide_boots',
    professionId: 'leatherworking',
    resultItemId: 'fenbridge_hide_boots',
    resultCount: 1,
    reagents: [
      { itemId: 'rough_hide', count: 2 },
      { itemId: 'tanning_agent', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'tannery',
  },
  {
    id: 'recipe_fenbridge_hide_belt',
    professionId: 'leatherworking',
    resultItemId: 'fenbridge_hide_belt',
    resultCount: 1,
    reagents: [
      { itemId: 'rough_hide', count: 2 },
      { itemId: 'spider_leg', count: 1 },
      { itemId: 'tanning_agent', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'tannery',
  },
  {
    id: 'recipe_marshstalker_jerkin',
    professionId: 'leatherworking',
    resultItemId: 'marshstalker_jerkin',
    resultCount: 1,
    reagents: [
      { itemId: 'rough_hide', count: 4 },
      { itemId: 'spider_silk', count: 2 },
      { itemId: 'tanning_agent', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'tannery',
  },
  {
    id: 'recipe_marshstalker_hood',
    professionId: 'leatherworking',
    resultItemId: 'marshstalker_hood',
    resultCount: 1,
    reagents: [
      { itemId: 'rough_hide', count: 3 },
      { itemId: 'spider_leg', count: 2 },
      { itemId: 'tanning_agent', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'tannery',
  },
  {
    id: 'recipe_marshstalker_spaulders',
    professionId: 'leatherworking',
    resultItemId: 'marshstalker_spaulders',
    resultCount: 1,
    reagents: [
      { itemId: 'rough_hide', count: 3 },
      { itemId: 'homespun_cloth', count: 2 },
      { itemId: 'tanning_agent', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'tannery',
  },
  {
    id: 'recipe_mirewarden_jerkin',
    professionId: 'leatherworking',
    resultItemId: 'mirewarden_jerkin',
    resultCount: 1,
    reagents: [
      { itemId: 'pristine_hide', count: 1 },
      { itemId: 'rough_hide', count: 4 },
      { itemId: 'thorium_ore', count: 1 },
      { itemId: 'tanning_agent', count: 2 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'tannery',
  },
  {
    id: 'recipe_mirewarden_leggings',
    professionId: 'leatherworking',
    resultItemId: 'mirewarden_leggings',
    resultCount: 1,
    reagents: [
      { itemId: 'rough_hide', count: 5 },
      { itemId: 'thorium_ore', count: 1 },
      { itemId: 'tanning_agent', count: 1 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'tannery',
  },
  {
    id: 'recipe_mirewarden_treads',
    professionId: 'leatherworking',
    resultItemId: 'mirewarden_treads',
    resultCount: 1,
    reagents: [
      { itemId: 'rough_hide', count: 4 },
      { itemId: 'spider_silk', count: 2 },
      { itemId: 'thorium_ore', count: 1 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'tannery',
  },
  // --- cooking -------------------------------------------------------------
  {
    id: 'recipe_pan_seared_perch',
    professionId: 'cooking',
    resultItemId: 'pan_seared_perch',
    resultCount: 1,
    reagents: [
      { itemId: 'raw_river_perch', count: 2 },
      { itemId: 'cooking_salt', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_hunters_game_skewer',
    professionId: 'cooking',
    resultItemId: 'hunters_game_skewer',
    resultCount: 1,
    reagents: [
      { itemId: 'game_meat', count: 2 },
      { itemId: 'cooking_salt', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_herbed_marsh_pike',
    professionId: 'cooking',
    resultItemId: 'herbed_marsh_pike',
    resultCount: 1,
    reagents: [
      { itemId: 'raw_marsh_pike', count: 2 },
      { itemId: 'silverleaf_herb', count: 1 },
      { itemId: 'cooking_salt', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_ashwood_smoked_eel',
    professionId: 'cooking',
    resultItemId: 'ashwood_smoked_eel',
    resultCount: 2,
    reagents: [
      { itemId: 'raw_bog_eel', count: 2 },
      { itemId: 'ashwood_log', count: 1 },
      { itemId: 'cooking_salt', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_goldleaf_game_stew',
    professionId: 'cooking',
    resultItemId: 'goldleaf_game_stew',
    resultCount: 2,
    reagents: [
      { itemId: 'game_meat', count: 3 },
      { itemId: 'goldleaf_herb', count: 1 },
      { itemId: 'cooking_salt', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_frostgill_chowder',
    professionId: 'cooking',
    resultItemId: 'frostgill_chowder',
    resultCount: 1,
    reagents: [
      { itemId: 'raw_frostgill_trout', count: 2 },
      { itemId: 'silverleaf_herb', count: 2 },
      { itemId: 'cooking_salt', count: 2 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_silvered_carp_supper',
    professionId: 'cooking',
    resultItemId: 'silvered_carp_supper',
    resultCount: 1,
    reagents: [
      { itemId: 'raw_stonescale_carp', count: 3 },
      { itemId: 'raw_mirror_trout', count: 1 },
      { itemId: 'goldleaf_herb', count: 1 },
      { itemId: 'cooking_salt', count: 1 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_anglers_feast_platter',
    professionId: 'cooking',
    resultItemId: 'anglers_feast_platter',
    resultCount: 3,
    reagents: [
      { itemId: 'raw_frostgill_trout', count: 2 },
      { itemId: 'raw_bog_eel', count: 2 },
      { itemId: 'sunpetal_herb', count: 1 },
      { itemId: 'cooking_salt', count: 2 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_marlows_grand_roast',
    professionId: 'cooking',
    resultItemId: 'marlows_grand_roast',
    resultCount: 1,
    reagents: [
      { itemId: 'prime_cut', count: 1 },
      { itemId: 'game_meat', count: 4 },
      { itemId: 'sunpetal_herb', count: 1 },
      { itemId: 'cooking_salt', count: 2 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  // --- alchemy -------------------------------------------------------------
  {
    id: 'recipe_silverleaf_healing_draught',
    professionId: 'alchemy',
    resultItemId: 'silverleaf_healing_draught',
    resultCount: 1,
    reagents: [
      { itemId: 'silverleaf_herb', count: 4 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_silverleaf_mana_draught',
    professionId: 'alchemy',
    resultItemId: 'silverleaf_mana_draught',
    resultCount: 1,
    reagents: [
      { itemId: 'silverleaf_herb', count: 3 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_elixir_of_the_boar',
    professionId: 'alchemy',
    resultItemId: 'elixir_of_the_boar',
    resultCount: 1,
    reagents: [
      { itemId: 'venom_gland', count: 2 },
      { itemId: 'silverleaf_herb', count: 2 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_goldleaf_healing_draught',
    professionId: 'alchemy',
    resultItemId: 'goldleaf_healing_draught',
    resultCount: 1,
    reagents: [
      { itemId: 'goldleaf_herb', count: 2 },
      { itemId: 'silverleaf_herb', count: 2 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_goldleaf_mana_draught',
    professionId: 'alchemy',
    resultItemId: 'goldleaf_mana_draught',
    resultCount: 1,
    reagents: [
      { itemId: 'goldleaf_herb', count: 2 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_venomfire_elixir',
    professionId: 'alchemy',
    resultItemId: 'venomfire_elixir',
    resultCount: 1,
    reagents: [
      { itemId: 'venom_gland', count: 3 },
      { itemId: 'goldleaf_herb', count: 1 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_sunpetal_healing_draught',
    professionId: 'alchemy',
    resultItemId: 'sunpetal_healing_draught',
    resultCount: 1,
    reagents: [
      { itemId: 'sunpetal_herb', count: 2 },
      { itemId: 'silverleaf_herb', count: 3 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_sunpetal_mana_draught',
    professionId: 'alchemy',
    resultItemId: 'sunpetal_mana_draught',
    resultCount: 1,
    reagents: [
      { itemId: 'sunpetal_herb', count: 2 },
      { itemId: 'goldleaf_herb', count: 1 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_elixir_of_the_serpent',
    professionId: 'alchemy',
    resultItemId: 'elixir_of_the_serpent',
    resultCount: 2,
    reagents: [
      { itemId: 'pristine_venom_gland', count: 1 },
      { itemId: 'venom_gland', count: 2 },
      { itemId: 'sunpetal_herb', count: 1 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'apothecary',
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
  ...CASTER_HUB_RECIPES,
  ...COMBO_RECIPES,
  ...LADDER_RECIPES,
];

export function recipeById(recipeId: string): ProfessionRecipeRecord | undefined {
  return ALL_RECIPES.find((r) => r.id === recipeId);
}

// The hands-vs-stations field set (Professions 2.0 Phase 8): the recipe ids
// craftable anywhere with bare hands, exactly the nine common recipes today.
// Everything outside this set either carries a stationType (station-bound)
// or is a combo recipe (field-craftable but pair-gated); the set exists so
// content/tests can name "field recipe" without re-deriving it.
export const FIELD_RECIPES: ReadonlySet<string> = new Set(COMMON_RECIPES.map((r) => r.id));

// Reverse lookup (#1149, Battlefield Experience): the recipe whose crafting
// produced a given result item id, so a tracked-event handler holding only an
// item instance can resolve back to the craft (professionId) that made it.
// First match wins: no two recipes in this table share a resultItemId today.
export function recipeForResultItem(itemId: string): ProfessionRecipeRecord | undefined {
  return COMMON_RECIPES.find((r) => r.resultItemId === itemId);
}
