export interface SpawnArea {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * Stable low-discrepancy placement for new players. This uses no shared RNG,
 * so adding a spawn area cannot perturb world-generation draw order.
 */
export function spawnPointInArea(area: SpawnArea, slot: number): { x: number; z: number } {
  const minX = Math.min(area.minX, area.maxX);
  const maxX = Math.max(area.minX, area.maxX);
  const minZ = Math.min(area.minZ, area.maxZ);
  const maxZ = Math.max(area.minZ, area.maxZ);
  const n = Math.max(0, Math.floor(slot));
  const u = ((n + 0.5) * 0.6180339887498949) % 1;
  const v = ((n + 0.5) * 0.7548776662466927) % 1;
  return {
    x: minX + (maxX - minX) * u,
    z: minZ + (maxZ - minZ) * v,
  };
}
