// Seat anchors: the generic "sit on furniture" vocabulary, shared by the sim (the sit
// command's checks, seat occupancy), the renderer (where a seated body is drawn and in
// which pose) and the client's seat picking. A pure leaf: no SimContext, no rng, no
// clock. A building DECLARES its anchors as data (content/mirefen_tavern_seats.ts is the
// first); content/seats.ts merges every building's list into the one registry.
//
// The model, load-bearing for every consumer:
//  - A seated body's SIM position is the seat's STAND spot, a collision-free point on the
//    floor beside the seat (the body never stands on the furniture, so no collider, no
//    physics step and no movement prediction ever has to know about chairs). Its facing
//    is the seat's facing.
//  - A seat is HELD by whoever sits (sitting, eating or drinking) on its stand spot: the
//    occupancy is derived from the entities alone, never stored, so a stand-up by any path
//    (moving, a hit, a cast, death, logout, a teleport) frees the seat by construction.
//  - The renderer draws a seated body at the seat's ANCHOR: the point on the seat surface
//    under the hip joints, turned to the seat's facing, and picks the clip family by the
//    seat's pose. The chair clips are authored with that anchor at their root.
//
// Every position here is in world yards; facing is the sim's convention, atan2(dx, dz).

/** Which authored clip family a seat takes: `upright` on backless benches and stools,
 *  `relaxed` against a backrest (settles, chairs), `high` on a bar stool with its feet on
 *  the footrest ring. */
export type SeatPose = 'upright' | 'relaxed' | 'high';

/** What piece of furniture a seat belongs to (flavour for tests and the renderer's pick). */
export type SeatKind = 'bench' | 'settle' | 'chair' | 'stool' | 'barStool';

/** A click volume: an oriented box on the floor, `rot` its world yaw (three.js
 *  rotation.y), its half extents along its own x and z, from `y0` up to `y1`. */
export interface SeatPickBox {
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
  y0: number;
  y1: number;
}

export interface SeatAnchor {
  /** Stable id (the wire token of the sit command). */
  id: string;
  /** The seats sharing one piece of furniture (a bench's two or three places): a click on
   *  a held one falls to the nearest free one of the same group. */
  group: string;
  kind: SeatKind;
  pose: SeatPose;
  /** The seat surface under the hip joints (the drawn body's root). */
  x: number;
  z: number;
  /** The seat surface's height (a cushion's top where it has one). */
  seatY: number;
  /** The floor the feet rest on. */
  floorY: number;
  /** The way a seated body faces. */
  facing: number;
  /** Where the body stands while seated (and stands up), clear of every collider. */
  standX: number;
  standZ: number;
  /** How far in front of the anchor the drawn body stands to sit down and after getting up
   *  (the chair clips' standing frames are authored further out; where furniture stands
   *  closer, the drawn body steps in from this nearer spot). */
  presit: number;
  /** Where the drawn body walks through between the stand spot and the seat, when it must
   *  come in round something (a booth's inner place slides in along the gap between settle
   *  and table). Absent: a straight line. */
  via?: { x: number; z: number };
  /** The seat's share of its furniture, for the pointer. */
  pick: SeatPickBox;
}

/** The authored clips' seat heights over the floor (Sit_Chair_* and Sit_High_*). */
export const SEAT_CHAIR_HEIGHT = 0.9;
export const SEAT_HIGH_HEIGHT = 1.0;

/** How near its stand spot a seated body must be to hold the seat. The sit command puts the
 *  body exactly on it, and stand spots of one building stay further apart than twice this. */
export const SEAT_HOLD_RADIUS = 0.3;
/** How far under or over the seat's floor a body may stand and still hold it. */
export const SEAT_HOLD_RISE = 0.9;

/** How far from a seat's stand spot the sit command reaches (the client walks the body to
 *  the spot; this only absorbs the last step and the round trip's lag). */
export const SEAT_REACH = 1.6;

/** The seated body's drawn root height (the root is where the buttocks meet the seat): the
 *  seat surface, except that a cushion gives under the body, down to the height the chair
 *  clips were authored on (never below the board under it). A bar stool takes its own
 *  clips at its own height. The rig is chibi: seated on these seats its feet hang. */
export function seatRootY(seat: Pick<SeatAnchor, 'pose' | 'seatY' | 'floorY'>): number {
  if (seat.pose === 'high') return seat.seatY;
  return Math.min(seat.seatY, seat.floorY + SEAT_CHAIR_HEIGHT);
}

/** The body facts occupancy reads (an Entity satisfies it structurally). */
export interface SeatedBodyLike {
  id: number;
  pos: { x: number; y: number; z: number };
  dead: boolean;
  sitting: boolean;
  eating?: unknown;
  drinking?: unknown;
}

/** Whether a body sits (or eats or drinks, which seats it) on this seat's stand spot. */
export function bodyHoldsSeat(e: SeatedBodyLike, seat: SeatAnchor): boolean {
  if (e.dead) return false;
  if (!e.sitting && !e.eating && !e.drinking) return false;
  if (Math.abs(e.pos.y - seat.floorY) > SEAT_HOLD_RISE) return false;
  return Math.hypot(e.pos.x - seat.standX, e.pos.z - seat.standZ) <= SEAT_HOLD_RADIUS;
}

/** The seat a seated body holds, or null (a body sitting anywhere else sits on the floor). */
export function seatHeldBy(e: SeatedBodyLike, seats: readonly SeatAnchor[]): SeatAnchor | null {
  if (!e.sitting && !e.eating && !e.drinking) return null;
  for (const seat of seats) if (bodyHoldsSeat(e, seat)) return seat;
  return null;
}

/** The body holding a seat (other than `exceptId`), or null when it is free. */
export function seatHolder<E extends SeatedBodyLike>(
  bodies: Iterable<E>,
  seat: SeatAnchor,
  exceptId = -1,
): E | null {
  for (const e of bodies) if (e.id !== exceptId && bodyHoldsSeat(e, seat)) return e;
  return null;
}
