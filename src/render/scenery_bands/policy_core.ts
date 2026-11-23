// Literal measured Low policy. Rendering adapters supply object identity and
// footprint; this module has no dependency on Three, the scene or the device.
import type { Bounds, SceneryRegion } from './types';

export const LOW_SCENERY_BUDGET = {
  full: 60,
  placementMargin: 4,
  middle: 120,
  far: 240,
  horizon: 480,
  fadeEnd: 560,
  middleTriangles: 512,
  palmMiddleTriangles: 256,
  farTriangles: 32,
  outerTriangles: 12,
  giantViews: 16,
  giantCellPixels: 256,
} as const;

export function footprintDistance(bounds: Bounds, x: number, z: number): number {
  return Math.hypot(
    Math.max(bounds[0] - x, x - bounds[1], 0),
    Math.max(bounds[2] - z, z - bounds[3], 0),
  );
}

export interface PlacementDistance {
  kind: 'foliage' | 'zone-instance' | 'landmark';
  bounds: Bounds;
  x: number;
  z: number;
}
export function placementDistance(item: PlacementDistance, x: number, z: number): number {
  return item.kind === 'foliage'
    ? Math.hypot(item.x - x, item.z - z)
    : footprintDistance(item.bounds, x, z);
}

export type LowSceneryRepresentation = 'source' | 'middle' | 'far' | 'outer' | 'sprite' | 'absent';
export function lowSceneryRepresentation(
  item: PlacementDistance,
  x: number,
  z: number,
  giant: boolean,
  maxDistance: number = LOW_SCENERY_BUDGET.fadeEnd,
): LowSceneryRepresentation {
  const distance = placementDistance(item, x, z);
  const near = LOW_SCENERY_BUDGET.full + (item.kind === 'foliage' ? 0 : 4);
  if (distance <= near) return 'source';
  if (distance > Math.min(LOW_SCENERY_BUDGET.fadeEnd, maxDistance)) return 'absent';
  if (giant) return 'sprite';
  if (distance <= LOW_SCENERY_BUDGET.middle) return 'middle';
  if (distance <= LOW_SCENERY_BUDGET.far) return 'far';
  return 'outer';
}

export function palmBudgetTree(
  x: number,
  z: number,
  rootName: string,
  materialName: string,
  zone: SceneryRegion,
): boolean {
  return (
    x >= zone.xMin &&
    x < zone.xMax &&
    z >= zone.zMin &&
    z < zone.zMax &&
    (/^(Bark_|Leaves_)/.test(materialName) ||
      (rootName === 'jungle-features' && materialName === 'Atlas'))
  );
}
