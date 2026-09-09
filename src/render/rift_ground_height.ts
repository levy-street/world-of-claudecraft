// Shared support height for actionable Rift ground warnings. Both ordinary
// rune casts and lethal zones must sit above the same platform and boss dais.
import { generateRiftFloor, riftLiftAt } from '../sim/rift/rift_gen';
import type { RiftFloorView } from '../world_api/dungeons';
import { daisVisualLift } from './dais_lift';
import { dungeonDaisHasRaisedPlatform } from './dungeon';

export function riftGroundHeight(
  base: number,
  rf: RiftFloorView | null,
  x: number,
  z: number,
): number {
  if (!rf) return base;
  const floor = generateRiftFloor(rf.seed, rf.baseLevel, rf.floorIndex, rf.upgrade);
  const lx = x - rf.origin.x;
  const lz = z - rf.origin.z;
  const raised = floor.style.daisRaised ?? dungeonDaisHasRaisedPlatform(floor.style.kit);
  return base + riftLiftAt(floor, lx, lz) + daisVisualLift(floor.layout.dais, raised, lx, lz);
}
