// Walled-village routing: the walled hubs and their gate crossings, built
// from the real layout exports (never hand-copied coordinates), plus a tiny
// waypoint planner for crossing a village wall.
//
// Covered hubs: eastbrook (EASTBROOK_LAYOUT.wall, 6 gates) and fenbridge
// (FENBRIDGE_LAYOUT.wall, 4 gates), both CircularWallConfig models with
// explicit gate crossings. The galecrest castle (castle_layout.ts) uses a
// different gate/courtyard model, not a circular wall with crossings, so it
// is deliberately out of scope.
//
// Routing rule: a waypoint is only needed when exactly one of (pos, target)
// sits inside a hub's wall circle. The route is then [best gate crossing,
// target], where best gate minimizes dist(pos, gate) + dist(gate, target);
// gateIndex picks the next-best gate instead (the brain bumps it after a
// failed approach). Both-inside routes direct, and both-outside routes
// direct too even when the ring lies between the points: gathering routes
// rarely cross hubs, and skirting a wall without obstacle probing is out of
// scope here.

import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { FENBRIDGE_LAYOUT } from '../src/sim/fenbridge_layout';

export interface WalledHub {
  id: string;
  center: { x: number; z: number };
  radius: number;
  gates: { x: number; z: number }[];
}

export const WALLED_HUBS: readonly WalledHub[] = [
  {
    id: 'eastbrook',
    center: EASTBROOK_LAYOUT.wall.center,
    radius: EASTBROOK_LAYOUT.wall.radius,
    gates: EASTBROOK_LAYOUT.wall.gates.map((g) => ({ x: g.crossing.x, z: g.crossing.z })),
  },
  {
    id: 'fenbridge',
    center: FENBRIDGE_LAYOUT.wall.center,
    radius: FENBRIDGE_LAYOUT.wall.radius,
    gates: FENBRIDGE_LAYOUT.wall.gates.map((g) => ({ x: g.crossing.x, z: g.crossing.z })),
  },
];

function dist2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return dx * dx + dz * dz;
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.sqrt(dist2(a, b));
}

function insideCircle(hub: WalledHub, p: { x: number; z: number }): boolean {
  return dist2(p, hub.center) < hub.radius * hub.radius;
}

// Waypoint list ending at target. See the header for the exact rule.
export function routeViaGates(
  pos: { x: number; z: number },
  target: { x: number; z: number },
  walls: readonly WalledHub[] = WALLED_HUBS,
  gateIndex = 0,
): { x: number; z: number }[] {
  for (const hub of walls) {
    if (insideCircle(hub, pos) === insideCircle(hub, target)) continue;
    const ranked = [...hub.gates].sort(
      (a, b) => dist(pos, a) + dist(a, target) - (dist(pos, b) + dist(b, target)),
    );
    const gate = ranked[Math.min(gateIndex, ranked.length - 1)];
    return [
      { x: gate.x, z: gate.z },
      { x: target.x, z: target.z },
    ];
  }
  return [{ x: target.x, z: target.z }];
}
