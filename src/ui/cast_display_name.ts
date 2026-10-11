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
