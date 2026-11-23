// Distant scenery stays present with the same materials, but can draw an
// authored coarse index list. Measure from the nearest footprint edge so a
// large instance batch never simplifies a hedge beside the camera.
export const SCENERY_LOD_HYSTERESIS = 0.1;

export function sceneryUsesCoarseGeometry(
  edgeDistance: number,
  farDistance: number,
  wasCoarse: boolean,
): boolean {
  if (!Number.isFinite(edgeDistance) || edgeDistance < 0 || !(farDistance > 0)) return false;
  const threshold = farDistance * (wasCoarse ? 1 - SCENERY_LOD_HYSTERESIS : 1);
  return edgeDistance >= threshold;
}
