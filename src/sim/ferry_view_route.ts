// Which scheduled route a player's ferry view shows (IWorld.ferryView): the
// route they ride, else the one whose ship or berth is nearest to them. One
// pure answer both worlds share (the offline Sim, transport_ferry.ts; the
// online ClientWorld, net/transport_wire.ts), so the HUD reads the same route
// in either host. Every route's ship is drawn from the shared clock anyway
// (render/deck_frame.ts); this only picks the one the timetable panel talks
// about.
//
// Pure leaf: no SimContext, no rng; the clock and the viewer come in.

import { TRANSPORT_ROUTES } from './content/transport_ships';
import { type TransportPose, transportShipPoseAt } from './transport_schedule';

const pose: TransportPose = { x: 0, z: 0, rot: 0 };

/**
 * The index into TRANSPORT_ROUTES of the route to show a viewer at (x, z)
 * who rides route `ridingIndex` (-1 on foot), at schedule `clock`: the ridden
 * route, else the nearest by its ship's pose or either of its berths (ties
 * go to the earlier route). -1 when no route runs.
 */
export function ferryViewRouteIndex(
  clock: number,
  x: number,
  z: number,
  ridingIndex: number,
): number {
  if (TRANSPORT_ROUTES.length === 0) return -1;
  if (ridingIndex >= 0 && ridingIndex < TRANSPORT_ROUTES.length) return ridingIndex;
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < TRANSPORT_ROUTES.length; i++) {
    const route = TRANSPORT_ROUTES[i];
    transportShipPoseAt(route, clock, pose);
    let d = Math.hypot(pose.x - x, pose.z - z);
    for (const b of route.berths) d = Math.min(d, Math.hypot(b.x - x, b.z - z));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The TRANSPORT_ROUTES index of a route id (-1 when unknown). */
export function transportRouteIndex(routeId: string | undefined): number {
  if (routeId === undefined) return -1;
  return TRANSPORT_ROUTES.findIndex((r) => r.id === routeId);
}
