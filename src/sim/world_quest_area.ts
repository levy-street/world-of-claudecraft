// The one "is this point inside a world quest's area" test. The sim uses it to
// start, pause and clear a quest as the player crosses the edge, and the HUD
// tracker uses the same rule to list a world quest only while the player stands
// in its area, so the two can never disagree about where the edge is.
import type { Vec3, WorldQuestDef } from './types';

export function positionInWorldQuestArea(
  pos: Pick<Vec3, 'x' | 'z'>,
  quest: Pick<WorldQuestDef, 'area'>,
): boolean {
  const dx = pos.x - quest.area.x;
  const dz = pos.z - quest.area.z;
  return dx * dx + dz * dz <= quest.area.radius * quest.area.radius;
}
