// One hunt ring for a map's authored wolf camps, including their spawn radii.
// The caller selects the zone; this leaf never reads mutable world state.
import type { CampDef } from '../sim/types';

export function wolfHuntArea(
  camps: readonly CampDef[],
): { x: number; z: number; radius: number } | null {
  const wolves = camps.filter((camp) => camp.mobId === 'forest_wolf' && camp.count > 0);
  if (wolves.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const camp of wolves) {
    minX = Math.min(minX, camp.center.x - camp.radius);
    maxX = Math.max(maxX, camp.center.x + camp.radius);
    minZ = Math.min(minZ, camp.center.z - camp.radius);
    maxZ = Math.max(maxZ, camp.center.z + camp.radius);
  }
  const x = (minX + maxX) / 2;
  const z = (minZ + maxZ) / 2;
  let radius = 0;
  for (const camp of wolves) {
    radius = Math.max(radius, Math.hypot(camp.center.x - x, camp.center.z - z) + camp.radius);
  }
  return { x, z, radius };
}
