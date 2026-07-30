import type { SkinRank } from '../../../sim/types';
import { type TranslationKey, t } from '../../i18n';

const SKIN_RANK_NAME_KEY: Record<SkinRank, TranslationKey> = {
  uncommon: 'itemUi.quality.uncommon',
  rare: 'itemUi.quality.rare',
  epic: 'itemUi.quality.epic',
};

const MECH_NAME_KEY: Record<string, TranslationKey> = {
  amber_crimson: 'skinEvent.mech.amber_crimson',
  crimson_amber: 'skinEvent.mech.crimson_amber',
  cyan_magenta: 'skinEvent.mech.cyan_magenta',
  magenta_cyan: 'skinEvent.mech.magenta_cyan',
  orange_steel: 'skinEvent.mech.orange_steel',
  steel_orange: 'skinEvent.mech.steel_orange',
  forest_pink: 'skinEvent.mech.forest_pink',
  pink_forest: 'skinEvent.mech.pink_forest',
  amethyst_silver: 'skinEvent.mech.amethyst_silver',
  ivory_copper: 'skinEvent.mech.ivory_copper',
  onyx_gold: 'skinEvent.mech.onyx_gold',
  imperial_crimson: 'skinEvent.mech.imperial_crimson',
  imperial_gold: 'skinEvent.mech.imperial_gold',
  vanguard_azure: 'skinEvent.mech.vanguard_azure',
  vanguard_chrome: 'skinEvent.mech.vanguard_chrome',
};

export function skinRankName(rank: SkinRank): string {
  return t(SKIN_RANK_NAME_KEY[rank]);
}

export function mechChromaName(id: string): string {
  const key = MECH_NAME_KEY[id];
  return key ? t(key) : id;
}
