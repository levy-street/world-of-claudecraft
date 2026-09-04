// Purpose hints for the arcane/resonant crafting materials (a data-driven
// tooltip line).
// The eight arcane/resonant materials are kind 'junk' with no def-level use,
// so their tooltips said nothing about what they are for or where they come
// from: a player holding Resonant Timber had no in-game way to learn it is an
// enchanting reagent, let alone which gear yields it. One line per material,
// keyed by ITEM ID in the table below so the hint is DATA the painter reads,
// never a branch inside the tooltip builder.
//
// Deliberately scoped to the ids in the table below ONLY. Every other item
// keeps its existing tooltip byte-for-byte; this is not a general
// item-description mechanism (the def-driven lines above it already cover
// use/quest/set text).
//
// The nine fine gathered grades (D8) were added for the same reason as the
// eight enchanting materials, and it bites harder for them: a fine grade is
// both a hard gate on the crafted tool recipes and a silent stand-in for its
// ordinary version, and nothing else in the client said either. They SHARE one
// key, because the sentence is identical for all nine.
// The source wordings track the sim's own routing rules:
// DISENCHANT_MATERIAL_BY_QUALITY (src/sim/professions/enchanting.ts) for the
// three arcane tiers, and ARMOR_SECONDARY_BY_TYPE / TIMBER_WEAPON_TYPES
// (src/sim/professions/disenchant_reagents.ts) for the five resonants.
// Since the jewelcrafting base catalog, arcane_dust and arcane_essence feed
// TWO crafts, so their leads read craft-neutral ("Crafting reagent."); the
// craft list itself is material_profession_hint_view's Used-by line, and a
// craft-free lead never supersedes that line (see the explicit craft-naming
// set there).
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { esc } from '../../esc';
import { type TranslationKey, t } from '../../i18n';

/** Item id -> its purpose-hint key. The ONLY items that carry a hint. */
export const MATERIAL_HINT_KEYS: Readonly<Record<string, TranslationKey>> = {
  arcane_dust: 'hudChrome.materialHint.arcaneDust',
  arcane_essence: 'hudChrome.materialHint.arcaneEssence',
  arcane_shard: 'hudChrome.materialHint.arcaneShard',
  resonant_thread: 'hudChrome.materialHint.resonantThread',
  resonant_hide: 'hudChrome.materialHint.resonantHide',
  resonant_links: 'hudChrome.materialHint.resonantLinks',
  resonant_steel: 'hudChrome.materialHint.resonantSteel',
  resonant_timber: 'hudChrome.materialHint.resonantTimber',
  fine_copper_ore: 'hudChrome.materialHint.fineGrade',
  fine_iron_ore: 'hudChrome.materialHint.fineGrade',
  fine_thorium_ore: 'hudChrome.materialHint.fineGrade',
  fine_ironbark_log: 'hudChrome.materialHint.fineGrade',
  fine_ashwood_log: 'hudChrome.materialHint.fineGrade',
  fine_elderwood_log: 'hudChrome.materialHint.fineGrade',
  fine_silverleaf_herb: 'hudChrome.materialHint.fineGrade',
  fine_goldleaf_herb: 'hudChrome.materialHint.fineGrade',
  fine_sunpetal_herb: 'hudChrome.materialHint.fineGrade',
  // The nine Masterwrought skill-75 intermediates (Phase 07) share one
  // craft-free lead the same way the fine grades do: they are kind 'junk'
  // with no def-level use. Phase 08 landed the armor-craft consumers, so
  // plating/cording/bolt now ALSO carry a real Used-by line beside this
  // lead (the fine-grade coexistence pattern); the remaining six wait on
  // their phase 09/10 apex rows. The Quickening Catalyst carries its own
  // line because its craft limit (one per day) is a rule the tooltip must
  // state; its Used-by line lists the consumers.
  duskforged_billet: 'hudChrome.materialHint.masterwroughtIntermediate',
  forgefold_plating: 'hudChrome.materialHint.masterwroughtIntermediate',
  wyrmhide_cording: 'hudChrome.materialHint.masterwroughtIntermediate',
  sunspun_bolt: 'hudChrome.materialHint.masterwroughtIntermediate',
  prismglass_setting: 'hudChrome.materialHint.masterwroughtIntermediate',
  precision_chassis: 'hudChrome.materialHint.masterwroughtIntermediate',
  seasoned_stock: 'hudChrome.materialHint.masterwroughtIntermediate',
  lucent_reagent: 'hudChrome.materialHint.masterwroughtIntermediate',
  sablewax_vellum: 'hudChrome.materialHint.masterwroughtIntermediate',
  quickening_catalyst: 'hudChrome.materialHint.quickeningCatalyst',
  // The growth tonic joined when it became a crafted output (the Phase 6
  // alchemy recipe): a recipe output must state its purpose in its tooltip
  // (tests/crafted_item_tooltip_coverage.test.ts), and the tonic is kind
  // 'junk' with no def-level use because plant_crop consumes it as the
  // plant-time yield knob, so the purpose line is the one place that says so.
  growth_tonic: 'hudChrome.materialHint.growthTonic',
  // The Deed of Making (masterwrought Phase 13): the promotion writ is a
  // recipe output (recipe_deed_of_making), kind 'junk' with no def-level use
  // because the final Perfecting rank consumes it (perfecting.ts
  // LEGENDARY_PROMOTION_COST), so this purpose line is the one place its
  // tooltip says what it is for (the growth_tonic precedent).
  deed_of_making: 'hudChrome.materialHint.deedOfMaking',
  // Wyrmfall Core (masterwrought Phase 14 UX pass): the tradable apex
  // catalyst is kind 'junk' with no def-level use, so nothing in the client
  // said where it comes from. The line names its faucets from the live
  // income module (src/sim/professions/masterwrought_materials.ts: the
  // per-source daily boss roll of WYRMFALL_BOSS_MIN..MAX, the deterministic
  // WYRMFALL_RIFT_COUNT first-clear grants, the Heroic Quartermaster row in
  // content/heroic_vendor.ts); the Used-by line names its consuming crafts.
  wyrmfall_core: 'hudChrome.materialHint.wyrmfallCore',
  // The adopted trophies (masterwrought Phase 11l): mob drops promoted to
  // common reagents by the TROPHY_RECIPES rows that consume them. Phase 11l
  // deliberately shipped them with no lead, on the reading that one would
  // duplicate the Used-by line; Phase 18 reopened that and authored these,
  // because the two lines answer different questions. The Used-by line says
  // which craft SPENDS a trophy, which the recipe tables already imply once
  // the player knows the trophy is a reagent at all; nothing in the client
  // said where MORE of one comes from, and a trophy's faucet is a named foe
  // rather than a node a gathering skill can be pointed at. Every lead here
  // is craft-free for that reason, so both lines render together.
  // The set is exactly the derived adopted list (tests/helpers/
  // adopted_trophy_ids.ts holds it in both directions), so a de-adopted
  // trophy cannot keep a lead that calls it a crafting reagent.
  mudfin_scale: 'hudChrome.materialHint.mudfinScale',
  cracked_wyrm_scale: 'hudChrome.materialHint.crackedWyrmScale',
  cracked_ogre_tusk: 'hudChrome.materialHint.crackedOgreTusk',
  tallow_candle: 'hudChrome.materialHint.tallowCandle',
  bandit_bandana: 'hudChrome.materialHint.banditBandana',
  old_cragmaws_pelt: 'hudChrome.materialHint.oldCragmawsPelt',
  emberwing_cinderscale: 'hudChrome.materialHint.emberwingCinderscale',
};

/** The hint key for one item id, or undefined for every other item. */
export function materialHintKey(itemId: string): TranslationKey | undefined {
  return MATERIAL_HINT_KEYS[itemId];
}

/** The hint as a tooltip line, or '' for an item with no hint. Rendered in the
 *  muted description style the other def-driven use lines share. */
export function materialHintLine(itemId: string): string {
  const key = materialHintKey(itemId);
  return key ? `<div class="tt-desc">${esc(t(key))}</div>` : '';
}
