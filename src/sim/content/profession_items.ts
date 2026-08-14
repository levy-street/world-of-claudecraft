// Profession materials: dedicated corpse-harvest components, their
// rare Pristine specimen counterparts, and the cheap master-stocked craft
// reagents. Merged into ITEMS by data.ts (mergeItems), same pattern as
// ZONE2_ITEMS.
//
// Crafting materials are common (white): they are reagents, not vendor trash,
// so they must never fall into the junk sweep (sellAllJunk in src/sim/items.ts
// vendors every quality 'poor' item). Enforced by
// tests/crafting_materials_quality.test.ts.
import type { ItemDef } from '../types';
import { CASTER_ALL } from './items';

export const PROFESSION_ITEMS: Record<string, ItemDef> = {
  // --- Corpse-harvest components (HARVEST_COMPONENT_ITEMS) -----------------
  // One material per component tag; never vendor-stocked (no buyValue), so
  // the only supply is harvesting tagged corpses. The old quest items
  // (boar_hide/webwood_silk/widow_venom_sac) keep their quest roles only.
  rough_hide: {
    id: 'rough_hide',
    name: 'Rough Hide',
    kind: 'junk',
    quality: 'common',
    sellValue: 5,
  },
  spider_silk: {
    id: 'spider_silk',
    name: 'Spider Silk',
    kind: 'junk',
    quality: 'common',
    sellValue: 5,
  },
  venom_gland: {
    id: 'venom_gland',
    name: 'Venom Gland',
    kind: 'junk',
    quality: 'common',
    sellValue: 6,
  },
  game_meat: {
    id: 'game_meat',
    name: 'Game Meat',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
  },
  homespun_cloth: {
    id: 'homespun_cloth',
    name: 'Homespun Cloth',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
  },
  sharp_claw: {
    id: 'sharp_claw',
    name: 'Sharp Claw',
    kind: 'junk',
    quality: 'common',
    sellValue: 5,
  },
  curved_tusk: {
    id: 'curved_tusk',
    name: 'Curved Tusk',
    kind: 'junk',
    quality: 'common',
    sellValue: 5,
  },

  // --- Pristine specimens (HARVEST_COMPONENT_SPECIMENS) --------------------
  // The signed jackpot a rare-or-better corpse-harvest rarity roll grants IN
  // ADDITION to the plain component (src/sim/interaction.ts harvestCorpse).
  // Rare so they read as a find, sellValue modest so they never outearn real
  // drops.
  pristine_hide: {
    id: 'pristine_hide',
    name: 'Pristine Hide',
    kind: 'junk',
    quality: 'rare',
    sellValue: 25,
  },
  pristine_silk: {
    id: 'pristine_silk',
    name: 'Pristine Silk',
    kind: 'junk',
    quality: 'rare',
    sellValue: 25,
  },
  pristine_venom_gland: {
    id: 'pristine_venom_gland',
    name: 'Pristine Venom Gland',
    kind: 'junk',
    quality: 'rare',
    sellValue: 30,
  },
  // claw joins hide/silk/venomSac/meat with a specimen: fen_troll (claw, tusk)
  // and old_greyjaw (hide, fang, claw) would otherwise carry TWO
  // specimen-less families on one corpse (fang+claw, or claw+tusk), which
  // breaks the capacity pre-gate's one-specimen-less-family-per-corpse
  // premise (tests/corpse_harvest_sim.test.ts, "no corpse tags two
  // specimen-less harvest families together"). tusk stays specimen-less,
  // same as fang/cloth: it never shares a corpse with another specimen-less
  // family once claw has its own.
  pristine_claw: {
    id: 'pristine_claw',
    name: 'Pristine Claw',
    kind: 'junk',
    quality: 'rare',
    sellValue: 25,
  },
  prime_cut: {
    id: 'prime_cut',
    name: 'Prime Cut',
    kind: 'junk',
    quality: 'rare',
    sellValue: 20,
  },

  // --- Vendor craft reagents ----------------------------------------------
  // Cheap staples each deep-craft master stocks at their own station hub
  // (forge/loom/tannery/kitchens/apothecary). buyValue is what the player
  // pays; sellValue is the floor(buyValue / 4) staple ratio used by the
  // premium reagents above this file's merge (thorium_ore and friends).
  smithing_flux: {
    id: 'smithing_flux',
    name: 'Smithing Flux',
    kind: 'junk',
    quality: 'common',
    sellValue: 5,
    buyValue: 20,
  },
  spool_of_thread: {
    id: 'spool_of_thread',
    name: 'Spool of Thread',
    kind: 'junk',
    quality: 'common',
    sellValue: 3,
    buyValue: 12,
  },
  tanning_agent: {
    id: 'tanning_agent',
    name: 'Tanning Agent',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
    buyValue: 16,
  },
  cooking_salt: {
    id: 'cooking_salt',
    name: 'Cooking Salt',
    kind: 'junk',
    quality: 'common',
    sellValue: 2,
    buyValue: 8,
  },
  glass_vial: {
    id: 'glass_vial',
    name: 'Glass Vial',
    kind: 'junk',
    quality: 'common',
    sellValue: 3,
    buyValue: 12,
  },

  // --- Crafted weapon ladder (weaponcrafting) ------------------------------
  // Trainer-taught outputs of LADDER_RECIPES (content/recipes.ts), three rungs
  // at skillReq 0/25/50. Stats and values were budgeted against real weapon
  // comparables; never vendor-stocked (no buyValue), and every crafted output's
  // sellValue clears strictly below its summed reagent value per the economy
  // invariant.
  copper_bearded_axe: {
    id: 'copper_bearded_axe',
    name: 'Copper Bearded Axe',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 6, max: 11, speed: 2.7 },
    sellValue: 40,
  },
  copper_flanged_mace: {
    id: 'copper_flanged_mace',
    name: 'Copper Flanged Mace',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 7, max: 11, speed: 2.9 },
    sellValue: 42,
  },
  ironbark_boar_spear: {
    id: 'ironbark_boar_spear',
    name: 'Ironbark Boar Spear',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'common',
    weapon: { min: 30, max: 41, speed: 3.2 },
    sellValue: 36,
  },
  ironedge_longsword: {
    id: 'ironedge_longsword',
    name: 'Ironedge Longsword',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 8, max: 13, speed: 2.4 },
    stats: { str: 4, sta: 2 },
    sellValue: 52,
  },
  ironshod_maul: {
    id: 'ironshod_maul',
    name: 'Ironshod Maul',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'uncommon',
    weapon: { min: 36, max: 51, speed: 3.3 },
    stats: { str: 5, sta: 3 },
    sellValue: 95,
  },
  whetted_iron_dirk: {
    id: 'whetted_iron_dirk',
    name: 'Whetted Iron Dirk',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    // Retuned: the old 5-9@1.8 (3.9 dps) was less than half a Lv15 craft's
    // weapon budget; 16-24@1.8 (11.1 dps) puts it in line with its tier.
    weapon: { min: 16, max: 24, speed: 1.8, dagger: true },
    stats: { agi: 5, sta: 2 },
    sellValue: 45,
  },
  thorium_warblade: {
    id: 'thorium_warblade',
    name: 'Osmium Warblade',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 20, max: 32, speed: 2.5 },
    stats: { str: 9, sta: 4 },
    sellValue: 275,
  },
  arcanite_war_axe: {
    id: 'arcanite_war_axe',
    name: 'Glyphsteel War Axe',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 22, max: 34, speed: 2.7 },
    stats: { agi: 9, sta: 4 },
    sellValue: 300,
  },
  elderwood_battle_staff: {
    id: 'elderwood_battle_staff',
    name: 'Highpine Battle Staff',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 19, max: 31, speed: 3.0 },
    stats: { int: 9, spi: 4 },
    sellValue: 285,
  },

  // --- Crafted armor ladder (armorcrafting) --------------------------------
  // Trainer-taught outputs of LADDER_RECIPES, three rungs at skillReq 0/25/50.
  // All mail. Armor and primary stats sit on the repo budget formula
  // (src/sim/item_budget.ts) per the ladder design notes; common-rung pieces
  // are armor-only (common quality carries no primary-stat budget). Never
  // vendor-stocked, sellValue below summed reagent value.
  riveted_copper_girdle: {
    id: 'riveted_copper_girdle',
    name: 'Riveted Copper Girdle',
    kind: 'armor',
    armorType: 'mail',
    slot: 'waist',
    quality: 'common',
    stats: { armor: 33 },
    sellValue: 42,
  },
  coppermail_sabatons: {
    id: 'coppermail_sabatons',
    name: 'Coppermail Sabatons',
    kind: 'armor',
    armorType: 'mail',
    slot: 'feet',
    quality: 'common',
    stats: { armor: 38 },
    sellValue: 40,
  },
  coppermail_gauntlets: {
    id: 'coppermail_gauntlets',
    name: 'Coppermail Gauntlets',
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'common',
    stats: { armor: 36 },
    sellValue: 26,
  },
  ironlink_hauberk: {
    id: 'ironlink_hauberk',
    name: 'Ironlink Hauberk',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 88, str: 3, sta: 3 },
    sellValue: 80,
  },
  ironlink_legguards: {
    id: 'ironlink_legguards',
    name: 'Ironlink Legguards',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 78, agi: 3, sta: 3 },
    sellValue: 78,
  },
  ironlink_spaulders: {
    id: 'ironlink_spaulders',
    name: 'Ironlink Spaulders',
    kind: 'armor',
    armorType: 'mail',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 66, str: 3, sta: 2 },
    sellValue: 48,
  },
  thoriumscale_greathelm: {
    id: 'thoriumscale_greathelm',
    name: 'Osmiumscale Greathelm',
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'rare',
    stats: { armor: 102, str: 6, sta: 5 },
    sellValue: 340,
  },
  thoriumscale_cuirass: {
    id: 'thoriumscale_cuirass',
    name: 'Osmiumscale Cuirass',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 122, str: 6, sta: 7 },
    sellValue: 420,
  },
  thoriumscale_leggings: {
    id: 'thoriumscale_leggings',
    name: 'Osmiumscale Leggings',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'rare',
    stats: { armor: 110, str: 6, sta: 6 },
    sellValue: 350,
  },

  // --- Crafted cloth ladder (tailoring) ------------------------------------
  // Trainer-taught outputs of LADDER_RECIPES (content/recipes.ts), three rungs
  // at skillReq 0/25/50, loom-bound at weaver_ottilie. Caster cloth (int/spi)
  // plus one bag upgrade; common-rung pieces are armor-only (common quality
  // carries no primary-stat budget). Never vendor-stocked (no buyValue), and
  // every crafted output's sellValue clears strictly below its summed reagent
  // value per the economy invariant. Budgets read from src/sim/item_budget.ts.
  homespun_hood: {
    id: 'homespun_hood',
    name: 'Homespun Hood',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'common',
    stats: { armor: 22 },
    sellValue: 28,
  },
  homespun_mitts: {
    id: 'homespun_mitts',
    name: 'Homespun Mitts',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'common',
    stats: { armor: 17 },
    sellValue: 20,
  },
  silverthread_slippers: {
    id: 'silverthread_slippers',
    name: 'Palethread Slippers',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'common',
    stats: { armor: 18 },
    sellValue: 24,
  },
  goldweave_robe: {
    id: 'goldweave_robe',
    name: 'Gildenweave Robe',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 41, int: 4, spi: 2 },
    sellValue: 140,
  },
  goldweave_leggings: {
    id: 'goldweave_leggings',
    name: 'Gildenweave Leggings',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 37, int: 3, spi: 2 },
    sellValue: 125,
  },
  silkspun_satchel: {
    id: 'silkspun_satchel',
    name: 'Silkspun Satchel',
    kind: 'bag',
    quality: 'uncommon',
    bagSlots: 10,
    sellValue: 150,
  },
  silkbinders_raiment: {
    id: 'silkbinders_raiment',
    name: "Silkbinder's Raiment",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 52, int: 8, spi: 5 },
    sellValue: 340,
  },
  sunweave_mantle: {
    id: 'sunweave_mantle',
    name: 'Sunweave Mantle',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'rare',
    stats: { armor: 40, int: 6, spi: 4 },
    sellValue: 175,
  },
  sunweave_treads: {
    id: 'sunweave_treads',
    name: 'Sunweave Treads',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 34, int: 5, spi: 3 },
    sellValue: 260,
  },

  // --- Crafted leather ladder (leatherworking) -----------------------------
  // Trainer-taught outputs of LADDER_RECIPES, three rungs at skillReq 0/25/50,
  // tannery-bound at tanner_hesk. Agi/sta melee leather, complementing the
  // existing int/spi leather pieces. Common-rung pieces are armor-only. Never
  // vendor-stocked, sellValue below summed reagent value; budgets read from
  // src/sim/item_budget.ts.
  fenbridge_hide_leggings: {
    id: 'fenbridge_hide_leggings',
    name: 'Fenbridge Hide Leggings',
    kind: 'armor',
    armorType: 'leather',
    slot: 'legs',
    quality: 'common',
    stats: { armor: 36 },
    sellValue: 32,
  },
  fenbridge_hide_boots: {
    id: 'fenbridge_hide_boots',
    name: 'Fenbridge Hide Boots',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'common',
    stats: { armor: 26 },
    sellValue: 22,
  },
  fenbridge_hide_belt: {
    id: 'fenbridge_hide_belt',
    name: 'Fenbridge Hide Belt',
    kind: 'armor',
    armorType: 'leather',
    slot: 'waist',
    quality: 'common',
    stats: { armor: 28 },
    sellValue: 25,
  },
  marshstalker_jerkin: {
    id: 'marshstalker_jerkin',
    name: 'Marshstalker Jerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 58, agi: 4, sta: 2 },
    sellValue: 40,
  },
  marshstalker_hood: {
    id: 'marshstalker_hood',
    name: 'Marshstalker Hood',
    kind: 'armor',
    armorType: 'leather',
    slot: 'helmet',
    quality: 'uncommon',
    stats: { armor: 38, agi: 3, sta: 2 },
    sellValue: 34,
  },
  marshstalker_spaulders: {
    id: 'marshstalker_spaulders',
    name: 'Marshstalker Spaulders',
    kind: 'armor',
    armorType: 'leather',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 44, agi: 3, sta: 2 },
    sellValue: 34,
  },
  mirewarden_jerkin: {
    id: 'mirewarden_jerkin',
    name: 'Mirewarden Jerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 72, agi: 8, sta: 5 },
    sellValue: 120,
  },
  mirewarden_leggings: {
    id: 'mirewarden_leggings',
    name: 'Mirewarden Leggings',
    kind: 'armor',
    armorType: 'leather',
    slot: 'legs',
    quality: 'rare',
    stats: { armor: 64, agi: 7, sta: 5 },
    sellValue: 88,
  },
  mirewarden_treads: {
    id: 'mirewarden_treads',
    name: 'Mirewarden Treads',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 44, agi: 5, sta: 3 },
    sellValue: 78,
  },

  // --- Crafted cooking ladder (cooking) ------------------------------------
  // Trainer-taught outputs of LADDER_RECIPES (content/recipes.ts), three rungs
  // at skillReq 0/25/50, kitchens-bound at cook_marlow. kind 'food' + foodHp
  // (an 18s sit heal); no new effect machinery. Every foodHp/sellValue reuses
  // an existing point on the vendor food curve (foodHp ceiling 980 =
  // conjured_bread4, the top existing food). Never vendor-stocked (no buyValue);
  // output quality matches the rung. Reagent economy clears strictly per rung.
  pan_seared_perch: {
    id: 'pan_seared_perch',
    name: 'Pan-Seared River Perch',
    kind: 'food',
    quality: 'common',
    foodHp: 90,
    sellValue: 6,
  },
  hunters_game_skewer: {
    id: 'hunters_game_skewer',
    name: "Hunter's Game Skewer",
    kind: 'food',
    quality: 'common',
    foodHp: 117,
    sellValue: 12,
  },
  herbed_marsh_pike: {
    id: 'herbed_marsh_pike',
    name: 'Herbed Marsh Pike',
    kind: 'food',
    quality: 'common',
    foodHp: 117,
    sellValue: 12,
  },
  ashwood_smoked_eel: {
    id: 'ashwood_smoked_eel',
    name: 'Ashwood Smoked Eel',
    kind: 'food',
    quality: 'uncommon',
    foodHp: 243,
    sellValue: 25,
  },
  goldleaf_game_stew: {
    id: 'goldleaf_game_stew',
    name: 'Goldleaf Game Stew',
    kind: 'food',
    quality: 'uncommon',
    foodHp: 243,
    sellValue: 25,
  },
  frostgill_chowder: {
    id: 'frostgill_chowder',
    name: 'Frostgill Chowder',
    kind: 'food',
    quality: 'uncommon',
    foodHp: 432,
    sellValue: 40,
  },
  silvered_carp_supper: {
    id: 'silvered_carp_supper',
    name: 'Silvered Carp Supper',
    kind: 'food',
    quality: 'rare',
    foodHp: 552,
    sellValue: 75,
  },
  anglers_feast_platter: {
    id: 'anglers_feast_platter',
    name: "Angler's Feast Platter",
    kind: 'food',
    quality: 'rare',
    foodHp: 552,
    sellValue: 60,
  },
  marlows_grand_roast: {
    id: 'marlows_grand_roast',
    name: "Marlow's Grand Roast",
    kind: 'food',
    quality: 'rare',
    foodHp: 980,
    sellValue: 150,
  },

  // --- Apex role foods (cooking, Masterwrought phase 10) --------------------
  // Outputs of APEX_CONSUMABLE_RECIPES (content/recipes.ts) at skillReq 100,
  // kitchens-bound like the ladder above. Still kind 'food' with the ordinary
  // 18-second sit heal, plus the classic Well Fed buff the new `wellFed`
  // payload carries (types.ts): it lands only when the drain COMPLETES, so a
  // meal cut short feeds and buffs nothing. One shared 'well_fed' aura id
  // across all three, so the newest plate replaces the last and no one eats
  // three roles at once, and no flask marker: Well Fed dies with you.
  //
  // foodHp 1392 is the next classic-era food band above the shipped 980
  // ceiling (conjured_bread4 / marlows_grand_roast), which is where the
  // repo's classic-formula doctrine puts the rung after it. The well-fed stat
  // enters at the consumable family's own entry rung, value 6 (the common
  // elixir rung), for the classic 10-minute duration. sellValue 90 continues
  // the dish curve's per-unit multi-output pricing one step past the 75 of
  // silvered_carp_supper, and 4 x 90 stays strictly below the summed reagent
  // value. Never vendor-stocked (no buyValue). 'Well Fed' is localized
  // client-side through the sim_i18n aura matcher, like the elixir auras.
  stonepot_stew: {
    id: 'stonepot_stew',
    name: 'Stonepot Stew',
    kind: 'food',
    quality: 'epic',
    foodHp: 1392,
    wellFed: { aura: 'Well Fed', kind: 'buff_sta', value: 6, duration: 600 },
    sellValue: 90,
  },
  warspice_skewers: {
    id: 'warspice_skewers',
    name: 'Warspice Skewers',
    kind: 'food',
    quality: 'epic',
    foodHp: 1392,
    wellFed: { aura: 'Well Fed', kind: 'buff_ap', value: 6, duration: 600 },
    sellValue: 90,
  },
  sageleaf_chowder: {
    id: 'sageleaf_chowder',
    name: 'Sageleaf Chowder',
    kind: 'food',
    quality: 'epic',
    foodHp: 1392,
    wellFed: { aura: 'Well Fed', kind: 'buff_int', value: 6, duration: 600 },
    sellValue: 90,
  },

  // --- Crafted alchemy ladder (alchemy) ------------------------------------
  // Trainer-taught outputs of LADDER_RECIPES (content/recipes.ts), three rungs
  // at skillReq 0/25/50, apothecary-bound at alchemist_verane. Potions reuse the
  // vendor potionHp/potionMana machinery (instant, in-combat, shared cooldown);
  // elixirs reuse the elixir_of_the_bear shape (a temporary buff_sta aura on
  // use). Every rung strictly EXCEEDS its vendor-tier equivalent in items.ts
  // (minor/lesser/healing_potion, minor/lesser/mana_potion; #1608 retuned that
  // ladder, so this one moved in lockstep to stay a strict upgrade): heal <= 335
  // (healing_potion's 320 + headroom), mana <= 425 (mana_potion's 410 +
  // headroom), elixir buff_sta <= 12 for <= 900s (elixir_of_the_bear). The three
  // elixir aura display names are localized client-side through the sim_i18n
  // aura matcher (AURA_NAME_KEY), the same path as 'Might of the Bear'. Never
  // vendor-stocked (no buyValue).
  silverleaf_healing_draught: {
    id: 'silverleaf_healing_draught',
    name: 'Sheenleaf Healing Draught',
    kind: 'potion',
    quality: 'common',
    potionHp: 120,
    sellValue: 12,
  },
  silverleaf_mana_draught: {
    id: 'silverleaf_mana_draught',
    name: 'Sheenleaf Mana Draught',
    kind: 'potion',
    quality: 'common',
    potionMana: 160,
    sellValue: 12,
  },
  elixir_of_the_boar: {
    id: 'elixir_of_the_boar',
    name: 'Elixir of the Boar',
    kind: 'elixir',
    quality: 'common',
    elixir: { aura: 'Might of the Boar', kind: 'buff_sta', value: 6, duration: 600 },
    sellValue: 10,
  },
  goldleaf_healing_draught: {
    id: 'goldleaf_healing_draught',
    name: 'Goldleaf Healing Draught',
    kind: 'potion',
    quality: 'uncommon',
    potionHp: 200,
    sellValue: 22,
  },
  goldleaf_mana_draught: {
    id: 'goldleaf_mana_draught',
    name: 'Goldleaf Mana Draught',
    kind: 'potion',
    quality: 'uncommon',
    potionMana: 260,
    sellValue: 22,
  },
  venomfire_elixir: {
    id: 'venomfire_elixir',
    name: 'Vipersear Elixir',
    kind: 'elixir',
    quality: 'uncommon',
    elixir: { aura: 'Vipersear Vigor', kind: 'buff_sta', value: 9, duration: 900 },
    sellValue: 15,
  },
  sunpetal_healing_draught: {
    id: 'sunpetal_healing_draught',
    name: 'Sunpetal Healing Draught',
    kind: 'potion',
    quality: 'rare',
    potionHp: 335,
    sellValue: 32,
  },
  sunpetal_mana_draught: {
    id: 'sunpetal_mana_draught',
    name: 'Sunpetal Mana Draught',
    kind: 'potion',
    quality: 'rare',
    potionMana: 425,
    sellValue: 32,
  },
  elixir_of_the_serpent: {
    id: 'elixir_of_the_serpent',
    name: 'Elixir of the Serpent',
    kind: 'elixir',
    quality: 'rare',
    elixir: { aura: 'Might of the Serpent', kind: 'buff_sta', value: 12, duration: 900 },
    sellValue: 20,
  },

  // --- Apex flasks (alchemy, Masterwrought phase 10) ------------------------
  // Outputs of APEX_CONSUMABLE_RECIPES (content/recipes.ts) at skillReq 100,
  // apothecary-bound like the rest of alchemy. kind 'flask' (types.ts
  // FlaskItemDef) reuses the `elixir` payload and the shipped `elixir_${kind}`
  // aura family, so a flask and a same-stat elixir or scroll replace each other
  // in both orders; what makes it a flask is the Aura.flask marker the use path
  // stamps: only ONE flask rides at a time whatever its stat, and it survives
  // death. One flask per role, so the choice is which role you fly, never how
  // many flasks you stack.
  //
  // The band deliberately BREAKS the elixir ceiling documented above (buff_sta
  // <= 12 for <= 900s), which is the point of an apex rung: value 15 is the
  // rare elixir's 12 plus the ladder's own +3 step, and duration 1200 is its
  // 900 plus the ladder's +300 step. sellValue 25 continues the elixir curve
  // (10/15/20) by its +5 step. Never vendor-stocked (no buyValue). The three
  // aura display names are localized client-side through the sim_i18n aura
  // matcher (AURA_NAME_KEY), the same path as 'Might of the Serpent'.
  ironhusk_flask: {
    id: 'ironhusk_flask',
    name: 'Ironhusk Flask',
    kind: 'flask',
    quality: 'epic',
    elixir: { aura: 'Ironhusk Vigor', kind: 'buff_sta', value: 15, duration: 1200 },
    sellValue: 25,
  },
  warboar_flask: {
    id: 'warboar_flask',
    name: 'Warboar Flask',
    kind: 'flask',
    quality: 'epic',
    elixir: { aura: 'Warboar Might', kind: 'buff_ap', value: 15, duration: 1200 },
    sellValue: 25,
  },
  runewater_flask: {
    id: 'runewater_flask',
    name: 'Runewater Flask',
    kind: 'flask',
    quality: 'epic',
    elixir: { aura: 'Runewater Clarity', kind: 'buff_int', value: 15, duration: 1200 },
    sellValue: 25,
  },

  // --- Crafted jewelry ladder (jewelcrafting) -------------------------------
  // Trainer-taught outputs of JEWELCRAFTING_RECIPES (content/recipes.ts), three
  // rungs at skillReq 0/25/50, forge-bound at forgemistress_darva (the recipes
  // carry an explicit forge stationType; jewelcrafting itself has no station).
  // Rung qualities are uncommon/uncommon/rare rather than the other ladders'
  // common/uncommon/rare: common quality carries no primary-stat budget and
  // jewelry has no armor axis, so a common ring would carry literally nothing.
  // No armorType (every class wears jewelry) and no combat rating of any kind:
  // ratings are jewelry's ENDGAME identity (heroic_vendor.ts), and the base
  // rungs stay rating-free per ruling R14. Stats sit exactly on the repo
  // budget formula (src/sim/item_budget.ts). Never vendor-stocked (no
  // buyValue), and every output's sellValue clears strictly below its summed
  // reagent value per the economy invariant. Display names follow the Osmium
  // register (the thorium_* ids display "Osmium", the originality-sweep
  // id/display split); the ids keep the verified thorium spellings.
  hammered_copper_band: {
    id: 'hammered_copper_band',
    name: 'Hammered Copper Band',
    kind: 'armor',
    slot: 'ring',
    quality: 'uncommon',
    stats: { str: 2, sta: 1 },
    sellValue: 32,
  },
  polished_copper_loop: {
    id: 'polished_copper_loop',
    name: 'Polished Copper Loop',
    kind: 'armor',
    slot: 'ring',
    quality: 'uncommon',
    stats: { int: 2, sta: 1 },
    sellValue: 32,
  },
  coiled_copper_torc: {
    id: 'coiled_copper_torc',
    name: 'Coiled Copper Torc',
    kind: 'armor',
    slot: 'neck',
    quality: 'uncommon',
    stats: { agi: 2, sta: 1 },
    sellValue: 36,
  },
  riveted_iron_signet: {
    id: 'riveted_iron_signet',
    name: 'Riveted Iron Signet',
    kind: 'armor',
    slot: 'ring',
    quality: 'uncommon',
    stats: { str: 3, sta: 1 },
    sellValue: 46,
  },
  etched_iron_loop: {
    id: 'etched_iron_loop',
    name: 'Etched Iron Loop',
    kind: 'armor',
    slot: 'ring',
    quality: 'uncommon',
    stats: { int: 3, sta: 1 },
    sellValue: 46,
  },
  iron_link_choker: {
    id: 'iron_link_choker',
    name: 'Iron Link Choker',
    kind: 'armor',
    slot: 'neck',
    quality: 'uncommon',
    stats: { agi: 3, sta: 1 },
    sellValue: 52,
  },
  weighted_thorium_band: {
    id: 'weighted_thorium_band',
    name: 'Weighted Osmium Band',
    kind: 'armor',
    slot: 'ring',
    quality: 'rare',
    stats: { str: 5, sta: 3 },
    sellValue: 280,
  },
  gleaming_thorium_loop: {
    id: 'gleaming_thorium_loop',
    name: 'Gleaming Osmium Loop',
    kind: 'armor',
    slot: 'ring',
    quality: 'rare',
    stats: { int: 5, sta: 3 },
    sellValue: 280,
  },
  burnished_thorium_amulet: {
    id: 'burnished_thorium_amulet',
    name: 'Burnished Osmium Amulet',
    kind: 'armor',
    slot: 'neck',
    quality: 'rare',
    stats: { agi: 5, sta: 3 },
    sellValue: 310,
  },

  // --- Crafted inscription ladder (tomes + scrolls) -------------------------
  // Trainer-taught outputs of INSCRIPTION_RECIPES (content/recipes.ts), three
  // rungs at skillReq 0/25/50, apothecary-bound at alchemist_verane (the
  // recipes carry an explicit apothecary stationType; inscription itself has
  // no station). TOMES are caster held-offhand stat sticks (CASTER_ALL, no
  // armor axis, no weapon damage); rung qualities are uncommon/uncommon/rare
  // for the jewelry ladder's reason: common quality carries no primary-stat
  // budget and held_offhand has no armor axis, so a common tome would carry
  // literally nothing. Stats sit exactly on the repo budget formula
  // (src/sim/item_budget.ts, held line 0.75). Zero combat ratings per ruling
  // R14. SCROLLS are the ALTERNATIVE SOURCE of the battle-elixir stamina
  // family (R14 corollary): each rung carries the SAME aura name, value, and
  // duration as its band's elixir, so either source grants the
  // indistinguishable buff and the shared elixir_buff_sta aura id makes them
  // mutually exclusive in both orders, never a stack. The authored family
  // ceiling (buff_sta <= 12 for <= 900s) binds scrolls exactly as it binds
  // elixirs. Never vendor-stocked (no buyValue); every output's sellValue
  // clears strictly below its summed reagent value per the economy invariant.
  // Display names follow the Sheenleaf register (the silverleaf_* ids display
  // "Sheenleaf", the originality-sweep id/display split); ids keep the
  // verified silverleaf spellings.
  silverleaf_primer: {
    id: 'silverleaf_primer',
    name: 'Sheenleaf Primer',
    kind: 'held_offhand',
    slot: 'offhand',
    quality: 'uncommon',
    stats: { int: 2, spi: 1 },
    requiredClass: CASTER_ALL,
    sellValue: 24,
  },
  goldleaf_folio: {
    id: 'goldleaf_folio',
    name: 'Goldleaf Folio',
    kind: 'held_offhand',
    slot: 'offhand',
    quality: 'uncommon',
    stats: { int: 3, spi: 2 },
    requiredClass: CASTER_ALL,
    sellValue: 100,
  },
  sunpetal_grimoire: {
    id: 'sunpetal_grimoire',
    name: 'Sunpetal Grimoire',
    kind: 'held_offhand',
    slot: 'offhand',
    quality: 'rare',
    stats: { int: 5, spi: 3, sta: 2 },
    requiredClass: CASTER_ALL,
    sellValue: 280,
  },
  silverleaf_scroll: {
    id: 'silverleaf_scroll',
    name: 'Sheenleaf Scroll',
    kind: 'scroll',
    quality: 'common',
    elixir: { aura: 'Might of the Boar', kind: 'buff_sta', value: 6, duration: 600 },
    sellValue: 10,
  },
  goldleaf_scroll: {
    id: 'goldleaf_scroll',
    name: 'Goldleaf Scroll',
    kind: 'scroll',
    quality: 'uncommon',
    elixir: { aura: 'Vipersear Vigor', kind: 'buff_sta', value: 9, duration: 900 },
    sellValue: 15,
  },
  sunpetal_scroll: {
    id: 'sunpetal_scroll',
    name: 'Sunpetal Scroll',
    kind: 'scroll',
    quality: 'rare',
    elixir: { aura: 'Might of the Serpent', kind: 'buff_sta', value: 12, duration: 900 },
    sellValue: 20,
  },

  // --- Masterwrought intermediates (Phase 07, R13) ---------------------------
  // The skill-75 rung: one intermediate material per profession, minted by
  // INTERMEDIATE_RECIPES (content/recipes.ts) per the Phase 07 pre-fan-out
  // ledger (docs/prd/masterwrought/state.md). The Quickening Catalyst is
  // alchemy's 75 rung and the bottom-of-chain time gate (one craft per day per
  // character via oncePerDay on its recipe); each of the other nine consumes
  // one Catalyst, and the phase 08/09/10 apex rows consume three of their own
  // profession's intermediate per piece (the recorded demand math). Materials
  // doctrine: kind 'junk', quality 'common' (a reagent must never fall into
  // the junk sweep), sellValue only (never vendor-stocked, no buyValue), and
  // ALL TEN are ordinary tradable items: the Catalyst's tradability is the
  // market pressure valve by ruling. sellValues sit in the tier-3 material
  // band (osmium 15 up to arcanite/sunpetal 40, wyrmfall_core 50) and strictly
  // below each minting recipe's input value per the economy invariant.
  duskforged_billet: {
    id: 'duskforged_billet',
    name: 'Duskforged Billet',
    kind: 'junk',
    quality: 'common',
    sellValue: 45,
  },
  forgefold_plating: {
    id: 'forgefold_plating',
    name: 'Forgefold Plating',
    kind: 'junk',
    quality: 'common',
    sellValue: 45,
  },
  wyrmhide_cording: {
    id: 'wyrmhide_cording',
    name: 'Wyrmhide Cording',
    kind: 'junk',
    quality: 'common',
    sellValue: 40,
  },
  sunspun_bolt: {
    id: 'sunspun_bolt',
    name: 'Sunspun Bolt',
    kind: 'junk',
    quality: 'common',
    sellValue: 45,
  },
  prismglass_setting: {
    id: 'prismglass_setting',
    name: 'Prismglass Setting',
    kind: 'junk',
    quality: 'common',
    sellValue: 45,
  },
  precision_chassis: {
    id: 'precision_chassis',
    name: 'Precision Chassis',
    kind: 'junk',
    quality: 'common',
    sellValue: 45,
  },
  quickening_catalyst: {
    id: 'quickening_catalyst',
    name: 'Quickening Catalyst',
    kind: 'junk',
    quality: 'common',
    sellValue: 50,
  },
  seasoned_stock: {
    id: 'seasoned_stock',
    name: 'Seasoned Stock',
    kind: 'junk',
    quality: 'common',
    sellValue: 30,
  },
  lucent_reagent: {
    id: 'lucent_reagent',
    name: 'Lucent Reagent',
    kind: 'junk',
    quality: 'common',
    sellValue: 40,
  },
  sablewax_vellum: {
    id: 'sablewax_vellum',
    name: 'Sablewax Vellum',
    kind: 'junk',
    quality: 'common',
    sellValue: 45,
  },

  // --- Masterwrought apex armor (Phase 08, R13/R14) --------------------------
  // The skill-100 rung for the three armor crafts: nine ilvl-31 epics (recipe
  // level 25 + epic bonus 6) whose primary sums EQUAL primaryStatBudget and
  // whose single rating follows the band's one-rating-at-40 law, each rating
  // chosen to COMPLEMENT the same-slot drop rather than duplicate it. Slots
  // come from the committed slot coverage audit (state.md Phase 08 ledger):
  // the weakest-covered cells per armor class. Armor values are copied from
  // the same-band same-slot reference piece, never invented. All nine carry
  // masterwrought: true (the counted equip family). The level-20 equip gate
  // is DERIVED, never hand-authored (item_level_req.ts doctrine): source
  // level 25 from the recipe clamps to MAX_LEVEL, exactly like the phase 05
  // jewelry; the sweep test pins requiredLevelFor(def) so the gate itself
  // stays load-bearing (tradable per R2).
  // sellValues sit strictly below each recipe's reagent input value per the
  // economy invariant; vendor value is not power. Pure stats per R14: no
  // procs, no effects, no on-use, anywhere in this block.
  spiritweld_girdle: {
    id: 'spiritweld_girdle',
    name: 'Spiritweld Girdle',
    kind: 'armor',
    armorType: 'mail',
    slot: 'waist',
    quality: 'epic',
    // ilvl-31 waist epic budget = 15; int:9+spi:6 = 15. Armor: gravescale_girdle.
    stats: { armor: 224, int: 9, spi: 6 },
    critRating: 40,
    sellValue: 300,
    masterwrought: true,
  },
  forgefold_legguards: {
    id: 'forgefold_legguards',
    name: 'Forgefold Legguards',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'epic',
    // ilvl-31 legs epic budget = 20; str:11+sta:9 = 20. Armor: bloodmane_war_legguards.
    stats: { armor: 315, str: 11, sta: 9 },
    critRating: 40,
    sellValue: 320,
    masterwrought: true,
  },
  wardspeaker_sabatons: {
    id: 'wardspeaker_sabatons',
    name: 'Wardspeaker Sabatons',
    kind: 'armor',
    armorType: 'mail',
    slot: 'feet',
    quality: 'epic',
    // ilvl-31 feet epic budget = 14; int:8+spi:6 = 14. Armor: tideworn_warboots.
    stats: { armor: 212, int: 8, spi: 6 },
    hasteRating: 40,
    sellValue: 280,
    masterwrought: true,
  },
  briarstep_jerkin: {
    id: 'briarstep_jerkin',
    name: 'Briarstep Jerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'epic',
    // ilvl-31 chest epic budget = 22; agi:13+sta:9 = 22. Armor: basin_stalkers_tunic.
    stats: { armor: 172, agi: 13, sta: 9 },
    critRating: 40,
    sellValue: 175,
    masterwrought: true,
  },
  fenbloom_breeches: {
    id: 'fenbloom_breeches',
    name: 'Fenbloom Breeches',
    kind: 'armor',
    armorType: 'leather',
    slot: 'legs',
    quality: 'epic',
    // ilvl-31 legs epic budget = 20; int:12+spi:8 = 20. Armor: tidewoven_trousers.
    stats: { armor: 132, int: 12, spi: 8 },
    hasteRating: 40,
    sellValue: 160,
    masterwrought: true,
  },
  barksong_handguards: {
    id: 'barksong_handguards',
    name: 'Barksong Handguards',
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'epic',
    // ilvl-31 gloves epic budget = 15; int:9+spi:6 = 15. Armor: sanctum_prowlers_grips.
    stats: { armor: 104, int: 9, spi: 6 },
    critRating: 40,
    sellValue: 140,
    masterwrought: true,
  },
  sunspun_vestments: {
    id: 'sunspun_vestments',
    name: 'Sunspun Vestments',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'epic',
    // ilvl-31 chest epic budget = 22; int:12+spi:10 = 22. Armor: shroud_of_the_gravewyrm.
    stats: { armor: 90, int: 12, spi: 10 },
    hitRating: 40,
    sellValue: 200,
    masterwrought: true,
  },
  sunspun_leggings: {
    id: 'sunspun_leggings',
    name: 'Sunspun Leggings',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'legs',
    quality: 'epic',
    // ilvl-31 legs epic budget = 20; int:12+spi:8 = 20. Armor: lunar_choir_leggings.
    stats: { armor: 72, int: 12, spi: 8 },
    hasteRating: 40,
    sellValue: 190,
    masterwrought: true,
  },
  sunspun_handwraps: {
    id: 'sunspun_handwraps',
    name: 'Sunspun Handwraps',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'epic',
    // ilvl-31 gloves epic budget = 15; int:9+spi:6 = 15. Armor: shadowpulse_handwraps.
    stats: { armor: 52, int: 9, spi: 6 },
    critRating: 40,
    sellValue: 170,
    masterwrought: true,
  },
  // The apex bag: best carried capacity in the game, one 2-slot step past
  // mistcallers_duffel (14) on the shipped quality ladder. Deliberately NOT
  // masterwrought (bags carry no combat power, so it never spends a slot in
  // the counted equip family) and not item-level eligible (kind bag).
  sunspun_haversack: {
    id: 'sunspun_haversack',
    name: 'Sunspun Haversack',
    kind: 'bag',
    quality: 'epic',
    bagSlots: 16,
    sellValue: 180,
  },
};
