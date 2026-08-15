// The one map from a gathering profession id to its localized display-name key,
// shared by the character window, the professions window, and the locked
// vendor row that names the proficiency a tool requires.
//
// String-keyed rather than keyed on GatheringProfessionId, exactly as both
// originals were: every caller looks the id up off wire-mirrored or content
// data, and an id with no entry here has no honest name to print, so callers
// treat `undefined` as "render no name" rather than inventing one. This is the
// gathering counterpart of char_window.ts's craftNameText for the ten-craft
// ring, which resolves its own unknown ids to the "none" copy because a craft
// row always exists to fill.

import type { TranslationKey } from './i18n';

/** Display-name key per gathering profession id (issue 1124; fishing landed
 *  with Professions 2.0). Mirrors src/sim/content/professions.ts
 *  GATHERING_PROFESSION_IDS: an id absent here renders no name. */
export const GATHERING_PROFESSION_NAME_KEYS: Record<string, TranslationKey> = {
  mining: 'hudChrome.gathering.mining',
  logging: 'hudChrome.gathering.logging',
  herbalism: 'hudChrome.gathering.herbalism',
  fishing: 'hudChrome.gathering.fishing',
};

/** hasOwn-safe read of the table above: the map is a plain object literal, so
 *  a bare bracket read of a prototype key ('constructor') would resolve a
 *  function instead of undefined. Callers treat undefined as "render no
 *  name"; use this getter rather than indexing the table directly. */
export function gatheringProfessionNameKey(professionId: string): TranslationKey | undefined {
  return Object.hasOwn(GATHERING_PROFESSION_NAME_KEYS, professionId)
    ? GATHERING_PROFESSION_NAME_KEYS[professionId]
    : undefined;
}
