// Scripted boss flight, shared by the encounters that take a boss into the air
// (G26: the Hollow Crypt's Knellwyrm on its Pyre Strafe, Korzul the
// Gravewyrm's flights over the Wyrm's Hollow). Flying patrols are a separate
// thing (mob/patrol.ts flies them at an authored altitude); this module is
// the encounter half: place a flier at a claim-local point and height, the
// climb and glide curves, and the out-of-reach hold while it is on the wing.
//
// Pure positioning: no rng, fixed curves, so every host flies the same path.
// The height rides `pos.y`, which every client already mirrors (the renderer
// lifts the model; the selection ring hides under an airborne unit).

import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** The floor height under a claim-local point, in world yards. */
export function floorUnder(ctx: SimContext, inst: InstanceSlot, lx: number, lz: number): number {
  const o = ctx.instanceOriginOf(inst);
  return ctx.groundPos(o.x + lx, o.z + lz).y;
}

/** Put a flier at a claim-local point at a world height. */
export function placeFlier(
  ctx: SimContext,
  inst: InstanceSlot,
  e: Entity,
  lx: number,
  lz: number,
  y: number,
): void {
  const o = ctx.instanceOriginOf(inst);
  e.pos.x = o.x + lx;
  e.pos.z = o.z + lz;
  e.pos.y = y;
  ctx.grid.update(e);
}

/** The height a climb has reached at progress `k` (0 to 1): a quarter sine,
 *  quick off the ground and easing into the hover. */
export function climbArc(k: number, height: number): number {
  const t = Math.max(0, Math.min(1, k));
  return height * Math.sin((Math.PI / 2) * t);
}

/** Smoothstep ease (0 to 1) for a glide between two points. */
export function glideEase(k: number): number {
  const t = Math.max(0, Math.min(1, k));
  return t * t * (3 - 2 * t);
}

/** Step a flier toward a claim-local point at `speed` yards a second, holding
 *  `y`. Returns true once it is there. */
export function glideToward(
  ctx: SimContext,
  inst: InstanceSlot,
  e: Entity,
  tx: number,
  tz: number,
  y: number,
  speed: number,
  dt: number,
): boolean {
  const o = ctx.instanceOriginOf(inst);
  const lx = e.pos.x - o.x;
  const lz = e.pos.z - o.z;
  const dx = tx - lx;
  const dz = tz - lz;
  const d = Math.hypot(dx, dz);
  const step = speed * dt;
  if (d <= step) {
    placeFlier(ctx, inst, e, tx, tz, y);
    return true;
  }
  e.facing = Math.atan2(dx, dz);
  placeFlier(ctx, inst, e, lx + (dx / d) * step, lz + (dz / d) * step, y);
  return false;
}

/** Hold a boss on the wing out of reach for this tick, while it stays in its
 *  fight (in combat, its threat kept): nobody's target, immune, no swing. The
 *  mob AI may re-hostile it before the encounter's pass, so the encounter
 *  calls this every tick it flies. */
export function holdAloft(e: Entity): void {
  e.hostile = false;
  e.damageImmune = true;
  e.swingTimer = Math.max(e.swingTimer, 0.6);
}

/** Bring a held flier back into reach (landed). */
export function releaseAloft(e: Entity): void {
  e.hostile = true;
  e.damageImmune = false;
}
