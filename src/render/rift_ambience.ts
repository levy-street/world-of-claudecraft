// Dynamic rift point-ambience sources: unlike the static world-built
// campfire/forge set (src/render/world_audio.ts, built once from fixed prop
// data), an active rift roller, open portal, or gliding player spawns, moves,
// and despawns during play, so this recomputes the live set from the entity
// snapshot every frame. Distance culling happens downstream in sfx.ts's
// tooFar check, same as the static sources, so this returns every live match
// unfiltered.

import type { Entity } from '../sim/types';
import type { AmbientPointSource } from './audio_sink';

// Writes the live rift ambience set into a CALLER-OWNED scratch array (cleared
// first), so a hot per-frame caller (renderer.ts updateCamera) can reuse one
// array across frames instead of allocating a fresh one every tick regardless
// of whether any rift entity is nearby (review finding, PR #2687; see
// src/render/CLAUDE.md "Performance discipline": reuse, don't allocate).
export function collectRiftAmbientSources(
  entities: ReadonlyMap<number, Entity>,
  out: AmbientPointSource[],
): void {
  out.length = 0;
  for (const e of entities.values()) {
    if (e.templateId === 'rift_portal') {
      out.push({
        id: `rift_portal:${e.id}`,
        kind: 'rift_portal',
        x: e.pos.x,
        y: e.pos.y,
        z: e.pos.z,
      });
    } else if (e.templateId === 'rift_roller') {
      out.push({
        id: `rift_roller:${e.id}`,
        kind: 'rift_roller',
        x: e.pos.x,
        y: e.pos.y,
        z: e.pos.z,
      });
    } else if (e.kind === 'player' && e.riftSliding) {
      // Any gliding player (self or another party member), not just self:
      // riftSliding already syncs for every entity (server/game.ts's `sld`
      // field drives the frozen-pose visual for anyone sliding), so this
      // reuses the same wire state rather than adding new sync surface.
      out.push({
        id: `rift_ice_glide:${e.id}`,
        kind: 'rift_ice_glide',
        x: e.pos.x,
        y: e.pos.y,
        z: e.pos.z,
      });
    }
  }
}

// Allocating convenience wrapper, kept for tests and any cold-path caller
// that wants a plain return value rather than the scratch-array contract.
export function riftAmbientSources(entities: ReadonlyMap<number, Entity>): AmbientPointSource[] {
  const sources: AmbientPointSource[] = [];
  collectRiftAmbientSources(entities, sources);
  return sources;
}
