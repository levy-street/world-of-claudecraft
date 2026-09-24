import type { Vec3 } from './types';

/** Shared deterministic placement for the physical hatch, whose earth mound
 * occupies a three-yard radius. No host state or random stream is consumed. */
export function findHoardEntrancePosition(
  player: Pick<Vec3, 'x' | 'z'>,
  facing: number,
  ground: (x: number, z: number) => Vec3,
  water: (x: number, z: number) => number,
): Vec3 | null {
  // Five yards remains the normal spawn. Alternate bearings are ordered by
  // angular distance from forward; wider rings are only tried when necessary.
  // Fixed bounds keep even an entirely flooded/custom map cheap and repeatable.
  for (const radius of [5, 7, 9, 12, 16, 20]) {
    for (let step = 0; step < 32; step++) {
      const offset = Math.ceil(step / 2) * (step % 2 === 0 ? -1 : 1);
      const angle = facing + offset * (Math.PI / 16);
      const pos = ground(player.x + Math.sin(angle) * radius, player.z + Math.cos(angle) * radius);
      let low = pos.y;
      let high = pos.y;
      let safe = true;
      for (let dx = -3; dx <= 3 && safe; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          if (dx * dx + dz * dz > 9) continue;
          const sample = ground(pos.x + dx, pos.z + dz);
          low = Math.min(low, sample.y);
          high = Math.max(high, sample.y);
          if (
            !Number.isFinite(sample.y) ||
            sample.y <= water(sample.x, sample.z) + 0.2 ||
            high - low > 1.2
          ) {
            safe = false;
            break;
          }
        }
      }
      if (safe) return pos;
    }
  }
  // Do not spend the map or create an underwater/inaccessible entrance.
  return null;
}
