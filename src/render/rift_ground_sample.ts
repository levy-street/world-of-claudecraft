import { generateRiftFloor, riftLiftAt } from '../sim/rift/rift_gen';
import type { RiftUpgradeManifest } from '../sim/rift/types';
import { groundHeight } from '../sim/world';
import type { RiftFloorView } from '../world_api/dungeons';
import { daisVisualLift } from './dais_lift';
import { dungeonDaisHasRaisedPlatform } from './dungeon';

interface RiftGroundDescriptor {
  seed: number;
  baseLevel: number;
  floorIndex: number;
  origin: { x: number; z: number };
  upgrade: RiftUpgradeManifest | null;
}

/** Cached ground sampler shared by effects that can appear on raised Rift arenas. */
export function createRiftAwareGroundSampler(
  worldSeed: () => number,
  currentFloor: () => RiftFloorView | null,
): (x: number, z: number) => number {
  let cachedKey = '';
  let cachedUpgrade: RiftUpgradeManifest | null = null;
  let cachedPlan: ReturnType<typeof generateRiftFloor> | null = null;
  return (x, z) => {
    const base = groundHeight(x, z, worldSeed());
    const descriptor: RiftGroundDescriptor | null = currentFloor();
    if (!descriptor) return base;
    const key = `${descriptor.seed}:${descriptor.baseLevel}:${descriptor.floorIndex}`;
    if (key !== cachedKey || descriptor.upgrade !== cachedUpgrade) {
      cachedKey = key;
      cachedUpgrade = descriptor.upgrade;
      cachedPlan = generateRiftFloor(
        descriptor.seed,
        descriptor.baseLevel,
        descriptor.floorIndex,
        descriptor.upgrade,
      );
    }
    if (!cachedPlan) return base;
    const lx = x - descriptor.origin.x;
    const lz = z - descriptor.origin.z;
    const raised =
      !cachedPlan.outdoor &&
      (cachedPlan.style.daisRaised ?? dungeonDaisHasRaisedPlatform(cachedPlan.style.kit));
    return (
      base + riftLiftAt(cachedPlan, lx, lz) + daisVisualLift(cachedPlan.layout, raised, lx, lz)
    );
  };
}
