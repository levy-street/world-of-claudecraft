// Station display names: the six per-type hudChrome.crafting.stationName.*
// keys, one per StationType (src/sim/professions/stations.ts). Moved out of
// crafting_window.ts (which re-exports stationNameText for its consumers)
// when the placed mobile-station title (mobile_station_title.ts) needed the
// same noun from the render-side world label, which must not import the DOM
// crafting window. The craft_name_view.ts shape.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import type { StationType } from '../../../sim/professions/stations';
import { type TranslationKey, t } from '../../i18n';

export const STATION_NAME_KEY: Readonly<Record<StationType, TranslationKey>> = {
  forge: 'hudChrome.crafting.stationName.forge',
  kitchens: 'hudChrome.crafting.stationName.kitchens',
  apothecary: 'hudChrome.crafting.stationName.apothecary',
  tannery: 'hudChrome.crafting.stationName.tannery',
  loom: 'hudChrome.crafting.stationName.loom',
  toolworks: 'hudChrome.crafting.stationName.toolworks',
};

/** The localized display name of one station type. */
export function stationNameText(type: StationType): string {
  return t(STATION_NAME_KEY[type]);
}
