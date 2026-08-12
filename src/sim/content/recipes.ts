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
  // chassis 290 vs 45, stock 98 vs 30, reagent 128 vs 40, vellum 258 vs 45.
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
    reagents: [
      { itemId: 'prime_cut', count: 1 },
      { itemId: 'game_meat', count: 3 },
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
];

export function recipeById(recipeId: string): ProfessionRecipeRecord | undefined {
  return ALL_RECIPES.find((r) => r.id === recipeId);
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
// Searches ALL_RECIPES (common, tool, caster hub, combo, and ladder alike),
// not just COMMON_RECIPES: a narrower search here silently broke attribution
// for every recipe outside the common set. First match wins: no two recipes
// in this table share a resultItemId today.
export function recipeForResultItem(itemId: string): ProfessionRecipeRecord | undefined {
  return ALL_RECIPES.find((r) => r.resultItemId === itemId);
}
