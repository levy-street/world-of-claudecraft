// Masterwrought apex recipe patterns (Phase 11, R8): the physical kind:'recipe'
// drops that teach the acquisition:['drop'] apex recipes (recipes.ts:
// APEX_ARMOR_RECIPES, APEX_GEAR_RECIPES, APEX_CONSUMABLE_RECIPES, and since
// masterwrought Phase 11i the apex rung of ROD_RECIPES). Merged into ITEMS by
// data.ts (mergeItems), beside PROFESSION_ITEMS. It was 28 at phase 11 and the
// prose below still says so where it is describing THAT wave; the live count is
// derived in tests/apex_pattern_items.test.ts rather than restated here, since
// a hand count is the thing that goes stale.
//
// R8 channel doctrine (the recorded phase decision; docs/prd/masterwrought/
// state.md, "Phase 11 pre-fan-out ledger"): the three pillars split the 28.
//   RAID: the ten APEX_GEAR patterns ride the Nythraxis base loot table as the
//     appended 'nythraxis_patterns' rollGroup (content/dungeons.ts), one
//     partitioned draw at 0.04 each, at most one pattern per kill.
//   RIFT: the ten APEX_ARMOR patterns ride addRiftClearGearLoot
//     (src/sim/rift/progression.ts) as the appended final draw on winning
//     B/A/S clears (0.08, then one pick over RIFT_PATTERN_ITEM_IDS).
//   HEROIC QUARTERMASTER: the APEX_CONSUMABLE patterns are deterministic
//     day-one Heroic Marks vendor stock (content/heroic_vendor.ts), so the
//     consumable economy functions from the first clear; their defs still live
//     HERE so the id universe is one table. EIGHT at phase 11, TWELVE since
//     masterwrought Phase 11i added the angler's endgame block at the bottom of
//     this file (three cooking rows plus the apex rod's schematic, which rides
//     this channel rather than the raid or rift tables for the R18 reason
//     recorded there).
//
// The id contract: pattern_<output item id>, one per apex recipe, teaching the
// recipe whose resultItemId is that output (pinned by
// tests/apex_pattern_items.test.ts). Display names follow the classic
// per-craft prefixes: armorcrafting/weaponcrafting "Plans:", leatherworking/
// tailoring "Pattern:", jewelcrafting "Design:", engineering "Schematic:",
// inscription "Technique:", alchemy/cooking "Recipe:".
//
// Def shape (types.ts RecipeItemDef): kind 'recipe' with teachesRecipeId and
// nothing else. No use, no stackSize, no soulbound, no noMarketList: patterns
// are ordinary tradable drops that bind by CONSUMPTION at learn time
// (src/sim/professions/pattern_items.ts). QUALITY DERIVES from the taught row's
// OUTPUT quality (ruling 11f-PAT), so recipe rarity stays monotone to power:
// that was 'epic' on every one of the original 28 because all 28 taught the
// epic tier, and masterwrought Phase 11i added the first two rows here that
// teach a RARE output and therefore carry rare. sellValue stays a uniform
// modest 100 across every row: the pattern is a teaching token, not the power.
//
// NOT THE ONLY PATTERN TABLE any more: content/farm_patterns.ts is its sibling
// (masterwrought Phase 11f), holding the six patterns that teach farming's
// upper rungs. It is separate so every statement above about "the 28" stays
// literally true, and it reuses this table's id contract, def shape and
// sellValue point rather than inventing its own. The kind:'recipe' universe
// pin in tests/apex_pattern_items.test.ts spans BOTH.
import type { ItemDef } from '../types';

export const APEX_PATTERN_ITEMS: Record<string, ItemDef> = {
  // --- Apex armor patterns (the RIFT channel) ------------------------------
  pattern_spiritweld_girdle: {
    id: 'pattern_spiritweld_girdle',
    name: 'Plans: Spiritweld Girdle',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_spiritweld_girdle',
  },
  pattern_forgefold_legguards: {
    id: 'pattern_forgefold_legguards',
    name: 'Plans: Forgefold Legguards',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_forgefold_legguards',
  },
  pattern_wardspeaker_sabatons: {
    id: 'pattern_wardspeaker_sabatons',
    name: 'Plans: Wardspeaker Sabatons',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_wardspeaker_sabatons',
  },
  pattern_briarstep_jerkin: {
    id: 'pattern_briarstep_jerkin',
    name: 'Pattern: Briarstep Jerkin',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_briarstep_jerkin',
  },
  pattern_fenbloom_breeches: {
    id: 'pattern_fenbloom_breeches',
    name: 'Pattern: Fenbloom Breeches',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_fenbloom_breeches',
  },
  pattern_barksong_handguards: {
    id: 'pattern_barksong_handguards',
    name: 'Pattern: Barksong Handguards',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_barksong_handguards',
  },
  pattern_sunspun_vestments: {
    id: 'pattern_sunspun_vestments',
    name: 'Pattern: Sunspun Vestments',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_sunspun_vestments',
  },
  pattern_sunspun_leggings: {
    id: 'pattern_sunspun_leggings',
    name: 'Pattern: Sunspun Leggings',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_sunspun_leggings',
  },
  pattern_sunspun_handwraps: {
    id: 'pattern_sunspun_handwraps',
    name: 'Pattern: Sunspun Handwraps',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_sunspun_handwraps',
  },
  pattern_sunspun_haversack: {
    id: 'pattern_sunspun_haversack',
    name: 'Pattern: Sunspun Haversack',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_sunspun_haversack',
  },
  // --- Apex gear patterns (the RAID channel) -------------------------------
  pattern_duskforged_warblade: {
    id: 'pattern_duskforged_warblade',
    name: 'Plans: Duskforged Warblade',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_duskforged_warblade',
  },
  pattern_ridgebreaker: {
    id: 'pattern_ridgebreaker',
    name: 'Plans: Ridgebreaker',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_ridgebreaker',
  },
  pattern_duskforged_bulwark: {
    id: 'pattern_duskforged_bulwark',
    name: 'Plans: Duskforged Bulwark',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_duskforged_bulwark',
  },
  pattern_wyrmfall_pendant: {
    id: 'pattern_wyrmfall_pendant',
    name: 'Design: Wyrmfall Pendant',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_wyrmfall_pendant',
  },
  pattern_warhewn_signet: {
    id: 'pattern_warhewn_signet',
    name: 'Design: Warhewn Signet',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_warhewn_signet',
  },
  pattern_prismglass_loop: {
    id: 'pattern_prismglass_loop',
    name: 'Design: Prismglass Loop',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_prismglass_loop',
  },
  pattern_gyrelens_array: {
    id: 'pattern_gyrelens_array',
    name: 'Schematic: Gyrelens Array',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_gyrelens_array',
  },
  pattern_masters_field_forge: {
    id: 'pattern_masters_field_forge',
    name: "Schematic: Master's Field Forge",
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_masters_field_forge',
  },
  pattern_makers_charm: {
    id: 'pattern_makers_charm',
    name: "Schematic: Maker's Charm",
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_makers_charm',
  },
  pattern_voidbound_grimoire: {
    id: 'pattern_voidbound_grimoire',
    name: 'Technique: Voidbound Grimoire',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_voidbound_grimoire',
  },
  // --- Apex consumable patterns (the HEROIC QUARTERMASTER channel) ---------
  pattern_ironhusk_flask: {
    id: 'pattern_ironhusk_flask',
    name: 'Recipe: Ironhusk Flask',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_ironhusk_flask',
  },
  pattern_warboar_flask: {
    id: 'pattern_warboar_flask',
    name: 'Recipe: Warboar Flask',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_warboar_flask',
  },
  pattern_runewater_flask: {
    id: 'pattern_runewater_flask',
    name: 'Recipe: Runewater Flask',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_runewater_flask',
  },
  pattern_stonepot_stew: {
    id: 'pattern_stonepot_stew',
    name: 'Recipe: Stonepot Stew',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_stonepot_stew',
  },
  pattern_warspice_skewers: {
    id: 'pattern_warspice_skewers',
    name: 'Recipe: Warspice Skewers',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_warspice_skewers',
  },
  pattern_sageleaf_chowder: {
    id: 'pattern_sageleaf_chowder',
    name: 'Recipe: Sageleaf Chowder',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_sageleaf_chowder',
  },
  pattern_grand_cauldron: {
    id: 'pattern_grand_cauldron',
    name: 'Recipe: Grand Cauldron',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_grand_cauldron',
  },
  pattern_laden_hearth: {
    id: 'pattern_laden_hearth',
    name: 'Recipe: The Laden Hearth',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_laden_hearth',
  },
  // --- The angler's endgame patterns (masterwrought Phase 11i) -------------
  // Four more on the SAME contract as the eight above: pattern_<output item
  // id>, kind 'recipe', the uniform sellValue 100, and the
  // registered per-craft display prefix ("Recipe:" for cooking, "Schematic:"
  // for engineering). They coin no name of their own: each is a prefix plus its
  // output's name, so the naming load for the whole group is zero. QUALITY is
  // the one field that is NOT uniform across the four, and the paragraph below
  // is why: it derives per row from what the row teaches.
  //
  // ALL FOUR RIDE THE HEROIC QUARTERMASTER as deterministic Heroic Marks stock
  // (content/heroic_vendor.ts), the channel phase 11 gave the eight apex
  // consumable patterns. The schematic in particular could not be a luck drop:
  // the rod it teaches is the gate on catch band 5, so luck-gating it would put
  // a whole band of the profession behind luck, which R18 forbids.
  // RARE, not epic, and the two below are the first rows in THIS table that are
  // not (ruling 11f-PAT: a pattern's quality derives from the OUTPUT quality of
  // the row it teaches, so recipe rarity stays monotone to power). Both teach a
  // plain rare dish that reuses a shipped foodHp and sellValue point, so an
  // epic wrapper would promise a power rung the dish does not have. The header
  // above carried a uniform-epic claim until this phase; it was true of the 28
  // and is not a rule, which is what 11f-PAT already said for the farm table.
  pattern_peppered_deepbarb_catfish: {
    id: 'pattern_peppered_deepbarb_catfish',
    name: 'Recipe: Peppered Deepbarb Catfish',
    kind: 'recipe',
    quality: 'rare',
    sellValue: 100,
    teachesRecipeId: 'recipe_peppered_deepbarb_catfish',
  },
  pattern_roast_hollowgill_sturgeon: {
    id: 'pattern_roast_hollowgill_sturgeon',
    name: 'Recipe: Roast Hollowgill Sturgeon',
    kind: 'recipe',
    quality: 'rare',
    sellValue: 100,
    teachesRecipeId: 'recipe_roast_hollowgill_sturgeon',
  },
  // THE APEX FEAST TIER (masterwrought Phase 11k). These three REPLACE Phase
  // 11i's pattern_deepwater_feast, whose recipe this phase retired under the
  // ruling recorded at content/profession_items.ts. Epic under ruling 11f-PAT,
  // because each teaches an epic output; all three sit at the 16-marks
  // skill-125 rung on the Heroic Quartermaster beside the two mobile stations.
  pattern_stonepot_feast: {
    id: 'pattern_stonepot_feast',
    name: 'Recipe: Stonepot Feast',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_stonepot_feast',
  },
  pattern_warspice_feast: {
    id: 'pattern_warspice_feast',
    name: 'Recipe: Warspice Feast',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_warspice_feast',
  },
  pattern_sageleaf_feast: {
    id: 'pattern_sageleaf_feast',
    name: 'Recipe: Sageleaf Feast',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_sageleaf_feast',
  },
  pattern_clockreel_fishing_rod: {
    id: 'pattern_clockreel_fishing_rod',
    name: 'Schematic: Clockreel Fishing Rod',
    kind: 'recipe',
    quality: 'epic',
    sellValue: 100,
    teachesRecipeId: 'recipe_clockreel_fishing_rod',
  },
};
