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

/** A ground sampler that can say when the ground it answers for was swapped. */
export interface GroundSampler {
  (x: number, z: number): number;
  /**
   * A number that changes whenever the same (x, z) may now read a different
   * height: another world seed, entering or leaving a Rift floor, the next
   * floor, another upgrade. A consumer that remembers heights compares it once
   * a frame and forgets them when it moves.
   */
  epoch(): number;
}

/** Cached ground sampler shared by effects that can appear on raised Rift arenas. */
export function createRiftAwareGroundSampler(
  worldSeed: () => number,
  currentFloor: () => RiftFloorView | null,
): GroundSampler {
  let cachedKey = '';
  let cachedUpgrade: RiftUpgradeManifest | null = null;
  let cachedPlan: ReturnType<typeof generateRiftFloor> | null = null;
  let epoch = 0;
  let epochWorld = Number.NaN;
  let epochFloor: RiftGroundDescriptor | null = null;
  let epochSeed = 0;
  let epochLevel = 0;
  let epochIndex = 0;
  let epochX = 0;
  let epochZ = 0;
  let epochUpgrade: RiftUpgradeManifest | null = null;
  const readEpoch = (): number => {
    const world = worldSeed();
    const floor: RiftGroundDescriptor | null = currentFloor();
    // Compared field by field: a host may hand out a fresh view object for the
    // same floor, and that must not read as new ground.
    const same =
      world === epochWorld &&
      (floor === null) === (epochFloor === null) &&
      (floor === null ||
        (floor.seed === epochSeed &&
          floor.baseLevel === epochLevel &&
          floor.floorIndex === epochIndex &&
          floor.origin.x === epochX &&
          floor.origin.z === epochZ &&
          floor.upgrade === epochUpgrade));
    if (same) return epoch;
    epochWorld = world;
    epochFloor = floor;
    if (floor) {
      epochSeed = floor.seed;
      epochLevel = floor.baseLevel;
      epochIndex = floor.floorIndex;
      epochX = floor.origin.x;
      epochZ = floor.origin.z;
      epochUpgrade = floor.upgrade;
    }
    epoch += 1;
    return epoch;
  };
  const sample = (x: number, z: number): number => {
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
  return Object.assign(sample, { epoch: readEpoch });
}
