// THE PLACED MOBILE-STATION TITLE, one rule for the two surfaces that paint
// it (the feast_title.ts shape): a placed station's entity carries the
// PLACER'S raw player name as its wire `name` (sim and server stay
// language-agnostic), and the localized "{name}'s <Station>" title is
// composed HERE, client-side, off the entity's templateId, for both
// src/ui/entity_display_core.ts (target frame, tooltips) and
// src/render/entity_labels.ts (the floating world label).
//
// WHAT the station is called derives from the templateId's suffix
// (src/sim/professions/mobile_station_object.ts): an ITEM placement names
// the item ("Fizban's Grand Cauldron", "Fizban's The Laden Hearth" is avoided
// by stripping a leading article from the item name, the placement line's
// nameCarriesOwnArticle twin), and a specialization placement names the
// station type its craft resolves to ("Fizban's Apothecary"). ONE key,
// hudChrome.crafting.mobileStationTitle, with the noun as a localized VALUE:
// the item and station nouns are already localized rows, so a per-item key
// would duplicate every fill.

import { ITEMS } from '../../../sim/data';
import { nameCarriesOwnArticle } from '../../../sim/professions/mobile_station';
import {
  mobileStationCraftOf,
  mobileStationItemOf,
} from '../../../sim/professions/mobile_station_object';
import { stationTypeForCraft } from '../../../sim/professions/stations';
import { itemDisplayName } from '../../entity_i18n';
import { t } from '../../i18n';
import { stationNameText } from './station_name_view';

/** The localized station noun a placed station entity's templateId names, or
 *  null when the templateId is not a mobile station. */
export function mobileStationNounFor(templateId: string | null | undefined): string | null {
  const itemId = mobileStationItemOf(templateId);
  if (itemId !== null) {
    const name = itemDisplayName(ITEMS[itemId]);
    return nameCarriesOwnArticle(name) ? name.replace(/^\S+\s+/, '') : name;
  }
  const craft = mobileStationCraftOf(templateId);
  const type = craft === null ? undefined : stationTypeForCraft(craft);
  return type ? stationNameText(type) : null;
}

/** The composed localized title for a placed mobile station, or null for any
 *  other entity. `placerName` is the entity's wire name, interpolated as a
 *  VALUE and never translated. */
export function mobileStationTitleFor(
  templateId: string | null | undefined,
  placerName: string,
): string | null {
  const station = mobileStationNounFor(templateId);
  if (station === null) return null;
  return t('hudChrome.crafting.mobileStationTitle', { name: placerName, station });
}
