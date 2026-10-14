// Frees the reference-counted rock/cave ground-texture SETS that no placement or
// cave references anymore, so cycling the rock/cave texture picker (which streams
// a full 1024^2 PBR set per pick) no longer leaks VRAM for the session. Cheap: a
// handful of resident set materials; the caller throttles it. Textures shared
// with the base terrain splat are pinned and never freed here (the loader's
// reference count guards that).
//
// The used-key source is passed in, NOT read from getActiveWorldContent(): the
// editor renders from the DOCUMENT (map.placements / map.caves) while its active
// WorldContent carries `placements: []`, so reading the registry there would
// find zero used keys and wrongly free the set the maker is actively using.

import { disposeUnusedCaveGroundMats } from './cave_mesh';
import { disposeUnusedRockGroundMats } from './rock_gen';

export function gcGroundTextureSets(
  placements: readonly { rockTexId?: string }[],
  caves: readonly { tex?: string }[],
): void {
  const rockKeys = new Set<string>();
  for (const p of placements) {
    if (p.rockTexId) rockKeys.add(p.rockTexId);
  }
  disposeUnusedRockGroundMats(rockKeys);
  const caveKeys = new Set<string>();
  for (const c of caves) {
    if (c.tex) caveKeys.add(c.tex);
  }
  disposeUnusedCaveGroundMats(caveKeys);
}
