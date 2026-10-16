// IWorld facet: sitting on furniture (src/sim/seating.ts, the seats themselves in
// src/sim/seat_anchor.ts + seat_registry.ts). One command: sit on a seat by its id.
// Everything a presentation layer needs to READ about seats is derived, not mirrored:
// the seats are static content both worlds import, and who holds one follows from the
// entities (a seated body on a seat's stand spot, seat_anchor.ts seatHolder), so there is
// no seat state to snapshot.
//
// Offline the Sim runs the command's checks itself; online ClientWorld sends `sit_seat`
// and the server re-checks everything (range, the seat exists, nobody holds it) before
// seating the player.

export interface IWorldSeating {
  /** Sit the local player on a seat (the client has walked them to its stand spot).
   *  Refusals arrive as the usual error toasts. */
  sitOnSeat(seatId: string): void;
}
