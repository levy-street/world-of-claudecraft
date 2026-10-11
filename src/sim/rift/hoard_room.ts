// The room in front of a Buried Hoard boss, measured off the floor's own shell
// so an arena mechanic fits whatever hoard this is. Pure geometry, no rng: the
// floor is regenerated from the instance's seed, exactly as the run built it.

import { riftInstanceOrigin } from '../data';
import type { Entity } from '../types';
import { generateRiftFloor } from './rift_gen';
import type { RiftInstance } from './types';

export interface HoardRoom {
  /** Which way along z the room opens from the boss. */
  forwardSign: 1 | -1;
  /** The narrowest half-width met on the way, measured off the boss's own line. */
  halfWidth: number;
  /** How far forward the room stays at least `neededHalfWidth` wide. */
  clearDepth: number;
}

/** Walk forward from where the boss STANDS: the room is "clear" while it stays
 *  `neededHalfWidth` wide, out to `maxDepth`. With no clear step at all the width
 *  falls back to `neededHalfWidth` and the depth to zero. */
export function measureHoardRoom(
  inst: RiftInstance,
  boss: Entity,
  neededHalfWidth: number,
  maxDepth: number,
): HoardRoom {
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const layout = generateRiftFloor(inst.seed, inst.baseLevel, inst.floorIndex, inst.upgrade).layout;
  const localX = boss.pos.x - origin.x;
  const localZ = boss.pos.z - origin.z;
  const forwardSign: 1 | -1 = layout.sideWallZ < localZ ? -1 : 1;
  const right = (layout.shellPolygon ?? []).filter((p) => p.x > 0).sort((a, b) => a.z - b.z);
  const halfWidthAt = (z: number): number => {
    let before: { x: number; z: number } | undefined;
    for (const point of right) {
      if (z <= point.z) {
        if (!before) return point.x;
        const t = (z - before.z) / Math.max(1e-6, point.z - before.z);
        return before.x + (point.x - before.x) * t;
      }
      before = point;
    }
    return before?.x ?? layout.floorHalfX ?? 20;
  };
  let narrowest = Number.POSITIVE_INFINITY;
  let clearDepth = 0;
  for (let step = 2; step <= maxDepth; step += 2) {
    const z = localZ + forwardSign * step;
    if (z < layout.zMin + 2 || z > layout.zMax - 2) break;
    const half = halfWidthAt(z) - Math.abs(localX);
    if (half < neededHalfWidth) break;
    narrowest = Math.min(narrowest, half);
    clearDepth = step;
  }
  if (!Number.isFinite(narrowest)) narrowest = neededHalfWidth;
  return { forwardSign, halfWidth: narrowest, clearDepth };
}
