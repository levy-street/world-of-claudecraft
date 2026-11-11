// One hunt ring for a map's authored wolf camps, including their spawn radii.
// The caller selects the zone; this leaf never reads mutable world state.
import { campLiveArea } from '../sim/camp_scatter';
import type { CampDef } from '../sim/types';

export function wolfHuntArea(
  camps: readonly CampDef[],
): { x: number; z: number; radius: number } | null {
  // Each camp counts where its live wolves stand (pinned spots, retired slots).
  const wolves = camps
    .filter((camp) => camp.mobId === 'forest_wolf')
    .map(campLiveArea)
    .filter((area): area is { x: number; z: number; radius: number } => area !== null);
  if (wolves.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const area of wolves) {
    minX = Math.min(minX, area.x - area.radius);
    maxX = Math.max(maxX, area.x + area.radius);
    minZ = Math.min(minZ, area.z - area.radius);
    maxZ = Math.max(maxZ, area.z + area.radius);
  }
  const x = (minX + maxX) / 2;
  const z = (minZ + maxZ) / 2;
  let radius = 0;
  for (const area of wolves) {
    radius = Math.max(radius, Math.hypot(area.x - x, area.z - z) + area.radius);
  }
  return { x, z, radius };
}
