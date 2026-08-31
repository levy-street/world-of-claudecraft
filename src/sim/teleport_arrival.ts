import type { Entity } from './types';

// Land settled: no carried-over jump arc or fall distance from the far side
// (otherwise a teleport with an elevation delta can deal fall damage on arrival).
export function settleTeleportArrival(p: Entity): void {
  p.vy = 0;
  p.jumping = false;
  p.onGround = true;
  p.fallStartY = p.pos.y;
}
