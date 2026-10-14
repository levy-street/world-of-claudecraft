// The authored-map half of the HUD's per-frame music input (instance_music.ts
// InstanceMusicInput), read from the live world. Moved out of hud.ts's music
// head so the coordinator passes one spread.
//
// Both fields are null on the shipped world, so the built-in soundtrack
// decision is exactly the location walk it always was.

import { getActiveWorldContent } from '../sim/data';
import { deepglassMatch } from '../sim/deepglass/match';
import type { InstanceMusicInput } from './instance_music';

export function authoredMapMusicInput(): Pick<InstanceMusicInput, 'deepglass' | 'mapMusic'> {
  const content = getActiveWorldContent();
  return {
    // The bell is a whole world, so presence there is the arming signal:
    // there is no Sowfield-style footprint to stand in.
    deepglass:
      content.presentationMode === 'deepglass'
        ? { inArena: true, phase: deepglassMatch()?.phase ?? null }
        : null,
    // The maker's own soundtrack for an authored map (the Studio's "Map
    // track" and its areas). Absent on the shipped world.
    mapMusic: content.music ?? null,
  };
}
