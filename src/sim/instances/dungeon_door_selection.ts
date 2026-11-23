import type { Entity, Vec3 } from '../types';

/** Select one reachable door without depending on entity spawn order. */
export function nearestDungeonDoor(
  entities: ReadonlyMap<number, Entity>,
  doorIds: readonly number[],
  pos: Vec3,
  radius: number,
  corpseDungeonId: string | null,
): Entity | null {
  let best: Entity | null = null;
  let bestDistance = Infinity;
  for (const id of doorIds) {
    const door = entities.get(id);
    if (!door?.dungeonId) continue;
    const dx = pos.x - door.pos.x;
    const dz = pos.z - door.pos.z;
    const dy = pos.y - door.pos.y;
    const distance = dx * dx + dz * dz + dy * dy;
    if (distance >= radius * radius) continue;
    const preferred = door.dungeonId === corpseDungeonId;
    const bestPreferred = best?.dungeonId === corpseDungeonId;
    if (
      !best ||
      (preferred && !bestPreferred) ||
      (preferred === bestPreferred &&
        (distance < bestDistance || (distance === bestDistance && door.id < best.id)))
    ) {
      best = door;
      bestDistance = distance;
    }
  }
  return best;
}
