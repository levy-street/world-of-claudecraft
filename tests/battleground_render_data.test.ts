// Pins the pure placement math src/render/battleground.ts derives from the
// battleground layout: the road polylines the ribbon meshes follow and the
// deterministic scatter transforms. Everything visual is screenshot-verified;
// this only guards that the derivations stay glued to the layout data.
import { describe, expect, it } from 'vitest';
import { bgRoadPolyline, bgScatterPlacements } from '../src/render/battleground';
import {
  BG_LANE_GATE_X,
  BG_SCATTER,
  BG_WARSTONE_Z,
  bgLaneWaypoints,
} from '../src/sim/battleground_layout';

describe('battleground render placement data', () => {
  it('road polylines run warstone to warstone through the lane waypoints', () => {
    for (const lane of ['west', 'east'] as const) {
      const road = bgRoadPolyline(lane);
      // starts at team A's warstone, ends at team B's (mirrorX yields -0, so
      // compare numerically rather than by object identity)
      expect(road[0].x === 0 && road[0].z === -BG_WARSTONE_Z).toBe(true);
      const last = road[road.length - 1];
      expect(last.x === 0 && last.z === BG_WARSTONE_Z).toBe(true);
      // contains every attack waypoint of the lane, in order
      const way = bgLaneWaypoints('A', lane);
      const tail = road.slice(road.length - way.length);
      expect(tail).toEqual(way);
      // the lane's gate column is on the road
      const sign = lane === 'west' ? -1 : 1;
      expect(road.some((p) => p.x === sign * BG_LANE_GATE_X)).toBe(true);
    }
  });

  it('scatter placements are deterministic and cover every layout record', () => {
    const a = bgScatterPlacements();
    const b = bgScatterPlacements();
    expect(a).toEqual(b);
    expect(a.length).toBe(BG_SCATTER.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].kind).toBe(BG_SCATTER[i].kind);
      expect(a[i].x).toBe(BG_SCATTER[i].x);
      expect(a[i].z).toBe(BG_SCATTER[i].z);
      expect(a[i].yaw).toBeGreaterThanOrEqual(0);
      expect(a[i].yaw).toBeLessThanOrEqual(Math.PI * 2);
      expect(a[i].variant).toBeGreaterThanOrEqual(0);
      expect(a[i].variant).toBeLessThanOrEqual(1);
    }
    // the north-half records and their mirrored south twins land mirrored in z
    const half = a.length / 2;
    for (let i = 0; i < half; i++) {
      expect(a[i + half].x).toBe(a[i].x);
      expect(a[i + half].z).toBe(-a[i].z);
    }
  });
});
