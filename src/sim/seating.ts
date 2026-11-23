// Sitting on furniture: the sit command and standing up, behind the SimContext seam.
// The seats themselves are data (seat_anchor.ts, seat_registry.ts); this module owns the
// verbs.
//
// sitOnSeat: a player right-clicks a seat, the client walks the body to the seat's stand
// spot and sends the seat's id; the server re-checks everything here (the seat exists in
// this world, the body is alive, out of combat, free to move and not busy with another
// movement mode, stands within SEAT_REACH of the stand spot on the seat's floor, and nobody
// else holds the seat), then sets the body on the stand spot, turned to the seat's facing,
// seated. Occupancy is never stored: a seat is held by whoever sits on its stand spot
// (seat_anchor.ts bodyHoldsSeat), so two bodies can never share one and any stand-up frees
// it by construction. The existing `sitting` bit carries it everywhere (the wire's `sit`,
// the rest indicator, eating and drinking in the chair), and every path that already
// stands a body up (moving, jumping, a hit, casting, attacking) stands it up from a seat.
//
// Draws no rng; reads no clock.

import { forceDismount } from './mounts';
import { bodyHoldsSeat, SEAT_HOLD_RADIUS, SEAT_REACH, type SeatAnchor } from './seat_anchor';
import { seatById } from './seat_registry';
import type { SimContext } from './sim_context';
import { type Entity, isConsuming } from './types';

/** How far above or below the seat's floor a body may stand when it asks to sit. */
const SEAT_REACH_RISE = 1.2;

/** Why a sit was refused, or null when it may go ahead. */
export function seatRefusal(ctx: SimContext, p: Entity, seat: SeatAnchor): string | null {
  if (p.dead) return "You can't do that while dead.";
  if (p.inCombat) return "You can't do that while in combat.";
  if (p.auras.some((a) => ctx.isControlAura(a.kind))) return "Can't move!";
  const meta = ctx.players.get(p.id);
  if (
    p.chargeTargetId !== null ||
    p.leap != null ||
    p.climb != null ||
    p.valkyrsCalling != null ||
    p.ferryRide != null ||
    meta?.vehicle != null
  ) {
    return 'You are busy.';
  }
  if (
    Math.hypot(p.pos.x - seat.standX, p.pos.z - seat.standZ) > SEAT_REACH ||
    Math.abs(p.pos.y - seat.floorY) > SEAT_REACH_RISE
  ) {
    return 'Too far away.';
  }
  const taken = ctx.grid.someInRadius(
    seat.standX,
    seat.standZ,
    SEAT_HOLD_RADIUS + 0.05,
    (e) => e.id !== p.id && bodyHoldsSeat(e, seat),
  );
  if (taken) return 'Someone is already sitting there.';
  return null;
}

/** Sit the resolved player on a seat, after the server-side checks. Returns whether they
 *  sat. An unknown id (a stale or forged command) is refused silently. */
export function sitOnSeat(ctx: SimContext, seatId: string, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const seat = seatById(seatId);
  if (!seat) return false;
  const p = r.e;
  const refusal = seatRefusal(ctx, p, seat);
  if (refusal !== null) {
    ctx.error(p.id, refusal);
    return false;
  }
  if (p.castingAbility !== null) ctx.cancelCast(p);
  forceDismount(ctx, p);
  p.followTargetId = null;
  placeOnSeat(p, seat);
  return true;
}

/** Set a body down on a seat: on the stand spot, turned to the seat, seated (the sit
 *  command's last step, and how the tavern's patrons are spawned). */
export function placeOnSeat(e: Entity, seat: SeatAnchor): void {
  e.pos.x = seat.standX;
  e.pos.z = seat.standZ;
  e.facing = seat.facing;
  e.sitting = true;
}

/** Stand a body up (moved verbatim from sim.ts): the pose clears, and a meal or drink in
 *  progress ends with its line. A seated body stands where it is, on the seat's stand
 *  spot, so standing needs nothing seat-specific. */
export function standUp(ctx: SimContext, p: Entity): void {
  p.sitting = false;
  if (isConsuming(p)) {
    p.eating = null;
    p.drinking = null;
    ctx.emit({ type: 'log', text: 'You stand up.', color: '#999', pid: p.id });
  }
}
