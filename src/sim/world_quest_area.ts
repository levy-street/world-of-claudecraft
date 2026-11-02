// The one "is this point inside a world quest's area" test. The sim uses it to
// start, pause and clear a quest as the player crosses the edge, and the HUD
// tracker uses the same rule to list a world quest only while the player stands
// in its area, so the two can never disagree about where the edge is.
//
// A kill quest's area is its whole zone: the target counts wherever it is
// hunted in that zone, by a player who is also in that zone. Its authored ring
// (quest.area) stays the map's hint of where the target's camps are and where
// the champion rises, never a credit edge. Every other objective keeps its ring,
// since a station, a board or an escort route is a place, not a hunt.
import { getActiveWorldContent, zoneAt } from './data';
import type { Vec3, WorldQuestDef } from './types';

export function worldQuestCoversWholeZone(quest: Pick<WorldQuestDef, 'objective'>): boolean {
  return quest.objective.type === 'kill';
}

// Callers test one position against each active quest in turn (the per-tick
// area sweep, a kill's recipients), so the last lookup is memoised. Keyed on the
// zone table too, so a content swap (a Studio map) never reuses a stale answer.
let memoZones: unknown = null;
let memoX = Number.NaN;
let memoZ = Number.NaN;
let memoZoneId = '';

function zoneIdAt(x: number, z: number): string {
  const zones = getActiveWorldContent().zones;
  if (x !== memoX || z !== memoZ || zones !== memoZones) {
    memoZoneId = zoneAt(x, z).id;
    memoX = x;
    memoZ = z;
    memoZones = zones;
  }
  return memoZoneId;
}

export function positionInWorldQuestArea(
  pos: Pick<Vec3, 'x' | 'z'>,
  quest: Pick<WorldQuestDef, 'area' | 'zoneId' | 'objective'>,
): boolean {
  if (worldQuestCoversWholeZone(quest)) return zoneIdAt(pos.x, pos.z) === quest.zoneId;
  const dx = pos.x - quest.area.x;
  const dz = pos.z - quest.area.z;
  return dx * dx + dz * dz <= quest.area.radius * quest.area.radius;
}
