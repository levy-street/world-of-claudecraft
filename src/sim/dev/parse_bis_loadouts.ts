// Real level-20 loadouts observed on the strongest available Nythraxis kill
// parses for every spec. The developer BIS command consumes this frozen snapshot
// instead of guessing from a one-number item score.
//
// Selection order: build 0.40.1 before older builds, Heroic before Normal, zero
// deaths, and at least 11 equipped slots. Damage specs rank by DPS, healers by
// HPS, and tanks by survived DTPS so the selected character was actually taking
// the boss. Four specs without a complete 0.40.1 raid sample use the newest
// complete historical Nythraxis top parse. No character identity is retained.

import type { EquipSlot, PlayerClass } from '../types';

export const PARSE_BIS_SOURCE = Object.freeze({
  endpoint: 'https://parses.worldofclaudecraft.com/api/rankings',
  encounter: 'nythraxis_boss_arena',
  preferredBuild: '0.40.1',
  capturedOn: '2026-08-27',
});

type ParseGear = Readonly<Partial<Record<EquipSlot, string>>>;
type ClassParseGear = Readonly<Record<string, ParseGear>>;

const LOADOUTS: Readonly<Record<PlayerClass, ClassParseGear>> = Object.freeze({
  warrior: Object.freeze({
    // Heroic DPS rank 1, build 0.38.2, fight 19300.
    arms: Object.freeze({
      feet: 'tideworn_warboots',
      legs: 'bloodmane_war_legguards',
      neck: 'medallion_of_endless_profit',
      chest: 'heroic_boneguard_breastplate',
      ring1: 'sutils_gambit',
      ring2: 'sutils_gambit',
      waist: 'gravescale_girdle',
      gloves: 'crownforged_gauntlets',
      helmet: 'heroic_crownforged_dreadhelm',
      mainhand: 'deathless_greatblade',
      shoulder: 'crownforged_warspaulders',
    }),
    // Heroic DPS rank 1, build 0.40.1, fight 51578.
    fury: Object.freeze({
      feet: 'deathlord_sabatons',
      legs: 'deathlord_legguards',
      neck: 'medallion_of_endless_profit',
      chest: 'deathlord_warplate',
      ring1: 'seal_of_the_nine_oaths',
      ring2: 'seal_of_the_nine_oaths',
      waist: 'crownforged_girdle',
      gloves: 'crownforged_gauntlets',
      helmet: 'heroic_crownforged_dreadhelm',
      offhand: 'deathless_greatblade',
      mainhand: 'deathless_greatblade',
      shoulder: 'heroic_crownforged_warspaulders',
    }),
    // Heroic DTPS rank 1, build 0.40.1, fight 51084.
    prot: Object.freeze({
      feet: 'deathlord_sabatons',
      legs: 'deathlord_legguards',
      neck: 'medallion_of_endless_profit',
      chest: 'deathlord_warplate',
      ring1: 'riftbound_band_of_might',
      ring2: 'riftbound_band_of_might',
      waist: 'crownforged_girdle',
      gloves: 'crownforged_gauntlets',
      helmet: 'heroic_crownforged_dreadhelm',
      offhand: 'heroic_bonewrought_bulwark',
      mainhand: 'heroic_kingsbane_last_oath',
      shoulder: 'heroic_crownforged_warspaulders',
    }),
  }),
  paladin: Object.freeze({
    // Heroic HPS rank 2, build 0.40.1, fight 51621. Rank 1 was incomplete.
    holy: Object.freeze({
      feet: 'necromancers_soulsteps',
      legs: 'necromancers_legwraps',
      neck: 'zense_meridian',
      chest: 'necromancers_starshroud',
      ring1: 'architects_cornerstone',
      ring2: 'architects_cornerstone',
      waist: 'stormcallers_waistguard',
      gloves: 'stormcallers_handguards',
      helmet: 'heroic_stormcallers_crown',
      offhand: 'wraithfire_orb',
      mainhand: 'stormcallers_focus',
      shoulder: 'necromancers_soulspire_mantle',
    }),
    // Heroic DTPS rank 1, build 0.40.1, fight 51621.
    protection: Object.freeze({
      feet: 'deathlord_sabatons',
      legs: 'heroic_deathlord_legguards',
      neck: 'medallion_of_endless_profit',
      chest: 'heroic_deathlord_warplate',
      ring1: 'riftbound_band_of_might',
      ring2: 'riftbound_band_of_might',
      waist: 'crownforged_girdle',
      gloves: 'crownforged_gauntlets',
      helmet: 'heroic_crownforged_dreadhelm',
      offhand: 'heroic_bonewrought_bulwark',
      mainhand: 'heroic_kingsbane_last_oath',
      shoulder: 'heroic_crownforged_warspaulders',
    }),
    // Strongest complete Heroic DPS loadout, build 0.40.1, fight 52058.
    retribution: Object.freeze({
      feet: 'deathlord_sabatons',
      legs: 'deathlord_legguards',
      neck: 'medallion_of_endless_profit',
      chest: 'deathlord_warplate',
      ring1: 'seal_of_the_nine_oaths',
      ring2: 'seal_of_the_nine_oaths',
      waist: 'crownforged_girdle',
      gloves: 'crownforged_gauntlets',
      helmet: 'heroic_crownforged_dreadhelm',
      mainhand: 'deathless_greatblade',
      shoulder: 'heroic_crownforged_warspaulders',
    }),
  }),
  hunter: Object.freeze({
    // Heroic DPS rank 1, build 0.40.1, fight 51177.
    beast_mastery: Object.freeze({
      feet: 'wyrmshadow_treads',
      legs: 'wyrmshadow_legguards',
      neck: 'yumis_keepsake_locket',
      chest: 'heroic_wyrmshadow_harness',
      ring1: 'sutils_gambit',
      ring2: 'sutils_gambit',
      waist: 'nighttalon_waistband',
      gloves: 'wyrmshadow_talongrips',
      helmet: 'heroic_nighttalon_crown',
      offhand: 'heroic_direfang_quiver',
      mainhand: 'heroic_kingsbane_last_oath',
      shoulder: 'heroic_nighttalon_shoulderguards',
    }),
    // Heroic DPS rank 1, build 0.40.1, fight 51084.
    marksmanship: Object.freeze({
      feet: 'heroic_wyrmshadow_treads',
      legs: 'wyrmshadow_legguards',
      neck: 'yumis_keepsake_locket',
      chest: 'heroic_wyrmshadow_harness',
      ring1: 'riftbound_band_of_guile',
      ring2: 'sutils_gambit',
      waist: 'nighttalon_waistband',
      gloves: 'wyrmshadow_talongrips',
      helmet: 'heroic_nighttalon_crown',
      offhand: 'direfang_quiver',
      mainhand: 'heroic_direfang_greatblade',
      shoulder: 'heroic_nighttalon_shoulderguards',
    }),
    // Heroic DPS rank 1, build 0.40.1, fight 50156.
    survival: Object.freeze({
      feet: 'wyrmshadow_treads',
      legs: 'wyrmshadow_legguards',
      neck: 'yumis_keepsake_locket',
      chest: 'wyrmshadow_harness',
      ring1: 'nielas_coldlight_band',
      ring2: 'nielas_coldlight_band',
      waist: 'nighttalon_waistband',
      gloves: 'nighttalon_grips',
      helmet: 'heroic_nighttalon_crown',
      offhand: 'heroic_direfang_quiver',
      mainhand: 'heroic_direfang_greatblade',
      shoulder: 'heroic_nighttalon_shoulderguards',
    }),
  }),
  rogue: Object.freeze({
    // Heroic DPS rank 1, build 0.40.1, fight 51152.
    assassination: Object.freeze({
      feet: 'wyrmshadow_treads',
      legs: 'wyrmshadow_legguards',
      neck: 'swiftfang_talisman',
      chest: 'wyrmshadow_harness',
      ring1: 'sutils_gambit',
      ring2: 'sutils_gambit',
      waist: 'nighttalon_waistband',
      gloves: 'nighttalon_grips',
      helmet: 'heroic_nighttalon_crown',
      offhand: 'heroic_duskwhisper',
      mainhand: 'heroic_duskwhisper',
      shoulder: 'heroic_nighttalon_shoulderguards',
    }),
    // Heroic DPS rank 1, build 0.40.1, fight 51162.
    combat: Object.freeze({
      feet: 'heroic_wyrmshadow_treads',
      legs: 'heroic_wyrmshadow_legguards',
      neck: 'swiftfang_talisman',
      chest: 'heroic_wyrmshadow_harness',
      ring1: 'sutils_gambit',
      ring2: 'sutils_gambit',
      waist: 'nighttalon_waistband',
      gloves: 'heroic_wyrmshadow_talongrips',
      helmet: 'heroic_nighttalon_crown',
      offhand: 'heroic_duskwhisper',
      mainhand: 'kingsbane_last_oath',
      shoulder: 'heroic_nighttalon_shoulderguards',
    }),
    // Heroic DPS rank 1, build 0.40.1, fight 51621.
    subtlety: Object.freeze({
      feet: 'wyrmshadow_treads',
      legs: 'wyrmshadow_legguards',
      neck: 'swiftfang_talisman',
      chest: 'wyrmshadow_harness',
      ring1: 'sutils_gambit',
      ring2: 'sutils_gambit',
      waist: 'nighttalon_waistband',
      gloves: 'wyrmshadow_talongrips',
      helmet: 'heroic_nighttalon_crown',
      offhand: 'heroic_duskwhisper',
      mainhand: 'heroic_duskwhisper',
      shoulder: 'heroic_nighttalon_shoulderguards',
    }),
  }),
  priest: Object.freeze({
    // Heroic HPS rank 1, build 0.39.1, fight 34968.
    discipline: Object.freeze({
      feet: 'necromancers_soulsteps',
      legs: 'necromancers_legwraps',
      neck: 'zense_meridian',
      chest: 'necromancers_starshroud',
      ring1: 'nielas_coldlight_band',
      ring2: 'nielas_coldlight_band',
      waist: 'soulflame_cord',
      gloves: 'soulflame_gloves',
      helmet: 'heroic_soulflame_cowl',
      offhand: 'heroic_wraithfire_orb',
      mainhand: 'scepter_of_the_deathless_court',
      shoulder: 'heroic_necromancers_soulspire_mantle',
    }),
    // Heroic HPS rank 1, build 0.40.1, fight 51742.
    holy: Object.freeze({
      feet: 'necromancers_soulsteps',
      legs: 'necromancers_legwraps',
      neck: 'zense_meridian',
      chest: 'heroic_necromancers_starshroud',
      ring1: 'architects_cornerstone',
      ring2: 'architects_cornerstone',
      waist: 'soulflame_cord',
      gloves: 'soulflame_gloves',
      helmet: 'heroic_soulflame_cowl',
      offhand: 'heroic_wraithfire_orb',
      mainhand: 'heroic_deathless_heartwood',
      shoulder: 'heroic_soulflame_mantle',
    }),
    // Heroic DPS rank 1, build 0.40.1, fight 51551.
    shadow: Object.freeze({
      feet: 'necromancers_soulsteps',
      legs: 'necromancers_legwraps',
      neck: 'zense_meridian',
      chest: 'necromancers_starshroud',
      ring1: 'riftbound_band_of_insight',
      ring2: 'riftbound_band_of_insight',
      waist: 'soulflame_cord',
      gloves: 'soulflame_gloves',
      helmet: 'heroic_soulflame_cowl',
      offhand: 'heroic_wraithfire_orb',
      mainhand: 'deathless_heartwood',
      shoulder: 'heroic_soulflame_mantle',
    }),
  }),
  shaman: Object.freeze({
    // Heroic DPS rank 1, build 0.40.1, fight 51117.
    elemental: Object.freeze({
      feet: 'necromancers_soulsteps',
      legs: 'necromancers_legwraps',
      neck: 'zense_meridian',
      chest: 'necromancers_starshroud',
      ring1: 'architects_cornerstone',
      ring2: 'architects_cornerstone',
      waist: 'stormcallers_waistguard',
      gloves: 'stormcallers_handguards',
      helmet: 'heroic_stormcallers_crown',
      offhand: 'wraithfire_orb',
      mainhand: 'stormcallers_focus',
      shoulder: 'heroic_stormcallers_spaulders',
    }),
    // Heroic DPS rank 1, build 0.40.1, fight 51117.
    enhancement: Object.freeze({
      feet: 'deathlord_sabatons',
      legs: 'deathlord_legguards',
      neck: 'medallion_of_endless_profit',
      chest: 'deathlord_warplate',
      ring1: 'oath_of_the_round_table',
      ring2: 'oath_of_the_round_table',
      waist: 'crownforged_girdle',
      gloves: 'crownforged_gauntlets',
      helmet: 'heroic_crownforged_dreadhelm',
      offhand: 'gravewyrm_cleaver',
      mainhand: 'gravewyrm_cleaver',
      shoulder: 'heroic_crownforged_warspaulders',
    }),
    // Heroic HPS rank 1, build 0.40.1, fight 51465.
    restoration: Object.freeze({
      feet: 'necromancers_soulsteps',
      legs: 'necromancers_legwraps',
      neck: 'zense_meridian',
      chest: 'necromancers_starshroud',
      ring1: 'architects_cornerstone',
      ring2: 'architects_cornerstone',
      waist: 'stormcallers_waistguard',
      gloves: 'stormcallers_handguards',
      helmet: 'heroic_stormcallers_crown',
      offhand: 'wraithfire_orb',
      mainhand: 'stormcallers_focus',
      shoulder: 'heroic_stormcallers_spaulders',
    }),
  }),
  mage: Object.freeze({
    // Heroic HPS rank 1, build 0.39.0, fight 29902.
    arcane: Object.freeze({
      feet: 'necromancers_soulsteps',
      legs: 'necromancers_legwraps',
      neck: 'zense_meridian',
      chest: 'necromancers_starshroud',
      ring1: 'architects_cornerstone',
      ring2: 'architects_cornerstone',
      waist: 'soulflame_cord',
      gloves: 'soulflame_gloves',
      helmet: 'heroic_soulflame_cowl',
      offhand: 'heroic_wraithfire_orb',
      mainhand: 'scepter_of_the_deathless_court',
      shoulder: 'heroic_soulflame_mantle',
    }),
    // Heroic DPS rank 1, build 0.40.1, fight 51084.
    fire: Object.freeze({
      feet: 'heroic_necromancers_soulsteps',
      legs: 'necromancers_legwraps',
      neck: 'zense_meridian',
      chest: 'heroic_necromancers_starshroud',
      ring1: 'riftbound_band_of_insight',
      ring2: 'riftbound_band_of_insight',
      waist: 'soulflame_cord',
      gloves: 'soulflame_gloves',
      helmet: 'heroic_soulflame_cowl',
      offhand: 'heroic_wraithfire_orb',
      mainhand: 'scepter_of_the_deathless_court',
      shoulder: 'heroic_soulflame_mantle',
    }),
    // Normal DPS rank 1, build 0.40.1, fight 50141.
    frost: Object.freeze({
      feet: 'necromancers_soulsteps',
      legs: 'necromancers_legwraps',
      neck: 'zense_meridian',
      chest: 'necromancers_starshroud',
      ring1: 'nielas_coldlight_band',
      ring2: 'nielas_coldlight_band',
      waist: 'soulflame_cord',
      gloves: 'soulflame_gloves',
      helmet: 'heroic_soulflame_cowl',
      offhand: 'heroic_wraithfire_orb',
      mainhand: 'lunar_tide_greatstaff',
      shoulder: 'heroic_soulflame_mantle',
    }),
  }),
  warlock: Object.freeze({
    // Heroic DPS rank 1, build 0.40.1, fight 51465.
    affliction: Object.freeze({
      feet: 'necromancers_soulsteps',
      legs: 'necromancers_legwraps',
      neck: 'zense_meridian',
      chest: 'shroud_of_the_gravewyrm',
      ring1: 'nielas_coldlight_band',
      ring2: 'nielas_coldlight_band',
      waist: 'soulflame_cord',
      gloves: 'soulflame_gloves',
      helmet: 'heroic_soulflame_cowl',
      offhand: 'wraithfire_orb',
      mainhand: 'scepter_of_the_deathless_court',
      shoulder: 'heroic_soulflame_mantle',
    }),
    // Heroic DPS rank 1, build 0.38.4, fight 26790.
    demonology: Object.freeze({
      feet: 'shadowpulse_slippers',
      legs: 'necromancers_legwraps',
      neck: 'zense_meridian',
      chest: 'necromancers_starshroud',
      ring1: 'architects_cornerstone',
      ring2: 'architects_cornerstone',
      waist: 'soulflame_cord',
      gloves: 'soulflame_gloves',
      helmet: 'heroic_soulflame_cowl',
      offhand: 'valefire_lantern',
      mainhand: 'scepter_of_the_deathless_court',
      shoulder: 'heroic_soulflame_mantle',
    }),
    // Heroic DPS rank 1, build 0.40.0, fight 49652.
    destruction: Object.freeze({
      feet: 'necromancers_soulsteps',
      legs: 'necromancers_legwraps',
      neck: 'zense_meridian',
      chest: 'necromancers_starshroud',
      ring1: 'nielas_coldlight_band',
      ring2: 'nielas_coldlight_band',
      waist: 'soulflame_cord',
      gloves: 'soulflame_gloves',
      helmet: 'heroic_soulflame_cowl',
      offhand: 'heroic_wraithfire_orb',
      mainhand: 'scepter_of_the_deathless_court',
      shoulder: 'heroic_soulflame_mantle',
    }),
  }),
  druid: Object.freeze({
    // Heroic DPS rank 1, build 0.40.1, fight 51680.
    balance: Object.freeze({
      feet: 'dreamroot_boots',
      legs: 'lunar_choir_leggings',
      neck: 'zense_meridian',
      chest: 'verdant_heart_vestment',
      ring1: 'architects_cornerstone',
      ring2: 'architects_cornerstone',
      waist: 'lunarward_cinch',
      gloves: 'soulflame_gloves',
      helmet: 'heroic_soulflame_cowl',
      offhand: 'heroic_wraithfire_orb',
      mainhand: 'scepter_of_the_deathless_court',
      shoulder: 'heroic_soulflame_mantle',
    }),
    // Heroic DTPS rank 1, build 0.40.1, fight 51742.
    feral: Object.freeze({
      feet: 'wyrmshadow_treads',
      legs: 'korgaths_chainwraps',
      neck: 'medallion_of_endless_profit',
      chest: 'ashstalker_harness',
      ring1: 'oath_of_the_round_table',
      ring2: 'sutils_gambit',
      waist: 'nighttalon_waistband',
      gloves: 'nighttalon_grips',
      helmet: 'heroic_nighttalon_crown',
      offhand: 'heroic_wraithfire_orb',
      mainhand: 'first_blood_razor',
      shoulder: 'heroic_nighttalon_shoulderguards',
    }),
    // Strongest complete Heroic HPS loadout, build 0.40.1, fight 51269.
    restoration: Object.freeze({
      feet: 'necromancers_soulsteps',
      legs: 'necromancers_legwraps',
      neck: 'zense_meridian',
      chest: 'necromancers_starshroud',
      ring1: 'nielas_coldlight_band',
      ring2: 'architects_cornerstone',
      waist: 'soulflame_cord',
      gloves: 'soulflame_gloves',
      helmet: 'soulflame_cowl',
      offhand: 'heroic_wraithfire_orb',
      mainhand: 'scepter_of_the_deathless_court',
      shoulder: 'heroic_necromancers_soulspire_mantle',
    }),
  }),
});

export interface ParseBisLoadoutEntry {
  cls: PlayerClass;
  spec: string;
  gear: ParseGear;
}

export function parseBisGearFor(cls: PlayerClass, spec: string): ParseGear | null {
  const gear = LOADOUTS[cls]?.[spec];
  return gear ? { ...gear } : null;
}

export function parseBisLoadoutEntries(): readonly ParseBisLoadoutEntry[] {
  return (Object.entries(LOADOUTS) as [PlayerClass, ClassParseGear][]).flatMap(([cls, specs]) =>
    Object.entries(specs).map(([spec, gear]) => ({
      cls,
      spec,
      gear,
    })),
  );
}
