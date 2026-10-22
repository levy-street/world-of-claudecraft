import type { Collider } from './collider_shapes';
import type { ZonePropsDef } from './types';
import { civicGroundY } from './world_layout/civic';

export function pushWellColliders(
  out: Collider[],
  wells: ZonePropsDef['wells'],
  groundAt: (x: number, z: number) => number,
): void {
  for (const well of wells) {
    const seat = civicGroundY(well.id, well, groundAt);
    out.push({
      type: 'circle',
      x: well.x,
      z: well.z,
      r: well.r,
      cameraTopY: seat + (well.height ?? 3.7),
      underY: seat,
    });
  }
}
