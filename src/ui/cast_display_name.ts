// Localized cast-bar labels: the named system casts (fishing, farming,
// gathering, crafting and friends), the rift boss mechanic wind-ups, then any
// ability id, in that resolver order. Moved WHOLE from hud.ts at the v0.38.0
// fourteenth absorb (the monolith ratchet heal); behavior unchanged.

import { ABILITIES } from '../sim/data';
import {
  CORPSE_HARVEST_CAST_ID,
  CRAFT_CAST_ID,
  DISENCHANT_CAST_ID,
  ENCHANT_CAST_ID,
  FARMING_CAST_ID,
  FISHING_CAST_ID,
  GATHER_CAST_ID,
  SALVAGE_CAST_ID,
  SUNDER_CAST_ID,
  TOOL_RECHARGE_CAST_ID,
} from '../sim/types';
import { abilityDisplayName } from './ability_display_name';
import { t } from './i18n';
import { riftCastDisplayName } from './rift_cast_display_name';
export const castDisplayName = (id: string): string => {
  if (id === FISHING_CAST_ID) return t('abilityUi.cast.fishing');
  if (id === FARMING_CAST_ID) return t('abilityUi.cast.farming');
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
  if (id === 'demon_heal') return t('abilityUi.cast.demonHeal');
  if (id === 'thunzharr_stormcall') return t('abilityUi.cast.thunzharrStormcall');
  const riftName = riftCastDisplayName(id);
  if (riftName) return riftName;
  const ability = ABILITIES[id];
  return ability ? abilityDisplayName(ability) : id;
};

/** The TARGET cast bar's label resolver (#tf-castbar) for the FARMING cast
 *  only. The target bar historically showed the raw cast id, byte-faithful to
 *  its old inline block, so a targeted player mid-trade-cast read "farming";
 *  Phase 14 localized exactly the FARMING cast here (the handoff row it
 *  discharges). Since the v0.41.0 Ignivar span (merged 2026-08-30) the hud
 *  routes every OTHER id through abilityDisplayNameFromSource, which passes
 *  an unknown id through unchanged, so this resolver's raw-id fallthrough is
 *  reached only for non-farming ids the hud has already handed elsewhere. */
export const targetCastDisplayLabel = (id: string): string =>
  id === FARMING_CAST_ID ? castDisplayName(id) : id;
