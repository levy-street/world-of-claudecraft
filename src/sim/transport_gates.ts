// Transport berth gates: the scheduled ship's deck exists only where, and
// while, the ship lies docked. Every route berth's hull (the Phase 1 layout,
// content/transport_ships.ts) is placed ONCE into the static collider grid,
// each collider tagged with its berth's gate id, and the grid holds a gate
// open (colliders in their cells) or closed (colliders out of them)
// (colliders.ts setColliderGateOpen). Every collision consumer (movement,
// support, sight, the renderer's seating, the online self-extrapolator) reads
// the same cells, so a closed berth is simply water everywhere at once.
//
// Which gates are open is a pure function of the schedule clock
// (transport_schedule.ts). The owning world re-applies it every tick (the
// Sim, transport_ferry.ts) or every snapshot (the online ClientWorld), and
// the grid is BUILT in the clock-0 state (docked at each route's first
// berth), so a world that never ticks still sees each ship moored there
// (Eastbrook and Wickharbor). The grid is shared per (content, seed) inside one process, so
// two worlds at different ferry phases in ONE process contend for it. The realm server does
// build short-lived Sims on the live seed beside its world (character creation, PBE boosts),
// and each one's constructor sync sets the gates to the clock-0 state until the live world's
// next tick; the re-apply at the top of every tick heals that within the tick and keeps each
// world's own tick consistent.
//
// Pure leaf over the grid seam: no SimContext, no rng.

import type { Collider } from './colliders';
import { TRANSPORT_ROUTES, TRANSPORT_SHIP_HULLS } from './content/transport_ships';
import { harborRouteMarkerColliders } from './harbor_route_markers';
import { transportBerthOpenAt } from './transport_schedule';
import { shipHullColliders } from './transport_ship';
import { WATER_LEVEL } from './world';

/** The gate id of one route berth. */
export function transportGateId(routeId: string, berth: number): string {
  return `${routeId}:${berth}`;
}

/**
 * Every route berth's hull colliders, tagged with the berth's gate. Seated on
 * the waterline (a transport ship floats at WATER_LEVEL, the same seat the
 * renderer draws it on). Then the berths' harbor route markers
 * (harbor_route_markers.ts): one narrow post each, UNGATED, since the sign
 * stands on the pier whether or not the ship is in.
 */
export function transportBerthColliders(seed: number): Collider[] {
  const out: Collider[] = [];
  for (const route of TRANSPORT_ROUTES) {
    const hull = TRANSPORT_SHIP_HULLS[route.ship];
    if (!hull) continue;
    route.berths.forEach((berth, i) => {
      const gate = transportGateId(route.id, i);
      for (const c of shipHullColliders(hull, {
        x: berth.x,
        z: berth.z,
        rot: berth.rot,
        baseY: WATER_LEVEL,
      })) {
        c.gate = gate;
        out.push(c);
      }
    });
  }
  out.push(...harborRouteMarkerColliders(seed));
  return out;
}

/** The gates a freshly built grid starts CLOSED (the clock-0 schedule). */
export function transportGatesClosedAtBuild(): string[] {
  const out: string[] = [];
  for (const route of TRANSPORT_ROUTES) {
    for (let i = 0; i < route.berths.length; i++) {
      if (!transportBerthOpenAt(route, i, 0)) out.push(transportGateId(route.id, i));
    }
  }
  return out;
}

/**
 * Apply the schedule at `clock` to the seed's collider grid: each berth's
 * gate open iff the ship lies docked there. `setOpen` is colliders.ts
 * setColliderGateOpen (injected so this leaf never imports the collider
 * engine's runtime); an unchanged gate is a cheap no-op there.
 */
export function syncTransportGates(
  seed: number,
  clock: number,
  setOpen: (seed: number, gate: string, open: boolean) => void,
): void {
  for (let r = 0; r < TRANSPORT_ROUTES.length; r++) {
    const route = TRANSPORT_ROUTES[r];
    for (let i = 0; i < route.berths.length; i++) {
      setOpen(seed, GATE_IDS[r][i], transportBerthOpenAt(route, i, clock));
    }
  }
}

/** Every route berth's gate id, built once (the per-tick sync reuses them). */
const GATE_IDS: readonly (readonly string[])[] = TRANSPORT_ROUTES.map((route) =>
  route.berths.map((_, i) => transportGateId(route.id, i)),
);
