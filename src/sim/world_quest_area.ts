// The one "is this point inside a world quest's area" test. The sim uses it to
// start, pause and clear a quest as the player crosses the edge, and the HUD
// tracker uses the same rule to list a world quest only while the player stands
// in its area, so the two can never disagree about where the edge is.
//
// A kill quest also covers its whole zone: the target counts wherever it is
// hunted in that zone, by a player who is also in that zone, as well as
// anywhere in its authored ring (never narrower than the ring, which can cross
// a zone border). The ring stays the map's hint of where the target's camps
// are and where the champion rises. Every other objective keeps only its ring,
// since a station, a board or an escort route is a place, not a hunt.
import { STRIP_MAX_X, STRIP_MIN_X, zoneAt } from './data';
import type { Vec3, WorldQuestDef } from './types';

export function worldQuestCoversWholeZone(quest: Pick<WorldQuestDef, 'objective'>): boolean {
  return quest.objective.type === 'kill';
}

/** The zone a position truly stands in, or null. zoneAt never answers
 *  "nowhere": off the map it falls back to the band holding z, which is how
 *  the instance plane far east would read as an overworld zone. So its answer
 *  only counts when the position sits inside that zone's own bounds. */
function overworldZoneIdAt(x: number, z: number): string | null {
  const zone = zoneAt(x, z);
  if (z < zone.zMin || z >= zone.zMax) return null;
  if (x < (zone.xMin ?? STRIP_MIN_X) || x >= (zone.xMax ?? STRIP_MAX_X)) return null;
  return zone.id;
}

export function positionInWorldQuestArea(
  pos: Pick<Vec3, 'x' | 'z'>,
  quest: Pick<WorldQuestDef, 'area' | 'zoneId' | 'objective'>,
): boolean {
  const dx = pos.x - quest.area.x;
  const dz = pos.z - quest.area.z;
  if (dx * dx + dz * dz <= quest.area.radius * quest.area.radius) return true;
  return worldQuestCoversWholeZone(quest) && overworldZoneIdAt(pos.x, pos.z) === quest.zoneId;
}
