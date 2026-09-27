import type { TransportFerryView } from '../sim/transport_schedule';

export type { TransportFerryView } from '../sim/transport_schedule';

// Scheduled transport (two ferries: Eastbrook Docks to Moonrest in the
// Nightbloom, and Wickharbor to the shore below Wyrmwatch in the Drakelands).
// The timetable is a pure function of the schedule clock
// (src/sim/transport_schedule.ts): the offline Sim reads its own clock, the
// online ClientWorld the clock the snapshot head carries, so both derive the
// same phase and ship pose. Boarding, carrying and set-down are server
// authoritative (src/sim/transport_ferry.ts); nothing here sends a command.
export interface IWorldTransport {
  /** One ferry's live state for the HUD: the route the viewing player
   *  rides, else the one nearest them (sim/ferry_view_route.ts, the same
   *  pick in both worlds). Its phase, the berth it lies at or is bound for,
   *  seconds to the next departure, the ship's pose, the schedule clock (one
   *  clock for every route: the renderer poses every ship from it), and
   *  whether the viewing player rides it. A LIVE object each world reuses:
   *  read it within the frame, never retain it. Null when no route runs (a
   *  custom editor world). */
  ferryView(): TransportFerryView | null;
}
