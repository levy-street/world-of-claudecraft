// Item id -> weapon variant key. The SINGLE source of truth shared by the 2D bag
// icon (src/ui/icons.ts, rendered as /ui/weapons/<key>.jpg) and the 3D held model
// (src/render/characters/manifest.ts, attached as models/weapons/<key>.glb), so a
// weapon's in-hand model always matches its inventory icon.
//
// Pure data, no imports, no DOM: safe to import from both the ui icon layer and
// the render character layer (and from node unit tests). Add a weapon here once
// and both surfaces pick it up. Keys are the rendered art set in public/ui/weapons/
// and public/models/weapons/. Weapons are spread across the available models for
// variety; art is limited so daggers/maces still share a model across a few items.
export const ITEM_WEAPON_VARIANTS: Record<string, string> = {
  // ---- swords (sword_a..g + the adv set; legendary/epic kept distinct) --------
  worn_sword: 'sword_a',
  eastbrook_arming_sword: 'sword_b',
  ironedge_longsword: 'sword_b', // crafted (weaponcrafting tier 2)
  thorium_warblade: 'adv_sword_1handed', // crafted; warblades share adv_sword_1handed
  gravecaller_blade: 'sword_c',
  emberfang_warblade: 'sword_c',
  redbrook_blade: 'sword_d',
  crossroads_saber: 'sword_d',
  mistcallers_edge: 'sword_e',
  zealotsbane_blade: 'sword_e',
  kingsbane_last_oath: 'sword_f', // LEGENDARY: the flaming blade (exclusive)
  valeborn_spellblade: 'sword_g', // crystalline
  maldrecs_soulbinder: 'sword_g',
  highwatch_warblade: 'adv_sword_1handed',
  eastbrook_greatsword: 'adv_sword_2handed',
  highwatch_greatsword: 'adv_sword_2handed',
  verlans_oathblade: 'adv_sword_2handed',
  moonscale_saber: 'adv_sword_2handed',
  wyrmfang_greatblade: 'adv_sword_2handed_color', // EPIC: gold greatblade
  deathless_greatblade: 'adv_sword_2handed_color', // EPIC: Heroic Nythraxis greatblade
  final_argument_greatblade: 'adv_sword_2handed_color', // WARFARE Strength main hand
  bonewrought_greatsword: 'adv_sword_2handed_color', // EPIC: Nythraxis raid 2H
  direfang_greatblade: 'adv_sword_2handed_color', // EPIC: Nythraxis hunter 2H

  // ---- daggers (only 4 models for ~21 daggers; spread as evenly as art allows)-
  rusty_dagger: 'dagger_a',
  vale_carving_knife: 'dagger_a',
  mirefen_skinner: 'dagger_a',
  ironvein_pickblade: 'dagger_a',
  caravan_warden_dirk: 'dagger_a',
  icevein_dirk: 'dagger_b',
  keen_dirk: 'dagger_b',
  whetted_iron_dirk: 'dagger_b', // crafted; dirks share dagger_b
  mistbinder_kris: 'dagger_b',
  mirejaw_biteblade: 'dagger_b',
  cultist_flayer: 'dagger_b',
  tideglass_dirk: 'dagger_b',
  moggers_shiv: 'dagger_c',
  widowfang_dirk: 'dagger_c',
  nhalias_dirgeblade: 'dagger_c',
  riptide_dirk: 'dagger_c',
  gutripper_shiv: 'dagger_c',
  fang_of_korzul: 'dagger_c',
  gravewardens_shiv: 'adv_dagger',
  drownedmoon_kris: 'adv_dagger',
  sloomtooth_tidefang: 'adv_dagger',
  skullsplitter_dirk: 'adv_dagger',
  first_blood_razor: 'adv_dagger', // WARFARE Agility main hand
  mirejaw_fang_knife: 'dagger_a', // knives share dagger_a (vale_carving_knife)
  drowned_choir_fang: 'dagger_c', // fangs share dagger_c (fang_of_korzul)
  mistcallers_fang: 'adv_dagger', // EPIC: Heroic Vael dagger

  // ---- staves (staff_a..d + adv_staff + adv_druid_staff) ----------------------
  gnarled_staff: 'staff_a',
  hickory_shortstaff: 'staff_a',
  fenreed_staff: 'staff_a',
  craghorn_staff: 'staff_b',
  apprentice_staff: 'staff_b',
  staff_of_drowned_prayers: 'staff_b',
  gravecaller_staff: 'staff_c', // "Staff of the Hollow"
  mirejaw_oracle_staff: 'staff_c',
  hollow_vigil_staff: 'staff_c',
  emberwood_staff: 'staff_d',
  ironvein_lantern_staff: 'staff_d',
  elderwood_battle_staff: 'staff_d', // crafted (weaponcrafting tier 3)
  staff_of_velkhar: 'staff_d',
  vaels_mist_staff: 'adv_staff',
  ogre_bonecharm_staff: 'adv_staff',
  staff_of_the_gravewyrm: 'adv_druid_staff',
  deathless_heartwood: 'adv_druid_staff', // LEGENDARY druid relic (antler staff)
  drovers_staff: 'adv_druid_staff',
  emberglass_warstaff: 'adv_staff', // WARFARE caster main hand
  lunar_tide_greatstaff: 'adv_staff', // EPIC: Heroic Ysolei staff

  // ---- wands (1H caster: scepters / rods / foci) ------------------------------
  drowned_tide_scepter: 'wand_a',
  drownedmoon_scepter: 'wand_b',
  palecoil_rod: 'adv_wand',
  corpse_candle_focus: 'wand_a',
  nhalias_litany_rod: 'wand_b',
  stormcallers_focus: 'wand_b', // EPIC: Nythraxis raid caster focus
  scepter_of_the_deathless_court: 'adv_wand', // EPIC: Nythraxis raid scepter

  // ---- maces (only 4 hammer models for ~9 maces) -----------------------------
  training_mace: 'hammer_a',
  bronzework_mace: 'hammer_a',
  copper_flanged_mace: 'hammer_a', // crafted (weaponcrafting tier 1)
  moggers_copper_cudgel: 'hammer_b',
  crag_warden_cudgel: 'hammer_b',
  voss_sanctified_mace: 'hammer_c',
  bogiron_mace: 'hammer_c',
  bristleback_maul: 'hammer_d',
  brutoks_maul: 'hammer_d',
  drownedmoon_maul: 'hammer_d',
  nhalias_bell_maul: 'hammer_d', // mauls share hammer_d
  ironshod_maul: 'hammer_d', // crafted 2H maul

  // ---- axes (axe_a..d + adv axes) --------------------------------------------
  rusty_hatchet: 'axe_a',
  copper_bearded_axe: 'axe_a', // crafted (weaponcrafting tier 1)
  drogmars_skullcleaver: 'axe_b',
  deacons_cleaver: 'axe_c',
  gorraks_cruel_chopper: 'axe_d',
  arcanite_war_axe: 'axe_d', // crafted (weaponcrafting tier 3)
  gorraks_cleaver: 'adv_axe_1handed',
  tradesman_hatchet: 'adv_axe_1handed',
  gravewyrm_cleaver: 'adv_axe_1handed', // EPIC: Heroic Korzul axe
  tunnelkings_spade: 'adv_axe_2handed',

  // ---- polearms --------------------------------------------------------------
  fen_reaver_glaive: 'scythe', // "Reaver" -> reaper scythe
  tidereaver_gaff: 'spear_a', // a gaff is a hooked spear
  ironbark_boar_spear: 'spear_a', // crafted 2H spear
};
