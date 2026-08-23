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
// bone_fragments, linen_scrap, spider_leg. Since Professions 2.0
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
// Acquisition (Professions 2.0, locked scope): ONLY the three
// COMBO_RECIPES carry `acquisition: ['trainer']`, learned from the resident
// master at their craft's station (professions/training.ts resolveTrain).
// COMMON_RECIPES, TOOL_RECIPES, and CASTER_HUB_RECIPES deliberately keep NO
// acquisition field: state.md locks them grandfathered, known to everyone via
// the empty-acquisition arm of crafting.ts isRecipeKnown. Existing characters
// keep the combo recipes too, via the one-time grandfather union
// (training.ts PRE_TRAINING_RECIPE_IDS / grandfatherKnownRecipes); every
// newly authored recipe must carry a non-empty acquisition list (see
// the field doc in ../professions/types.ts).

import type { ProfessionRecipeRecord } from '../professions/types';

// Economy invariant: the reagent lists of the former
// LEGACY_GOLD_POSITIVE_RECIPE_IDS members below were reworked so
// input value exceeds output sellValue (the locked recipe_economy.test.ts
// rule). INPUT reworks only: ids, results, resultCounts, skillReq, stations,
// and acquisition are untouched. Every material on a rung-0 common is
// obtainable by a fresh zone-1 character (starter mob drops, tier-1 nodes,
// Eastbrook vendor staples); tanning_agent (zone-2 vendor) and glass_vial
// (zone-3 vendor) are deliberately NOT used at rung 0. Four members (the
// jerkin, vestments, druids hide, and warded leggings) could not clear the
// invariant through inputs alone and closed through the paired arm
// instead: an input rework plus an output sellValue re-priced
// below it in items.ts. The frozen legacy list is EMPTY (see
// tests/recipe_economy.test.ts).
export const COMMON_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_eastbrook_arming_sword',
    professionId: 'weaponcrafting',
    resultItemId: 'eastbrook_arming_sword',
    resultCount: 1,
    // Fang-hilted arming sword: the first wolf_fang consumer (closing the
    // zero-consumer harvest family). Input 156 vs output 140.
    reagents: [
      { itemId: 'wolf_fang', count: 2 },
      { itemId: 'bone_fragments', count: 4 },
      { itemId: 'smithing_flux', count: 6 },
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
    // Chain needs links: copper smelted under flux. Input 196 vs output 180.
    reagents: [
      { itemId: 'copper_ore', count: 4 },
      { itemId: 'smithing_flux', count: 9 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
  },
  {
    id: 'recipe_eastbrook_wool_trousers',
    professionId: 'tailoring',
    resultItemId: 'eastbrook_wool_trousers',
    resultCount: 1,
    // Harvested cloth volume plus vendor thread. Input 120 vs output 110.
    reagents: [
      { itemId: 'homespun_cloth', count: 3 },
      { itemId: 'spool_of_thread', count: 9 },
    ],
    skillReq: 0,
    itemLevelBudget: 8,
    level: 8,
  },
  {
    id: 'recipe_tanned_leather_jerkin',
    professionId: 'leatherworking',
    resultItemId: 'tanned_leather_jerkin',
    resultCount: 1,
    // Economy invariant (paired arm): zone-1 leather palette (hide, sinew,
    // thread; tanning_agent is
    // zone-2 vendored and stays barred at the entry tier) plus the output
    // sellValue re-priced below input in items.ts. Input 88 vs sell 80.
    reagents: [
      { itemId: 'rough_hide', count: 4 },
      { itemId: 'spider_leg', count: 2 },
      { itemId: 'spool_of_thread', count: 5 },
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
    // Economy invariant: sheenleaf (the zone-1 healing herb)
    // joins the brew. glass_vial was rejected here: its only vendor is in
    // zone 3 and this is the level-1 field alchemy entry. Input 15 vs output 8.
    reagents: [
      { itemId: 'linen_scrap', count: 1 },
      { itemId: 'spider_leg', count: 1 },
      { itemId: 'silverleaf_herb', count: 2 },
    ],
    skillReq: 0,
    itemLevelBudget: 1,
    level: 1,
  },
  // Caster-stat (int/spi) common-tier recipes: one per
  // tailoring/leatherworking/armorcrafting, alongside the armor-only pieces
  // above. All three clear the economy invariant via the paired arm (zone-1
  // thematic input rework plus an output sellValue re-priced below input in
  // items.ts); the frozen legacy list is empty. See tests/recipe_economy.test.ts.
  {
    id: 'recipe_eastbrook_ritual_vestments',
    professionId: 'tailoring',
    resultItemId: 'eastbrook_ritual_vestments',
    resultCount: 1,
    // Economy invariant (paired arm, see the jerkin note): cloth palette;
    // also retires this piece as easy dust-mill fodder.
    // The original linen 3 + spider_leg 1
    // core is KEPT (the count-1 spider row is a load-bearing premise of the
    // masterwork count-1 signed-reagent pins); cloth and thread add the
    // volume. Input 85 vs sell 72.
    reagents: [
      { itemId: 'linen_scrap', count: 3 },
      { itemId: 'spider_leg', count: 1 },
      { itemId: 'homespun_cloth', count: 3 },
      { itemId: 'spool_of_thread', count: 5 },
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
    // Economy invariant (paired arm, see the jerkin note).
    // Input 93 vs sell 84.
    reagents: [
      { itemId: 'rough_hide', count: 5 },
      { itemId: 'spider_leg', count: 2 },
      { itemId: 'spool_of_thread', count: 5 },
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
    // Economy invariant (paired arm, see the jerkin note).
    // Input 117 vs sell 105.
    reagents: [
      { itemId: 'bone_fragments', count: 3 },
      { itemId: 'copper_ore', count: 4 },
      { itemId: 'smithing_flux', count: 4 },
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
// stationType (Professions 2.0, formerly #1297's requiresHubStation):
// every recipe below is station-bound at the toolworks (content/professions.ts
// STATIONS, checked by ../professions/stations.ts). These are the natural
// first station-bound recipes: real tier-4/5 gear already tier-gated well
// past the common free floor, unlike COMMON_RECIPES/COMBO_RECIPES above
// (both free-field-craftable, deliberately left ungated here).
//
// Every gathered reagent below is a FINE grade (D8,
// professions/material_grades.ts), which is what turns this list from a
// shopping list into a ladder: a fine material only drops for a player whose
// tool is already strictly above it, and each recipe also consumes the tool
// one rung down, so the rung below is the only route to the rung above. The
// counts and the previous-tool reagent are unchanged; only the grade moved.
//
// Two rungs needed a decision rather than a swap, and both are recorded here
// because the reagent lists alone do not show why they differ:
//
// - The tier-4 PICK could not simply take fine_thorium_ore. Osmium is the
//   thornpeak (tier-3) yield, so its fine grade needs a tier-4 pick, which is
//   this recipe's own output: a closed circuit with no entry. It is re-pointed
//   onto fine_iron_ore, the mirefen (tier-2) yield, whose fine grade needs the
//   tier-3 pick this recipe already consumes. That is exactly the shape the
//   axe and sickle lines already had, so all three tier-4 recipes now read the
//   same way instead of the pick being the odd one out.
// - The tier-5 PICK has no node material at all: arcanite_bar is refined and
//   vendor-only by locked ruling, and is consumed by nothing else, so
//   re-pointing off it would strand both the bar and its vendor rows. It KEEPS
//   the bar and GAINS fine_thorium_ore x2, matching the other two tier-5
//   recipes (two units of the thornpeak fine grade plus the tier-4 tool) and
//   giving fine_thorium_ore the consumer it would otherwise lack. It is the
//   one rung that got more expensive rather than equivalent; that is the
//   point, since it was the one rung still buyable off a counter.
export const TOOL_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_thorium_mining_pick',
    professionId: 'engineering',
    resultItemId: 'thorium_mining_pick',
    resultCount: 1,
    reagents: [
      { itemId: 'fine_iron_ore', count: 4 },
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
      { itemId: 'fine_thorium_ore', count: 2 },
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
      { itemId: 'fine_ashwood_log', count: 4 },
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
      { itemId: 'fine_elderwood_log', count: 2 },
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
      { itemId: 'fine_goldleaf_herb', count: 4 },
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
      { itemId: 'fine_sunpetal_herb', count: 2 },
      { itemId: 'goldleaf_sickle', count: 1 },
    ],
    skillReq: 150,
    itemLevelBudget: 30,
    level: 20,
    stationType: 'toolworks',
  },
];

// The crafted fishing rods, tier 4 and tier 5 (D9).
//
// A SEPARATE LIST FROM TOOL_RECIPES, deliberately. TOOL_RECIPES carries one
// invariant that is the whole reason it exists: every member consumes a FINE
// gathered grade plus the tool one rung down, which is what makes that ladder
// self-gating (the grade only drops for a player whose tool already outclasses
// it). Fishing has no world nodes, so it has no fine grades, and folding these
// two rows in would turn that invariant into "a fine grade OR a rare catch",
// a disjunction the six land recipes could then quietly stop satisfying while
// the sweep stayed green on the rods. A weaker shared claim is worth less than
// two strong separate ones, so the rod ladder states its own
// (tests/professions_rod_recipes.test.ts) and leaves TOOL_RECIPES alone.
//
// HOW FAR THE SELF-GATE ACTUALLY REACHES, stated plainly rather than implied.
// Each rung consumes the rod below it, same as the land ladder. The rest
// diverges:
//
// - The tier-4 rung is paced, not gated. Its reagent is the rare catch, whose
//   weight is 1 / 3 / 6 by proficiency band (content/items.ts), so a capped
//   angler farms it six times faster than a beginner. A beginner CAN still
//   land one, which is the deliberate difference from a fine grade: the koi
//   is also the low-level thrill and a deed target, and gating it behind
//   fishing's 200 cap would have put the tier-4 rod behind the end of the
//   climb rather than partway up it, which is not where the land tier-4 tools
//   sit.
// - The tier-5 rung IS hard-gated, and that is what the Slatefin Carp is
//   doing in it. Carp is a Thornpeak-only catch, and Thornpeak water takes a
//   tier-3 rod (professions/fishing_zones.ts), so the reagent cannot be
//   fished at all without the rung this recipe's own input descends from.
//
// Neither rung joins the counterfactually-vendor-fed set in
// tests/recipe_economy.test.ts, because the koi carries no buyValue and no
// counter stocks it. That is a property of the reagent, not an exemption.
//
// Both carry `acquisition: ['trainer']`: the pre-training recipe list is a
// frozen historical record and must not grow, so anything authored after that
// switch is learned from a master. Tinker Gizzel at the Eastbrook toolworks
// teaches them, without a content edit, because the trainer's list derives
// from the crafts its station serves.
//
// SKILL REQUIREMENTS ARE BOTH INSIDE ENGINEERING'S CAP (125), unlike the
// tier-5 land tools at 75/150. 150 resolves to tier 6 while the cap resolves
// to tier 5, and a trainer only teaches a recipe whose tier the learner has
// reached, so a trainer-taught recipe at 150 would be permanently unlearnable
// rather than merely expensive. The land tools escape that only because they
// predate training and are grandfathered known.
export const ROD_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_stormreel_fishing_rod',
    professionId: 'engineering',
    resultItemId: 'stormreel_fishing_rod',
    resultCount: 1,
    reagents: [
      { itemId: 'glimmerfin_koi', count: 4 },
      { itemId: 'silverstream_fishing_rod', count: 1 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    stationType: 'toolworks',
    acquisition: ['trainer'],
  },
  {
    id: 'recipe_tidewrought_fishing_rod',
    professionId: 'engineering',
    resultItemId: 'tidewrought_fishing_rod',
    resultCount: 1,
    reagents: [
      { itemId: 'glimmerfin_koi', count: 2 },
      { itemId: 'raw_stonescale_carp', count: 8 },
      { itemId: 'stormreel_fishing_rod', count: 1 },
    ],
    skillReq: 125,
    itemLevelBudget: 30,
    level: 20,
    stationType: 'toolworks',
    acquisition: ['trainer'],
  },
];

// Tool-effect charms (the acquisition craft): the game's first enchanting
// recipes, minting the item form of the two live TOOL_EFFECTS entries
// (content/items.ts gatherers_cache / artisans_eye; the ids match). The slot
// command consumes the item through resolveSlotToolEffect, so THESE recipes
// are the only production path for a slotted effect.
//
// - `professionId: 'enchanting'` is identity, not listing convenience: the
//   effects are Enchanter work (TOOL_EFFECTS craftId), so the craft gains
//   ENCHANTING skill and the specialization recharge discount keys off the
//   same craft. Enchanting has no station of its own, so the recipes bind to
//   the TOOLWORKS (`stationType`), and the trainer route follows the binding
//   (training.ts trainingStationTypeFor): the tool master teaches the tool
//   upgrades.
// - `acquisition: ['trainer']` per the authoring default (the pre-training
//   grandfather list is frozen); skillReq 25 resolves to tier 1, so learning
//   needs enchanting 25 (a real disenchant/enchant climb) and the tier-1
//   training fee.
// - REAGENTS ARE THE PRICE FLOOR, not flavor: re-slotting a fresh charm
//   resets charges to full, so the mint MUST cost more than the most
//   expensive generic recharge (a full epic-rung fill priced in shards) or
//   re-crafting would bypass recharging outright. The whole arcane ladder is
//   consumed (shards the bulk of the value), which also gives the shard its
//   second sink beside the Greater enchants. The counts clear the bound at
//   the DISCOUNTED price, not just the listed one: a specialized enchanter
//   consumes floor(count x 0.8) of each reagent (crafting.ts
//   requiredReagentCountFor), which is the arm that actually competes with a
//   recharge, so the listed 383 copper is sized so the discounted 298 still
//   sits above the 275 the worst generic recharge costs. The inequality is
//   pinned BOTH ways in tests/professions_tool_effect_recharge.test.ts;
//   retune both sides together.
// - NO Springback (quickening_charm) recipe: the R9 slot policy refuses that
//   effect everywhere, and no path may mint what another path refuses (same
//   guard test derives this from the policy).
export const TOOL_EFFECT_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_gatherers_cache',
    professionId: 'enchanting',
    resultItemId: 'gatherers_cache',
    resultCount: 1,
    reagents: [
      { itemId: 'arcane_shard', count: 5 },
      { itemId: 'arcane_essence', count: 4 },
      { itemId: 'arcane_dust', count: 6 },
    ],
    skillReq: 25,
    itemLevelBudget: 15,
    level: 20,
    stationType: 'toolworks',
    acquisition: ['trainer'],
  },
  {
    id: 'recipe_artisans_eye',
    professionId: 'enchanting',
    resultItemId: 'artisans_eye',
    resultCount: 1,
    reagents: [
      { itemId: 'arcane_shard', count: 5 },
      { itemId: 'arcane_essence', count: 4 },
      { itemId: 'arcane_dust', count: 6 },
    ],
    skillReq: 25,
    itemLevelBudget: 15,
    level: 20,
    stationType: 'toolworks',
    acquisition: ['trainer'],
  },
];

// Station-tier caster-stat (int/spi) recipes (crafting content follow-up to
// the COMMON_RECIPES caster pieces above): one per tailoring/leatherworking/
// armorcrafting, at the same osmium tier as TOOL_RECIPES, each bound to its
// own craft's station type (loom/tannery/forge).
// Economy invariant: all three caster-hub reagent lists are authored
// gold-negative (input above output under the recipe_economy rule).
// skillReq-75 recipes may consume rare-band materials; the plain volume-based
// shapes were used (the resonant-consumer variant was deliberately not taken).
export const CASTER_HUB_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_wardweave_cowl',
    professionId: 'tailoring',
    resultItemId: 'wardweave_cowl',
    resultCount: 1,
    // Silk volume warded with premium herbs (the ladder's sunweave/gildenweave
    // idiom); the odd osmium padding is gone. Input 534 vs output 440.
    reagents: [
      { itemId: 'sunpetal_herb', count: 2 },
      { itemId: 'goldleaf_herb', count: 2 },
      { itemId: 'pristine_silk', count: 2 },
      { itemId: 'spider_silk', count: 4 },
      { itemId: 'spool_of_thread', count: 2 },
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
    // Hide volume (pristine plus rough) tanned at the vats; the thorium
    // studs carry the value. Nothing here is counter-bought since the
    // delist: thorium is harvest-only (Thornpeak mining), the hides are mob
    // drops, and tanning_agent is the zone-2 vendor staple. Input 461 vs
    // output 420 (buyValue basis; delisted materials keep theirs).
    reagents: [
      { itemId: 'thorium_ore', count: 6 },
      { itemId: 'pristine_hide', count: 3 },
      { itemId: 'rough_hide', count: 2 },
      { itemId: 'tanning_agent', count: 1 },
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
    // Ore stays (mail theme) plus smithing_flux volume. Only the flux is
    // Darva's counter staple; the thorium is harvest-only since the delist.
    // Listed input 520 vs output 280 (buyValue basis):
    // the output sits below even the cheapest specialized-plus-self-signed
    // consumption (300, the discount-aware economy arm) so the all-vendor
    // loop can never print copper.
    reagents: [
      { itemId: 'thorium_ore', count: 7 },
      { itemId: 'smithing_flux', count: 5 },
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
// Economy invariant: all three combo reagent lists are authored
// gold-negative. The two rare-output showcases may consume rare-band
// materials (every reagent is vendor-stocked or harvestable in Eastbrook);
// the resonant-secondary variant was deliberately not taken.
export const COMBO_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_ironbound_warplate_helm',
    professionId: 'armorcrafting',
    resultItemId: 'boundstone_helm',
    resultCount: 1,
    // Warplate showcase: bar and ore under flux, crested with wolf fangs (the
    // second wolf_fang home, closing the zero-consumer harvest family).
    // Input 516 vs output 460.
    reagents: [
      { itemId: 'arcanite_bar', count: 1 },
      { itemId: 'thorium_ore', count: 5 },
      { itemId: 'wolf_fang', count: 4 },
      { itemId: 'smithing_flux', count: 2 },
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
    // Same combo family as the helm: osmium volume fluxed around an iron
    // core. Input 424 vs output 390.
    reagents: [
      { itemId: 'thorium_ore', count: 6 },
      { itemId: 'iron_ore', count: 3 },
      { itemId: 'smithing_flux', count: 2 },
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
    // Venom glands deepen the gland sink; the vial is sold by
    // alchemist_verane, the very master who teaches this recipe at the
    // apothecary. Input 38 vs output 20.
    reagents: [
      { itemId: 'linen_scrap', count: 2 },
      { itemId: 'spider_leg', count: 2 },
      { itemId: 'venom_gland', count: 2 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    comboRequirement: { craftA: 'alchemy', craftB: 'engineering', minTier: 1 },
    acquisition: ['trainer'],
  },
];

// Trained ladder set (Professions 2.0): the weaponcrafting,
// armorcrafting, tailoring, leatherworking, cooking, and alchemy recipe
// ladders, three rungs per craft at skillReq 0/25/50, all trainer-taught and
// station-bound (forge for the weapon/armor crafts, loom for tailoring at
// weaver_ottilie, tannery for leatherworking at tanner_hesk, kitchens for
// cooking at cook_marlow, apothecary for alchemy at alchemist_verane). Outputs
// are the new crafted weapon/armor/bag/food/potion/elixir ItemDefs in
// content/profession_items.ts. Never-grandfathered content, so every record carries a
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
    // Tusk-crested boar spear: the first curved_tusk consumer, closing the
    // zero-consumer harvest family #2905 shipped the same way Phase 15 closed
    // wolf_fang (the fang-hilted arming sword above). wild_boar itself drops
    // the tusks, so the rung-0 recipe stays zone-1 legal. Input 50 vs output 36.
    reagents: [
      { itemId: 'curved_tusk', count: 2 },
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
    // Claw-spiked treads: the first sharp_claw and pristine_claw consumers,
    // closing the two remaining zero-consumer harvest families #2905 shipped
    // (the wolf_fang precedent), with the specimen riding count-1 beside its
    // base material like the serpent elixir's pristine_venom_gland. The mire
    // prowlers this line is named for are claw carriers themselves. Input 125
    // vs output 78.
    reagents: [
      { itemId: 'pristine_claw', count: 1 },
      { itemId: 'sharp_claw', count: 2 },
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
    // THE PROVISIONING SUPPLY LINE, rung 0 (masterwrought R17/R18). The grain
    // the skewer is rolled in, ADDED beside the meat and never traded for it:
    // no meat or salt count moved. vale_wheat rather than the brook_carrot the
    // plan defaulted to, and the reason is the economy basis rather than taste.
    // brook_carrot is farming's D9 fee vegetable and the one BASE produce row
    // that carries a buyValue (16); every FINE twin carries one too, so the
    // claim is about the base line only. That 16 would make it the most
    // valuable reagent on this row: the comparison is CONTRIBUTION, not the
    // per-unit basis, so it is one carrot at 16 against game_meat's two at 4
    // for 8. The crop becomes the body and breaks the accent rule.
    // THE COST OF THE SWAP, recorded because it is real: brook_carrot is the one
    // produce a counter sells, so with it this rung-0 bill stayed buyable, and
    // with vale_wheat it needs a farm detour or the World Market. R18 is still
    // satisfied (vale_wheat is a market-listable kind 'junk' material, exactly
    // as sunpetal_herb is in these same bills), so the requirement never falls
    // on a profession, but the vendor route is genuinely gone.
    // vale_wheat at 4 sits under the cap, and a vale_wheat 1
    // binder is the shipped shape farming's own tier-1 rows already use
    // (recipe_eastbrook_root_pottage, recipe_eastbrook_glazed_carrots) under
    // farming's (bz) binder ruling.
    reagents: [
      { itemId: 'game_meat', count: 2 },
      { itemId: 'vale_wheat', count: 1 },
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
    // THE PROVISIONING SUPPLY LINE, rung 25, and the flagship row: a stew is
    // the dish the missing vegetable class was most obviously short of, and it
    // is the one place grain AND root both belong. The grain that thickens it
    // and the root that bodies it, both ADDED: the meat stays at 3, the herb at
    // 1 and the salt at 1. vale_wheat gates at farming 0 and bog_beet at 25,
    // both at or under this row's skillReq 25, so a cook levelling both skills
    // together is never blocked.
    reagents: [
      { itemId: 'game_meat', count: 3 },
      { itemId: 'vale_wheat', count: 2 },
      { itemId: 'bog_beet', count: 1 },
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
    // THE PROVISIONING SUPPLY LINE, rung 25: a chowder's root, ADDED beside the
    // fish and the herb with neither count reduced. ONE carrot, not the two the
    // plan defaulted to, and the count is derived rather than picked: this row's
    // largest non-produce count is 2 (trout, herb and salt all sit there), and
    // a crop at 2 would tie it instead of staying strictly under it. Two would
    // also tie the summed fish count, and a fish row whose vegetables match its
    // fish is no longer a fish dish. At 1 the row stays fish-forward 2 to 1.
    reagents: [
      { itemId: 'raw_frostgill_trout', count: 2 },
      { itemId: 'brook_carrot', count: 1 },
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
    // THE PROVISIONING SUPPLY LINE, rung 50: the bed the supper is served on.
    // The carp stays the headline at 3 and nothing else moved. Fish-forward
    // holds 4 to 2, and exactly one crop family joins a fish row.
    reagents: [
      { itemId: 'raw_stonescale_carp', count: 3 },
      { itemId: 'raw_mirror_trout', count: 1 },
      { itemId: 'marsh_rice', count: 2 },
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
    // THE PROVISIONING SUPPLY LINE, rung 50, and the row that exercises
    // masterwrought DECISION B on the cooking side: a roast's grain and gourd,
    // at TIER 3, which gates at farming 50 and so lands exactly on this row's
    // skillReq. The tier-3 seed faucet is real and was read from the code
    // rather than a plan doc: farmer_hollis stocks all four tier-3 seeds at
    // buyValue 32 (src/sim/content/zone3.ts). Both meats, the herb and the salt
    // are untouched.
    reagents: [
      { itemId: 'prime_cut', count: 1 },
      { itemId: 'game_meat', count: 4 },
      { itemId: 'highland_barley', count: 2 },
      { itemId: 'frost_gourd', count: 2 },
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
    // THE PROVISIONING SUPPLY LINE, alchemy rung 0. The elixir line is the
    // hearty stamina line, so a farm base belongs in it, and after this phase
    // the two professions supply each other: alchemy already brews farming's
    // growth tonic from wild Sheenleaf (farming D7), and now farming feeds the
    // elixirs back. The herb count is untouched, which is the whole point of
    // masterwrought R18: herbalism loses nothing here.
    // vale_wheat rather than brook_carrot for the same economy-basis reason as
    // the rung-0 skewer: the carrot's D9 buyValue of 16 would make it worth
    // more than this row's largest reagent (venom_gland at 12).
    reagents: [
      { itemId: 'venom_gland', count: 2 },
      { itemId: 'vale_wheat', count: 1 },
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
    // THE PROVISIONING SUPPLY LINE, alchemy rung 25: the root base, at tier 2,
    // which gates at farming 25 and lands exactly on this row. The gland count
    // and the herb count are both untouched.
    reagents: [
      { itemId: 'venom_gland', count: 3 },
      { itemId: 'bog_beet', count: 2 },
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
    // THE PROVISIONING SUPPLY LINE, alchemy rung 50, and masterwrought DECISION
    // B on the alchemy side: TIER 3 produce, gating at farming 50, on the row
    // that unlocks at alchemy 50. ONE gourd, not the two the plan defaulted to,
    // because this row's largest non-produce count is venom_gland at 2 and a
    // crop must stay strictly under it. Neither herb nor gland count moved.
    reagents: [
      { itemId: 'pristine_venom_gland', count: 1 },
      { itemId: 'venom_gland', count: 2 },
      { itemId: 'frost_gourd', count: 1 },
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

// The jewelcrafting base catalog (Masterwrought phase 05): three rungs at
// skillReq 0/25/50, three outputs per rung (two rings plus one neck), the
// crafted jewelry ItemDefs in content/profession_items.ts. A separate list
// from LADDER_RECIPES on purpose: that array's length and six-craft shape are
// pinned as the Professions 2.0 ladder, and this catalog carries two shapes of
// its own (tests/jewelcrafting_catalog.test.ts).
//
// - Every record binds `stationType: 'forge'` explicitly: jewelcrafting has no
//   station of its own and deliberately stays OUT of STATION_TYPE_BY_CRAFT (no
//   new station type, no new trainer NPC). The binding is the recipe's
//   teaching home (training.ts trainingStationTypeFor), so Forgemistress Darva
//   teaches the catalog, the enchanting charm precedent
//   (TOOL_EFFECT_RECIPES). The foreign-bound literal pin in
//   tests/professions_crafting_hub.test.ts names all nine ids.
// - Reagents read the phase's "gems-from-salvage" input class as the
//   disenchant ladder: arcane_dust on the 0 rung, arcane_essence on the 25 and
//   50 rungs, and NEVER arcane_shard (phase 04 sized epic disenchant 1:1
//   against the heroic faucet; shards stay reserved for the apex band). Ores
//   carry the volume (wrought-metal register, the forge binding), fluxed like
//   the other forge ladders; the rung-50 fourth line is iron_ore solder,
//   NEVER fine_thorium_ore: a recipe must never list a base material AND its
//   fine grade (they share one consumption pool via materialGradeIds, so the
//   reagent check double-counts a bag; the disjointness invariant in
//   tests/material_grades.test.ts pins it). The solder keeps the whole input
//   list mining-plus-disenchant rather than crossing into the
//   enchant-exclusive resonant secondaries.
// - Scaffolding follows the cross-craft convention above (skillReq 0 -> 10/10,
//   25 -> 16/15, 50 -> 20/20); acquisition is ['trainer'] on every record (the
//   grandfather list is frozen). Every reagent list is authored gold-negative
//   under the recipe_economy rule, and every rung keeps at least one
//   no-buyValue reagent (the ores/dust/essence) so no record joins the
//   counterfactually-vendor-fed set.
export const JEWELCRAFTING_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_hammered_copper_band',
    professionId: 'jewelcrafting',
    resultItemId: 'hammered_copper_band',
    resultCount: 1,
    // Input 48 vs output 32.
    reagents: [
      { itemId: 'copper_ore', count: 4 },
      { itemId: 'arcane_dust', count: 2 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_polished_copper_loop',
    professionId: 'jewelcrafting',
    resultItemId: 'polished_copper_loop',
    resultCount: 1,
    // Input 54 vs output 32.
    reagents: [
      { itemId: 'copper_ore', count: 4 },
      { itemId: 'arcane_dust', count: 3 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_coiled_copper_torc',
    professionId: 'jewelcrafting',
    resultItemId: 'coiled_copper_torc',
    resultCount: 1,
    // Input 52 vs output 36.
    reagents: [
      { itemId: 'copper_ore', count: 5 },
      { itemId: 'arcane_dust', count: 2 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_riveted_iron_signet',
    professionId: 'jewelcrafting',
    resultItemId: 'riveted_iron_signet',
    resultCount: 1,
    // Input 70 vs output 46.
    reagents: [
      { itemId: 'iron_ore', count: 4 },
      { itemId: 'arcane_essence', count: 1 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_etched_iron_loop',
    professionId: 'jewelcrafting',
    resultItemId: 'etched_iron_loop',
    resultCount: 1,
    // Input 80 vs output 46.
    reagents: [
      { itemId: 'iron_ore', count: 3 },
      { itemId: 'arcane_essence', count: 2 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_iron_link_choker',
    professionId: 'jewelcrafting',
    resultItemId: 'iron_link_choker',
    resultCount: 1,
    // Input 78 vs output 52.
    reagents: [
      { itemId: 'iron_ore', count: 5 },
      { itemId: 'arcane_essence', count: 1 },
      { itemId: 'smithing_flux', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_weighted_thorium_band',
    professionId: 'jewelcrafting',
    resultItemId: 'weighted_thorium_band',
    resultCount: 1,
    // Input 332 vs output 280 (buyValue basis: osmium ore 60, flux 20). The
    // 4th line is iron solder, NOT fine_thorium_ore: a recipe must never list
    // a base material AND its fine grade (they share one consumption pool via
    // materialGradeIds, so the reagent check double-counts a bag; the
    // disjointness invariant in tests/material_grades.test.ts pins it).
    reagents: [
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'arcane_essence', count: 2 },
      { itemId: 'smithing_flux', count: 2 },
      { itemId: 'iron_ore', count: 2 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_gleaming_thorium_loop',
    professionId: 'jewelcrafting',
    resultItemId: 'gleaming_thorium_loop',
    resultCount: 1,
    // Input 350 vs output 280. Iron solder 4th line, same rule as the band.
    reagents: [
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'arcane_essence', count: 3 },
      { itemId: 'smithing_flux', count: 2 },
      { itemId: 'iron_ore', count: 2 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_burnished_thorium_amulet',
    professionId: 'jewelcrafting',
    resultItemId: 'burnished_thorium_amulet',
    resultCount: 1,
    // Input 332 vs output 310. Iron solder 4th line, same rule as the band.
    reagents: [
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'arcane_essence', count: 2 },
      { itemId: 'smithing_flux', count: 2 },
      { itemId: 'iron_ore', count: 2 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
];

// The inscription base catalog (Masterwrought phase 06): three rungs at
// skillReq 0/25/50, two outputs per rung (one caster tome plus one buff
// scroll), the crafted ItemDefs in content/profession_items.ts. A separate
// list from LADDER_RECIPES for the jewelcrafting reason: that array's length
// and six-craft shape are pinned as the Professions 2.0 ladder, and this
// catalog carries shapes of its own (tests/inscription_catalog.test.ts).
//
// - Every record binds `stationType: 'apothecary'` explicitly: inscription has
//   no station of its own and deliberately stays OUT of STATION_TYPE_BY_CRAFT
//   (no new station type, no new trainer NPC). The binding is the recipe's
//   teaching home (training.ts trainingStationTypeFor), so Alchemist Verane
//   teaches the catalog, the enchanting-charm/jewelcrafting precedent. The
//   foreign-bound literal pin in tests/professions_crafting_hub.test.ts names
//   all six ids.
// - Reagents are ink and pigment work: the herb ladder carries the volume
//   (silverleaf on the 0 rung, goldleaf on 25, sunpetal on 50, the SAME herbs
//   the apothecary's alchemy draughts mill), arcane_dust on the 0 rung and
//   arcane_essence on 25/50 are the magical ink, and NEVER arcane_shard
//   (phase 04 sized epic disenchant 1:1 against the heroic faucet; shards
//   stay reserved for the apex band). glass_vial is the ink vessel, the
//   apothecary staple the recipes' own station stocks. The rung-50 fourth
//   line is goldleaf_herb sizing, NEVER a fine_* grade beside its base: a
//   recipe must never list a base material AND its fine grade (they share one
//   consumption pool via materialGradeIds; the disjointness invariant in
//   tests/material_grades.test.ts pins it).
// - Scaffolding follows the cross-craft convention above (skillReq 0 -> 10/10,
//   25 -> 16/15, 50 -> 20/20); acquisition is ['trainer'] on every record.
//   Every reagent list is authored gold-negative under the recipe_economy
//   rule, and every rung keeps at least one no-buyValue reagent (the
//   dust/essence ink lines) so no record joins the counterfactually-
//   vendor-fed set.
export const INSCRIPTION_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_silverleaf_primer',
    professionId: 'inscription',
    resultItemId: 'silverleaf_primer',
    resultCount: 1,
    // Input 36 vs output 24.
    reagents: [
      { itemId: 'silverleaf_herb', count: 3 },
      { itemId: 'arcane_dust', count: 2 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_silverleaf_scroll',
    professionId: 'inscription',
    resultItemId: 'silverleaf_scroll',
    resultCount: 1,
    // Input 26 vs output 10.
    reagents: [
      { itemId: 'silverleaf_herb', count: 2 },
      { itemId: 'arcane_dust', count: 1 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_goldleaf_folio',
    professionId: 'inscription',
    resultItemId: 'goldleaf_folio',
    resultCount: 1,
    // Input 150 vs output 100.
    reagents: [
      { itemId: 'goldleaf_herb', count: 2 },
      { itemId: 'arcane_essence', count: 1 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_goldleaf_scroll',
    professionId: 'inscription',
    resultItemId: 'goldleaf_scroll',
    resultCount: 1,
    // Input 90 vs output 15.
    reagents: [
      { itemId: 'goldleaf_herb', count: 1 },
      { itemId: 'arcane_essence', count: 1 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_sunpetal_grimoire',
    professionId: 'inscription',
    resultItemId: 'sunpetal_grimoire',
    resultCount: 1,
    // Input 488 vs output 280. Goldleaf sizing 4th line, no fine grades.
    reagents: [
      { itemId: 'sunpetal_herb', count: 2 },
      { itemId: 'arcane_essence', count: 2 },
      { itemId: 'glass_vial', count: 1 },
      { itemId: 'goldleaf_herb', count: 2 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_sunpetal_scroll',
    professionId: 'inscription',
    resultItemId: 'sunpetal_scroll',
    resultCount: 2,
    // Input 214 vs output 40 (two scrolls, the serpent-elixir batch shape).
    // Priced at EXACT parity with recipe_elixir_of_the_serpent (214, also x2)
    // per the Phase 06 QA ruling: the two routes grant a byte-identical buff,
    // and a cheaper scroll would compete with pristine_venom_gland's only
    // crafting sink. The rung-25 pair already ships this parity (90 = 90).
    // The dust 4th line stays inside the craft's ink register (the rung-0
    // recipes grind dust) and mirrors the grimoire's own 4-line rung-50 shape.
    reagents: [
      { itemId: 'sunpetal_herb', count: 1 },
      { itemId: 'arcane_essence', count: 2 },
      { itemId: 'glass_vial', count: 1 },
      { itemId: 'arcane_dust', count: 1 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
];

// The Masterwrought intermediates rung (Phase 07, R13): one intermediate
// material per profession at skill 75, per the Phase 07 pre-fan-out ledger in
// docs/prd/masterwrought/state.md (the ten-row mapping and the demand math
// phases 08/09/10 author against). The Quickening Catalyst is alchemy's 75
// rung and the time gate: `oncePerDay` limits it to one successful craft per
// character per reset day (professions/types.ts), and every other row
// consumes exactly one Catalyst, so each apex piece (3 intermediates) costs 3
// catalyst-days, self-funded or market-bought (the Catalyst and all nine
// intermediates are ordinary tradable items).
//
// - A NEW list rather than a LADDER_RECIPES growth: that array's 54-row
//   six-craft shape is pinned as the Professions 2.0 ladder
//   (tests/ladder_crafting.test.ts), the jewelcrafting/inscription precedent.
// - Scaffolding is the shipped 75-band convention (skillReq 75,
//   itemLevelBudget 20, level 20: CASTER_HUB_RECIPES, the 75-skill
//   TOOL_RECIPES, recipe_stormreel_fishing_rod); acquisition ['trainer'] on
//   every record (the grandfather list is frozen), tier-3 teaches at the
//   crafts' own stations. The three station-less crafts bind a foreign
//   station per record, the recipe's teaching home: jewelcrafting 'forge'
//   (phase 05), inscription 'apothecary' (phase 06), and enchanting
//   'toolworks' (the Phase 07 serial decision: the two tool-effect charms
//   already bind there, and enchanting stays OUT of STATION_TYPE_BY_CRAFT).
//   The foreign-bound literal pin in tests/professions_crafting_hub.test.ts
//   names the three new ids.
// - Reagents are EXISTING gathered mats in each craft's own register plus the
//   Catalyst; the Catalyst row consumes alchemy-register mats only. Every row
//   keeps at least one no-buyValue reagent (the Catalyst itself for the nine,
//   venom glands on the Catalyst row), so no record joins the
//   counterfactually-vendor-fed set; never a base material beside its fine_
//   grade (material_grades.ts disjointness); and NEVER arcane_shard (reserved
//   for the apex band per Phase 04).
export const INTERMEDIATE_RECIPES: ProfessionRecipeRecord[] = [
  // The rung itself and the gate. Input 304 (sunpetal 160 + goldleaf 2x60 +
  // venom glands 2x6 + vial 12) vs output 50.
  {
    id: 'recipe_quickening_catalyst',
    professionId: 'alchemy',
    resultItemId: 'quickening_catalyst',
    resultCount: 1,
    reagents: [
      { itemId: 'sunpetal_herb', count: 1 },
      { itemId: 'goldleaf_herb', count: 2 },
      { itemId: 'venom_gland', count: 2 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'apothecary',
    oncePerDay: true,
  },
  // The nine consumers, each gold-negative on the buyValue-else-sellValue
  // basis with the Catalyst priced at its 50 sellValue: billet 246 vs 45,
  // plating 256 vs 45, cording 105 vs 40, bolt 255 vs 45, setting 206 vs 45,
  // chassis 290 vs 45, stock 130 vs 30, reagent 128 vs 40, vellum 258 vs 45.
  // (The stock read 98 here from Phase 07 until masterwrought Phase 11g's
  // DECISION C put marsh_rice 2 plus bog_beet 2 in that bill and left this
  // number behind. Corrected by Phase 11h's verify pass over the same row,
  // which re-derives 130 from the merged table; the ROW itself is 11g's and is
  // untouched here.)
  {
    id: 'recipe_duskforged_billet',
    professionId: 'weaponcrafting',
    resultItemId: 'duskforged_billet',
    resultCount: 1,
    reagents: [
      { itemId: 'thorium_ore', count: 3 },
      { itemId: 'iron_ore', count: 2 },
      { itemId: 'quickening_catalyst', count: 1 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_forgefold_plating',
    professionId: 'armorcrafting',
    resultItemId: 'forgefold_plating',
    resultCount: 1,
    reagents: [
      { itemId: 'thorium_ore', count: 3 },
      { itemId: 'iron_ore', count: 2 },
      { itemId: 'rough_hide', count: 2 },
      { itemId: 'quickening_catalyst', count: 1 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_wyrmhide_cording',
    professionId: 'leatherworking',
    resultItemId: 'wyrmhide_cording',
    resultCount: 1,
    reagents: [
      { itemId: 'pristine_hide', count: 1 },
      { itemId: 'rough_hide', count: 4 },
      { itemId: 'spider_silk', count: 2 },
      { itemId: 'quickening_catalyst', count: 1 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'tannery',
  },
  {
    id: 'recipe_sunspun_bolt',
    professionId: 'tailoring',
    resultItemId: 'sunspun_bolt',
    resultCount: 1,
    reagents: [
      { itemId: 'sunpetal_herb', count: 1 },
      { itemId: 'spider_silk', count: 4 },
      { itemId: 'pristine_silk', count: 1 },
      { itemId: 'quickening_catalyst', count: 1 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'loom',
  },
  {
    id: 'recipe_prismglass_setting',
    professionId: 'jewelcrafting',
    resultItemId: 'prismglass_setting',
    resultCount: 1,
    reagents: [
      { itemId: 'thorium_ore', count: 2 },
      { itemId: 'arcane_essence', count: 2 },
      { itemId: 'quickening_catalyst', count: 1 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'forge',
  },
  {
    id: 'recipe_precision_chassis',
    professionId: 'engineering',
    resultItemId: 'precision_chassis',
    resultCount: 1,
    reagents: [
      { itemId: 'ashwood_log', count: 2 },
      { itemId: 'thorium_ore', count: 2 },
      { itemId: 'quickening_catalyst', count: 1 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'toolworks',
  },
  {
    id: 'recipe_seasoned_stock',
    professionId: 'cooking',
    resultItemId: 'seasoned_stock',
    resultCount: 1,
    // THE CHOKE POINT (masterwrought DECISION C, settled 2026-08-20, authored
    // HERE because Phase 11g reaches this row first; Phase 11h takes this bill
    // AS GIVEN and re-derives its own arithmetic from it rather than editing
    // the row). The result is meat plus vegetables plus salt, which is what a
    // stock is.
    //
    // THE COUNTS ARE DERIVED FROM THE ROW'S OWN SHAPE, not picked: the shipped
    // bill was prime_cut 1, game_meat 3, cooking_salt 2, quickening_catalyst 1,
    // so the vegetables enter at the salt's count of 2, one below the meat
    // count of 3, and the bill still reads meat, then vegetables, then salt.
    //
    // THE TIER IS DELIBERATELY 2 AT BOTH, and it is grain AND root rather than
    // one crop. Everything in the cooking apex flows through this single row
    // (the three role plates take seasoned_stock 1, recipe_laden_hearth takes
    // 3, and Phase 11k's apex feasts take it too), so coupling it to two
    // vendor-seeded, market-fed supply lines spreads the choke point instead of
    // making the whole apex kitchen ride one paddy. Tier 3 or 4 would put it
    // behind farming's deliberately slow upper supply, so the choke point would
    // actually choke.
    //
    // masterwrought R17 IS NOT BREACHED HERE, and the distinction is the point:
    // R17 fences produce out of the GEAR chain, and this is a cooking
    // intermediate whose output is a food reagent with no equip slot. The
    // firewall sweep in tests/provisioner_firewall.test.ts reads
    // INTERMEDIATE_RECIPES, a mixed table holding both gear intermediates and
    // this one, so that sweep gains a consumable-profession carve-out proved by
    // the same no-equip-slot test the hoe carve-out already uses.
    reagents: [
      { itemId: 'prime_cut', count: 1 },
      { itemId: 'game_meat', count: 3 },
      { itemId: 'marsh_rice', count: 2 },
      { itemId: 'bog_beet', count: 2 },
      { itemId: 'cooking_salt', count: 2 },
      { itemId: 'quickening_catalyst', count: 1 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_lucent_reagent',
    professionId: 'enchanting',
    resultItemId: 'lucent_reagent',
    resultCount: 1,
    reagents: [
      { itemId: 'arcane_essence', count: 3 },
      { itemId: 'arcane_dust', count: 4 },
      { itemId: 'quickening_catalyst', count: 1 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'toolworks',
  },
  {
    id: 'recipe_sablewax_vellum',
    professionId: 'inscription',
    resultItemId: 'sablewax_vellum',
    resultCount: 1,
    reagents: [
      { itemId: 'sunpetal_herb', count: 1 },
      { itemId: 'arcane_essence', count: 2 },
      { itemId: 'glass_vial', count: 1 },
      { itemId: 'quickening_catalyst', count: 1 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'apothecary',
  },
];

// The Masterwrought apex armor rung (Phase 08, R8/R13): the skill-100 recipes
// for the three armor crafts, nine ilvl-31 epics plus the tailoring apex bag.
// Every row consumes exactly 3 of its own profession's intermediate (the
// recorded phase 07 demand math: one apex piece = 3 catalyst-days) plus
// 2 Wyrmfall Cores (the raid/heroic tie; the catalyst stays the pacing gate)
// plus the craft's gathered family. acquisition ['drop'] per R8: apex patterns
// land as tradable raid/rift drops and heroic-marks vendor rows in phase 11,
// so these recipes are deliberately unlearnable until then; NOT trainer rows.
// stationType matches each craft's existing rows so the per-craft wiki station
// field stays unanimous. itemLevelBudget feeds only the craft gold fee.
export const APEX_ARMOR_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_spiritweld_girdle',
    professionId: 'armorcrafting',
    resultItemId: 'spiritweld_girdle',
    resultCount: 1,
    // Input 491 vs output 300.
    reagents: [
      { itemId: 'forgefold_plating', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'iron_ore', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'forge',
  },
  {
    id: 'recipe_forgefold_legguards',
    professionId: 'armorcrafting',
    resultItemId: 'forgefold_legguards',
    resultCount: 1,
    // Input 491 vs output 320.
    reagents: [
      { itemId: 'forgefold_plating', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'iron_ore', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'forge',
  },
  {
    id: 'recipe_wardspeaker_sabatons',
    professionId: 'armorcrafting',
    resultItemId: 'wardspeaker_sabatons',
    resultCount: 1,
    // Input 491 vs output 280.
    reagents: [
      { itemId: 'forgefold_plating', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'iron_ore', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'forge',
  },
  {
    id: 'recipe_briarstep_jerkin',
    professionId: 'leatherworking',
    resultItemId: 'briarstep_jerkin',
    resultCount: 1,
    // Input 265 vs output 175.
    reagents: [
      { itemId: 'wyrmhide_cording', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'rough_hide', count: 4 },
      { itemId: 'pristine_hide', count: 1 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'tannery',
  },
  {
    id: 'recipe_fenbloom_breeches',
    professionId: 'leatherworking',
    resultItemId: 'fenbloom_breeches',
    resultCount: 1,
    // Input 265 vs output 160.
    reagents: [
      { itemId: 'wyrmhide_cording', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'rough_hide', count: 4 },
      { itemId: 'pristine_hide', count: 1 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'tannery',
  },
  {
    id: 'recipe_barksong_handguards',
    professionId: 'leatherworking',
    resultItemId: 'barksong_handguards',
    resultCount: 1,
    // Input 265 vs output 140.
    reagents: [
      { itemId: 'wyrmhide_cording', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'rough_hide', count: 4 },
      { itemId: 'pristine_hide', count: 1 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'tannery',
  },
  {
    id: 'recipe_sunspun_vestments',
    professionId: 'tailoring',
    resultItemId: 'sunspun_vestments',
    resultCount: 1,
    // Input 280 vs output 200.
    reagents: [
      { itemId: 'sunspun_bolt', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'spider_silk', count: 4 },
      { itemId: 'pristine_silk', count: 1 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'loom',
  },
  {
    id: 'recipe_sunspun_leggings',
    professionId: 'tailoring',
    resultItemId: 'sunspun_leggings',
    resultCount: 1,
    // Input 280 vs output 190.
    reagents: [
      { itemId: 'sunspun_bolt', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'spider_silk', count: 4 },
      { itemId: 'pristine_silk', count: 1 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'loom',
  },
  {
    id: 'recipe_sunspun_handwraps',
    professionId: 'tailoring',
    resultItemId: 'sunspun_handwraps',
    resultCount: 1,
    // Input 280 vs output 170.
    reagents: [
      { itemId: 'sunspun_bolt', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'spider_silk', count: 4 },
      { itemId: 'pristine_silk', count: 1 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'loom',
  },
  {
    id: 'recipe_sunspun_haversack',
    professionId: 'tailoring',
    resultItemId: 'sunspun_haversack',
    resultCount: 1,
    // Input 280 vs output 180.
    reagents: [
      { itemId: 'sunspun_bolt', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'spider_silk', count: 4 },
      { itemId: 'pristine_silk', count: 1 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'loom',
  },
];

// The Masterwrought apex gear rung (Phase 09, R8/R13): the skill-100 recipes
// for weaponcrafting (1H, 2H, shield), jewelcrafting (neck, two rings),
// engineering (gadget, field forge, apex charm), and inscription (tome).
// Reagent bills are uniform per craft, the phase 07 demand math: exactly 3 of
// the profession's own intermediate (3 catalyst-days) plus 2 Wyrmfall Cores
// (the raid/heroic tie) plus the craft's gathered family, quantities on the
// phase 08 idiom. acquisition ['drop'] per R8, same as APEX_ARMOR_RECIPES:
// apex patterns land as drops and heroic-marks vendor rows in phase 11, so
// these recipes are deliberately unlearnable until then; NOT trainer rows.
// stationType matches each craft's existing rows so the per-craft wiki
// station field stays unanimous; itemLevelBudget feeds only the craft gold
// fee. The apex charm row also carries the R39 mint-out-costs-recharge
// inequality: its cheapest (engineering-specialized) mint values 380 copper,
// above the 275 the worst generic recharge costs; pinned both ways in
// tests/professions_tool_effect_recharge.test.ts.
export const APEX_GEAR_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_duskforged_warblade',
    professionId: 'weaponcrafting',
    resultItemId: 'duskforged_warblade',
    resultCount: 1,
    // Input 491 vs output 320.
    reagents: [
      { itemId: 'duskforged_billet', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'iron_ore', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'forge',
  },
  {
    id: 'recipe_ridgebreaker',
    professionId: 'weaponcrafting',
    resultItemId: 'ridgebreaker',
    resultCount: 1,
    // Input 491 vs output 340.
    reagents: [
      { itemId: 'duskforged_billet', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'iron_ore', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'forge',
  },
  {
    id: 'recipe_duskforged_bulwark',
    professionId: 'weaponcrafting',
    resultItemId: 'duskforged_bulwark',
    resultCount: 1,
    // Input 491 vs output 300.
    reagents: [
      { itemId: 'duskforged_billet', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'iron_ore', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'forge',
  },
  {
    id: 'recipe_wyrmfall_pendant',
    professionId: 'jewelcrafting',
    resultItemId: 'wyrmfall_pendant',
    resultCount: 1,
    // Input 511 vs output 320.
    reagents: [
      { itemId: 'prismglass_setting', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'forge',
  },
  {
    id: 'recipe_warhewn_signet',
    professionId: 'jewelcrafting',
    resultItemId: 'warhewn_signet',
    resultCount: 1,
    // Input 511 vs output 300.
    reagents: [
      { itemId: 'prismglass_setting', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'forge',
  },
  {
    id: 'recipe_prismglass_loop',
    professionId: 'jewelcrafting',
    resultItemId: 'prismglass_loop',
    resultCount: 1,
    // Input 511 vs output 300.
    reagents: [
      { itemId: 'prismglass_setting', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'thorium_ore', count: 4 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'forge',
  },
  {
    id: 'recipe_gyrelens_array',
    professionId: 'engineering',
    resultItemId: 'gyrelens_array',
    resultCount: 1,
    // Input 595 vs output 340.
    reagents: [
      { itemId: 'precision_chassis', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'ashwood_log', count: 4 },
      { itemId: 'thorium_ore', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'toolworks',
  },
  {
    id: 'recipe_masters_field_forge',
    professionId: 'engineering',
    resultItemId: 'masters_field_forge',
    resultCount: 1,
    // Input 595 vs output 380.
    reagents: [
      { itemId: 'precision_chassis', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'ashwood_log', count: 4 },
      { itemId: 'thorium_ore', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'toolworks',
  },
  {
    id: 'recipe_makers_charm',
    professionId: 'engineering',
    resultItemId: 'makers_charm',
    resultCount: 1,
    // Input 595 vs output 150. The R39 bound at the apex rung: a
    // specialized engineer consumes floor(count x 0.8) of each line
    // (2 chassis 90 + 1 core 50 + 3 logs 180 + 1 ore 60 = 380), above the
    // 275 the worst generic recharge (an epic-rung 50-charge fill, 5
    // shards) costs, so re-crafting can never bypass recharging.
    reagents: [
      { itemId: 'precision_chassis', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'ashwood_log', count: 4 },
      { itemId: 'thorium_ore', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'toolworks',
  },
  {
    id: 'recipe_voidbound_grimoire',
    professionId: 'inscription',
    resultItemId: 'voidbound_grimoire',
    resultCount: 1,
    // Input 603 vs output 340.
    reagents: [
      { itemId: 'sablewax_vellum', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'sunpetal_herb', count: 2 },
      { itemId: 'arcane_essence', count: 2 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'apothecary',
  },
];

// The Masterwrought apex CONSUMABLE rung (Phase 10, R8/R13): the two crafts
// the apex gear rungs left out, alchemy and cooking, land theirs as
// consumables rather than gear. Its own array beside APEX_ARMOR_RECIPES and
// APEX_GEAR_RECIPES because LADDER_RECIPES is pinned at its 54-row six-craft
// shape and must never grow.
//
// The consumable idiom, which is where these rows differ from the gear ones:
// a batch output (2 flasks, 4 plates) rather than a single piece, and ONE of
// the craft's own intermediate rather than three, because a consumable is
// spent and re-bought while a piece of gear is worn forever.
//
// THE UNIFORM-BILL RULE, AMENDED BY masterwrought Phase 11h (11h-GATE-A) and
// scoped exactly, because a rule silently contradicted by the rows under it is
// worse than a rule changed on purpose:
//   - THE FOOD FAMILY'S bills differ by EXACTLY ONE CROP ROW and are identical
//     in every other reagent.
//   - THE FLASK FAMILY stays BYTE-IDENTICAL.
// The original rule (uniform within a family, so a role choice is never also an
// economy choice) is unchanged in substance and that is what the narrow scope
// protects. The one crop row is worth 30 copper on every plate, so the three
// bills are cost-identical to the copper and the differentiation is FLAVOR,
// never price: the tank plate takes the gourd, the physical plate the grain,
// the caster plate the leaf, all tier 3, all gated at farming 50, so a role
// choice is not an economy choice OR a skill-gate choice either.
// The looser amendment ("the food family is exempt") is REFUSED: it would read
// as open season, and it would not tell Phase 11i what its fish row has to
// satisfy. That row is legal under this wording precisely because it is the
// SAME row on all three plates (11i DECISION D), so the crop row differentiates
// and the fish row unifies. Read the scope, not the family name.
//
// PACING: the flask chain is daily-gated TRANSITIVELY. recipe_quickening_
// catalyst is oncePerDay, so a flask costs a catalyst-day even though no row
// here carries the flag. The food chain runs through seasoned_stock, which is
// NOT daily-gated, so cooking's apex output paces on materials alone.
//
// The two skill-125 CAPSTONE rungs sit at the end: the alchemy and cooking
// mobile stations, one rung above everything else in the game. 125 is legal
// (the tidewrought precedent) and there is no craft-time skill admission gate
// anyway; skillReq shapes teachability, the gold fee, the masterwork proc, and
// skill gain, so the rung reads as the prestige marker it is. Their bills
// mirror recipe_masters_field_forge: 3 of the craft's intermediate, 2 Wyrmfall
// Cores, then the craft's gathered family (the hearth's meats plus the shared
// sunpetal herb that Marlow's roast and the three role dishes already carry,
// so the mirror is by shape, not by literal item list).
//
// acquisition ['drop'] on every row per R8, same as the other two apex arrays:
// the patterns land as drops and heroic-marks vendor rows in phase 11, so
// these are deliberately unlearnable until then; NOT trainer rows. stationType
// matches each craft's existing rows so the per-craft wiki station field stays
// unanimous, and itemLevelBudget feeds only the craft gold fee. Every row is
// authored gold-negative and keeps reagents with no buyValue, so none joins
// the counterfactually-vendor-fed set (tests/recipe_economy.test.ts).
export const APEX_CONSUMABLE_RECIPES: ProfessionRecipeRecord[] = [
  // The three flasks share one bill: the serpent elixir's own reagent list
  // one rung up (sunpetal doubled) plus the catalyst that paces it, plus the
  // tier-3 grain masterwrought Phase 11h adds IDENTICALLY to all three
  // (11h-GATE-C). Input 424 to 439 vs output 50.
  //
  // THE FAMILY STAYS BYTE-IDENTICAL, and that is the amended header's other
  // half rather than an accident: the flask chain is the DAILY-GATED one
  // (recipe_quickening_catalyst is oncePerDay, so a flask costs a catalyst-day),
  // so a bill difference between the three roles here would be a real gate
  // rather than flavor. The food family can afford to differ because nothing
  // paces it but materials.
  //
  // ADDED, NEVER SUBSTITUTED (masterwrought R18, farming D24): sunpetal_herb
  // stays at 2 on every one of the three bills and no other reagent moves. The
  // grain stands BESIDE the herb line; herbalism loses nothing.
  //
  // THE COUNT IS ONE, NOT TWO, and this is a DEVIATION from 11h-GATE-C's
  // literal, forced by the standing accent rule rather than chosen. masterwrought
  // R17 RULE 2's
  // count half (tests/provisioning_supply_line.test.ts, accentVerdict) requires
  // a crop to stay STRICTLY BELOW the row's largest non-produce count, and this
  // bill's largest is 2 (venom_gland and sunpetal_herb), so a grain at 2 TIES
  // and reds. Phase 11g hit the identical collision one rung down and resolved
  // it the same way: recipe_elixir_of_the_serpent's frost_gourd went 2 to 1
  // because venom_gland sits at 2, and only the count moved. This bill IS that
  // elixir's bill one rung up. Everything else the ruling states is intact: one
  // tier-3 grain, identical on all three, beside the herb, replacing none of it.
  {
    id: 'recipe_ironhusk_flask',
    professionId: 'alchemy',
    resultItemId: 'ironhusk_flask',
    resultCount: 2,
    reagents: [
      { itemId: 'quickening_catalyst', count: 1 },
      { itemId: 'pristine_venom_gland', count: 1 },
      { itemId: 'venom_gland', count: 2 },
      { itemId: 'sunpetal_herb', count: 2 },
      { itemId: 'highland_barley', count: 1 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_warboar_flask',
    professionId: 'alchemy',
    resultItemId: 'warboar_flask',
    resultCount: 2,
    reagents: [
      { itemId: 'quickening_catalyst', count: 1 },
      { itemId: 'pristine_venom_gland', count: 1 },
      { itemId: 'venom_gland', count: 2 },
      { itemId: 'sunpetal_herb', count: 2 },
      { itemId: 'highland_barley', count: 1 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'apothecary',
  },
  {
    id: 'recipe_runewater_flask',
    professionId: 'alchemy',
    resultItemId: 'runewater_flask',
    resultCount: 2,
    reagents: [
      { itemId: 'quickening_catalyst', count: 1 },
      { itemId: 'pristine_venom_gland', count: 1 },
      { itemId: 'venom_gland', count: 2 },
      { itemId: 'sunpetal_herb', count: 2 },
      { itemId: 'highland_barley', count: 1 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'apothecary',
  },
  // The three role foods: Marlow's Grand Roast scaled to the apex batch, with
  // the seasoned stock that carries the rung, and ONE crop row each
  // (masterwrought Phase 11h, 11h-GATE-A and 11h-GATE-B). Input 422 to 452 vs
  // output 360 on all three.
  //
  // THIS IS WHERE THREE BILLS STOP BEING BYTE-IDENTICAL. Since Phase 10 the
  // three role plates were the same recipe with three names, and a player
  // comparing them in the crafting window saw nothing to compare. The crop is
  // what a cook reads off the plate now: the gourd for the tank, the grain for
  // the fighter, the leaf for the caster.
  //
  // THE COUNT IS 2 ON ALL THREE AND THE CROPS ARE ALL TIER 3, deliberately and
  // by derivation rather than taste. Every tier-3 base crop carries sellValue
  // 15 and no buyValue, so 2 of any of them is worth exactly 30 on the
  // buyValue-else-sellValue basis the economy suite reads: the COST SPREAD
  // ACROSS THE THREE PLATES IS ZERO IN COPPER, pinned in
  // tests/provisioning_supply_line_apex.test.ts. And farmCropSkillThreshold
  // gates all four tier-3 crops at farming 50, so a role choice is not a
  // skill-gate choice either. The superseded alternative was the tier-4 halving
  // branch, which would have spread 30/30/40 and asked farming 75 for one
  // plate; Phase 11e's roster was composed with a tier-3 LEAF precisely to make
  // it unnecessary.
  //
  // IN COPPER, AND THE SCOPE IS THE HONEST HALF. 11h-GATE-A rules on summed
  // VALUE and that is what is zero here, but the three crops do NOT share a
  // growth timer: highland_barley 14,400,000 ms, thornpeak_cabbage 15,000,000,
  // frost_gourd 16,200,000, because farm_crops.ts gives every crop in a tier its
  // own duration on purpose. So a cook who grows their own pays 4h, 4h10m or
  // 4h30m per two, a 12.5 percent wall-clock spread from cheapest to dearest,
  // while a cook who buys pays the same either way. The spread is recorded and
  // pinned beside the copper one rather than left for a reader to discover: it
  // is small, it is invisible to anyone using the market, and the alternative
  // (three crops sharing one timer) would break the crop ladder's own rule.
  //
  // The INPUT side only. foodHp, the Well Fed magnitude and duration (11c's
  // settled ladder, 6 for 900 seconds on the single well_fed aura id),
  // sellValue, resultCount, skillReq: none of them moves here, and a reagent
  // changes what a craft COSTS and never what it produces.
  {
    id: 'recipe_stonepot_stew',
    professionId: 'cooking',
    resultItemId: 'stonepot_stew',
    resultCount: 4,
    // THE TANK PLATE (buff_sta) takes the GOURD: a stew is what a gourd goes
    // into, and Frost Gourd is the Highwatch terrace crop the roast already
    // simmers one rung down.
    reagents: [
      { itemId: 'seasoned_stock', count: 1 },
      { itemId: 'prime_cut', count: 2 },
      { itemId: 'game_meat', count: 4 },
      { itemId: 'frost_gourd', count: 2 },
      { itemId: 'sunpetal_herb', count: 2 },
      { itemId: 'cooking_salt', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_warspice_skewers',
    professionId: 'cooking',
    resultItemId: 'warspice_skewers',
    resultCount: 4,
    // THE PHYSICAL PLATE (buff_ap) takes the GRAIN: skewers are served on a
    // grain, and Highland Barley is the tier's grain.
    reagents: [
      { itemId: 'seasoned_stock', count: 1 },
      { itemId: 'prime_cut', count: 2 },
      { itemId: 'game_meat', count: 4 },
      { itemId: 'highland_barley', count: 2 },
      { itemId: 'sunpetal_herb', count: 2 },
      { itemId: 'cooking_salt', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_sageleaf_chowder',
    professionId: 'cooking',
    resultItemId: 'sageleaf_chowder',
    resultCount: 4,
    // THE CASTER PLATE (buff_int) takes the LEAF, which is the row Phase 11e's
    // roster composition existed to make available: Thornpeak Cabbage is tier
    // 3's leaf (frost_lentils is its legume), and a chowder named for a leaf
    // that carried none read thin.
    reagents: [
      { itemId: 'seasoned_stock', count: 1 },
      { itemId: 'prime_cut', count: 2 },
      { itemId: 'game_meat', count: 4 },
      { itemId: 'thornpeak_cabbage', count: 2 },
      { itemId: 'sunpetal_herb', count: 2 },
      { itemId: 'cooking_salt', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'kitchens',
  },
  // The skill-125 capstones, and the first bills in the game to consume a
  // TIER-4 farm crop (masterwrought Phase 11h, 11h-GATE-D). Cauldron input 1010
  // to 1410 vs output 380; hearth 606 to 1006 vs 380.
  //
  // ONE SHOWCASE CROP EACH, SPLIT rather than shared, so the two 125 capstones
  // do not read off the same line: the melon to alchemy, the greens to cooking
  // (the greens are farming's own capstone-plate crop, so the COOKING capstone
  // is the right home for them).
  //
  // THE SHIPPED SHOWCASE IDIOM, CARRIED OFF THE MERGED TREE rather than off a
  // plan doc, which is what 11h-GATE-D itself instructs. Farming's two tier-4
  // plates each carry TWO showcase pairs: recipe_evergarden_harvest_platter
  // takes evergarden_greens 3 + fine 1 AND evergarden_pumpkin 2 + fine 1, and
  // recipe_evergarden_sunmelon_tart takes gilded_sunmelon 3 + fine 1 AND
  // gilded_yam 2 + fine 1. So the merged tree carries the base-plus-fine idiom
  // at BOTH 3+1 and 2+1, twice each, and no number here is invented.
  //
  // 2 + 1 IS A DEVIATION from 11h-GATE-D's literal 3 + 1, forced by the
  // standing accent rule rather than chosen. masterwrought R17 RULE 2's
  // absolute accent cap
  // (tests/provisioning_supply_line.test.ts, accentVerdict capOk) refuses any
  // produce entry above 2 on a consumable row farming did not write, so a base
  // crop at 3 reds on both capstones. 2 + 1 is the same shipped idiom one notch
  // down and it clears every half of the rule. The fine twin stays at 1, where
  // the idiom puts it.
  //
  // THE FINE TWIN IS THE POINT, not decoration: before this phase
  // fine_evergarden_greens and fine_gilded_sunmelon were consumed by exactly
  // one recipe each, both farming's own tier-4 dishes at cooking 100. This
  // phase gives both their CAPSTONE consumer at skillReq 125, the top of the
  // CONSUMABLE catalog, which is the masterwrought R20 shape the packet exists
  // to close. (Scoped at the Phase 11h QA: 125 is cooking and alchemy's
  // ceiling. ALL_RECIPES tops out at 150, the apex tool family this phase
  // records as out of scope, and the packet census says so: "3 at 125, 3 at
  // 150".) Neither is a hoe twin (the hoe ladder takes fine_vale_wheat,
  // fine_marsh_rice and fine_highland_barley under farming's deviation (ad)),
  // so nothing is double-booked.
  {
    id: 'recipe_grand_cauldron',
    professionId: 'alchemy',
    resultItemId: 'grand_cauldron',
    resultCount: 1,
    reagents: [
      { itemId: 'quickening_catalyst', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'gilded_sunmelon', count: 2 },
      { itemId: 'fine_gilded_sunmelon', count: 1 },
      { itemId: 'sunpetal_herb', count: 4 },
      { itemId: 'goldleaf_herb', count: 2 },
    ],
    skillReq: 125,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'apothecary',
  },
  // THE LONGEST BILL IN THE GAME after this phase: seven reagent entries, where
  // the previous maximum across the merged table was six (Phase 11g's roast and
  // seasoned stock) and five before that. The claim is not left to this comment:
  // tests/provisioning_supply_line_apex.test.ts derives the maximum over
  // ALL_RECIPES and pins this row as the only member at seven, so a later phase
  // that ties or beats it visits that arm rather than this sentence.
  // Nothing in src/ or server/ slices or
  // caps a reagent list, so the seventh row renders by existing.
  //
  // THE THREE SURFACES THAT ACTUALLY DRAW IT, traced rather than assumed,
  // because Phase 11g's own record named a fourth that structurally cannot:
  // the crafting window's reagent line (src/ui/crafting_window.ts, which wraps
  // inside a card whose pane scrolls), that window's recipe TOOLTIP, and the
  // wiki materials cell (src/guide/pages/professions_craft.ts, whose
  // .guide-prof-mat rule wraps between entries). The bag action-menu cost line
  // is NOT one of them: it reads ENCHANTS[...].reagents and has no craft-recipe
  // path at all, so no bill length can reach it.
  {
    id: 'recipe_laden_hearth',
    professionId: 'cooking',
    resultItemId: 'laden_hearth',
    resultCount: 1,
    reagents: [
      { itemId: 'seasoned_stock', count: 3 },
      { itemId: 'wyrmfall_core', count: 2 },
      { itemId: 'prime_cut', count: 4 },
      { itemId: 'game_meat', count: 4 },
      { itemId: 'evergarden_greens', count: 2 },
      { itemId: 'fine_evergarden_greens', count: 1 },
      { itemId: 'sunpetal_herb', count: 2 },
    ],
    skillReq: 125,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'kitchens',
  },
];

// The crafted farming hoes, tiers 2 to 4 (the crop-ladder phase's tool half).
//
// A SEPARATE LIST FROM TOOL_RECIPES, deliberately, for the same reason
// ROD_RECIPES above is: TOOL_RECIPES' whole invariant is that every member
// consumes a FINE gathered GRADE (a MATERIAL_GRADES row) plus the tool one
// rung down, and farming has no MATERIAL_GRADES rows at all: its fine twins
// come from the harvest roll (professions/farming.ts resolveFarmHarvest),
// never from a node grade. Folding these in would weaken that invariant into
// a disjunction, so the hoe ladder states its own
// (tests/professions_hoe_recipes.test.ts) and leaves TOOL_RECIPES alone.
//
// THE HOE LADDER'S OWN INVARIANT: every member consumes the fine TWIN of a
// crop ONE TIER BELOW its result plus the hoe one rung down, at the
// toolworks. The one-tier-below reagent is the closed-circuit resolution the
// tier-4 pick recorded above: the step-12 hoe gate reads
// canGatherTier(hoe tier, crop.tier), so a tier-N crop's fine twin cannot be
// grown without the tier-N hoe already owned; consuming the MATCHING-tier
// twin would be a circuit with no entry. One tier down, the twin's crop
// grows under exactly the hoe the recipe already consumes (rung 2 takes
// fine_vale_wheat, tier 1, grown under the vendor-PRICED garden_hoe,
// stocked on the tier-1 farmer NPC since the go-live).
//
// ACQUISITION COVERAGE, where this ladder diverges from the rods and why:
// the rod ladder leaves rungs 2 and 3 vendor-priced and crafts only 4 and 5,
// but the hoe pricing table locks buyValue OFF rungs 2 to 4, so the vendor
// arm cannot be mirrored; HOE_RECIPES covers rungs 2, 3, AND 4 instead,
// making craft the only mint above rung 1 and leaving no acquisition gap
// WITHIN the ladder (each rung is reachable from a state the rung below
// grants; the ladder's one entry point is rung 1's vendor stocking on the
// tier-1 farmer NPC, the go-live counter). There is
// also, deliberately, NO delve Marks fallback row this phase (see the hoe
// block in content/items.ts; flagged for the maintainer).
//
// All three are `acquisition: ['trainer']` per the post-freeze authoring
// default: Tinker Gizzel at the Eastbrook toolworks teaches them with no
// content edit (the trainer list derives from the station). skillReq
// 25/50/75 resolves to trainer tiers 1/2/3, all inside engineering's
// learnable band, honoring the ROD_RECIPES lesson (a trainer-taught recipe
// above the cap band is permanently unlearnable). The rung-4 shape
// (skillReq 75, itemLevelBudget 20, level 20, toolworks) matches every other
// tier-4 tool recipe in TOOL_RECIPES.
export const HOE_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_bronze_hoe',
    professionId: 'engineering',
    resultItemId: 'bronze_hoe',
    resultCount: 1,
    reagents: [
      { itemId: 'fine_vale_wheat', count: 4 },
      { itemId: 'garden_hoe', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 10,
    level: 10,
    stationType: 'toolworks',
    acquisition: ['trainer'],
  },
  {
    id: 'recipe_skysilver_hoe',
    professionId: 'engineering',
    resultItemId: 'skysilver_hoe',
    resultCount: 1,
    reagents: [
      { itemId: 'fine_marsh_rice', count: 4 },
      { itemId: 'bronze_hoe', count: 1 },
    ],
    skillReq: 50,
    itemLevelBudget: 15,
    level: 15,
    stationType: 'toolworks',
    acquisition: ['trainer'],
  },
  {
    id: 'recipe_osmium_hoe',
    professionId: 'engineering',
    resultItemId: 'osmium_hoe',
    resultCount: 1,
    reagents: [
      { itemId: 'fine_highland_barley', count: 4 },
      { itemId: 'skysilver_hoe', count: 1 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    stationType: 'toolworks',
    acquisition: ['trainer'],
  },
];

// The farm-economy hook set (Phase 6, reopened by Phase 11): the recipes that
// turn farm output into something a player wants, so growing a crop is a
// supply chain rather than a vendor-sell loop. Thirteen cooking rows (the
// eight plain dishes, the four Phase 11 well-fed buff dishes, and the Phase
// 12 harvest feast) plus one alchemy row, the growth tonic's craft (D7, the
// cross-profession trade).
//
// A SEPARATE LIST FROM LADDER_RECIPES, deliberately, for the same reason
// ROD_RECIPES and HOE_RECIPES are separate: LADDER_RECIPES is CLOSED at three
// rungs x three recipes for each of its six crafts (54 rows, pinned as a
// literal and as a per-craft shape in tests/recipe_economy.test.ts). Folding
// four rung-50 dishes into cooking's nine would break that shape outright, so
// the farm set states its own conformance (tests/farm_recipes.test.ts) and
// leaves the ladder alone. Both lists join content-side ALL_RECIPES below, so
// every recipe surface (recipeList, the trainer, the crafting window, the
// guide) picks these up with no further wiring.
//
// SHAPE: taught at whichever station the row's own craft serves (the dishes at
// the kitchens under cook_marlow, the tonic at the apothecary under
// alchemist_verane), with no content edit either side, the post-freeze
// authoring default: a trainer's list derives from the crafts its station
// serves.
//
// TWO CHANNELS, SPLIT BY RUNG, and the split is a RULE rather than a per-row
// choice (masterwrought Phase 11f, ruling 11f-GATE-B): every row at
// FARM_DROP_RUNG_FLOOR or above is acquisition ['drop'], taught by a pattern
// item off the raid, the heroic five-mans, the rift, or the Heroic
// Quartermaster; every row below it stays ['trainer']. That is what keeps a
// new farmer's on-ramp intact (the whole rung-0 band, the growth tonic
// included, is still walk-up-and-learn) while farming's endgame reaches
// players the way every other endgame recipe in the game does. Derive the
// split from the rung, never from a row list, or it drifts row by row.
// Every row follows the ladder's cross-craft scaffolding convention
// (skillReq 0 -> 10/10, 25 -> 16/15, 50 -> 20/20, 75 -> 20/20,
// 100 -> 25/25); no farm row reaches 125. The PLAIN dish outputs are
// plain kind 'food' + foodHp ItemDefs in content/profession_items.ts with no
// buff machinery; the four Phase 11 buff dishes add exactly the one `wellFed`
// field (see their block below). The tonic's output is the kind 'junk' item
// the plant_crop command already consumes as a knob, which is why it gets no
// use arm here either.
//
// THE FINE-TWIN SLOTS ARE THE POINT, not decoration. Farming's fine twins get
// no downward grade substitution (materialGradeIds walks MATERIAL_GRADES only,
// and no farm row is a member), so a fine twin gains a consumer ONLY through
// its own reagent slot. The hoe ladder took three of the eight
// (fine_vale_wheat, fine_marsh_rice, fine_highland_barley); these dishes take
// the remaining five, which is the Phase 5 deferral closing.
//
// EVERY row carries at least one reagent with NO buyValue, deliberately: a
// recipe whose reagents ALL carry a copper basis joins the counterfactual
// vendor-fed arm in tests/recipe_economy.test.ts (a sorted literal pin plus a
// discounted-input bound), and neither a dish grown from produce nor a tonic
// brewed from gathered herbs is that shape (Sheenleaf carries no buyValue).
//
// VALUES ARE PROPOSED AND FLAGGED FOR THE MAINTAINER: classic-modest, and
// every foodHp/sellValue pair REUSES a point the shipped food curve already
// ships (980 is the ceiling, conjured_bread4). Reagent counts are sized so
// each dish vendors strictly below its input value at the LISTED counts on
// the recipe-economy unitValue basis (buyValue when one exists, else
// sellValue); on a raw sellValue basis the beet braise is exactly break-even,
// which converts produce without minting copper and is the intended shape.
// DEVIATION (aj) IS DISCHARGED, both halves, and it is worth stating why
// rather than deleting the paragraph. The deviation recorded that every farm
// row shipped TRAINABLE before go-live so the crafting window could list them
// while the farm was dormant, and its Phase 6 QA addendum recorded the FEE
// half as a ruling owed: the rung-25 and rung-50 rows charged 2500 and 10000
// copper for recipes nobody could yet cook. Both halves are gone now, from
// opposite directions. Phase 11e stocked all eight upper seeds, so no farm row
// is reagent-dormant any more, which retires the addendum's premise for the
// held bannock (still trainer-taught at rung 50, still 10000, but now for a
// dish a player can actually cook). And every OTHER formerly dormant row is at
// FARM_DROP_RUNG_FLOOR or above under the channel rule above, so it is not
// trainer-taught at all and charges no fee, in advance or otherwise. What
// remains trainer-taught is the rung 0 to 50 on-ramp, free at rung 0 on the
// settled R8 fee curve's tier-0 point and fee-charging at 25 and 50; pinned in
// tests/farm_recipes.test.ts. THAT R8 IS THE PROFESSIONS-TUNING ONE (ruling R8
// in docs/design/professions-tuning-packet-review.md, cited at
// professions/training.ts's TRAINING_FEE_BY_TIER), NOT masterwrought R8, which
// is the recipe-channel doctrine. Left bare on purpose: qualifying it as
// "masterwrought" would attach the wrong packet to a shipped ruling, which is
// exactly the collision the packet's R-namespace rule exists to prevent.

/** The rung at which a farm recipe stops being trainer homework and becomes a
 *  drop (masterwrought ruling 11f-GATE-B). Exported so the channel assertions
 *  derive the split from the rung the way FARM_RECIPES does, instead of
 *  restating a row list that goes stale the first time a row moves. */
export const FARM_DROP_RUNG_FLOOR = 75;

export const FARM_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_vale_hearth_loaf',
    professionId: 'cooking',
    resultItemId: 'vale_hearth_loaf',
    resultCount: 1,
    // The starter bake: wheat and salt, the plainest thing a vale kitchen
    // makes, and the one dish reachable the hour a first plot comes in.
    // Input 20 vs output 6.
    reagents: [
      { itemId: 'vale_wheat', count: 3 },
      { itemId: 'cooking_salt', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_eastbrook_root_pottage',
    professionId: 'cooking',
    resultItemId: 'eastbrook_root_pottage',
    resultCount: 1,
    // The first fine-twin sink: a thick root pottage whose body comes from
    // brook_carrot (the vendor-priced starter vegetable that also pays the
    // farmer's watch fee, D9) and whose sweetness comes from the fine pick,
    // thickened with a handful of wheat. Input 68 vs output 12.
    reagents: [
      { itemId: 'brook_carrot', count: 2 },
      { itemId: 'fine_brook_carrot', count: 1 },
      { itemId: 'vale_wheat', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_fenbridge_rice_bowl',
    professionId: 'cooking',
    resultItemId: 'fenbridge_rice_bowl',
    resultCount: 1,
    // Marsh rice steamed plain and salted, the bulk staple of the fen towns.
    // resultCount stays 1 where the ladder's rung-25 cooking rows sometimes
    // pay 2: doubling the output here would need inputs above 50 copper to
    // clear the economy bound, which is a heavier ask than a plain rice bowl
    // should carry. Input 40 vs output 25.
    reagents: [
      { itemId: 'marsh_rice', count: 4 },
      { itemId: 'cooking_salt', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_fenbridge_beet_braise',
    professionId: 'cooking',
    resultItemId: 'fenbridge_beet_braise',
    resultCount: 1,
    // Beets braised down until they candy, the fine pick going in whole for
    // the colour. The tier-2 fine-twin slot. Input 88 vs output 40.
    reagents: [
      { itemId: 'bog_beet', count: 3 },
      { itemId: 'fine_bog_beet', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_highwatch_barley_bannock',
    professionId: 'cooking',
    resultItemId: 'highwatch_barley_bannock',
    resultCount: 1,
    // A griddle flatcake off the wall kitchens, salted hard because it is
    // carried cold on watch, with shredded cabbage worked through the batter.
    // The base tier-3 grain keeps its own demand at 4 per bannock; Phase 11e
    // ADDED the cabbage pair alongside it (masterwrought R18: added, never
    // substituted), so this stopped being the one rung-50 dish with no fine
    // twin in it. Input 226 vs output 60 (76 before the widening). The figure
    // is restored here at the 11e QA: the widening deleted this row's Input
    // line rather than correcting it, leaving the only one of the five dish
    // blocks with no recorded economy figure.
    reagents: [
      { itemId: 'highland_barley', count: 4 },
      { itemId: 'thornpeak_cabbage', count: 2 },
      { itemId: 'fine_thornpeak_cabbage', count: 1 },
      { itemId: 'cooking_salt', count: 2 },
    ],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_highwatch_gourd_soup',
    professionId: 'cooking',
    resultItemId: 'highwatch_gourd_soup',
    resultCount: 1,
    // Frost gourd simmered to a soup, the fine pick carrying the sweetness
    // the base gourds lack. The tier-3 fine-twin slot. Input 323 vs output 75
    // (173 before the Phase 11e widening added frost_lentils x2 + its fine twin).
    //
    // RUNG 75, A DROP (Phase 11f, rulings 11f-GATE-A and 11f-GATE-B). The
    // tier-3 dishes climb off the flat rung-50 band onto cooking's real
    // upper ladder, and the channel follows the rung: at or above
    // FARM_DROP_RUNG_FLOOR this is taught by pattern_highwatch_gourd_soup,
    // which rides the heroic five-mans and the Heroic Quartermaster. Only
    // the rung and the channel moved: reagents, resultCount, station and
    // output power are 11c's and are untouched.
    reagents: [
      { itemId: 'frost_gourd', count: 3 },
      { itemId: 'fine_frost_gourd', count: 1 },
      { itemId: 'frost_lentils', count: 2 },
      { itemId: 'fine_frost_lentils', count: 1 },
      { itemId: 'cooking_salt', count: 1 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['drop'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_evergarden_sunmelon_tart',
    professionId: 'cooking',
    resultItemId: 'evergarden_sunmelon_tart',
    resultCount: 1,
    // The top band, and the wheat line's second life: a melon tart on a
    // wheat crust, so the tier-1 crop still has a buyer at the tier-4 table.
    // The tier-4 fine-twin slot. Input 848 vs output 150 (448 before the Phase
    // 11e widening added gilded_yam x2 + its fine twin).
    //
    // RUNG 100, A DROP (Phase 11f, rulings 11f-GATE-A and 11f-GATE-B). The
    // tier-4 dishes take cooking's top farm rung; nothing farming owns
    // reaches 125, which is 11k's apex-feast band. Taught by
    // pattern_evergarden_sunmelon_tart off the rift and the Heroic
    // Quartermaster. Rung and channel only: 11c owns the power and it did
    // not move.
    reagents: [
      { itemId: 'gilded_sunmelon', count: 3 },
      { itemId: 'fine_gilded_sunmelon', count: 1 },
      { itemId: 'gilded_yam', count: 2 },
      { itemId: 'fine_gilded_yam', count: 1 },
      { itemId: 'vale_wheat', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_evergarden_harvest_platter',
    professionId: 'cooking',
    resultItemId: 'evergarden_harvest_platter',
    resultCount: 1,
    // The capstone plate, dressed greens off the Evergarden beds. The last
    // fine-twin slot, closing the Phase 5 deferral. Input 856 vs output 150
    // (456 before the Phase 11e widening added evergarden_pumpkin x2 + its twin).
    //
    // RUNG 100, A DROP (Phase 11f), on the tier-4 band with its sibling
    // above. Taught by pattern_evergarden_harvest_platter off the rift and
    // the Heroic Quartermaster.
    reagents: [
      { itemId: 'evergarden_greens', count: 3 },
      { itemId: 'fine_evergarden_greens', count: 1 },
      { itemId: 'evergarden_pumpkin', count: 2 },
      { itemId: 'fine_evergarden_pumpkin', count: 1 },
      { itemId: 'cooking_salt', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'kitchens',
  },
  // --- Phase 11 buff dishes (well-fed food) --------------------------------
  // One buff dish per crop tier, so the produce ladder has a well-fed
  // consumer at every rung. Each takes its tier's produce x4 (one more than
  // the plain twins), so the buff dish costs strictly more produce than its
  // plain sibling at the same rung, plus the kitchen staple salt (the tier-1
  // row adds the pottage-precedent vale_wheat binder, see below). NO fine
  // twins here: the fine_marsh_rice / fine_highland_barley consumer set is an
  // OPEN maintainer question, and THREE of the five dish twins above stay
  // single-owner. (This read "the five dish twins above stay single-owner"
  // until the Phase 11h QA corrected it: 11h gave fine_gilded_sunmelon and
  // fine_evergarden_greens a second owner apiece, the two skill-125 capstones,
  // so the single-owner claim now scopes to the three tier 1 to 3 twins.)
  // The tier 3/4 pair SHIPPED reagent-dormant under deviation (bo), trainable
  // and well-formed but with no tier 3/4 seed faucet. NO LONGER DORMANT: GATE 1
  // (Phase 11e) stocked all eight upper seeds at farmer_hollis and
  // farmer_verbena, so both rows are completable today. VALUES ARE PROPOSED AND
  // FLAGGED FOR THE MAINTAINER, reagent counts and rungs alike.
  //
  // The tier-1 row keeps the POTTAGE PRECEDENT: brook_carrot is the D9
  // vegetable, the one produce row that is vendor-stocked AND priced, so a
  // carrot dish carries a vale_wheat binder exactly like
  // recipe_eastbrook_root_pottage above. That keeps the whole-list invariant
  // intact (every farm recipe holds at least one reagent no counter stocks
  // and no vendor prices), so no dish, buff or plain, is craftable from
  // counter stock alone, and no rung-0 cooking skill-up faucet opens from
  // vendor goods (the unresolved hazard the deviation (ai) QA addendum
  // flagged for the tonic; opening a second one is a maintainer call this
  // phase does not make).
  {
    id: 'recipe_eastbrook_glazed_carrots',
    professionId: 'cooking',
    resultItemId: 'eastbrook_glazed_carrots',
    resultCount: 1,
    // The starter buff dish: the D9 carrot glazed down with salt and bound
    // with a handful of wheat (the pottage's binder idiom), reachable the
    // hour a first carrot bed comes in. Input 76 vs output 6.
    reagents: [
      { itemId: 'brook_carrot', count: 4 },
      { itemId: 'vale_wheat', count: 1 },
      { itemId: 'cooking_salt', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_fenbridge_rice_pudding',
    professionId: 'cooking',
    resultItemId: 'fenbridge_rice_pudding',
    resultCount: 1,
    // The fen tier's buff dish: the same rice and salt as the plain bowl,
    // slow-cooked into a pudding worth sitting through. Input 40 vs output 25.
    reagents: [
      { itemId: 'marsh_rice', count: 4 },
      { itemId: 'cooking_salt', count: 1 },
    ],
    skillReq: 25,
    itemLevelBudget: 16,
    level: 15,
    acquisition: ['trainer'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_highwatch_barley_porridge',
    professionId: 'cooking',
    resultItemId: 'highwatch_barley_porridge',
    resultCount: 1,
    // The wall kitchens' buff dish. Shipped reagent-dormant under deviation
    // (bo) while highland_barley had no seed faucet; GATE 1 (Phase 11e) stocked
    // that seed at farmer_hollis, so this row is completable today.
    // Input 68 vs output 60.
    //
    // RUNG 75, A DROP (Phase 11f), the tier-3 band with the gourd soup.
    // Taught by pattern_highwatch_barley_porridge off the heroic five-mans
    // and the Heroic Quartermaster.
    reagents: [
      { itemId: 'highland_barley', count: 4 },
      { itemId: 'cooking_salt', count: 1 },
    ],
    skillReq: 75,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['drop'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_evergarden_braised_greens',
    professionId: 'cooking',
    resultItemId: 'evergarden_braised_greens',
    resultCount: 1,
    // The capstone buff dish. Shipped reagent-dormant under deviation (bo)
    // while evergarden_greens had no seed faucet; GATE 1 (Phase 11e) stocked
    // that seed at farmer_verbena, so this row is completable today.
    // Input 168 vs output 150.
    //
    // RUNG 100, A DROP (Phase 11f), the tier-4 band. Taught by
    // pattern_evergarden_braised_greens off the rift and the Heroic
    // Quartermaster. Note the feast below serves THIS dish, so the two rows
    // climb together and a feast host still has a plate to serve.
    reagents: [
      { itemId: 'evergarden_greens', count: 4 },
      { itemId: 'cooking_salt', count: 1 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'kitchens',
  },
  {
    id: 'recipe_harvest_feast',
    professionId: 'cooking',
    resultItemId: 'harvest_feast',
    resultCount: 1,
    // The shared feast (Phase 12, D16): the tier-4 communal showcase, cooked
    // from BOTH tier-4 produce lines at once so one feast asks a whole
    // evergarden harvest, not a single bed. Input vs output: unit value =
    // buyValue when finite and > 0 else sellValue, so greens 40x4 + sunmelon
    // 40x4 + salt 8x2 = 336 in against an output sellValue of 250:
    // gold-negative, like every farm row.
    //
    // The (bz) whole-list invariant holds here too: both produce reagents
    // (evergarden_greens, gilded_sunmelon) carry no buyValue and no counter
    // stocks them, so the feast can never be cooked from vendor stock alone
    // and stays out of the counterfactual vendor-fed set in
    // tests/recipe_economy.test.ts.
    //
    // Shipped REAGENT-DORMANT under deviation (bo) with the (ca)
    // reconciliation, because the D11 seed-bootstrap ruling owned the tier 3/4
    // seed faucet. GATE 1 (Phase 11e) discharged that ruling and stocked all
    // eight upper seeds, so this row is completable today, exactly like the
    // tier 3/4 dishes above it.
    //
    // FLAGGED FOR THE MAINTAINER: the reagent counts (4 + 4 + 2) and the
    // 250 output sellValue are proposed tuning, like every farming constant.
    //
    // RUNG 100, A DROP (Phase 11f), and the rung is the ruled one: NOT 125.
    // At 125 the party feast would collide with 11k's apex feasts and
    // falsify their "the party-tier rung below" premise, so the feast ladder
    // is a real two-rung climb instead (this at cooking 100, the raid feasts
    // at 125), and NO second cooking-125 capstone exception is taken. This is
    // the farm ladder's pinnacle, so its pattern rides the pinnacle
    // encounter: pattern_harvest_feast drops from Nythraxis and is also on
    // the Heroic Quartermaster.
    reagents: [
      { itemId: 'evergarden_greens', count: 4 },
      { itemId: 'gilded_sunmelon', count: 4 },
      { itemId: 'cooking_salt', count: 2 },
    ],
    skillReq: 100,
    itemLevelBudget: 25,
    level: 25,
    acquisition: ['drop'],
    stationType: 'kitchens',
  },
  // --- alchemy -------------------------------------------------------------
  {
    id: 'recipe_growth_tonic',
    professionId: 'alchemy',
    resultItemId: 'growth_tonic',
    resultCount: 1,
    // The cross-profession trade (D7): the one knob that speeds a planting is
    // brewed by an ALCHEMIST out of wild herbs, never grown, so a farmer who
    // wants faster beds has to buy from (or level) the other craft, and the
    // herb line gains a buyer outside the potion ladder. Sheenleaf is the
    // rung-0 herb every shipped alchemy entry starts from; the vial is the
    // flask each of them decants into. Input 20 vs output 6.
    //
    // FLAGGED FOR THE MAINTAINER: the reagent counts (2 herbs, the low end of
    // the shipped 2-to-4 band, plus the usual single vial) and skillReq 0. The
    // tonic is a plant-time knob for EVERY farm tier rather than a late luxury,
    // so it sits on the accessible rung; gating it at 25 or 50 would leave the
    // early tiers with a knob nobody can brew for them, and it is never
    // vendor-stocked (see the growth_tonic ItemDef comment), so the trainer
    // rung is the only faucet there is.
    reagents: [
      { itemId: 'silverleaf_herb', count: 2 },
      { itemId: 'glass_vial', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
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
  ...ROD_RECIPES,
  ...TOOL_EFFECT_RECIPES,
  ...CASTER_HUB_RECIPES,
  ...COMBO_RECIPES,
  ...LADDER_RECIPES,
  ...JEWELCRAFTING_RECIPES,
  ...INSCRIPTION_RECIPES,
  ...INTERMEDIATE_RECIPES,
  ...APEX_ARMOR_RECIPES,
  ...APEX_GEAR_RECIPES,
  ...APEX_CONSUMABLE_RECIPES,
  ...HOE_RECIPES,
  ...FARM_RECIPES,
];

// O(1) indexes for the two per-lookup resolvers below (the recipe table grows
// every content phase, and recipeById sits on crafting hot paths). NOT built
// once at load: ALL_RECIPES is append-only content at runtime, but test
// fixtures push and splice synthetic recipes around a suite
// (tests/recipe_pattern_items.test.ts relies on recipeById seeing them), so
// the indexes rebuild whenever the table's length changes; a same-length
// in-place swap is outside the contract (nothing replaces rows). First
// insertion wins, preserving the linear scans' first-match semantics, and a
// miss stays undefined.
let recipeIndexSize = -1;
let recipeByIdIndex: ReadonlyMap<string, ProfessionRecipeRecord> = new Map();
let recipeByResultItemIndex: ReadonlyMap<string, ProfessionRecipeRecord> = new Map();

function ensureRecipeIndexes(): void {
  if (recipeIndexSize === ALL_RECIPES.length) return;
  const byId = new Map<string, ProfessionRecipeRecord>();
  const byResultItem = new Map<string, ProfessionRecipeRecord>();
  for (const recipe of ALL_RECIPES) {
    if (!byId.has(recipe.id)) byId.set(recipe.id, recipe);
    if (!byResultItem.has(recipe.resultItemId)) byResultItem.set(recipe.resultItemId, recipe);
  }
  recipeIndexSize = ALL_RECIPES.length;
  recipeByIdIndex = byId;
  recipeByResultItemIndex = byResultItem;
}

export function recipeById(recipeId: string): ProfessionRecipeRecord | undefined {
  ensureRecipeIndexes();
  return recipeByIdIndex.get(recipeId);
}

// The hands-vs-stations field set (Professions 2.0): the recipe ids
// craftable anywhere with bare hands, exactly the nine common recipes today.
// Everything outside this set either carries a stationType (station-bound)
// or is a combo recipe (field-craftable but pair-gated); the set exists so
// content/tests can name "field recipe" without re-deriving it.
export const FIELD_RECIPES: ReadonlySet<string> = new Set(COMMON_RECIPES.map((r) => r.id));

// Reverse lookup (#1149, Battlefield Experience): the recipe whose crafting
// produced a given result item id, so a tracked-event handler holding only an
// item instance can resolve back to the craft (professionId) that made it.
// Indexes ALL_RECIPES (common, tool, caster hub, combo, and ladder alike),
// not just COMMON_RECIPES: a narrower search here silently broke attribution
// for every recipe outside the common set. First match wins: no two recipes
// in this table share a resultItemId today.
export function recipeForResultItem(itemId: string): ProfessionRecipeRecord | undefined {
  ensureRecipeIndexes();
  return recipeByResultItemIndex.get(itemId);
}
