// Is this entity a ferry passenger (aboard while the ship sails)? One
// predicate for both worlds: the offline Sim's entities carry the
// authoritative voyage (`ferryRide`, src/sim/transport_ferry.ts), the online
// mirror carries the wire's deck spot (`ferryRiding`, src/net/transport_wire.ts).
// The HUD and the renderer ask here, never which world they run in. Pure leaf.

import type { Entity } from './types';

type FerryFields = Pick<Entity, 'ferryRide' | 'ferryRiding'>;

/** Aboard the ferry while it sails: the moving deck carries the body. */
export function isFerryPassenger(e: FerryFields): boolean {
  return !!e.ferryRide || e.ferryRiding === true;
}
