// Camp-construction RNG selection. Established spawns keep consuming the one
// shared world stream; expansion-only tail spawns use a deterministic private
// stream so growing a camp cannot re-roll every later camp.

import { hash2, Rng } from './rng';
import type { CampDef } from './types';

export function createCampSpawnRngSelector(
  shared: Rng,
  worldSeed: number,
  camp: Pick<CampDef, 'center' | 'sharedRngCount'>,
): (spawnIndex: number) => Rng {
  const sharedRngCount = camp.sharedRngCount;
  if (sharedRngCount === undefined) return () => shared;

  const privateRng = new Rng(
    Math.floor(
      hash2(Math.round(camp.center.x * 10), Math.round(camp.center.z * 10), worldSeed) *
        0x1_0000_0000,
    ),
  );
  return (spawnIndex) => (spawnIndex < sharedRngCount ? shared : privateRng);
}
