// Scene music-directive samples (H3): the Last Bell scenes author abstract
// 'music' directives (the sim never knows what audio is), and this module
// maps the ones with a sampled interpretation onto the SFX engine. Unknown
// directives stay deliberate no-ops (authored for later phases), exactly the
// scene_director_core.sceneMusicAction contract for silence/resume.

import { sfx } from './sfx';
import type { SfxId } from './sfx_manifest.generated';

// Directive -> catalog key (public/audio/sfx/<key>.mp3, sfx_manifest). The
// SfxId pin keeps a renamed manifest key from silently no-opping at runtime.
const DIRECTIVE_SFX: Record<string, SfxId> = {
  // The campaign's signature sound: one bell toll, the street counts.
  lb_bell_toll_one: 'lb_bell_toll',
  // The departure bed: water against pilings, rope and timber.
  lb_harbor_ambience: 'lb_harbor_ambience',
  // Cast-off: the hull working against the fenders as way comes on.
  lb_ship_castoff: 'lb_ship_castoff',
};

/** Play the sampled interpretation of a scene music directive, if it has
 *  one. Personal, non-positional (the scene is a personal event stream). */
export function playSceneDirectiveSfx(directive: string): boolean {
  const key = DIRECTIVE_SFX[directive];
  if (key === undefined) return false;
  sfx.playUi(key, { jitter: false });
  return true;
}
