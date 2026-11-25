// Level-20 Forge-tier (Ignivar raid) best-in-slot loadouts for every spec: the
// `/dev bis forge` kit, the endgame twin of the frozen Nythraxis snapshot in
// parse_bis_loadouts.ts. Draws no rng; pure data plus two readers.
//
// How each kit was built (2026-11-25, from the public parse rankings for
// ignivar_raid_arena and ignivar_inner_crucible):
//   1. Start from the spec's strongest zero-death kill loadout (Heroic before
//      Normal, 11+ slots). Four specs with weak samples borrow the closest
//      sibling's armor, jewelry and trinket: arms from fury, marksmanship and
//      survival from beast mastery, discipline from holy priest.
//   2. The spec's own ilvl-35 tier set (never a sibling spec's) fills every armor slot it covers, and any
//      remaining pre-Forge armor or jewelry piece is upgraded to the best
//      ilvl-35 piece for the slot (damage specs never take a Healing Power
//      piece). A missing or pre-Forge trinket becomes the line's ilvl-35 one,
//      and an agility kit never keeps a Strength piece from its parse.
//   3. Every spec wields its best legendary weapon (Stonebound is the one
//      exception: dual spell-power wands, see its kit): Forgebreaker for two-hand
//      strength specs (and fury's main hand), Thronebane for tanks (beside
//      Emberward), hunters, combat rogues and enhancement, and the heroic
//      Heartwood for every caster and healer. Assassination and subtlety keep
//      a dagger main hand (their openers need one) and carry Thronebane in
//      the off hand.
//   4. Exactly two Crucible crafted pieces of the spec's own line (the
//      Masterwrought cap, and the line's two-piece bonus): casters wear chest
//      and feet, healers waist and feet, and physical specs and tanks take the
//      pair that keeps them closest to the melee hit cap (130 rating against a
//      level-22 boss), then the most set bonus tiers, then the most stats.
// Two specs carry a second kit on both tiers: feral (cat by default, plus
// bear) and enhancement (Warspirit Galeheart by default, plus Stonebound).

import type { EquipSlot, PlayerClass } from '../types';

export const FORGE_BIS_SOURCE = Object.freeze({
  endpoint: 'https://parses.worldofclaudecraft.com/api/rankings',
  encounters: ['ignivar_raid_arena', 'ignivar_inner_crucible'],
  capturedOn: '2026-11-25',
});

type ForgeGear = Readonly<Partial<Record<EquipSlot, string>>>;
type ClassForgeGear = Readonly<Record<string, ForgeGear>>;

const LOADOUTS: Readonly<Record<PlayerClass, ClassForgeGear>> = Object.freeze({
  warrior: Object.freeze({
    // Jewelry and trinket from the fury kit (the arms sample was weak), in
    // the arms Slagbreaker set. Crafted chest + feet (hit 110/130).
    arms: Object.freeze({
      mainhand: 'varkhul_forgebreaker',
      helmet: 'slagbreaker_helmet',
      neck: 'legendary_chained_ember_choker',
      shoulder: 'slagbreaker_shoulder',
      chest: 'crucible_str_mail_chest',
      waist: 'warforged_waistguard',
      legs: 'slagbreaker_legs',
      gloves: 'slagbreaker_gloves',
      feet: 'crucible_str_mail_feet',
      ring1: 'seal_of_the_forgewall',
      ring2: 'seal_of_the_forgewall',
      trinket: 'forgefathers_temper',
    }),
    // Heroic DPS parse, build 0.45.6, fight 180223.
    // Crafted chest + feet (hit 130/130, set tiers 3).
    fury: Object.freeze({
      mainhand: 'varkhul_forgebreaker',
      offhand: 'heroic_kingsbane_last_oath',
      helmet: 'emberfury_helmet',
      neck: 'legendary_chained_ember_choker',
      shoulder: 'emberfury_shoulder',
      chest: 'crucible_str_mail_chest',
      waist: 'warforged_waistguard',
      legs: 'emberfury_legs',
      gloves: 'emberfury_gloves',
      feet: 'crucible_str_mail_feet',
      ring1: 'seal_of_the_forgewall',
      ring2: 'seal_of_the_forgewall',
      trinket: 'forgefathers_temper',
    }),
    // Heroic DTPS parse, build 0.44.7, fight 173574.
    // Crafted chest + feet (hit 130/130, set tiers 3).
    prot: Object.freeze({
      mainhand: 'heroic_kingsbane_last_oath',
      offhand: 'varkhul_emberward',
      helmet: 'forgewall_helmet',
      neck: 'pendant_of_the_first_tempering',
      shoulder: 'forgewall_shoulder',
      chest: 'crucible_tank_mail_chest',
      waist: 'forgewall_girdle',
      legs: 'forgewall_legs',
      gloves: 'forgewall_gloves',
      feet: 'crucible_tank_mail_feet',
      ring1: 'seal_of_the_forgewall',
      ring2: 'seal_of_the_forgewall',
      trinket: 'heart_of_the_crucible',
    }),
  }),
  paladin: Object.freeze({
    // Heroic HPS parse, build 0.44.6, fight 162732.
    // Crafted waist + feet (healer rule).
    holy: Object.freeze({
      mainhand: 'heroic_deathless_heartwood',
      offhand: 'ember_wardens_barrier',
      helmet: 'dawnforged_helmet',
      neck: 'heartspring_amulet',
      shoulder: 'dawnforged_shoulder',
      chest: 'dawnforged_chest',
      waist: 'crucible_healer_mail_waist',
      legs: 'dawnforged_legs',
      gloves: 'dawnforged_gloves',
      feet: 'crucible_healer_mail_feet',
      ring1: 'loop_of_quiet_springs',
      ring2: 'loop_of_quiet_springs',
      trinket: 'last_flame_lantern',
    }),
    // Heroic DTPS parse, build 0.45.2, fight 178302.
    // Crafted chest + feet (hit 130/130, set tiers 3).
    protection: Object.freeze({
      mainhand: 'heroic_kingsbane_last_oath',
      offhand: 'varkhul_emberward',
      helmet: 'oathpyre_helmet',
      neck: 'pendant_of_the_first_tempering',
      shoulder: 'oathpyre_shoulder',
      chest: 'crucible_tank_mail_chest',
      waist: 'forgewall_girdle',
      legs: 'oathpyre_legs',
      gloves: 'oathpyre_gloves',
      feet: 'crucible_tank_mail_feet',
      ring1: 'seal_of_the_forgewall',
      ring2: 'seal_of_the_forgewall',
      trinket: 'heart_of_the_crucible',
    }),
    // Heroic DPS parse, build 0.45.8, fight 181325.
    // Crafted chest + feet (hit 110/130, set tiers 2).
    retribution: Object.freeze({
      mainhand: 'varkhul_forgebreaker',
      helmet: 'vanguard_paladin_retribution_helmet',
      neck: 'legendary_chained_ember_choker',
      shoulder: 'vanguard_paladin_retribution_shoulder',
      chest: 'crucible_str_mail_chest',
      waist: 'warforged_waistguard',
      legs: 'vanguard_paladin_retribution_legs',
      gloves: 'zealfire_gloves',
      feet: 'crucible_str_mail_feet',
      ring1: 'vanguard_band_of_might',
      ring2: 'vanguard_band_of_might',
      trinket: 'forgefathers_temper',
    }),
  }),
  hunter: Object.freeze({
    // Heroic DPS parse, build 0.45.6, fight 180201.
    // Crafted chest + feet (hit 130/130, set tiers 3).
    beast_mastery: Object.freeze({
      mainhand: 'heroic_kingsbane_last_oath',
      offhand: 'infernal_quiver',
      helmet: 'packlord_emberhide_helmet',
      neck: 'yumis_keepsake_locket',
      shoulder: 'packlord_emberhide_shoulder',
      chest: 'crucible_agi_leather_chest',
      waist: 'slagstalker_belt',
      legs: 'packlord_emberhide_legs',
      gloves: 'packlord_emberhide_gloves',
      feet: 'crucible_agi_leather_feet',
      ring1: 'riftbound_band_of_guile',
      ring2: 'riftbound_band_of_guile',
      trinket: 'molten_fletching',
    }),
    // Jewelry and trinket from the beast_mastery kit (the marksmanship sample
    // was weak), in the marksmanship Coldsight set. Crafted chest + feet.
    marksmanship: Object.freeze({
      mainhand: 'heroic_kingsbane_last_oath',
      offhand: 'direfang_quiver',
      helmet: 'coldsight_trackers_helmet',
      neck: 'yumis_keepsake_locket',
      shoulder: 'coldsight_trackers_shoulder',
      chest: 'crucible_agi_leather_chest',
      waist: 'slagstalker_belt',
      legs: 'coldsight_trackers_legs',
      gloves: 'coldsight_trackers_gloves',
      feet: 'crucible_agi_leather_feet',
      ring1: 'riftbound_band_of_guile',
      ring2: 'riftbound_band_of_guile',
      trinket: 'molten_fletching',
    }),
    // Jewelry and trinket from the beast_mastery kit (the survival sample was
    // weak), in the survival Slagsnare set. Crafted chest + feet (hit 130/130).
    survival: Object.freeze({
      mainhand: 'heroic_kingsbane_last_oath',
      offhand: 'cragmaw_huntquiver',
      helmet: 'slagsnare_helmet',
      neck: 'yumis_keepsake_locket',
      shoulder: 'slagsnare_shoulder',
      chest: 'crucible_agi_leather_chest',
      waist: 'slagstalker_belt',
      legs: 'slagsnare_legs',
      gloves: 'slagsnare_gloves',
      feet: 'crucible_agi_leather_feet',
      ring1: 'riftbound_band_of_guile',
      ring2: 'riftbound_band_of_guile',
      trinket: 'molten_fletching',
    }),
  }),
  rogue: Object.freeze({
    // Heroic DPS parse, build 0.45.8, fight 181314.
    // Crafted chest + feet (hit 130/130, set tiers 3).
    assassination: Object.freeze({
      mainhand: 'cinderfang_kris',
      offhand: 'heroic_kingsbane_last_oath',
      helmet: 'cinderfang_helmet',
      neck: 'vanguard_pendant_of_precision',
      shoulder: 'cinderfang_shoulder',
      chest: 'crucible_agi_leather_chest',
      waist: 'slagstalker_belt',
      legs: 'cinderfang_legs',
      gloves: 'cinderfang_gloves',
      feet: 'crucible_agi_leather_feet',
      ring1: 'vanguard_band_of_precision',
      ring2: 'vanguard_band_of_precision',
      trinket: 'molten_fletching',
    }),
    // Heroic DPS parse, build 0.45.7, fight 180544, with Slagstalker Belt over
    // the parse belt (Cinderbark Cinch is a Strength belt now). Crafted chest +
    // feet (hit 130/130, set tiers 3).
    combat: Object.freeze({
      mainhand: 'heroic_kingsbane_last_oath',
      offhand: 'cinderfang_kris',
      helmet: 'smolderstrike_helmet',
      neck: 'yumis_keepsake_locket',
      shoulder: 'smolderstrike_shoulder',
      chest: 'crucible_agi_leather_chest',
      waist: 'slagstalker_belt',
      legs: 'smolderstrike_legs',
      gloves: 'smolderstrike_gloves',
      feet: 'crucible_agi_leather_feet',
      ring1: 'band_of_marked_strikes',
      ring2: 'sutils_gambit',
      trinket: 'molten_fletching',
    }),
    // Heroic DPS parse, build 0.45.1, fight 177494.
    // Crafted chest + feet (hit 130/130, set tiers 3).
    subtlety: Object.freeze({
      mainhand: 'cinderfang_kris',
      offhand: 'heroic_kingsbane_last_oath',
      helmet: 'ashveil_helmet',
      neck: 'yumis_keepsake_locket',
      shoulder: 'ashveil_shoulder',
      chest: 'crucible_agi_leather_chest',
      waist: 'slagstalker_belt',
      legs: 'ashveil_legs',
      gloves: 'ashveil_gloves',
      feet: 'crucible_agi_leather_feet',
      ring1: 'sutils_gambit',
      ring2: 'band_of_marked_strikes',
      trinket: 'molten_fletching',
    }),
  }),
  priest: Object.freeze({
    // Jewelry and trinket from the holy kit (the discipline sample was weak),
    // in the discipline Creed of Embers set. Crafted waist + feet (healer rule).
    discipline: Object.freeze({
      mainhand: 'heroic_deathless_heartwood',
      offhand: 'wraithfire_orb',
      helmet: 'emberscreed_helmet',
      neck: 'heartspring_amulet',
      shoulder: 'emberscreed_shoulder',
      chest: 'emberscreed_chest',
      waist: 'crucible_healer_cloth_waist',
      legs: 'emberscreed_legs',
      gloves: 'emberscreed_gloves',
      feet: 'crucible_healer_cloth_feet',
      ring1: 'loop_of_quiet_springs',
      ring2: 'loop_of_quiet_springs',
      trinket: 'last_flame_lantern',
    }),
    // Heroic HPS parse, build 0.45.2, fight 178055.
    // Crafted waist + feet (healer rule).
    holy: Object.freeze({
      mainhand: 'heroic_deathless_heartwood',
      offhand: 'orb_of_the_last_spring',
      helmet: 'benison_dawnweave_helmet',
      neck: 'heartspring_amulet',
      shoulder: 'benison_dawnweave_shoulder',
      chest: 'benison_dawnweave_chest',
      waist: 'crucible_healer_cloth_waist',
      legs: 'benison_dawnweave_legs',
      gloves: 'benison_dawnweave_gloves',
      feet: 'crucible_healer_cloth_feet',
      ring1: 'loop_of_quiet_springs',
      ring2: 'loop_of_quiet_springs',
      trinket: 'last_flame_lantern',
    }),
    // Heroic DPS parse, build 0.44.4, fight 151223.
    // Crafted chest + feet (caster rule).
    shadow: Object.freeze({
      mainhand: 'heroic_deathless_heartwood',
      offhand: 'heroic_wraithfire_orb',
      helmet: 'vesperash_helmet',
      neck: 'locket_of_the_last_flame',
      shoulder: 'vesperash_shoulder',
      chest: 'crucible_caster_cloth_chest',
      waist: 'cord_of_the_last_flame',
      legs: 'vesperash_legs',
      gloves: 'vesperash_gloves',
      feet: 'crucible_caster_cloth_feet',
      ring1: 'circle_of_cinders',
      ring2: 'circle_of_cinders',
      trinket: 'kindling_orb',
    }),
  }),
  shaman: Object.freeze({
    // Heroic DPS parse, build 0.45.2, fight 178055.
    // Crafted chest + feet (caster rule).
    elemental: Object.freeze({
      mainhand: 'heroic_deathless_heartwood',
      offhand: 'heroic_wraithfire_orb',
      helmet: 'stormkindled_helmet',
      neck: 'locket_of_the_last_flame',
      shoulder: 'stormkindled_shoulder',
      chest: 'crucible_caster_mail_chest',
      waist: 'stormkindled_chain',
      legs: 'stormkindled_legs',
      gloves: 'stormkindled_gloves',
      feet: 'crucible_caster_mail_feet',
      ring1: 'circle_of_cinders',
      ring2: 'circle_of_cinders',
      trinket: 'kindling_orb',
    }),
    // Heroic DPS parse, build 0.44.6, fight 162825.
    // Crafted chest + feet (hit 130/130, set tiers 3).
    enhancement: Object.freeze({
      mainhand: 'heroic_kingsbane_last_oath',
      offhand: 'slagrender_cleaver',
      helmet: 'warspirit_emberscale_helmet',
      neck: 'legendary_chained_ember_choker',
      shoulder: 'warspirit_emberscale_shoulder',
      chest: 'crucible_str_mail_chest',
      waist: 'warforged_waistguard',
      legs: 'warspirit_emberscale_legs',
      gloves: 'warspirit_emberscale_gloves',
      feet: 'crucible_str_mail_feet',
      ring1: 'vanguard_band_of_might',
      ring2: 'riftbound_band_of_might',
      trinket: 'forgefathers_temper',
    }),
    // Warspirit in Stonebound (the tank posture), in its own Stonehearth tank
    // set (owner call, 2026-11-25). Stonebound runs dual Wands of Quenched
    // Sparks for their Spell Power (the current best setup, ahead of a
    // legendary), with the Crucible Guardian's pair in chest + feet (the most
    // hit) and the tank neck, rings and trinket.
    stonebound: Object.freeze({
      mainhand: 'wand_of_quenched_sparks',
      offhand: 'wand_of_quenched_sparks',
      helmet: 'stonehearth_helmet',
      neck: 'pendant_of_the_first_tempering',
      shoulder: 'stonehearth_shoulder',
      chest: 'crucible_tank_mail_chest',
      waist: 'warforged_waistguard',
      legs: 'stonehearth_legs',
      gloves: 'stonehearth_gloves',
      feet: 'crucible_tank_mail_feet',
      ring1: 'seal_of_the_forgewall',
      ring2: 'seal_of_the_forgewall',
      trinket: 'heart_of_the_crucible',
    }),
    // Heroic HPS parse, build 0.45.7, fight 180547.
    // Crafted waist + feet (healer rule).
    restoration: Object.freeze({
      mainhand: 'heroic_deathless_heartwood',
      offhand: 'orb_of_the_last_spring',
      helmet: 'springmender_helmet',
      neck: 'heartspring_amulet',
      shoulder: 'springmender_shoulder',
      chest: 'springmender_chest',
      waist: 'crucible_healer_mail_waist',
      legs: 'springmender_legs',
      gloves: 'springmender_gloves',
      feet: 'crucible_healer_mail_feet',
      ring1: 'loop_of_quiet_springs',
      ring2: 'loop_of_quiet_springs',
      trinket: 'last_flame_lantern',
    }),
  }),
  mage: Object.freeze({
    // Heroic HPS parse, build 0.45.2, fight 177615.
    // Crafted waist + feet (healer rule).
    arcane: Object.freeze({
      mainhand: 'heroic_deathless_heartwood',
      offhand: 'orb_of_the_last_spring',
      helmet: 'chronoweave_helmet',
      neck: 'heartspring_amulet',
      shoulder: 'chronoweave_shoulder',
      chest: 'chronoweave_chest',
      waist: 'crucible_healer_cloth_waist',
      legs: 'chronoweave_legs',
      gloves: 'chronoweave_gloves',
      feet: 'crucible_healer_cloth_feet',
      ring1: 'loop_of_quiet_springs',
      ring2: 'loop_of_quiet_springs',
      trinket: 'last_flame_lantern',
    }),
    // Heroic DPS parse, build 0.44.7, fight 173317.
    // Crafted chest + feet (caster rule).
    fire: Object.freeze({
      mainhand: 'heroic_deathless_heartwood',
      offhand: 'cinder_of_the_first_design',
      helmet: 'pyroclast_helmet',
      neck: 'locket_of_the_last_flame',
      shoulder: 'pyroclast_shoulder',
      chest: 'crucible_caster_cloth_chest',
      waist: 'cord_of_the_last_flame',
      legs: 'pyroclast_legs',
      gloves: 'pyroclast_gloves',
      feet: 'crucible_caster_cloth_feet',
      ring1: 'circle_of_cinders',
      ring2: 'circle_of_cinders',
      trinket: 'kindling_orb',
    }),
    // Heroic DPS parse, build 0.44.4, fight 150308, in the frost Frostquench
    // set. Crafted chest + feet (caster rule).
    frost: Object.freeze({
      mainhand: 'heroic_deathless_heartwood',
      offhand: 'heroic_wraithfire_orb',
      helmet: 'frostquench_helmet',
      neck: 'locket_of_the_last_flame',
      shoulder: 'frostquench_shoulder',
      chest: 'crucible_caster_cloth_chest',
      waist: 'cord_of_the_last_flame',
      legs: 'frostquench_legs',
      gloves: 'frostquench_gloves',
      feet: 'crucible_caster_cloth_feet',
      ring1: 'circle_of_cinders',
      ring2: 'circle_of_cinders',
      trinket: 'kindling_orb',
    }),
  }),
  warlock: Object.freeze({
    // Heroic DPS parse, build 0.45.7, fight 180542.
    // Crafted chest + feet (caster rule).
    affliction: Object.freeze({
      mainhand: 'heroic_deathless_heartwood',
      offhand: 'cinder_of_the_first_design',
      helmet: 'hexthread_helmet',
      neck: 'locket_of_the_last_flame',
      shoulder: 'hexthread_shoulder',
      chest: 'crucible_caster_cloth_chest',
      waist: 'cord_of_the_last_flame',
      legs: 'hexthread_legs',
      gloves: 'hexthread_gloves',
      feet: 'crucible_caster_cloth_feet',
      ring1: 'circle_of_cinders',
      ring2: 'circle_of_cinders',
      trinket: 'kindling_orb',
    }),
    // Heroic DPS parse, build 0.44.7, fight 173317.
    // Crafted chest + feet (caster rule).
    demonology: Object.freeze({
      mainhand: 'heroic_deathless_heartwood',
      offhand: 'cinder_of_the_first_design',
      helmet: 'gravebrand_helmet',
      neck: 'locket_of_the_last_flame',
      shoulder: 'gravebrand_shoulder',
      chest: 'crucible_caster_cloth_chest',
      waist: 'cord_of_the_last_flame',
      legs: 'gravebrand_legs',
      gloves: 'gravebrand_gloves',
      feet: 'crucible_caster_cloth_feet',
      ring1: 'circle_of_cinders',
      ring2: 'circle_of_cinders',
      trinket: 'kindling_orb',
    }),
    // Heroic DPS parse, build 0.45.3, fight 178439.
    // Crafted chest + feet (caster rule).
    destruction: Object.freeze({
      mainhand: 'heroic_deathless_heartwood',
      offhand: 'cinder_of_the_first_design',
      helmet: 'ruincaller_helmet',
      neck: 'locket_of_the_last_flame',
      shoulder: 'ruincaller_shoulder',
      chest: 'crucible_caster_cloth_chest',
      waist: 'cord_of_the_last_flame',
      legs: 'ruincaller_legs',
      gloves: 'ruincaller_gloves',
      feet: 'crucible_caster_cloth_feet',
      ring1: 'circle_of_cinders',
      ring2: 'circle_of_cinders',
      trinket: 'kindling_orb',
    }),
  }),
  druid: Object.freeze({
    // Heroic DPS parse, build 0.45.7, fight 180264.
    // Crafted chest + feet (caster rule).
    balance: Object.freeze({
      mainhand: 'heroic_deathless_heartwood',
      offhand: 'cinder_of_the_first_design',
      helmet: 'moonscorch_helmet',
      neck: 'locket_of_the_last_flame',
      shoulder: 'moonscorch_shoulder',
      chest: 'crucible_caster_leather_chest',
      waist: 'moonscorch_waistwrap',
      legs: 'moonscorch_legs',
      gloves: 'moonscorch_gloves',
      feet: 'crucible_caster_leather_feet',
      ring1: 'circle_of_cinders',
      ring2: 'circle_of_cinders',
      trinket: 'kindling_orb',
    }),
    // Heroic DPS parse, build 0.45.8, fight 181331.
    // Crafted chest + feet (hit 130/130, set tiers 3).
    feral: Object.freeze({
      mainhand: 'varkhul_forgebreaker',
      helmet: 'wildfang_emberhide_helmet',
      neck: 'ignivars_ember_choker',
      shoulder: 'wildfang_emberhide_shoulder',
      chest: 'crucible_str_leather_chest',
      waist: 'cinderbark_cinch',
      legs: 'wildfang_emberhide_legs',
      gloves: 'wildfang_emberhide_gloves',
      feet: 'crucible_str_leather_feet',
      ring1: 'vanguard_band_of_might',
      ring2: 'vanguard_band_of_might',
      trinket: 'forgefathers_temper',
    }),
    // Heroic HPS parse, build 0.45.7, fight 180534.
    // Bear: Heroic DTPS parse, build 0.45.6, fight 180210, with the Forge
    // rules: the ilvl-35 Cinderbark tank set, Forgebreaker, the Crucible
    // Guardian's pair in chest + feet (keeps Cinderbark Cinch's 60 Hit), and
    // the tank trinket.
    bear: Object.freeze({
      mainhand: 'varkhul_forgebreaker',
      helmet: 'cinderbark_helmet',
      neck: 'pendant_of_the_first_tempering',
      shoulder: 'cinderbark_shoulder',
      chest: 'crucible_tank_leather_chest',
      waist: 'cinderbark_cinch',
      legs: 'cinderbark_legs',
      gloves: 'cinderbark_gloves',
      feet: 'crucible_tank_leather_feet',
      ring1: 'seal_of_the_forgewall',
      ring2: 'seal_of_the_forgewall',
      trinket: 'heart_of_the_crucible',
    }),
    // Crafted waist + feet (healer rule).
    restoration: Object.freeze({
      mainhand: 'heroic_deathless_heartwood',
      offhand: 'orb_of_the_last_spring',
      helmet: 'grovespring_helmet',
      neck: 'heartspring_amulet',
      shoulder: 'grovespring_shoulder',
      chest: 'grovespring_chest',
      waist: 'crucible_healer_leather_waist',
      legs: 'grovespring_legs',
      gloves: 'grovespring_gloves',
      feet: 'crucible_healer_leather_feet',
      ring1: 'loop_of_quiet_springs',
      ring2: 'loop_of_quiet_springs',
      trinket: 'last_flame_lantern',
    }),
  }),
});

export interface ForgeBisLoadoutEntry {
  cls: PlayerClass;
  spec: string;
  gear: ForgeGear;
}

export function forgeBisGearFor(cls: PlayerClass, spec: string): ForgeGear | null {
  const gear = LOADOUTS[cls]?.[spec];
  return gear ? { ...gear } : null;
}

export function forgeBisLoadoutEntries(): readonly ForgeBisLoadoutEntry[] {
  return (Object.entries(LOADOUTS) as [PlayerClass, ClassForgeGear][]).flatMap(([cls, specs]) =>
    Object.entries(specs).map(([spec, gear]) => ({ cls, spec, gear })),
  );
}
