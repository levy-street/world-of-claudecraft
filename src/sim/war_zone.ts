// The Breach, the eternal war zone at the center of Valdris (see
// docs/design/valdris-continent.md). Open-world faction PvP exists ONLY
// inside this zone band: players of different factions read as hostile to
// each other there (attackable, never heal-able), and nowhere else. Duels and
// the arena keep their own rules and take precedence at the isHostileTo choke
// point in sim.ts, which is the single caller of this module's verdict.
//
// Pure leaf module: stateless functions of entity + static zone data, no rng,
// no clock, no SimContext state, so it unit-tests directly and the renderer
// may share the same verdict for nameplate color (a sanctioned pure-helper
// import, like sim/world's terrainHeight).

import { factionOfRace } from './content/races';
import { DUNGEON_X_THRESHOLD, ZONES } from './data';
import type { Entity, PlayerFaction, Vec3, ZoneDef } from './types';

export const WAR_ZONE_ID = 'the_breach';

// Resolved once from the static zone table (null while the zone is not
// registered, which keeps every check a no-op in stripped-down test worlds).
const warZone: ZoneDef | null = ZONES.find((z) => z.id === WAR_ZONE_ID) ?? null;

/** A player's faction: a pure function of race (pre-race saves are Human/Kael). */
export function playerFaction(e: Entity): PlayerFaction {
  return factionOfRace(e.race ?? 'human');
}

/** Inside the Last Bastion truce ground: the war-zone hub and its immediate
 *  yard are the one spot in the Breach where the truce-flag holds (vendors,
 *  the graveyard, and the road gate stay ungankable). */
export function inWarZoneSanctuary(pos: Vec3): boolean {
  if (!warZone) return false;
  const dx = pos.x - warZone.hub.x;
  const dz = pos.z - warZone.hub.z;
  const r = warZone.hub.radius + 10;
  return dx * dx + dz * dz < r * r;
}

/** Inside the open-PvP band of the Breach. Instanced content (dungeons,
 *  arena, delves) lives in far-off x bands and is exempt by the x check. */
export function inEternalWarZone(pos: Vec3): boolean {
  if (!warZone) return false;
  if (pos.x > DUNGEON_X_THRESHOLD) return false;
  if (pos.z < warZone.zMin || pos.z >= warZone.zMax) return false;
  return !inWarZoneSanctuary(pos);
}

/** The war-zone PvP verdict between two PLAYER entities: hostile when their
 *  factions differ and both stand in the open Breach. Callers handle duels,
 *  arena, and self/dead checks; this is only the eternal-war rule. */
export function warZonePvpHostile(a: Entity, b: Entity): boolean {
  if (playerFaction(a) === playerFaction(b)) return false;
  return inEternalWarZone(a.pos) && inEternalWarZone(b.pos);
}
