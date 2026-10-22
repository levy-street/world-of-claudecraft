import type { Collider } from './collider_shapes';
import { campCrateShape } from './prop_layout';
import type { ZonePropsDef } from './types';
import { propSourceIndex } from './world_layout/props';

/** Preserve the renderer's original crate/barrel variant and stacked top. */
export function pushCampCrateColliders(
  out: Collider[],
  props: ZonePropsDef,
  topAt: (x: number, z: number, height: number) => number,
): void {
  props.crates.forEach(([x, z, stack], index) => {
    const shape = campCrateShape(x, z, propSourceIndex(props, 'crates', index));
    const top = shape.top * (stack ?? 1);
    out.push({
      type: 'circle',
      x,
      z,
      r: shape.r,
      cameraTopY: topAt(x, z, top),
      moveTopY: topAt(x, z, top),
      underY: topAt(x, z, 0),
      standable: true,
    });
  });
}
