// Crucible of the Last Spring: the raid professions tier (data-as-code,
// docs/prd/ignivar-raid-professions.md). The core reagent, the drop-taught
// recipe scrolls, the three crafted best-in-slot epics, and the legendary
// hammer with its quest-taught recipe. The enchant formula lives in
// ./enchants.ts (that domain's own table); the loot rows on the raid mobs in
// ./dungeons.ts; the quest chain in ./ignivar_raid_lore.ts.
//
// Numbers doctrine:
// - Item levels are DERIVED from each recipe's `level` through the source
//   index recipe arm (src/sim/item_level.ts): epics author at level 31
//   (31 + epic 6 = ilvl 37, two above the dropped raid tier) and the hammer
//   at level 29 (29 + legendary 10 = ilvl 39).
// - Primary stats are budget-true by hand (the authored-content rule):
//   round(ilvl x quality x slot x STAT_PER_ILVL), with the two-hander
//   premium on the hammer. Ratings ride OFF the primary budget (the tier's
//   convention) and no crafted piece carries hit (the loot plan's hit
//   program stays settled).
// - Core costs are the PRD's 3/6/15 and the core reagent rows carry
//   noDiscount: every crafter who can learn these is specialized by
//   construction, so without the flag the authored economy would never be
//   the real one (professions/types.ts ProfessionReagent.noDiscount).
// - The dropped-tier ilvl-35 registration (IGNIVAR_RAID_LOOT_SOURCE_LEVEL)
//   is the loot plan's own phase; nothing here depends on it.

import type { ProfessionRecipeRecord } from '../professions/types';
import type { ItemDef } from '../types';

export const CRUCIBLE_PROFESSION_ITEMS: Record<string, ItemDef> = {
  // The core reagent (the classic molten-core shape): guaranteed off both
  // bosses plus a lesser raid-trash arm, consumed 3/6/15 by the formula,
  // the epics, and the hammer. Ordinary tradeable material; kind 'junk' is
  // the material convention (the junk sweep vendors POOR only, and the
  // tooltip kind line reads Material). Priced so the recipe economy
  // invariant holds with room (inputs always out-value the vendor line of
  // every output below).
  lastflame_core: {
    id: 'lastflame_core',
    name: 'Core of the Last Flame',
    kind: 'junk',
    quality: 'epic',
    sellValue: 5000,
  },
  // The hammer chain's starter relic: drops off Varkhul only while the
  // chain quest is active (the LootEntry questId gate in ./dungeons.ts).
  forgefathers_ember: {
    id: 'forgefathers_ember',
    name: "Forgefather's Ember",
    kind: 'quest',
    quality: 'epic',
    questId: 'q_forgefathers_requiem',
    sellValue: 0,
    noVendorSell: true,
  },

  // The three crafted epics: each targets a DIFFERENT tier-set slot per
  // armor class, so the crafted piece fills the free fifth set slot and
  // composes with the four-piece bonus instead of competing with it.
  // Armor values sit on the empirical slot ladder scaled to ilvl 37 off the
  // shipped epic baselines (crownforged mail helm 310 at 29; the heroic
  // leather/cloth lines at 31).
  cruciblewrought_warhelm: {
    id: 'cruciblewrought_warhelm',
    name: 'Crucible-Wrought Warhelm',
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'epic',
    requiredLevel: 20,
    // primaryStatBudget(37, epic, helmet 0.85) = round(22.015) = 22 points.
    stats: { armor: 395, str: 12, sta: 10 },
    critRating: 25,
    sellValue: 12000,
    requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  emberveil_legguards: {
    id: 'emberveil_legguards',
    name: 'Emberveil Legguards',
    kind: 'armor',
    armorType: 'leather',
    slot: 'legs',
    quality: 'epic',
    requiredLevel: 20,
    // primaryStatBudget(37, epic, legs 0.9) = round(23.31) = 23 points.
    stats: { armor: 205, agi: 13, sta: 10 },
    hasteRating: 25,
    sellValue: 12000,
    requiredClass: ['rogue', 'druid', 'hunter'],
  },
  vestment_of_the_last_spring: {
    id: 'vestment_of_the_last_spring',
    name: 'Vestment of the Last Spring',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'epic',
    requiredLevel: 20,
    // primaryStatBudget(37, epic, chest 1.0) = round(25.9) = 26 points.
    stats: { armor: 105, int: 14, sta: 6, spi: 6 },
    // The tier's spellPower debut does the work here: the single best
    // sp-per-slot chest in the tier (healers benefit through the
    // spellPower-feeds-healing directionality; a dedicated healer line is
    // an open catalog question for the integration re-cut).
    spellPower: 18,
    critRating: 15,
    sellValue: 12000,
    requiredClass: ['mage', 'warlock', 'priest'],
  },

  // The legendary hammer: the tier's weapon ceiling, self-crafted by design
  // (soulbound at mint; the quest chain in ./ignivar_raid_lore.ts teaches
  // the recipe and its finale is forging it yourself).
  forgefathers_requiem: {
    id: 'forgefathers_requiem',
    name: "Forgefather's Requiem",
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'legendary',
    requiredLevel: 20,
    // weaponDpsBudget(39) = 18.4 x TWOHAND_DPS_MULT = 21.16 dps at a slow
    // 3.6 swing: avg 76.2, so 57 to 95.
    weapon: { min: 57, max: 95, speed: 3.6 },
    // round(primaryStatBudget(39, legendary, mainhand) = 52 x
    // TWOHAND_STAT_MULT 1.3) = 68 points.
    stats: { str: 38, sta: 30 },
    soulbound: true,
    sellValue: 20000,
    requiredClass: ['warrior', 'paladin', 'shaman', 'druid'],
  },

  // The four drop-taught scrolls (the hammer's recipe is quest-taught
  // instead). Tradeable on purpose: on a small realm the drop must be able
  // to migrate to a qualified crafter, and using one below the learn floor
  // refuses WITHOUT consuming (professions/recipe_scrolls.ts), so an
  // unqualified winner can always sell it on. noVendorSell guards a
  // server-first drop against a misclick vendoring; the World Market stays
  // open.
  plans_cruciblewrought_warhelm: {
    id: 'plans_cruciblewrought_warhelm',
    name: 'Plans: Crucible-Wrought Warhelm',
    kind: 'recipe',
    quality: 'epic',
    use: { type: 'teachRecipe', recipeId: 'recipe_cruciblewrought_warhelm' },
    sellValue: 0,
    noVendorSell: true,
  },
  pattern_emberveil_legguards: {
    id: 'pattern_emberveil_legguards',
    name: 'Pattern: Emberveil Legguards',
    kind: 'recipe',
    quality: 'epic',
    use: { type: 'teachRecipe', recipeId: 'recipe_emberveil_legguards' },
    sellValue: 0,
    noVendorSell: true,
  },
  pattern_vestment_of_the_last_spring: {
    id: 'pattern_vestment_of_the_last_spring',
    name: 'Pattern: Vestment of the Last Spring',
    kind: 'recipe',
    quality: 'epic',
    use: { type: 'teachRecipe', recipeId: 'recipe_vestment_of_the_last_spring' },
    sellValue: 0,
    noVendorSell: true,
  },
  formula_lastflame_zeal: {
    id: 'formula_lastflame_zeal',
    name: "Formula: Last Flame's Zeal",
    kind: 'recipe',
    quality: 'epic',
    use: { type: 'teachRecipe', recipeId: 'enchant_weapon_lastflame_zeal' },
    sellValue: 0,
    noVendorSell: true,
  },
};

// The recipe tier: skillReq 100 (tier 4) is both the learn floor and the
// difficulty band; the hammer sits at 125, the cap, per the PRD. Gathering
// inputs are the fine grades (the tool-outclassed premium yields) plus the
// profession-appropriate corpse and vendor materials, and every core row is
// discount-exempt.
export const CRUCIBLE_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_cruciblewrought_warhelm',
    professionId: 'armorcrafting',
    resultItemId: 'cruciblewrought_warhelm',
    resultCount: 1,
    reagents: [
      { itemId: 'lastflame_core', count: 6, noDiscount: true },
      { itemId: 'fine_thorium_ore', count: 6 },
      { itemId: 'fine_elderwood_log', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 31,
    level: 31,
    stationType: 'forge',
    acquisition: ['drop'],
  },
  {
    id: 'recipe_emberveil_legguards',
    professionId: 'leatherworking',
    resultItemId: 'emberveil_legguards',
    resultCount: 1,
    reagents: [
      { itemId: 'lastflame_core', count: 6, noDiscount: true },
      { itemId: 'pristine_hide', count: 4 },
      { itemId: 'fine_sunpetal_herb', count: 2 },
      { itemId: 'tanning_agent', count: 4 },
    ],
    skillReq: 100,
    itemLevelBudget: 31,
    level: 31,
    stationType: 'tannery',
    acquisition: ['drop'],
  },
  {
    id: 'recipe_vestment_of_the_last_spring',
    professionId: 'tailoring',
    resultItemId: 'vestment_of_the_last_spring',
    resultCount: 1,
    reagents: [
      { itemId: 'lastflame_core', count: 6, noDiscount: true },
      { itemId: 'spider_silk', count: 8 },
      { itemId: 'fine_sunpetal_herb', count: 2 },
      { itemId: 'spool_of_thread', count: 4 },
    ],
    skillReq: 100,
    itemLevelBudget: 31,
    level: 31,
    stationType: 'loom',
    acquisition: ['drop'],
  },
  {
    id: 'recipe_forgefathers_requiem',
    professionId: 'weaponcrafting',
    resultItemId: 'forgefathers_requiem',
    resultCount: 1,
    reagents: [
      { itemId: 'lastflame_core', count: 15, noDiscount: true },
      { itemId: 'fine_thorium_ore', count: 10 },
      { itemId: 'fine_elderwood_log', count: 6 },
    ],
    skillReq: 125,
    itemLevelBudget: 29,
    level: 29,
    stationType: 'forge',
    acquisition: ['quest'],
  },
];
