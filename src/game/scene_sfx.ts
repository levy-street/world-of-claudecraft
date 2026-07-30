// Scene music-directive samples (H3): the Last Bell scenes author abstract
// 'music' directives (the sim never knows what audio is), and this module
// maps the ones with a sampled interpretation onto the SFX engine. The
// authoring union explicitly names the deliberate no-ops for later phases,
// exactly like the scene_director_core.sceneMusicAction silence/resume pair.

import type { SceneMusicDirective, SceneSampledMusicDirective } from '../sim/scenes/registry';
import { sfx } from './sfx';
import type { SfxId } from './sfx_manifest.generated';

type SceneDirectiveSfxMap = {
  readonly [Directive in SceneMusicDirective]: Directive extends SceneSampledMusicDirective
    ? SfxId
    : null;
};

// Directive -> catalog key (public/audio/sfx/<key>.mp3, sfx_manifest). The
// SceneMusicDirective key set makes this map exhaustive, and the SfxId value
// pin keeps a renamed manifest key from silently no-opping at runtime.
const DIRECTIVE_SFX = {
  // The campaign's signature sound: one bell toll, the street counts.
  lb_bell_toll_one: 'lb_bell_toll',
  // The departure bed: water against pilings, rope and timber.
  lb_harbor_ambience: 'lb_harbor_ambience',
  // Cast-off: the hull working against the fenders as way comes on.
  lb_ship_castoff: 'lb_ship_castoff',
  silence: null,
  resume: null,
  'theme:last_bell': null,
} satisfies SceneDirectiveSfxMap;

/** Play the sampled interpretation of a scene music directive, if it has
 *  one. Personal, non-positional (the scene is a personal event stream). */
export function playSceneDirectiveSfx(directive: string): boolean {
  if (!Object.hasOwn(DIRECTIVE_SFX, directive)) return false;
  const key = DIRECTIVE_SFX[directive as SceneMusicDirective];
  if (key === null) return false;
  sfx.playUi(key, { jitter: false });
  return true;
}
