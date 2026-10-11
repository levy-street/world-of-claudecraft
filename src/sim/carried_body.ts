// A carried body: a player an encounter holds in the air and moves itself (the
// Lady of the Bonechill's Frozen Embrace, encounters/hollow_crypt/lady.ts).
// While `Entity.carriedBy` names the carrier, the player's own locomotion is
// switched off (player_movement_modes.ts runs this as an exclusive mode): no
// gravity, no fall build-up, no velocity, so when the encounter lets go the
// body falls from where it is held, from rest, and nothing stale rides along.
// The encounter pins the pose each tick after the mob AI and holds the victim
// with an unbreakable stun, which also stands the online client's prediction
// down (the snapshot carries the airborne height as-is).
//
// Pure over the entity: no SimContext, no rng.

import { dist2d, type Entity } from './types';

/** A carrier this far from the body it holds has lost it (a teleport, a
 *  summon, an instance freed under them). */
export const CARRY_REACH = 8;

/** The exclusive step: true when an encounter carries this body (it owns the
 *  pose; the walking kernel must not run). A body whose carrier is gone, dead
 *  or out of reach is let go here (it falls from where it is), so no path that
 *  forgets the encounter can leave a player held for ever. */
export function advanceCarried(p: Entity, carrier: Entity | undefined): boolean {
  if (p.carriedBy === undefined) return false;
  if (!carrier || carrier.dead || dist2d(carrier.pos, p.pos) > CARRY_REACH) {
    dropBody(p);
    return false;
  }
  p.onGround = false;
  p.jumping = false;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  // A fall only counts from where the carrier lets go.
  p.fallStartY = p.pos.y;
  return true;
}

/** Take hold of a body (the encounter then pins its pose each tick). */
export function carryBody(p: Entity, carrierId: number): void {
  p.carriedBy = carrierId;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
}

/** Let go: the body falls from rest where it hangs (gravity takes it from the
 *  next tick; no fall damage builds over a short hold, the encounter deals its
 *  own impact). */
export function dropBody(p: Entity): void {
  p.carriedBy = undefined;
  p.onGround = false;
  p.jumping = false;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.fallStartY = p.pos.y;
}

/** Set a body down on its floor at `y` (a gentle release). */
export function setDownBody(p: Entity, y: number): void {
  p.carriedBy = undefined;
  p.pos.y = y;
  p.prevPos.y = y;
  p.onGround = true;
  p.jumping = false;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.fallStartY = y;
}
