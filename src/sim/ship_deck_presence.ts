// Is a body standing on (or in the air over) a scheduled ship's deck right
// now, moored or under way? The one question the mount rules ask of the
// ferry (mounts.ts: no mount is summoned aboard a ship, docked or sailing;
// a rider who boards on horseback is dismounted as the ship casts off,
// transport_ferry.ts). A leaf so the mount module never imports the ferry
// system (which imports the mount module to dismount at cast-off).
//
// Pure over the schedule clock: no rng, no state.

import { TRANSPORT_ROUTES, TRANSPORT_SHIP_HULLS } from './content/transport_ships';
import { isBuiltinWorldActive } from './data';
import type { SimContext } from './sim_context';
import { aboardDeck } from './transport_deck';
import { type TransportPose, transportShipPoseAt } from './transport_schedule';
import type { Entity } from './types';
import { WATER_LEVEL } from './world';

const pose: TransportPose = { x: 0, z: 0, rot: 0 };

/** Aboard a scheduled ship: a voyage under way, or on its moored deck. */
export function onShipDeck(ctx: SimContext, e: Entity): boolean {
  if (e.ferryRide) return true;
  if (!isBuiltinWorldActive()) return false;
  const clock = ctx.time + ctx.transportClockOffset;
  for (const route of TRANSPORT_ROUTES) {
    if (!Object.hasOwn(TRANSPORT_SHIP_HULLS, route.ship)) continue;
    transportShipPoseAt(route, clock, pose);
    const hull = TRANSPORT_SHIP_HULLS[route.ship];
    if (aboardDeck(hull, pose, WATER_LEVEL, e.pos.x, e.pos.y, e.pos.z)) return true;
  }
  return false;
}
