// Item id -> held-weapon variant key. This registry selects the 3D model attached by
// src/render/characters/manifest.ts as models/weapons/<key>.glb. Inventory identity is
// deliberately independent: every authored weapon now ships bespoke painted art at
// public/ui/items/<item-id>.webp, while Heroic copies inherit their base painting.
//
// Pure data, no imports, no DOM: safe to import from both the ui icon layer and
// the render character layer (and from node unit tests). Add a base weapon here and add its
// painted item WebP in the same change. Values name both the GLBs and their legacy JPG previews
// under public/ui/weapons/, which remain useful to Armory and asset-pipeline tooling.
//
// A weapon draws the model set one rarity BELOW its own, so that looks climb with the gear
// and the best art is kept for the top tier:
//
// - Common, uncommon AND rare weapons wear the plain "field" models: ten shapes (one-hand
//   sword, greatsword `_2h`, dagger, one-hand mace `hammer_field`, maul `hammer_field_2h`,
//   axe, staff, spear, wand, plus the shield in manifest.ts ITEM_OFFHAND_MODELS) in up to
//   three painted looks, `<family>_field[_2h]_<iron|steel|bronze>`. The look only varies the
//   paint, so neighbours in a level band do not all match. The starting weapons keep their own
//   `<family>_starter` models (tests/field_weapon_models.test.ts).
// - Epic weapons wear the "rare" models: two designs per type (`_a`, `_b`; the mace's `_b` is
//   a war maul, the axe's `_b` a double-bit) in up to three painted finishes,
//   `<family>_rare_<a|b>_<teal|ember|violet>`. A finish is one-hand length or two-hand
//   length, never both (weapon_grip.ts), so a two-hander names a two-hand finish
//   (tests/rare_weapon_models.test.ts).
// - Legendary weapons wear the "epic" models: one design per named weapon line,
//   `<family>_epic_<design>_<finish>` (tests/epic_weapon_models.test.ts). The two Ignivar
//   forge legendaries keep the models made for them (`hammer_varkhul`, and the shield in
//   ITEM_OFFHAND_MODELS).
//
// Every weapon item draws one of these sets: no item draws a kit model any more.
export const ITEM_WEAPON_VARIANTS: Record<string, string> = {
  // ---- swords ------------------------------------------------------------------
  worn_sword: 'sword_starter', // the warrior's starting sword
  eastbrook_arming_sword: 'sword_field_steel',
  ironedge_longsword: 'sword_field_iron', // crafted (weaponcrafting tier 2)
  thorium_warblade: 'sword_field_steel', // crafted
  gravecaller_blade: 'sword_field_iron',
  emberfang_warblade: 'sword_field_bronze',
  redbrook_blade: 'sword_field_iron',
  crossroads_saber: 'sword_field_steel',
  mistcallers_edge: 'sword_field_steel',
  zealotsbane_blade: 'sword_field_iron',
  hoarfrost_edge: 'sword_field_steel', // rift rare 1H sword (heroic clone rides heroicOf)
  veilsteel_blade: 'sword_field_steel', // realm uncommon 1H sword
  kingsbane_last_oath: 'sword_epic_deathless_crucible_heart', // LEGENDARY: the flaming blade (exclusive)
  valeborn_spellblade: 'sword_field_steel', // crystalline
  maldrecs_soulbinder: 'sword_field_iron',
  highwatch_warblade: 'sword_field_bronze',
  duskforged_warblade: 'sword_rare_a_teal', // crafted apex 1H (masterwrought)
  riftwarden_voidblade: 'sword_rare_b_violet', // Faction vendor epic 1H sword
  eastbrook_greatsword: 'sword_field_2h_iron',
  highwatch_greatsword: 'sword_field_2h_steel',
  verlans_oathblade: 'sword_field_bronze',
  moonscale_saber: 'sword_field_steel',
  wyrmfang_greatblade: 'sword_rare_a_ember', // EPIC: gold greatblade
  deathless_greatblade: 'sword_rare_a_spectral', // EPIC: Heroic Nythraxis greatblade
  final_argument_greatblade: 'sword_rare_b_violet', // WARFARE Strength main hand
  bonewrought_greatsword: 'sword_rare_a_violet', // EPIC: Nythraxis raid 2H
  direfang_greatblade: 'sword_rare_a_violet', // EPIC: Nythraxis hunter 2H
  wildheart_tuskblade: 'sword_rare_a_ivory',
  greatfang_of_the_basin: 'sword_rare_a_jade', // EPIC: Heroic Zulgar 2H

  // ---- daggers -----------------------------------------------------------------
  rusty_dagger: 'dagger_starter', // the rogue's starting daggers
  vale_carving_knife: 'dagger_field_steel',
  mirefen_skinner: 'dagger_field_bronze',
  ironvein_pickblade: 'dagger_field_iron',
  caravan_warden_dirk: 'dagger_field_bronze',
  icevein_dirk: 'dagger_field_iron',
  keen_dirk: 'dagger_field_steel',
  whetted_iron_dirk: 'dagger_field_iron', // crafted
  mistbinder_kris: 'dagger_field_steel',
  mirejaw_biteblade: 'dagger_field_bronze',
  cultist_flayer: 'dagger_field_iron',
  tideglass_dirk: 'dagger_field_bronze',
  duskfang_dirk: 'dagger_field_steel', // realm uncommon dirk
  moggers_shiv: 'dagger_field_bronze',
  widowfang_dirk: 'dagger_field_iron',
  nhalias_dirgeblade: 'dagger_field_steel',
  riptide_dirk: 'dagger_field_steel',
  gutripper_shiv: 'dagger_field_bronze',
  fang_of_korzul: 'dagger_rare_b_violet',
  gravewardens_shiv: 'dagger_field_iron',
  drownedmoon_kris: 'dagger_field_iron',
  sloomtooth_tidefang: 'dagger_field_steel',
  skullsplitter_dirk: 'dagger_field_bronze',
  first_blood_razor: 'dagger_rare_a_ember', // WARFARE Agility main hand
  mirejaw_fang_knife: 'dagger_field_iron',
  drowned_choir_fang: 'dagger_field_iron',
  mistcallers_fang: 'dagger_rare_b_teal', // EPIC: Heroic Vael dagger
  wildheart_fangknife: 'dagger_rare_b_ember',
  voidsong_dirk: 'dagger_epic_dragonfang_ivory_violet', // LEGENDARY: the S-rift caster dirk
  // The rogue epics and a rare
  rimefang: 'dagger_rare_a_frost', // EPIC: Rift frost dagger
  marrowpoint: 'dagger_rare_a_bone', // EPIC: Cindraleth (Drakelands) bone dagger
  duskwhisper: 'dagger_rare_a_violet', // EPIC: Wildheart Beastmaster shadow dagger
  // heroic_duskwhisper inherits the base variant via heroicOf (auto-generated);
  // it must NOT have its own entry here (held_weapon_models pins that).
  boneglass_shiv: 'dagger_field_steel', // RARE: Basin Lv17-19 filler

  // ---- staves ------------------------------------------------------------------
  gnarled_staff: 'staff_starter', // the casters' starting staff
  hickory_shortstaff: 'staff_field_steel',
  fenreed_staff: 'staff_field_bronze',
  craghorn_staff: 'staff_field_iron',
  apprentice_staff: 'staff_field_steel',
  staff_of_drowned_prayers: 'staff_field_steel',
  gravecaller_staff: 'staff_field_iron', // "Staff of the Hollow"
  mirejaw_oracle_staff: 'staff_field_steel',
  hollow_vigil_staff: 'staff_field_iron',
  emberwood_staff: 'staff_field_bronze',
  ironvein_lantern_staff: 'staff_field_iron',
  elderwood_battle_staff: 'staff_field_bronze', // crafted (weaponcrafting tier 3)
  staff_of_velkhar: 'staff_field_iron',
  vaels_mist_staff: 'staff_field_steel',
  ogre_bonecharm_staff: 'staff_field_bronze',
  briarroot_staff: 'staff_field_bronze', // feral ladder, zone-1 rung
  cragthorn_greatstaff: 'staff_field_iron', // feral ladder, zone-3 rung
  nightfangs_greatstaff: 'staff_rare_b_violet', // feral ladder, Korzul epic rung
  gleamwood_stave: 'staff_field_steel', // realm uncommon caster stave (apprentice-tier)
  staff_of_the_gravewyrm: 'staff_rare_a_teal',
  deathless_heartwood: 'staff_epic_hexwood_basin_turquoise', // LEGENDARY druid relic (antler staff)
  drovers_staff: 'staff_field_iron',
  emberglass_warstaff: 'staff_rare_a_obsidian', // WARFARE caster main hand
  lunar_tide_greatstaff: 'staff_rare_a_violet', // EPIC: Heroic Ysolei staff
  wildheart_hexwood_staff: 'staff_rare_b_ember',

  // ---- wands (1H caster rods and foci) -----------------------------------------
  drowned_tide_scepter: 'wand_field_steel',
  drownedmoon_scepter: 'wand_field_iron',
  palecoil_rod: 'wand_field_iron',
  corpse_candle_focus: 'wand_field_steel',
  nhalias_litany_rod: 'wand_field_iron',
  stormcallers_focus: 'wand_rare_a_teal', // EPIC: Nythraxis raid caster focus
  scepter_of_the_deathless_court: 'wand_rare_b_violet', // EPIC: Nythraxis raid scepter

  // ---- maces -------------------------------------------------------------------
  training_mace: 'hammer_starter', // the paladin's and shaman's starting mace
  bronzework_mace: 'hammer_field_bronze',
  copper_flanged_mace: 'hammer_field_bronze', // crafted (weaponcrafting tier 1)
  moggers_copper_cudgel: 'hammer_field_bronze',
  crag_warden_cudgel: 'hammer_field_steel',
  voss_sanctified_mace: 'hammer_field_bronze',
  bogiron_mace: 'hammer_field_iron',
  dawnkeeper_consecrated_mace: 'hammer_rare_a_ember', // Faction vendor epic mace
  bristleback_maul: 'hammer_field_steel',
  brutoks_maul: 'hammer_field_bronze',
  drownedmoon_maul: 'hammer_field_steel',
  nhalias_bell_maul: 'hammer_field_steel',
  ironshod_maul: 'hammer_field_2h_iron', // crafted 2H maul
  fenshadow_maul: 'hammer_field_2h_steel', // feral ladder maul
  gravewyrm_thornmaul: 'hammer_field_2h_iron', // feral ladder maul
  maul_of_the_scourged_wilds: 'hammer_rare_b_violet', // feral ladder, Nythraxis raid rung
  wildsoul_maul: 'hammer_rare_b_teal', // feral ladder, heroic-only ilvl 31 rung
  ridgebreaker: 'hammer_rare_b_violet', // crafted apex 2H maul (masterwrought)
  // The Mirefen world boss's signature drop, on its own bespoke model.
  foremans_barrowmaul: 'balgath_barrowmaul_hammer',
  // Balgath's caster spoil, on its own bespoke model (scripts/assets/craterglass_stave/).
  craterglass_stave: 'craterglass_stave',
  varkhul_forgebreaker: 'hammer_varkhul', // LEGENDARY: Ignivar raid (animated engine maul)

  // ---- axes --------------------------------------------------------------------
  rusty_hatchet: 'axe_starter', // the hunter's starting hatchet
  copper_bearded_axe: 'axe_field_bronze', // crafted (weaponcrafting tier 1)
  drogmars_skullcleaver: 'axe_field_bronze',
  deacons_cleaver: 'axe_field_iron',
  gorraks_cruel_chopper: 'axe_field_bronze',
  arcanite_war_axe: 'axe_field_steel', // crafted (weaponcrafting tier 3)
  gorraks_cleaver: 'axe_field_steel',
  tradesman_hatchet: 'axe_field_bronze',
  forgemaster_crag_cleaver: 'axe_rare_b_ember', // Faction vendor epic two-handed axe
  gravewyrm_cleaver: 'axe_rare_a_teal', // EPIC: Heroic Korzul axe
  // Nythraxis gap-fill one-handers (content/zone3.ts). Their inventory icons are
  // in-engine stills of the models they first drew
  // (scripts/render_weapon_still_icons.mjs over the jobs table in
  // docs/achievements/nythraxis-gap-weapon-renders-2026-09-04/).
  courtiers_bonefang: 'dagger_rare_b_teal',
  thornpeak_wardblade: 'sword_rare_b_teal',
  gravecourt_hewer: 'axe_rare_a_violet',
  pitlords_cleaver: 'axe_field_iron', // rift rare cleaver (heroic clone rides heroicOf)
  tunnelkings_spade: 'axe_field_iron',

  // ---- polearms (the field spear) ----------------------------------------------
  fen_reaver_glaive: 'spear_field_iron',
  tidereaver_gaff: 'spear_field_iron',
  ironbark_boar_spear: 'spear_field_iron', // crafted 2H spear
  fanglords_beastspear: 'spear_field_iron', // RARE: the basin Beastmaster's boar spear

  // ---- The Sunken Bastion rework (sunken_bastion_items.ts) ------------------
  knight_commanders_longsword: 'sword_field_steel',
  gaolyard_cudgel: 'hammer_field_steel', // an iron-banded club reads as the plain mace

  // ---- The Drowned Temple rework (drowned_temple_items.ts) -------------------
  tideglass_shiv: 'dagger_field_bronze', // slim shiv; the Tideglass Dirk already rides dagger_b
  tideglass_warmaul: 'hammer_rare_a_teal', // heroic epic maul (heroic clones ride heroicOf)

  // ---- The Wildheart Basin rework (wildheart_items.ts) -----------------------
  // Held model reuses a shipped GLB (the heroic clone rides heroicOf).
  falls_blessed_staff: 'staff_field_iron', // a gnarled, vine-wound staff of the falls

  // ---- The Hollow Crypt rework (hollow_crypt_items.ts) -------------------------
  // Held models reuse shipped GLBs (the heroic clones ride heroicOf). The two
  // spades classify as axes (weapon_skin_rules.ts) and hold the two-handed axe
  // model like the Tunnelking's Spade; the fang rides dagger_c with the other
  // fangs (fang_of_korzul, drowned_choir_fang).
  // v0.45.0 integration: the five-dungeon rework's weapons moved off the KayKit models
  // the character pack retired, onto pack finishes by type, quality and hand (placeholder
  // picks pending the pack owner's pass).
  sextons_spadehaft: 'axe_field_iron',
  sextons_burial_spade: 'axe_rare_b_ember', // heroic epic: the Gravecaller's burial spade
  rimeweb_fang: 'dagger_field_steel',

  // ---- The Gravewyrm Sanctum rework (gravewyrm_sanctum_items.ts) --------------
  // Held model reuses a shipped GLB.
  hammer_of_the_open_lock: 'hammer_rare_b_violet', // heroic epic: the Smith's forge hammer

  // ---- The lower dungeons' normal blues (hollow_crypt_items.ts,
  // sunken_bastion_items.ts, drowned_temple_items.ts) ---------------------------
  // Held models reuse shipped GLBs (the heroic clones ride heroicOf).
  gravecallers_rod: 'wand_field_steel', // Morthen's rite rod, the Corpse Candle Focus's wand
  turnkeys_shank: 'dagger_field_iron', // a gaol shank rides the shiv model
  fogbinders_rod: 'wand_field_iron', // Vael's fog rod
  merecleaver: 'axe_field_steel', // the Mere Hydra's two-hand axe
  moonwrack_stave: 'staff_field_steel', // Ysolei's stave, the Lunar Tide Greatstaff's model

  // ---- Crucible of the Last Spring raid weapons (ignivar_loot.ts) -------------
  // Held models reuse shipped GLBs.
  forgefathers_warhammer: 'hammer_rare_b_ember',
  springtouched_crozier: 'hammer_rare_a_teal',
  cinderfang_kris: 'dagger_rare_b_ember',
  slagrender_cleaver: 'axe_rare_a_ember',
  anvilguard_blade: 'sword_rare_a_anvil',
  heart_of_the_end_greatblade: 'sword_rare_a_molten',
  staff_of_the_last_spring: 'staff_rare_b_teal',
  forgefire_spire: 'staff_rare_a_ember',
  wand_of_quenched_sparks: 'wand_rare_b_ember',
  // Skerrit's Shardpike: a socketwright's gem-setting tool, not a soldier's spear, so it
  // gets its own model rather than borrowing spear_a. Unmapped it fell through to the
  // class default attach, which meant the quest tool the Mirefen world boss's whole
  // level-spread mechanic runs on was drawn as a plain sword.
  skerrits_shardpike: 'shardpike_spear',
  // The muster's lent copy off the command camp's rack: the same pike in the same hands.
  muster_shardpike: 'shardpike_spear',

  // ---- Warfare Season 2 honor weapons (pvp_honor_season2.ts) ------------------
  // Held models reuse shipped GLBs.
  vanguard_verdict_greatsword: 'sword_rare_a_royal',
  vanguard_oath_blade: 'sword_rare_b_ember',
  vanguard_fang_dagger: 'dagger_rare_a_teal',
  vanguard_warstaff: 'staff_rare_a_teal',
};
