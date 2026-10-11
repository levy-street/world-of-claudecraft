// The scheduled ferry's share of the server wire (src/sim/transport_ferry.ts is
// the authority; src/net/transport_wire.ts the client decode). The two
// entity-record splicers the snapshot builder shares live in
// server/entity_wire_cache.ts.
//
// The ferry's schedule clock IS the snapshot head's `time` in play, so the head
// normally carries nothing extra. Only while a dev skip is active
// (ALLOW_DEV_COMMANDS, /dev ferry: a non-zero Sim.transportClockOffset) does
// the head add `fc`, the offset clock, so online clients follow the jumped
// timetable. Built once per broadcast pass with the head (serialize-once).
//
// A passenger's record also carries `fry`, their spot on the moving deck in
// the hull's frame, taken at the ship's pose of the same tick as their world
// x/y/z: [route index, x, y, z, heading off the bow]. It rides the entity's
// dynamic fields (serialized once per entity per tick, like x/y/z, which a
// body on a moving ship changes every tick anyway), so it adds five short
// numbers per passenger in interest range and nothing for anyone else.

import { TRANSPORT_ROUTES } from '../src/sim/content/transport_ships';
import type { Sim } from '../src/sim/sim';
import { type DeckLocal, toDeckLocal } from '../src/sim/transport_deck';
import type { Entity } from '../src/sim/types';
import { WATER_LEVEL } from '../src/sim/world';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const deckSpot: DeckLocal = { x: 0, y: 0, z: 0, f: 0 };

/** A passenger's deck spot at full precision for the reconciliation self
 *  block, [route, x, y, z, f], or undefined for everyone else. The height
 *  here is the WORLD height, untouched: the hull never heaves in the sim,
 *  and the prediction's vertical tests must see the server's exact bits. */
export function ferryDeckReconWire(e: Entity): number[] | undefined {
  const ride = e.ferryRide;
  if (!ride) return undefined;
  const route = TRANSPORT_ROUTES.findIndex((r) => r.id === ride.route);
  if (route < 0) return undefined;
  toDeckLocal(ride.ship, WATER_LEVEL, e.pos.x, e.pos.y, e.pos.z, e.facing, deckSpot);
  return [route, deckSpot.x, e.pos.y, deckSpot.z, deckSpot.f];
}

/**
 * The frame a player's movement is measured in, with their position in it
 * written to `out`: -1 and the world position on foot, the route index and
 * the hull-frame spot aboard a sailing ship (the movement override epoch
 * compares steps in it, server/movement_override_epoch.ts).
 */
export function ferryMovementFrame(e: Entity, out: { x: number; y: number; z: number }): number {
  const ride = e.ferryRide;
  const route = ride ? TRANSPORT_ROUTES.findIndex((r) => r.id === ride.route) : -1;
  if (!ride || route < 0) {
    out.x = e.pos.x;
    out.y = e.pos.y;
    out.z = e.pos.z;
    return -1;
  }
  toDeckLocal(ride.ship, WATER_LEVEL, e.pos.x, e.pos.y, e.pos.z, e.facing, deckSpot);
  out.x = deckSpot.x;
  out.y = deckSpot.y;
  out.z = deckSpot.z;
  return route;
}

/** A passenger's `fry` wire value (the spot rounded like x/y/z, the height
 *  above the waterline), or undefined for everyone else. */
export function ferryDeckWire(e: Entity): number[] | undefined {
  const spot = ferryDeckReconWire(e);
  if (!spot) return undefined;
  const above = round2(spot[2] - WATER_LEVEL);
  return [spot[0], round2(spot[1]), above, round2(spot[3]), round3(spot[4])];
}

/** The head fragment for the ferry clock: `,"fc":<clock>` or ''. */
export function transportHeadJson(sim: Pick<Sim, 'time' | 'transportClockOffset'>): string {
  const offset = sim.transportClockOffset;
  if (!offset) return '';
  return `,"fc":${round2(sim.time + offset)}`;
}
