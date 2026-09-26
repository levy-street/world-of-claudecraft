// The raid target markers' localized names (star through skull, in marker
// index order), moved out of hud.ts under the monolith ratchet. Pure: the
// HUD's marker menu and target frame read them.

import { type TranslationKey, t } from './i18n';

export const RAID_MARKER_LABEL_KEYS = [
  'hud.markers.names.star',
  'hud.markers.names.circle',
  'hud.markers.names.diamond',
  'hud.markers.names.triangle',
  'hud.markers.names.moon',
  'hud.markers.names.square',
  'hud.markers.names.cross',
  'hud.markers.names.skull',
] as const satisfies readonly TranslationKey[];

/** A marker index's localized name (an unknown index reads as the first). */
export function raidMarkerDisplayName(index: number): string {
  return t(RAID_MARKER_LABEL_KEYS[index] ?? RAID_MARKER_LABEL_KEYS[0]);
}
