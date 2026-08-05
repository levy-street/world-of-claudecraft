// Pure zone-to-zone route planning for the multi-zone rotation: a static
// walkability graph over the zone rectangles (ZONES, src/sim/data.ts) plus
// the paired overworld portals (PORTALS), and a BFS path finder over it.
//
// Adjacency rules, derived from the ZoneDef pass fields:
// - A shared z border (a's zMax = b's zMin, with real x overlap) is walkable
//   through the NORTHERN zone's southern ridge pass: southPassX, defaulting
//   to 0 (the original central road). A northern zone with sealedSouthBorder
//   has no pass: the edge is unwalkable (portal-only by content design).
// - A shared x border (a's xMax = b's xMin, with real z overlap) is walkable
//   when either side declares the pass (eastPassZ on the west zone or
//   westPassZ on the east zone); neither declared means a sealed ridge, so
//   the edge is unwalkable (eastbrook_vale to farshore_isle is the live
//   example).
// - Each portal whose two ends land in different zones adds a zero-cost edge
//   per direction; the waypoint is the portal mouth on the FROM side (the
//   sim teleports on contact, portals.ts).
//
// The crossing waypoint for a walkable border is the pass coordinate on that
// border. Unwalkable pairs simply have no edge, so findZonePath routes
// around them honestly.

import type { PortalDef, ZoneDef } from '../src/sim/types';

// Zone rects omit xMin/xMax for the original full-width strip.
const STRIP_HALF_WIDTH = 180;

export interface ZoneHop {
  // The zone this hop enters...
  zoneId: string;
  // ...by crossing at this waypoint (a border pass or a portal mouth).
  waypoint: { x: number; z: number };
}

export type ZoneGraph = ReadonlyMap<string, readonly ZoneHop[]>;

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

function rectOf(zone: ZoneDef): Rect {
  return {
    x0: zone.xMin ?? -STRIP_HALF_WIDTH,
    x1: zone.xMax ?? STRIP_HALF_WIDTH,
    z0: zone.zMin,
    z1: zone.zMax,
  };
}

function zoneIdAt(zones: readonly ZoneDef[], x: number, z: number): string | null {
  for (const zone of zones) {
    const r = rectOf(zone);
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return zone.id;
  }
  return null;
}

export function buildZoneGraph(
  zones: readonly ZoneDef[],
  portals: readonly PortalDef[] = [],
): ZoneGraph {
  const edges = new Map<string, ZoneHop[]>();
  const link = (from: string, to: string, waypoint: { x: number; z: number }): void => {
    const list = edges.get(from) ?? [];
    list.push({ zoneId: to, waypoint });
    edges.set(from, list);
  };

  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i];
      const b = zones[j];
      const ra = rectOf(a);
      const rb = rectOf(b);

      // Shared z border: one zone's zMax is the other's zMin, x ranges overlap.
      for (const [south, north, rs, rn] of [
        [a, b, ra, rb],
        [b, a, rb, ra],
      ] as const) {
        if (rs.z1 !== rn.z0) continue;
        const lo = Math.max(rs.x0, rn.x0);
        const hi = Math.min(rs.x1, rn.x1);
        if (hi - lo <= 0) continue;
        if (north.sealedSouthBorder) continue; // no road pass: portal-only by design
        // The pass defaults to 0 (the original strip's central road), which
        // only counts when 0 is on the shared segment: a column border with
        // no declared pass is unwalkable (farshore_isle, by content design).
        const passX = north.southPassX ?? 0;
        if (passX < lo || passX > hi) continue;
        const waypoint = { x: passX, z: rn.z0 };
        link(south.id, north.id, waypoint);
        link(north.id, south.id, waypoint);
      }

      // Shared x border: one's xMax is the other's xMin, z ranges overlap.
      for (const [west, east, rw, re] of [
        [a, b, ra, rb],
        [b, a, rb, ra],
      ] as const) {
        if (rw.x1 !== re.x0) continue;
        const lo = Math.max(rw.z0, re.z0);
        const hi = Math.min(rw.z1, re.z1);
        if (hi - lo <= 0) continue;
        const passZ = west.eastPassZ ?? east.westPassZ;
        if (passZ === undefined) continue; // sealed ridge: unwalkable
        if (passZ < lo || passZ > hi) continue;
        const waypoint = { x: rw.x1, z: passZ };
        link(west.id, east.id, waypoint);
        link(east.id, west.id, waypoint);
      }
    }
  }

  for (const portal of portals) {
    const fromA = zoneIdAt(zones, portal.a.x, portal.a.z);
    const fromB = zoneIdAt(zones, portal.b.x, portal.b.z);
    if (!fromA || !fromB || fromA === fromB) continue;
    link(fromA, fromB, { x: portal.a.x, z: portal.a.z });
    link(fromB, fromA, { x: portal.b.x, z: portal.b.z });
  }

  return edges;
}

// BFS from one zone to another. Returns the hop list (cross at waypoint into
// zoneId, in order), [] when already there, null when unreachable.
export function findZonePath(
  graph: ZoneGraph,
  fromZoneId: string,
  toZoneId: string,
): ZoneHop[] | null {
  if (fromZoneId === toZoneId) return [];
  const prev = new Map<string, { from: string; waypoint: { x: number; z: number } }>();
  const queue = [fromZoneId];
  const seen = new Set([fromZoneId]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const hop of graph.get(current) ?? []) {
      if (seen.has(hop.zoneId)) continue;
      seen.add(hop.zoneId);
      prev.set(hop.zoneId, { from: current, waypoint: hop.waypoint });
      if (hop.zoneId === toZoneId) {
        const path: ZoneHop[] = [];
        let cursor = toZoneId;
        while (cursor !== fromZoneId) {
          const step = prev.get(cursor);
          if (!step) break;
          path.unshift({ zoneId: cursor, waypoint: step.waypoint });
          cursor = step.from;
        }
        return path;
      }
      queue.push(hop.zoneId);
    }
  }
  return null;
}
