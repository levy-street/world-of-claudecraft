// Farming recipe patterns (Phase 11f, masterwrought R8): the physical
// kind:'recipe' drops that teach the farm recipes at or above
// FARM_DROP_RUNG_FLOOR (recipes.ts, FARM_RECIPES). Merged into ITEMS by
// data.ts (mergeItems), beside APEX_PATTERN_ITEMS.
//
// A SEPARATE TABLE FROM apex_patterns.ts, deliberately, and for three reasons
// worth stating so nobody folds them together later. Module-first is this
// repo's default for a new table. Farming's block stays contiguous under the
// three-tier ordering rule Phase 11b established. And apex_patterns.ts's
// header is a recorded statement about the 28 MASTERWROUGHT apex recipes,
// which must stay literally true: these six teach farm dishes, not apex gear.
//
// NO NEW MACHINERY, which is the whole thesis of the phase. A farm recipe is a
// COOKING recipe, the same kind of object an apex consumable pattern teaches,
// so resolvePatternLearn (professions/pattern_items.ts) resolves these through
// the same four reads it already ran: the recipe's acquisition includes
// 'drop', it is not already known, the player's flat skill in
// recipe.professionId is above zero, and teachTierMet holds over the shared
// 25-point band math. RecipeItemDef.teachesRecipeId points at a recipe id and
// never asks which craft owns it. pattern_items.ts, training.ts, wheel.ts and
// crafting.ts are byte-identical across this phase.
//
// masterwrought R8 channel doctrine as wired and summarized in
// docs/design/professions.md:
//   RAID: pattern_harvest_feast rides the Nythraxis base loot table as the
//     appended 'nythraxis_farm' rollGroup, with the tier-4 seeds. The farm
//     ladder's pinnacle on the pinnacle encounter.
//   DUNGEON: the two rung-75 patterns ride the heroic five-mans as an appended
//     'heroic_farm_patterns' tail group (content/heroic_loot.ts).
//   RIFT: the other three rung-100 patterns ride addRiftClearGearLoot as the
//     appended draw on winning B/A/S clears, with the tier-3 and tier-4 seeds
//     (FARM_RIFT_DROP_ITEM_IDS in src/sim/rift/progression.ts).
//   HEROIC QUARTERMASTER: all six, plus every tier-3 and tier-4 seed, at the
//     12-mark ring point (content/heroic_vendor.ts). That valve is the reason
//     the luck-gated arms are allowed to exist at all: under D13 a luck-gated
//     trigger can never be the only faucet for a pattern.
//
// The id contract is the shipped one, pattern_<output item id>, one per flipped
// recipe, teaching the recipe whose resultItemId is that output. Display names
// follow the shipped per-craft prefix table, and cooking's prefix is "Recipe:",
// so every name here is "Recipe: " plus an ALREADY SHIPPED dish name and this
// table mints NO new proper noun. The naming sweep ran anyway and its verdict
// is written in docs/design/naming-audit.md.
//
// Def shape copies types.ts RecipeItemDef exactly: kind 'recipe' with
// teachesRecipeId and nothing else. No use, no stackSize, no soulbound, no
// noMarketList; patterns are ordinary tradable drops that bind by CONSUMPTION
// at learn time (professions/pattern_items.ts).
//
// QUALITY DERIVES from the taught row's OUTPUT quality (ruling 11f-PAT). The
// literal below is the RESULT of that derivation, not an independent choice:
// each value was computed per pattern against the merged catalog, and
// tests/farm_pattern_items.test.ts re-derives it row by row, so a taught row
// whose output quality moved reds here instead of leaving a stale rarity. Recipe
// rarity is pinned monotone to the power of what it teaches. On this set that
// lands uniformly on 'rare', which was PREDICTED before the rung climb and
// OBSERVED after, and is a fact about the six flipped rows rather than a rule:
// the whole fourteen-row farm ladder spans common, uncommon and rare, so a
// future flipped row need not be rare and the derivation, not the value, is
// what to preserve. The apex set reads 'epic' for the same reason: it teaches
// the epic tier.
//
// sellValue stays UNIFORM at the shipped point of 100, the same single point
// all 28 apex patterns use. sellValue on a kind 'recipe' item is a vendor
// floor for a tradable teaching item, not a power statement, and the shipped
// catalog carries exactly ONE point for that entire class; the mark price and
// channel already carry the rung. Minting a second point for the farm set was rejected as a number nobody
// measured, bought to restate a rung two other surfaces already state.
// Typed as the NARROW RecipeItemDef rather than the ItemDef union its apex
// sibling uses, deliberately: the def shape above is a contract, and the narrow
// type makes tsc enforce it (a stray `use` or `stackSize` fails to compile
// instead of waiting for a test). It still merges into ITEMS unchanged, since
// RecipeItemDef is a member of that union.
import type { RecipeItemDef } from '../types';

export const FARM_PATTERN_ITEMS: Record<string, RecipeItemDef> = {
  // --- rung 75, the tier-3 dishes (the heroic five-man channel) -------------
  pattern_highwatch_gourd_soup: {
    id: 'pattern_highwatch_gourd_soup',
    name: 'Recipe: Highwatch Gourd Soup',
    kind: 'recipe',
    quality: 'rare',
    sellValue: 100,
    teachesRecipeId: 'recipe_highwatch_gourd_soup',
  },
  pattern_highwatch_barley_porridge: {
    id: 'pattern_highwatch_barley_porridge',
    name: 'Recipe: Highwatch Barley Porridge',
    kind: 'recipe',
    quality: 'rare',
    sellValue: 100,
    teachesRecipeId: 'recipe_highwatch_barley_porridge',
  },
  // --- rung 100, the tier-4 dishes (the rift channel) ----------------------
  pattern_evergarden_sunmelon_tart: {
    id: 'pattern_evergarden_sunmelon_tart',
    name: 'Recipe: Evergarden Sunmelon Tart',
    kind: 'recipe',
    quality: 'rare',
    sellValue: 100,
    teachesRecipeId: 'recipe_evergarden_sunmelon_tart',
  },
  pattern_evergarden_harvest_platter: {
    id: 'pattern_evergarden_harvest_platter',
    name: 'Recipe: Evergarden Harvest Platter',
    kind: 'recipe',
    quality: 'rare',
    sellValue: 100,
    teachesRecipeId: 'recipe_evergarden_harvest_platter',
  },
  pattern_evergarden_braised_greens: {
    id: 'pattern_evergarden_braised_greens',
    name: 'Recipe: Evergarden Braised Greens',
    kind: 'recipe',
    quality: 'rare',
    sellValue: 100,
    teachesRecipeId: 'recipe_evergarden_braised_greens',
  },
  // --- rung 100, the party feast (the raid channel) ------------------------
  pattern_harvest_feast: {
    id: 'pattern_harvest_feast',
    name: 'Recipe: Harvest Feast',
    kind: 'recipe',
    quality: 'rare',
    sellValue: 100,
    teachesRecipeId: 'recipe_harvest_feast',
  },
};
