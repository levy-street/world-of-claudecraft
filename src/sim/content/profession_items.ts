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
  // vendor-stocked, sellValue below summed reagent value. Since masterwrought
  // Phase 11o the rare rung-50 pieces keep these authored ilvl-23 budgets over
  // a level-15 recipe (derived ilvl 18), deliberately over-budget: see the
  // LADDER_RECIPES amendment in content/recipes.ts.
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
  // value per the economy invariant. Budgets read from src/sim/item_budget.ts;
  // since masterwrought Phase 11o the rare rung-50 pieces keep their authored
  // ilvl-23 budgets over a level-15 recipe (see the LADDER_RECIPES amendment).
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
  // The crafted bag ladder above the Silkspun Satchel (BAG_RECIPES in
  // content/recipes.ts). Every one of these vendors cheap for its tier the way
  // the satchel does: a crafted bag is worth its slots, not its gold, and the
  // economy invariant holds each output under its own reagent bill.
  duskweave_bag: {
    id: 'duskweave_bag',
    name: 'Duskweave Bag',
    kind: 'bag',
    quality: 'rare',
    bagSlots: 12,
    sellValue: 450,
  },
  // The deterministic top general bag: 16 slots without a drop roll, which is
  // why it costs the most cloth of any general bag.
  resonant_weave_bag: {
    id: 'resonant_weave_bag',
    name: 'Resonantweave Bag',
    kind: 'bag',
    quality: 'epic',
    bagSlots: 16,
    sellValue: 900,
  },
  // Materials-only satchels (materialsOnly: true): their slots feed the
  // materials pool, never the general one. See src/sim/bag_pools.ts.
  foragers_haversack: {
    id: 'foragers_haversack',
    name: "Forager's Haversack",
    kind: 'bag',
    quality: 'uncommon',
    bagSlots: 12,
    materialsOnly: true,
    sellValue: 200,
  },
  // The top materials satchel at 24 slots, and the priciest bag bill in the
  // game: the whole materials pool ceiling runs through this one recipe.
  loombound_reagent_satchel: {
    id: 'loombound_reagent_satchel',
    name: 'Loombound Reagent Satchel',
    kind: 'bag',
    quality: 'epic',
    bagSlots: 24,
    materialsOnly: true,
    sellValue: 1200,
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
  // src/sim/item_budget.ts (the rare rung-50 pieces keep their authored
  // ilvl-23 budgets over a level-15 recipe since masterwrought Phase 11o, see
  // the LADDER_RECIPES amendment).
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
  // (an 18s sit heal); no new effect machinery. Every foodHp/sellValue was
  // authored on an existing point of the pre-11n food curve (foodHp ceiling
  // 980 = conjured_bread4); since the 11n vendor floor the vendor food line
  // sits the 10/15/20 margin ladder BELOW these crafted points, which stayed
  // frozen per R5. Never vendor-stocked (no buyValue);
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
  // 18-second sit heal, plus the classic Well Fed buff the `wellFed`
  // payload carries (types.ts): it lands only when the drain COMPLETES, so a
  // meal cut short feeds and buffs nothing. One shared 'well_fed' aura id
  // across EVERY well-fed food (WELL_FED_AURA_ID, src/sim/wellfed.ts), so
  // the newest meal replaces the last, no one eats two buffs at once, and no
  // flask marker: Well Fed dies with you.
  //
  // foodHp 1392 is the next classic-era food band above everything shipped:
  // the classic ladder runs 61 / 243 / 552 / 874 / 1392 / 2148, and the
  // shipped top of 980 (conjured_bread4 / marlows_grand_roast) is an off-band
  // value that already sits past the 874 band, so the apex rung continues the
  // classic ladder rather than stepping from that value. The well-fed VALUE
  // enters at the consumable family's own entry rung, 6 (elixir_of_the_boar,
  // the common elixir rung). The kit sum that rung was chosen against read
  // flask 15 plus food 6 for 21; Phase 15's measured pass brought the flask
  // to 13, so the crafted stamina ceiling now reads 19. The PLATE's own 6 is
  // unmoved and is not this phase's to move: it is settled at ruling
  // 11c-D-2. The DURATION takes the elixir
  // ladder's own next step, the entry rung's 600 plus the boar-to-venomfire
  // duration step of 300, so the apex plate is 6 / 900 and strictly
  // dominates every farming rung of the five-rung Well Fed ladder below
  // (farming climbs 2/3/4/5 at 600s, one point per crop tier, topping out
  // one below the apex; the apex plate then beats every one of them on stat
  // AND duration, last eaten wins under the one 'well_fed' id). Raising the
  // crafted duration here is ladder ORDERING inside the crafted line, not a
  // floor move: R23 governs the vendor-versus-crafted margin and no vendor
  // item grants Well Fed at all, while R5's always-on kit premise is
  // indifferent to 600 versus 900. sellValue 90 is set by
  // the BATCH, not the quality band: the recipe yields four plates and
  // 4 x 90 = 360 stays strictly below the summed reagent value (about 422),
  // where Marlow's per-plate 150 on a four-plate batch (600) would turn the
  // recipe into a gold faucet. So an epic plate vendors for less than the
  // rare Marlow's Grand Roast on purpose (a player-visible inversion, recorded
  // as a maintainer call in the packet ledger; the earlier framing of a
  // 'multi-output curve' past silvered_carp_supper was wrong: both anchors
  // are single-output recipes). Never vendor-stocked (no buyValue). 'Well
  // Fed' is localized client-side through the sim_i18n aura matcher, like
  // the elixir auras.
  stonepot_stew: {
    id: 'stonepot_stew',
    name: 'Stonepot Stew',
    kind: 'food',
    quality: 'epic',
    foodHp: 1392,
    wellFed: { aura: 'Well Fed', kind: 'buff_sta', value: 6, duration: 900 },
    sellValue: 90,
  },
  warspice_skewers: {
    id: 'warspice_skewers',
    name: 'Warspice Skewers',
    kind: 'food',
    quality: 'epic',
    foodHp: 1392,
    wellFed: { aura: 'Well Fed', kind: 'buff_ap', value: 6, duration: 900 },
    sellValue: 90,
  },
  sageleaf_chowder: {
    id: 'sageleaf_chowder',
    name: 'Sageleaf Chowder',
    kind: 'food',
    quality: 'epic',
    foodHp: 1392,
    wellFed: { aura: 'Well Fed', kind: 'buff_int', value: 6, duration: 900 },
    sellValue: 90,
  },

  // --- Angler's endgame dishes (cooking, masterwrought Phase 11i) ----------
  // The three drop-taught rows that put FISHING into the endgame bill census on
  // its own account rather than through a rod (R20). All three are outputs of
  // APEX_CONSUMABLE_RECIPES at skillReq 75 / 100 / 125, kitchens-bound.
  //
  // NO NEW POWER ANYWHERE IN THE BLOCK, and that is R14 rather than caution.
  // The two plain dishes REUSE a shipped foodHp and sellValue pair exactly
  // (552 / 75 is Highwatch Gourd Soup's, 980 / 150 is the Sunmelon Tart and
  // Marlow's Grand Roast rung), so the fish line adds no rung to the food
  // curve, and neither carries a wellFed payload at all. The capstone carries
  // no payload of its own either: it SERVES a shipped plate (below).
  peppered_deepbarb_catfish: {
    id: 'peppered_deepbarb_catfish',
    name: 'Peppered Deepbarb Catfish',
    kind: 'food',
    quality: 'rare',
    foodHp: 552,
    sellValue: 75,
  },
  roast_hollowgill_sturgeon: {
    id: 'roast_hollowgill_sturgeon',
    name: 'Roast Hollowgill Sturgeon',
    kind: 'food',
    quality: 'rare',
    foodHp: 980,
    sellValue: 150,
  },
  // THE APEX FEAST TIER (masterwrought Phase 11k, deliverable 1): three
  // placeable role feasts at cooking 125, one per combat role, on ONE
  // byte-identical bill. This block REPLACES Phase 11i's single
  // `deepwater_feast`, and the replacement is a maintainer ruling rather than a
  // tidy-up, so the reasoning is recorded here where the rows are:
  //
  // - 11i minted `deepwater_feast` (cooking 125, epic, junk, charges 10,
  //   durationTicks 3600, dishItemId stonepot_stew, drop-taught, kitchens, an
  //   epic pattern at 100 on the 16-marks rung) three days after this phase was
  //   specified. It matched THIS tier's stamina rung on every settled field.
  // - It was also DEAD: professions/feast.ts bound its whole lifecycle to one
  //   module constant, so using it either denied `no_feast` forever or spent a
  //   Harvest Feast and placed one instead. The Phase 11k widening is the
  //   machinery whose absence killed it, so this phase could not be neutral on
  //   the row: fixing it, cutting it, and shipping a fourth feast beside it
  //   were the only three options and all three are decisions.
  // - CUT AND RE-MINT was ruled. Folding the shipped row in would have left the
  //   family with a non-uniform bill (its own bill is all-fish where these take
  //   produce, core and catch) and a non-uniform price (250, which is the RARE
  //   party rung's own point), and its name names a water rather than the plate
  //   it serves, which is the one thing decision K1 makes functional: the placed
  //   title is how a raider at the table knows which plate is on it. The id was
  //   branch-only and never shipped in a release, so nothing append-only broke.
  //
  // WHAT IS INHERITED RATHER THAN INVENTED, which is the whole tier's thesis:
  // - A serving IS a shipped apex plate, through the `dishItemId` indirection
  //   farming already built. Re-tuning the plate re-tunes the feast, and the
  //   feast can never drift from the bagged dish. NO new aura id, NO new
  //   magnitude, NO new duration, NO new proc effect anywhere in this block.
  // - charges 10 is RAID_MAX (social/party.ts), one serving each for a full
  //   raid; durationTicks 3600 is the party feast's own 180 seconds. Both are
  //   decision K5, taken from the rung below rather than re-picked, because
  //   feast.ts's per-player ledger, its 1 Hz despawn sweep and the render
  //   shadow cap were all sized for these numbers and feast uptime is a
  //   Phase 15 input.
  // - kind 'junk' is the placeable-usable precedent harvest_feast set (the
  //   junk-sale sweep keys on quality 'poor', so an epic feast can never ride
  //   the bulk sale). quality 'epic' is decision K2 and matches the skill-125
  //   rung and the epic pattern that teaches it; it also keeps every feast
  //   rare-or-better, which is what makes the crafted copy carry its crafter's
  //   signature under the shipped craft-signing rule (professions/crafting.ts).
  //
  // sellValue 300 IS DERIVED, inside decision K2's binding window (strictly
  // above the rare party feast at 250, strictly below the epic permanent
  // station laden_hearth at 380, a multiple of 10). The step is the one reagent
  // this tier adds that the party feast's bill does not carry: a Wyrmfall Core,
  // sellValue 50. 250 + 50 = 300. That is the rate limiter made legible in the
  // price rather than a number chosen between two bounds, and every input is a
  // shipped point read off the merged table. Gold-negative by a wide margin
  // (input 1464 against 300); the arithmetic is printed at the recipe rows.
  //
  // EACH CARRIES ITS OWN templateId, and they are unique per feast id. The
  // placed title is composed client-side off templateId
  // (src/ui/hud/professions/feast_title.ts), so sharing one would label an apex feast as the
  // rung it is not, which is exactly decision K1's rejected alternative.
  stonepot_feast: {
    id: 'stonepot_feast',
    name: 'Stonepot Feast',
    kind: 'junk',
    quality: 'epic',
    sellValue: 300,
    // THE TANK TABLE: serves Stonepot Stew (buff_sta), the plate its name is
    // compounded from, so the role is legible from the placed title BY
    // CONSTRUCTION and this phase coins no proper noun at all.
    feast: {
      charges: 10,
      durationTicks: 3600,
      dishItemId: 'stonepot_stew',
      templateId: 'stonepot_feast',
    },
  },
  warspice_feast: {
    id: 'warspice_feast',
    name: 'Warspice Feast',
    kind: 'junk',
    quality: 'epic',
    sellValue: 300,
    // THE PHYSICAL TABLE: serves Warspice Skewers (buff_ap).
    feast: {
      charges: 10,
      durationTicks: 3600,
      dishItemId: 'warspice_skewers',
      templateId: 'warspice_feast',
    },
  },
  sageleaf_feast: {
    id: 'sageleaf_feast',
    name: 'Sageleaf Feast',
    kind: 'junk',
    quality: 'epic',
    sellValue: 300,
    // THE CASTER TABLE: serves Sageleaf Chowder (buff_int).
    feast: {
      charges: 10,
      durationTicks: 3600,
      dishItemId: 'sageleaf_chowder',
      templateId: 'sageleaf_feast',
    },
  },
  // --- Farm dishes (cooking, Phase 6 economy hooks) ------------------------
  // Outputs of FARM_RECIPES (content/recipes.ts), the farm half of cooking:
  // eight dishes cooked from crop produce at the kitchens, a SIBLING of the
  // ladder block above rather than part of it (the ladder is closed at three
  // rungs x three recipes per craft; see the FARM_RECIPES header for why
  // folding these in would break that shape).
  //
  // NO LONGER ALL TRAINER-TAUGHT (masterwrought Phase 11f): the farm ladder is
  // split by rung now, so the dishes at or above FARM_DROP_RUNG_FLOOR are
  // taught by pattern items instead. Nothing about these DEFS moved for that:
  // the channel is a property of the recipe row, and this block's power,
  // quality and prices are 11c's and are untouched.
  //
  // Exactly the same shape as the ladder dishes: kind 'food' + foodHp (an 18s
  // sit heal), no buff machinery and no new effect field. Every foodHp and
  // sellValue pair REUSES a point the block above already ships (90/6, 117/12,
  // 243/25, 432/40, 552/60, 552/75, 980/150; 980 is the ceiling,
  // conjured_bread4), so the farm line adds no new rung to the food curve.
  // Never vendor-stocked (no buyValue); output quality matches the rung
  // (skillReq 0 common, 25 uncommon, 50 rare).
  //
  // VALUES ARE PROPOSED AND FLAGGED FOR THE MAINTAINER. Names are IP-safe per
  // D17: real plant, food and cooking words (loaf, pottage, braise, bannock,
  // tart, platter) plus this game's own settlement and zone flavor.
  vale_hearth_loaf: {
    id: 'vale_hearth_loaf',
    name: 'Vale Hearth Loaf',
    kind: 'food',
    quality: 'common',
    foodHp: 90,
    sellValue: 6,
  },
  eastbrook_root_pottage: {
    id: 'eastbrook_root_pottage',
    name: 'Eastbrook Root Pottage',
    kind: 'food',
    quality: 'common',
    foodHp: 117,
    sellValue: 12,
  },
  fenbridge_rice_bowl: {
    id: 'fenbridge_rice_bowl',
    name: 'Fenbridge Rice Bowl',
    kind: 'food',
    quality: 'uncommon',
    foodHp: 243,
    sellValue: 25,
  },
  fenbridge_beet_braise: {
    id: 'fenbridge_beet_braise',
    name: 'Fenbridge Beet Braise',
    kind: 'food',
    quality: 'uncommon',
    foodHp: 432,
    sellValue: 40,
  },
  highwatch_barley_bannock: {
    id: 'highwatch_barley_bannock',
    name: 'Highwatch Barley Bannock',
    kind: 'food',
    quality: 'rare',
    foodHp: 552,
    sellValue: 60,
  },
  highwatch_gourd_soup: {
    id: 'highwatch_gourd_soup',
    name: 'Highwatch Gourd Soup',
    kind: 'food',
    quality: 'rare',
    foodHp: 552,
    sellValue: 75,
  },
  evergarden_sunmelon_tart: {
    id: 'evergarden_sunmelon_tart',
    name: 'Evergarden Sunmelon Tart',
    kind: 'food',
    quality: 'rare',
    foodHp: 980,
    sellValue: 150,
  },
  evergarden_harvest_platter: {
    id: 'evergarden_harvest_platter',
    name: 'Evergarden Harvest Platter',
    kind: 'food',
    quality: 'rare',
    foodHp: 980,
    sellValue: 150,
  },

  // --- Farm buff dishes (cooking, Phase 11 well-fed food) -------------------
  // Outputs of FARM_RECIPES, one BUFF dish per crop tier so the produce
  // ladder has a well-fed consumer at every rung. The upper two are taught by
  // pattern items rather than a trainer since Phase 11f (see the plain-dish
  // header above); their defs did not move for it. Exactly the
  // plain-dish shape above plus the ONE extra field: `wellFed`, the same
  // payload the apex role foods carry (types.ts), minted at the 18s
  // sit-restore's completion under the one shared 'well_fed' aura id.
  //
  // These four are the LEVELLING AND PRE-RAID RUNGS of the one five-rung
  // Well Fed ladder (Masterwrought 11c, ruling 11c-D-2): one point of
  // stamina per crop tier, 2/3/4/5, all at the entry duration of 600s,
  // topping out one point below the apex plates (6 / 900, the block above),
  // so the drop-taught apex strictly dominates every trainer rung on stat
  // AND duration. One aura id across the whole family means last eaten
  // always wins (the classic one-food-buff rule) and a dish can never stack
  // with a role plate; a same-stat elixir still coexists (different aura
  // id), so the farming rungs' own stacking ceiling is dish 5 plus elixir
  // 12, 17 stamina (the global crafted ceiling is the apex block's flask plus
  // plate: 19 since Phase 15 trimmed the flask band to the measured R5
  // envelope, 21 before it), comfortably below the raid floor either way.
  // The earlier per-kind
  // wellfed_<kind> namespace and its "at or below the elixir budget ceiling"
  // calibration were retired here: they let a cooking-50 trainer dish (12 /
  // 900) beat the cooking-100 apex plate on both axes, the inversion the
  // re-tune removes.
  //
  // foodHp and sellValue reuse shipped curve points; quality matches the
  // rung. The tier 3/4 pair SHIPPED reagent-dormant under (bo): trainable and
  // well-formed, but at the time tier 3/4 produce had no seed faucet and the
  // D11 bootstrap ruling was still open. GATE 1 (Phase 11e) discharged that
  // ruling and stocked all eight upper seeds, so the dormancy is over and both
  // rows are completable today.
  // Names are IP-safe per D17 (real culinary words plus
  // settlement flavor) and collide with none of the eight plain dishes.
  eastbrook_glazed_carrots: {
    id: 'eastbrook_glazed_carrots',
    name: 'Eastbrook Glazed Carrots',
    kind: 'food',
    quality: 'common',
    foodHp: 90,
    sellValue: 6,
    wellFed: { aura: 'Well Fed', kind: 'buff_sta', value: 2, duration: 600 },
  },
  fenbridge_rice_pudding: {
    id: 'fenbridge_rice_pudding',
    name: 'Fenbridge Rice Pudding',
    kind: 'food',
    quality: 'uncommon',
    foodHp: 243,
    sellValue: 25,
    wellFed: { aura: 'Well Fed', kind: 'buff_sta', value: 3, duration: 600 },
  },
  highwatch_barley_porridge: {
    id: 'highwatch_barley_porridge',
    name: 'Highwatch Barley Porridge',
    kind: 'food',
    quality: 'rare',
    foodHp: 552,
    sellValue: 60,
    wellFed: { aura: 'Well Fed', kind: 'buff_sta', value: 4, duration: 600 },
  },
  evergarden_braised_greens: {
    id: 'evergarden_braised_greens',
    name: 'Evergarden Braised Greens',
    kind: 'food',
    quality: 'rare',
    foodHp: 980,
    sellValue: 150,
    wellFed: { aura: 'Well Fed', kind: 'buff_sta', value: 5, duration: 600 },
  },
  // The shared feast (Phase 12, D16): the tier-4 communal showcase. NOT
  // kind 'food': using it PLACES a farm_feast world entity instead of
  // eating (src/sim/professions/feast.ts owns the whole lifecycle), and
  // each of `charges` players eats once, receiving one serving OF THE
  // CAPSTONE DISH above (`dishItemId`: the bite's eating slot points at
  // that def, so its foodHp restore and its Well Fed mint apply verbatim
  // and can never drift from the bagged dish; re-tuning the dish re-tunes
  // the feast). kind 'junk' is the tonic precedent for a crafted
  // non-equippable usable; quality 'rare' matches the tier-4 dish set, and
  // the junk-sale sweep keys on quality 'poor' so a feast can never ride
  // the bulk junk sale. No buyValue: never vendor-stocked, and it SHIPPED
  // reagent-dormant under deviation (bo) like the tier 3/4 dishes (the (ca)
  // reconciliation: the D11 seed-bootstrap ruling owned the faucet). GATE 1
  // (Phase 11e) discharged it, so the feast is completable today.
  // charges 10 and durationTicks 3600 (180s at 20 Hz) are
  // maintainer-flagged tuning, like every farming constant.
  harvest_feast: {
    id: 'harvest_feast',
    name: 'Harvest Feast',
    kind: 'junk',
    quality: 'rare',
    sellValue: 250,
    feast: {
      charges: 10,
      durationTicks: 3600,
      dishItemId: 'evergarden_braised_greens',
      // The party rung KEEPS ITS LEGACY TEMPLATE ID, which is deliberately not
      // its item id: 'farm_feast' is what shipped, what every placed entity in
      // a live realm carries, and what the render prop is registered under
      // (scripts/assets/farm_props/model.js). The three apex rungs ABOVE in this
      // file match their item ids only because they are new. Do not "tidy" this
      // to 'harvest_feast'.
      templateId: 'farm_feast',
    },
  },

  // --- Crafted alchemy ladder (alchemy) ------------------------------------
  // Trainer-taught outputs of LADDER_RECIPES (content/recipes.ts), three rungs
  // at skillReq 0/25/50, apothecary-bound at alchemist_verane. Potions reuse the
  // vendor potionHp/potionMana machinery (instant, in-combat, shared cooldown);
  // elixirs reuse the elixir_of_the_bear shape (a temporary buff_sta aura on
  // use). Every rung strictly EXCEEDS its vendor-tier equivalent in items.ts
  // (minor/lesser/healing_potion, minor/lesser/mana_potion; #1608 retuned that
  // ladder, and the 11n vendor floor then lowered the vendor line onto the
  // 10/15/20 margin ladder BELOW this one, healing_potion 279 and mana_potion
  // 354, while these crafted ceilings stayed frozen per R5): heal <= 335,
  // mana <= 425, elixir buff_sta <= 12 for <= 900s (elixir_of_the_bear). The three
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
  // <= 12 for <= 900s), which is the point of an apex rung. VALUE 13, and
  // Phase 15 brought it there from 15. The 15 was the rare elixir's 12 plus
  // the elixir ladder's own +3 step (6 / 9 / 12), which is internally sound
  // and is also the single largest term in the R5 envelope: the flask is the
  // one always-on consumable, it is the first offensive consumable the game
  // has ever had (every pre-packet elixir and scroll is stamina), and its
  // whole magnitude lands as new throughput with nothing to net it off. The
  // measured pass (docs/prd/masterwrought/power-verification.md) put the full
  // kit outside the 5 percent envelope on the highest-throughput physical
  // spec with the flask at 15, and inside it at 13, so the value is
  // ENVELOPE-DERIVED rather than ladder-derived: R5 is the contract and the
  // packet's own record names flask 15 as the first tune-down knob. 13 is
  // still strictly above the elixir ceiling of 12, which is what keeps the
  // apex rung a rung. DURATION is untouched:
  // 1200 is the serpent's 900 plus the ladder's ONE non-zero duration step
  // (600 / 900 / 900: +300, then flat; a strictly-flat reading would give 900,
  // rejected in the phase 10 ledger, and the classic 2x-elixir ratio would give
  // 1800, so 1200 is the conservative rung). sellValue 25 continues the elixir
  // curve (10/15/20) by its +5 step. Never vendor-stocked (no buyValue). The
  // three aura display names are localized client-side through the sim_i18n
  // aura matcher (AURA_NAME_KEY), the same path as 'Might of the Serpent'.
  ironhusk_flask: {
    id: 'ironhusk_flask',
    name: 'Ironhusk Flask',
    kind: 'flask',
    quality: 'epic',
    elixir: { aura: 'Ironhusk Vigor', kind: 'buff_sta', value: 13, duration: 1200 },
    sellValue: 25,
  },
  warboar_flask: {
    id: 'warboar_flask',
    name: 'Warboar Flask',
    kind: 'flask',
    quality: 'epic',
    elixir: { aura: 'Warboar Might', kind: 'buff_ap', value: 13, duration: 1200 },
    sellValue: 25,
  },
  runewater_flask: {
    id: 'runewater_flask',
    name: 'Runewater Flask',
    kind: 'flask',
    quality: 'epic',
    elixir: { aura: 'Runewater Clarity', kind: 'buff_int', value: 13, duration: 1200 },
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
  // budget formula (src/sim/item_budget.ts) at their authoring-time item
  // levels; since masterwrought Phase 11o the rare rung-50 pieces keep those
  // ilvl-23 budgets over a level-15 recipe (see the LADDER_RECIPES
  // amendment). Never vendor-stocked (no
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
  // (src/sim/item_budget.ts, held line 0.75) at their authoring-time item
  // levels; since masterwrought Phase 11o the rare rung-50 grimoire keeps its
  // ilvl-23 budget over a level-15 recipe (see the LADDER_RECIPES amendment).
  // Zero combat ratings per ruling
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
  // The orange promotion's writ (Masterwrought phase 13, R3/R13): inscription's
  // first 125-rung output (recipe_deed_of_making), consumed 1:1 by the
  // legendary promotion of an already-Perfected apex copy
  // (professions/perfecting.ts LEGENDARY_PROMOTION_COST). A consumable
  // document, never gear: no slot, no stats, never masterwrought. Of the
  // perfecting-bill family it takes the TRADABLE arm (the wyrmfall_core
  // shape: 'junk' reuse, quality above poor so sellAllJunk never touches it),
  // not the soulbound token arm, because an inscriptionist scribes it FOR the
  // promoter; soulbound would dead-end the design. Price basis: input 553 on
  // the sibling recipes' buyValue basis (buyValue where one exists, else
  // sellValue) vs output 50 (the recipe row spells the arithmetic).
  deed_of_making: {
    id: 'deed_of_making',
    name: 'Deed of Making',
    kind: 'junk',
    quality: 'rare',
    stackSize: 20,
    sellValue: 50,
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
    // HASTE, not Hit, and Phase 15 moved it here: hit converts at twice the
    // rate of the other two ratings (HIT_RATING_PER_PCT 10 vs 20, types.ts),
    // so a 40-rating Hit piece is worth 4 percent where a 40-rating crit or
    // haste piece is worth 2. This def is a byte-identical stat and armor
    // clone of the caster BiS chest shroud_of_the_gravewyrm, whose only
    // difference was that it took the double-value rating, and caster chest
    // Hit had ZERO pre-packet carriers, so it was the sole source of the
    // scarcest rating in the largest-budget slot: the Lionheart shape the
    // packet's own research names. Measured at an S-rift target (level 23,
    // where spell hit is uncapped) that was worth 2.8 to 4.1 percent of
    // throughput from one slot against an R5 budget of 5 percent for the
    // whole kit. Against the level-22 heroic target the same piece is close to
    // a wash rather than an outlier: a raid-BiS caster carries 160 hit rating
    // and sits at 98 percent effective spell hit, so min(1, ...) clamps half a
    // further 40 hit away and the hit line reads 2.04 percent against haste's
    // 2.00. Fixing BOTH target levels is what made the outlier visible.
    // Haste still COMPLEMENTS the reference drop's crit, so the rule the other
    // eight follow is untouched; the nine WEARABLE apex armour pieces now hand
    // out no Hit at all, which is the conservative side of the band. The apex
    // SHIELD (duskforged_bulwark) keeps its reference's Hit at 20, which is the
    // held-and-shield family's band and a threat stat, not a caster one.
    hasteRating: 40,
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

  // --- Engineering on-ramp (masterwrought Phase 11o, qr-11o-ENG) -----------
  // The skill-0 part and the skill-25 gadget that make engineering levelable
  // from zero (ENGINEERING_ONRAMP_RECIPES in content/recipes.ts carries the
  // full derivation). The part follows the intermediates materials doctrine
  // above (kind 'junk', quality 'common', sellValue only, ordinary tradable);
  // tier 0 in professions/material_tier.ts by omission, on purpose, so the
  // chassis bill it joins keeps its masterwork material bonus unchanged.
  cogwheel_blank: {
    id: 'cogwheel_blank',
    name: 'Cogwheel Blank',
    kind: 'junk',
    quality: 'common',
    sellValue: 18,
  },
  // Engineering's own held-lens identity one register below gyrelens_array:
  // pure stats on the formula at the rung-25 convention (level 15 + uncommon
  // bonus 1 = ilvl 16; held line 0.75: int:3+sta:2 = 5), no use field, no
  // ratings (masterwrought R14), no vendor twin (masterwrought R23; no vendor
  // sells any held_offhand). Caster lock per the wraithfire_orb gate.
  copperlens_ocular: {
    id: 'copperlens_ocular',
    name: 'Copperlens Ocular',
    kind: 'held_offhand',
    slot: 'offhand',
    quality: 'uncommon',
    stats: { int: 3, sta: 2 },
    sellValue: 36,
    requiredClass: ['mage', 'priest', 'warlock', 'shaman', 'paladin', 'druid'],
  },
};
