// Which spell-effect cues the Smith's Heart's fights sound themselves (each
// fight's audio core, src/game/smith_heart_*_audio_core.ts): the HUD's generic
// nova, beam or burst sound is skipped for every one, so a raid mechanic never
// plays twice or under a generic layer. Pure.

import { breathSoundClaims } from './smith_heart_breath_audio_core';
import { councilSoundClaims } from './smith_heart_council_audio_core';
import { finalSoundClaims } from './smith_heart_final_audio_core';
import { heatSoundClaims } from './smith_heart_heat_audio_core';
import { quenchSoundClaims } from './smith_heart_quench_audio_core';

/** Does one of the raid's five fights play this cue's sound itself? */
export function smithHeartSoundClaims(ability: string | undefined): boolean {
  return (
    councilSoundClaims(ability) ||
    breathSoundClaims(ability) ||
    quenchSoundClaims(ability) ||
    heatSoundClaims(ability) ||
    finalSoundClaims(ability)
  );
}
