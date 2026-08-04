// The one map from a tool-effect id to its localized display-name key.
//
// The gathering-profession counterpart of GATHERING_PROFESSION_NAME_KEYS
// (./gathering_profession_name.ts), and it exists for the same reason: the sim
// and the wire are language-agnostic and carry only a ToolEffectId, so the id
// has to become a name somewhere on the UI side, once.
//
// String-keyed rather than keyed on ToolEffectId, matching the gathering table:
// every caller looks the id up off wire-mirrored data, and an id with no entry
// here has no honest name to print. What `undefined` means is the SURFACE's
// call: a browse surface (a window row, a list) renders no row rather than
// inventing a name, because a persisted slot can name an effect a later
// content change retired and a phantom row would advertise nothing actionable.
// A RESULT line answering the player's own command (the hud toolEffectResult
// arm) renders the raw id instead, the stale-content doctrine: the player just
// acted on that id, and "no line at all" hides an outcome they caused, which
// is worse than an unlocalized identifier.

import type { TranslationKey } from './i18n';

/** Display-name key per tool-effect id. Mirrors src/sim/content/professions.ts
 *  TOOL_EFFECTS; an id absent here renders no row. */
export const TOOL_EFFECT_NAME_KEYS: Record<string, TranslationKey> = {
  gatherers_cache: 'hudChrome.professions.toolEffectName.gatherersCache',
  artisans_eye: 'hudChrome.professions.toolEffectName.artisansEye',
  quickening_charm: 'hudChrome.professions.toolEffectName.quickeningCharm',
};

/** hasOwn-safe read of the table above, the twin of
 *  gatheringProfessionNameKey: the map is a plain object literal, so a bare
 *  bracket read of a wire-supplied prototype key ('constructor') would
 *  resolve a function that passes an undefined check and reaches t(). Use
 *  this getter rather than indexing the table directly. */
export function toolEffectNameKey(effectId: string): TranslationKey | undefined {
  return Object.hasOwn(TOOL_EFFECT_NAME_KEYS, effectId)
    ? TOOL_EFFECT_NAME_KEYS[effectId]
    : undefined;
}
