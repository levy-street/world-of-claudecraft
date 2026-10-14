// The pass-under gate: a body deep in a cave tube or carve walks beneath a
// surface collider instead of hitting its 2D footprint. Extracted out of
// colliders.ts; resolvePosition and the physics solver both read it.

import type { Collider } from '../collider_shapes';
import { authoredMapActive } from '../data';

// Pass-under gate: a mover this tall (head height) fits beneath a collider
// whose base is at least the margin above the head, cave tubes run under
// surface props/trees/fences without hitting their 2D footprints, and an
// authored second storey does not wall the floor below. Colliders with no
// baseY (everything the shipped world builds) block at every depth.
const MOVER_HEAD_Y = 2.0;
const UNDER_PASS_MARGIN = 0.4;

export function passesUnder(c: Collider, moverY: number | undefined): boolean {
  // underY only matters where a body can walk beneath the surface (an authored
  // map's tubes and carves). The built-in world has neither, so its surface
  // props keep blocking at every depth exactly as they always have.
  const floor = c.underY !== undefined ? (authoredMapActive() ? c.underY : undefined) : c.baseY;
  return (
    moverY !== undefined && floor !== undefined && moverY + MOVER_HEAD_Y < floor - UNDER_PASS_MARGIN
  );
}
