// Editor helpers for authored point sounds (looping positional SFX emitters):
// the loopable clips a maker can pick, a sensible default, and a friendly label
// for a clip id. Pure data + formatting, shared by the app (placement + deps)
// and the inspector (picker). The player side lives in src/game/sfx.ts
// (Sfx.pointSounds) and the document shape in src/sim/map_doc.ts (MapPointSound).

import { SFX_CLIPS } from '../game/sfx_manifest.generated';

/** The clips authored to loop seamlessly, the sensible set for a "sound on
 *  repeat". Derived from the generated manifest so it tracks the shipped files
 *  (a clip added/removed by scripts/gen_sfx.mjs shows up here automatically). */
export const POINT_SOUND_CLIPS: readonly string[] = Object.entries(SFX_CLIPS)
  .filter(([, entry]) => entry.loop)
  .map(([key]) => key)
  .sort();

/** New nodes start on a warm, obviously-looping ambience clip (falling back to
 *  whatever loopable clip ships first, so the default is never a dead id). */
export const DEFAULT_POINT_SOUND: string = POINT_SOUND_CLIPS.includes('amb_campfire')
  ? 'amb_campfire'
  : (POINT_SOUND_CLIPS[0] ?? 'amb_campfire');

/** A friendly label for a clip id (strip the category prefix, title-case). The
 *  editor UI is English-only, so this derives display text from the data id
 *  rather than carrying a translated key per clip (which would dangle as the
 *  generated clip set changes). */
export function pointSoundLabel(id: string): string {
  return id
    .replace(/^[a-z]+_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
