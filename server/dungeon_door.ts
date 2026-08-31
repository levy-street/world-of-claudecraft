// The enter_dungeon door gate for the command router: the door entity for the
// requested dungeon must be within interaction reach of the player before the
// server asks the sim to admit them.

import type { Entity } from '../src/sim/types';

// The door interaction reach in yards; the command fails outside it.
const DUNGEON_DOOR_REACH = 8;

export function findDungeonDoorNear(
  entities: Iterable<Entity>,
  dungeonId: string,
  pos: { x: number; z: number },
): Entity | undefined {
  return [...entities].find(
    (x) =>
      x.templateId === 'dungeon_door' &&
      x.dungeonId === dungeonId &&
      Math.hypot(pos.x - x.pos.x, pos.z - x.pos.z) < DUNGEON_DOOR_REACH,
  );
}
