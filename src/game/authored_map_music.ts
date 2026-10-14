// The authored-map half of the HUD's per-frame music input (instance_music.ts
// InstanceMusicInput), read from the live world. Moved out of hud.ts's music
// head so the coordinator passes one spread.
//
// The field is null on the shipped world, so the built-in soundtrack decision
// is exactly the location walk it always was.

import { getActiveWorldContent } from '../sim/data';
import type { InstanceMusicInput } from './instance_music';

export function authoredMapMusicInput(): Pick<InstanceMusicInput, 'mapMusic'> {
  return {
    // The maker's own soundtrack for an authored map (the Studio's "Map
    // track" and its areas). Absent on the shipped world.
    mapMusic: getActiveWorldContent().music ?? null,
  };
}
