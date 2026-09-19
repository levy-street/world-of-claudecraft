// A shared, late terrain pad seats the stone hall and its walk-up on level ground.
// Sampling the unpadded height avoids recursion through world.terrainHeight.
import { getContentGeneration, isBuiltinWorldActive } from './data';
import { EASTBROOK_LAYOUT } from './eastbrook_layout';

let anchor: { seed: number; generation: number; height: number } | undefined;
export function applyEastbrookVaultPad(
  x: number,
  z: number,
  seed: number,
  height: number,
  sampleBase: (x: number, z: number, seed: number) => number,
  memoize = true,
): number {
  const hall = EASTBROOK_LAYOUT.weeklyVault;
  if (Math.abs(x - hall.x) > 18 || Math.abs(z - hall.z) > 18) return height;
  if (!isBuiltinWorldActive()) return height;
  const dx = x - hall.x,
    dz = z - hall.z;
  const lx = dx * Math.cos(hall.rot) - dz * Math.sin(hall.rot);
  const lz = dx * Math.sin(hall.rot) + dz * Math.cos(hall.rot);
  const distance = Math.hypot(
    Math.max(0, Math.abs(lx) - hall.w / 2 - 0.5),
    Math.max(0, -hall.d / 2 - 0.5 - lz, lz - hall.d / 2 - 3.5),
  );
  if (distance >= 4) return height;
  const t = 1 - distance / 4;
  // Forced calm probes must neither consume nor overwrite the ordinary anchor.
  if (!memoize)
    return height + (sampleBase(hall.keeper.x, hall.keeper.z, seed) - height) * t * t * (3 - 2 * t);
  const generation = getContentGeneration();
  if (!anchor || anchor.seed !== seed || anchor.generation !== generation)
    anchor = { seed, generation, height: sampleBase(hall.keeper.x, hall.keeper.z, seed) };
  return height + (anchor.height - height) * t * t * (3 - 2 * t);
}
