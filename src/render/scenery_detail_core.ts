// Scenery colour submission policy. Shadows and materials retain their owners.
export type SceneryDetailLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type SceneryDetailBands = readonly [number, number, number, number, number];
export const SCENERY_DETAIL_EDGES = [60, 120, 240, 480] as const;

/** Hysteresis is outside the boundary: approaching always restores the finer
 * representation by its advertised distance, including the full-detail 60 yd. */
export function sceneryDetailLevel(
  distance: number,
  previous: number,
  bands: SceneryDetailBands,
): SceneryDetailLevel {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  let band = 0;
  while (band < SCENERY_DETAIL_EDGES.length) {
    const edge = SCENERY_DETAIL_EDGES[band];
    const margin = previous > bands[band] ? 0 : Math.min(8, edge * 0.05);
    if (distance <= edge + margin) break;
    band++;
  }
  return bands[band] as SceneryDetailLevel;
}

export interface SceneryRegion {
  xMin?: number;
  xMax?: number;
  zMin: number;
  zMax: number;
}

export function inSceneryRegion(x: number, z: number, region: SceneryRegion): boolean {
  return (
    x >= (region.xMin ?? -180) && x < (region.xMax ?? 180) && z >= region.zMin && z < region.zMax
  );
}

/** Absolute per-part budgets extend the measured Low bands to fuller presets.
 * A ratio alone lets the most expensive models retain most of their cost. */
export function sceneryReduction(
  level: number,
  triangles: number,
  palm: boolean,
): {
  triangles: number;
  error: number;
} {
  const budgets = [triangles, 2048, 1024, 512, 32, 12];
  const errors = [0, 0.002, 0.01, 0.01, 1, 1];
  const target = palm && level >= 2 && level <= 3 ? budgets[level] / 2 : budgets[level];
  return {
    triangles: Math.min(triangles, target),
    error: errors[level],
  };
}

/** Small dressing stops at the preset's full-detail edge. Larger scenery
 * replaces the original at every subsequent band; the native horizon wins. */
export function sceneryFullDistance(bands: SceneryDetailBands): number {
  const first = bands.findIndex((level) => level > 0);
  return first > 0 ? SCENERY_DETAIL_EDGES[first - 1] : Infinity;
}

export function sceneryFootprintDistance(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  x: number,
  z: number,
): number {
  return Math.hypot(Math.max(minX - x, x - maxX, 0), Math.max(minZ - z, z - maxZ, 0));
}
