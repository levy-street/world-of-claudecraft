// Localized cast-bar labels: the named system casts (fishing,
// gathering, crafting and friends), the rift boss mechanic wind-ups, then any
// ability id, in that resolver order. Moved WHOLE from hud.ts at the v0.38.0
// fourteenth absorb (the monolith ratchet heal); behavior unchanged.

import { ABILITIES } from '../sim/data';
import {
  ALLIED_HEARTHSTONE_CAST_ID,
  CORPSE_HARVEST_CAST_ID,
  CRAFT_CAST_ID,
  DISENCHANT_CAST_ID,
  ENCHANT_CAST_ID,
  FISHING_CAST_ID,
  GATHER_CAST_ID,
  SALVAGE_CAST_ID,
  SUNDER_CAST_ID,
  TOOL_RECHARGE_CAST_ID,
} from '../sim/types';
import { abilityDisplayName, abilityDisplayNameFromSource } from './ability_display_name';
import { type TranslationKey, t } from './i18n';

// Rift boss one-shot mechanic cast IDs: keyed by their authored mechanic name.
// These appear in the target cast bar when the boss winds up a lethal zone.
// The lookup prevents falling back to the raw castId string on the HUD.
const RIFT_CAST_DISPLAY_KEYS: Partial<Record<TranslationKey, true>> = {
  'abilityUi.cast.rift_frost_execution': true,
  'abilityUi.cast.rift_frost_strike': true,
  'abilityUi.cast.rift_ember_execution': true,
  'abilityUi.cast.rift_ember_strike': true,
  'abilityUi.cast.rift_venom_execution': true,
  'abilityUi.cast.rift_venom_strike': true,
  'abilityUi.cast.rift_necro_execution': true,
  'abilityUi.cast.rift_necro_strike': true,
  'abilityUi.cast.rift_brute_execution': true,
  'abilityUi.cast.rift_brute_strike': true,
  'abilityUi.cast.rift_arcane_execution': true,
  'abilityUi.cast.rift_arcane_strike': true,
  'abilityUi.cast.rift_storm_execution': true,
  'abilityUi.cast.rift_storm_strike': true,
  'abilityUi.cast.rift_tide_execution': true,
  'abilityUi.cast.rift_tide_strike': true,
  // Buried Hoard control casts (src/sim/rift/hoard_control_casts.ts).
  'abilityUi.cast.hoard_cast_fear': true,
  'abilityUi.cast.hoard_cast_stun': true,
  'abilityUi.cast.hoard_cast_drowning_hook': true,
  'abilityUi.cast.hoard_cast_rime_beam': true,
  'abilityUi.cast.hoard_cast_cinder_bolt': true,
  'abilityUi.cast.hoard_cast_void_empower': true,
  'abilityUi.cast.hoard_cast_webbing': true,
  'abilityUi.cast.hoard_cast_doom_ritual': true,
  'abilityUi.cast.hoard_cast_charge': true,
  'abilityUi.cast.hoard_cast_silk_snare': true,
  'abilityUi.cast.hoard_cast_silence': true,
  'abilityUi.cast.hoard_cast_hex': true,
  'abilityUi.cast.hoard_lightning_strike': true,
  'abilityUi.cast.hoard_ice_age': true,
  'abilityUi.cast.hoard_pulsar_overload': true,
  'abilityUi.cast.hoard_rolling_boulder': true,
  'abilityUi.cast.hoard_goblin_escape': true,
  'abilityUi.cast.hoard_cast_mole_rake': true,
  'abilityUi.cast.hoard_cast_burrow': true,
  'abilityUi.cast.hoard_cast_tunnel': true,
  'abilityUi.cast.hoard_cast_emerge': true,
  'abilityUi.cast.hoard_cast_collapse': true,
  'abilityUi.cast.hoard_cast_bat_dive_aim': true,
  'abilityUi.cast.hoard_cast_bat_dive': true,
  'abilityUi.cast.hoard_cast_screech': true,
  'abilityUi.cast.hoard_cast_mimic_bite': true,
  'abilityUi.cast.hoard_cast_mimic_leap': true,
  'abilityUi.cast.hoard_cast_coin_spit': true,
  // The Hollow Crypt trash kit (src/sim/mob/trash_kit/cast_ids.ts).
  'abilityUi.cast.crypt_grave_bolt': true,
  'abilityUi.cast.crypt_raise_bones': true,
  'abilityUi.cast.crypt_murder_call': true,
  'abilityUi.cast.crypt_stone_shriek': true,
  'abilityUi.cast.crypt_grave_cleave': true,
  'abilityUi.cast.crypt_barrowflame_breath': true,
  'abilityUi.cast.crypt_tail_lash': true,
  'abilityUi.cast.crypt_wing_gust': true,
  // The Hollow Crypt finale (encounters/hollow_crypt/ids.ts).
  'abilityUi.cast.crypt_morthen_rite_wakes': true,
  'abilityUi.cast.crypt_morthen_rise': true,
  'abilityUi.cast.crypt_morthen_proclaim': true,
  'abilityUi.cast.crypt_morthen_descend': true,
  'abilityUi.cast.crypt_knellwyrm_arrive': true,
  'abilityUi.cast.crypt_knellwyrm_pyre_strafe': true,
  'abilityUi.cast.crypt_knellwyrm_strafe_run': true,
  'abilityUi.cast.crypt_knellwyrm_dread_bellow': true,
  // The Sunken Bastion trash kit and boss casts.
  'abilityUi.cast.bastion_brine_mend': true,
  'abilityUi.cast.bastion_fog_ward': true,
  'abilityUi.cast.bastion_halberd_sweep': true,
  'abilityUi.cast.bastion_piercing_bolt': true,
  'abilityUi.cast.bastion_claw_sweep': true,
  'abilityUi.cast.bastion_shell_slam': true,
  'abilityUi.cast.bastion_oathbound_charge': true,
  'abilityUi.cast.bastion_gaolers_cudgel': true,
  'abilityUi.cast.bastion_mist_surge': true,
  'abilityUi.cast.bastion_drowning_hymn': true,
  'abilityUi.cast.bastion_iron_cage': true,
  'abilityUi.cast.bastion_drowned_anchor_cast': true,
  'abilityUi.cast.bastion_shackle_pair': true,
  'abilityUi.cast.bastion_shadowstep': true,
  'abilityUi.cast.bastion_reaping_scythe': true,
  'abilityUi.cast.bastion_veil_rise': true,
  // The Drowned Temple trash kit and boss casts.
  'abilityUi.cast.temple_lullaby': true,
  'abilityUi.cast.temple_call_the_tide': true,
  'abilityUi.cast.temple_static_coil': true,
  'abilityUi.cast.temple_snapper_snap': true,
  'abilityUi.cast.temple_trident_sweep': true,
  'abilityUi.cast.temple_sea_song': true,
  'abilityUi.cast.temple_tidal_slap': true,
  'abilityUi.cast.temple_tide_breath': true,
  'abilityUi.cast.temple_moonlight_lance': true,
  'abilityUi.cast.temple_prism_flare': true,
  'abilityUi.cast.temple_resonant_slam': true,
  'abilityUi.cast.temple_undertow': true,
  'abilityUi.cast.temple_lunar_tide': true,
  'abilityUi.cast.temple_skewering_trident': true,
  'abilityUi.cast.temple_pale_mending': true,
  'abilityUi.cast.temple_glimmer_venom': true,
  'abilityUi.cast.temple_pearl_slam': true,
  'abilityUi.cast.temple_lightning_spit': true,
  'abilityUi.cast.temple_crushing_torrent': true,
  'abilityUi.cast.temple_hydra_tsunami': true,
  'abilityUi.cast.temple_ysolei_call': true,
  'abilityUi.cast.temple_ysolei_wrath': true,
  // The Wildheart Basin rework: its trash kit and the Great Saurian.
  'abilityUi.cast.wildheart_ancestral_sap': true,
  'abilityUi.cast.wildheart_plant_totem': true,
  'abilityUi.cast.wildheart_entangling_lash': true,
  'abilityUi.cast.wildheart_saurian_tail_swipe': true,
  'abilityUi.cast.wildheart_saurian_stomp': true,
  // The Wildheart Basin's three bosses.
  'abilityUi.cast.wildheart_beast_pit_quake': true,
  'abilityUi.cast.wildheart_jaguar_heel': true,
  'abilityUi.cast.wildheart_gorgebloom_seed_rain': true,
  'abilityUi.cast.wildheart_gorgebloom_vine_lash': true,
  'abilityUi.cast.wildheart_gorgebloom_gorge': true,
  'abilityUi.cast.wildheart_zulgar_pulse': true,
  'abilityUi.cast.wildheart_zulgar_spirit_hunt': true,
  // The Gravewyrm Sanctum rework: its trash kit and the Sledge Tusker.
  'abilityUi.cast.sanctum_cinder_breath': true,
  'abilityUi.cast.sanctum_warming_rite': true,
  'abilityUi.cast.sanctum_goad': true,
  'abilityUi.cast.sanctum_plant_brazier': true,
  'abilityUi.cast.sanctum_ice_block_toss': true,
  'abilityUi.cast.sanctum_tusker_tusk_sweep': true,
  'abilityUi.cast.sanctum_tusker_trample': true,
  'abilityUi.cast.sanctum_velkhar_soulfire_trench': true,
  'abilityUi.cast.sanctum_velkhar_shadow_volley': true,
  'abilityUi.cast.sanctum_korgath_maul_arc': true,
  'abilityUi.cast.sanctum_korgath_chain_flail': true,
  'abilityUi.cast.sanctum_korgath_threshold_charge': true,
  'abilityUi.cast.sanctum_korgath_foremans_bellow': true,
  'abilityUi.cast.sanctum_korgath_strain': true,
  'abilityUi.cast.sanctum_korgath_stomp': true,
  'abilityUi.cast.sanctum_goadsmith_rerivet': true,
  'abilityUi.cast.sanctum_korzul_break_free': true,
  'abilityUi.cast.sanctum_korzul_grave_breath': true,
  'abilityUi.cast.sanctum_korzul_tail_sweep': true,
  'abilityUi.cast.sanctum_korzul_grave_inferno': true,
  'abilityUi.cast.sanctum_korzul_wing_gale': true,
  'abilityUi.cast.sanctum_korzul_plunging_fire': true,
  'abilityUi.cast.sanctum_korzul_crashing_descent': true,
};
export const castDisplayName = (id: string): string => {
  if (id === FISHING_CAST_ID) return t('abilityUi.cast.fishing');
  if (id === GATHER_CAST_ID) return t('abilityUi.cast.gathering');
  // Corpse harvest (Intentional Gathering PR3) reuses the existing "Harvest"
  // label the corpse loot popup already ships, rather than a new cast key.
  if (id === CORPSE_HARVEST_CAST_ID) return t('hudChrome.corpseHarvest.title');
  if (id === CRAFT_CAST_ID) return t('abilityUi.cast.crafting');
  if (id === DISENCHANT_CAST_ID) return t('abilityUi.cast.disenchanting');
  if (id === ENCHANT_CAST_ID) return t('abilityUi.cast.enchanting_apply');
  if (id === SALVAGE_CAST_ID) return t('abilityUi.cast.salvaging');
  // Ported from the masterwrought side of the farming absorb (11b RULE 2):
  // hud.ts gained this arm in place while farming extracted the resolver
  // here, so the arm follows the function into its new home, keeping the
  // pre-extraction resolver order (between SALVAGE and TOOL_RECHARGE).
  if (id === SUNDER_CAST_ID) return t('abilityUi.cast.sundering');
  if (id === TOOL_RECHARGE_CAST_ID) return t('abilityUi.cast.tool_recharge');
  if (id === ALLIED_HEARTHSTONE_CAST_ID) return t('entities.items.allied_hearthstone.name');
  if (id === 'demon_heal') return t('abilityUi.cast.demonHeal');
  if (id === 'thunzharr_stormcall') return t('abilityUi.cast.thunzharrStormcall');
  const riftKey = `abilityUi.cast.${id}` as TranslationKey;
  if (riftKey in RIFT_CAST_DISPLAY_KEYS) return t(riftKey);
  const ability = ABILITIES[id];
  return ability ? abilityDisplayName(ability) : id;
};

/** The TARGET cast bar's label. A mob's cast label is usually an authored
 *  mechanic NAME (resolved by abilityDisplayNameFromSource), but the Buried
 *  Hoard and rift boss wind-ups carry a cast ID (hoard_cast_mole_rake), which
 *  must read as its localized name there too, never the raw id. */
export const targetCastDisplayName = (label: string): string => {
  const riftKey = `abilityUi.cast.${label}` as TranslationKey;
  if (riftKey in RIFT_CAST_DISPLAY_KEYS) return t(riftKey);
  return abilityDisplayNameFromSource(label);
};
