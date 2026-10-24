import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customMapToWorldContent } from '../src/editor/custom_map';
import { parseMap } from '../src/editor/persist';
import { roadEditKey } from '../src/editor/road_edit_core';
import { type Collider, rotY } from '../src/sim/collider_shapes';
import { pushPlacementColliders } from '../src/sim/colliders_authored/placement_colliders';
import { setActiveWorldContent } from '../src/sim/data';
import {
  loadPublishedMap,
  MAP_SEED,
} from '../src/sim/maps/eastbrook_and_mirefen_changes.generated';
import type { PlacedAsset, WorldContent } from '../src/sim/types';
import { roadDistance } from '../src/sim/world';

// The combined Eastbrook and Mirefen map repainted every town with the
// Tidehold kit, so its roads were reworked to the new houses: no road runs
// through a building, and every town building's front door opens onto one.
// Both are read off the shipped (published) world with the sim's own
// roadDistance, the curve the terrain splat paints, so the road's meander and
// smoothing are part of what is checked.

// The terrain splat paints full road dirt inside 1.9 yd of the road curve
// (render/terrain_chunk_build.ts), fading out by 3.6 yd.
const ROAD_DIRT_HALF_WIDTH = 1.9;
const MARGIN = 0.25;
// A door counts as on the road when its doorstep sits inside the dirt fade.
const DOORSTEP_OUT = 3;
const DOORSTEP_REACH = 3;
const TOWN_RADIUS = 120;
const BUILDING_PATH = /^\/models\/(tidehold\/|props\/house_)/;

interface Footprint {
  path: string;
  x: number;
  z: number;
  rot: number;
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

const MAP_JSON = path.resolve(__dirname, '../data/maps/eastbrook_and_mirefen_changes.map.json');

let world: WorldContent;
let buildings: PlacedAsset[];
let footprints: Footprint[];

function colliderCorners(c: Collider): { x: number; z: number }[] {
  if (c.type === 'circle') {
    return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
      x: c.x + c.r * Math.cos((i * Math.PI) / 4),
      z: c.z + c.r * Math.sin((i * Math.PI) / 4),
    }));
  }
  if (c.type !== 'obb') throw new Error(`unexpected ${c.type} collider on a town building`);
  return [
    [-c.hw, -c.hd],
    [c.hw, -c.hd],
    [c.hw, c.hd],
    [-c.hw, c.hd],
  ].map(([u, v]) => {
    const r = rotY(u, v, c.rot);
    return { x: c.x + r.x, z: c.z + r.z };
  });
}

/** The building's lot: the box, in its own frame, round every collider it emits. */
function footprintOf(p: PlacedAsset): Footprint | null {
  const colliders: Collider[] = [];
  pushPlacementColliders(colliders, { ...world, placements: [p] }, MAP_SEED);
  if (colliders.length === 0) return null;
  const f: Footprint = {
    path: p.path,
    x: p.x,
    z: p.z,
    rot: p.rotY,
    minU: Infinity,
    maxU: -Infinity,
    minV: Infinity,
    maxV: -Infinity,
  };
  for (const c of colliders) {
    for (const q of colliderCorners(c)) {
      const l = rotY(q.x - p.x, q.z - p.z, -p.rotY);
      f.minU = Math.min(f.minU, l.x);
      f.maxU = Math.max(f.maxU, l.x);
      f.minV = Math.min(f.minV, l.z);
      f.maxV = Math.max(f.maxV, l.z);
    }
  }
  return f;
}

type Point = { x: number; z: number };

function distanceToPolyline(p: Point, line: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    const t =
      len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - abx * t, p.z - a.z - abz * t));
  }
  return best;
}

function at(f: Footprint, u: number, v: number): { x: number; z: number } {
  const r = rotY(u, v, f.rot);
  return { x: f.x + r.x, z: f.z + r.z };
}

function label(f: Footprint): string {
  return `${f.path.replace('/models/', '')} at (${f.x.toFixed(1)}, ${f.z.toFixed(1)})`;
}

beforeAll(() => {
  world = loadPublishedMap();
  setActiveWorldContent(world);
  buildings = (world.placements ?? []).filter((p) => BUILDING_PATH.test(p.path));
  footprints = buildings.map(footprintOf).filter((f): f is Footprint => f !== null);
});

afterAll(() => setActiveWorldContent(null));

/** `n` evenly spaced values from `lo` to `hi`, both ends included. */
function span(lo: number, hi: number, step: number): number[] {
  const n = Math.max(1, Math.ceil((hi - lo) / step));
  return Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
}

describe('the combined map city roads', () => {
  it('measures every painted town building', () => {
    // The repainted towns stand over sixty Tidehold buildings; a collapse here
    // would make the checks below vacuous, and a building with no collider
    // would drop out of them silently.
    expect(buildings.length).toBeGreaterThan(60);
    expect(footprints.length).toBe(buildings.length);
  });

  it('publishes the roads the map document holds', () => {
    // The checks read the published world; the document is what Studio edits.
    const map = parseMap(readFileSync(MAP_JSON, 'utf8'));
    expect(map).not.toBeNull();
    expect(customMapToWorldContent(map!).roads).toEqual(world.roads);
  });

  it('runs no road through a building', () => {
    const crossed: string[] = [];
    for (const f of footprints) {
      let min = Infinity;
      for (const u of span(f.minU, f.maxU, 0.5)) {
        for (const v of span(f.minV, f.maxV, 0.5)) {
          const p = at(f, u, v);
          min = Math.min(min, roadDistance(p.x, p.z));
        }
      }
      if (min < ROAD_DIRT_HALF_WIDTH + MARGIN) crossed.push(`${label(f)}: ${min.toFixed(2)} yd`);
    }
    expect(crossed).toEqual([]);
  });

  it('leads a road to the front door of every town building', () => {
    // Town buildings only: two lone brick houses well outside Hedgewick and
    // the old props/house_3 huts keep whatever path they had.
    const hubs = world.zones.flatMap((z) => (z.hub ? [z.hub] : []));
    const town = footprints.filter(
      (f) =>
        f.path.startsWith('/models/tidehold/') &&
        hubs.some((h) => Math.hypot(h.x - f.x, h.z - f.z) < TOWN_RADIUS),
    );
    expect(town.length).toBeGreaterThan(55);
    const offRoad: string[] = [];
    for (const f of town) {
      // The Tidehold kit's front door is in the model's -z wall.
      const step = at(f, (f.minU + f.maxU) / 2, f.minV - DOORSTEP_OUT);
      const d = roadDistance(step.x, step.z);
      if (d > DOORSTEP_REACH) offRoad.push(`${label(f)}: doorstep ${d.toFixed(1)} yd off`);
    }
    expect(offRoad).toEqual([]);
  });

  it('keeps every legacy road joined, re-routing only between its ends', () => {
    // A legacy road is changed through a roadEdits entry, never in place. Its
    // two ends are where it meets other roads and the towns it joins, so an
    // end may only move along the network: onto another road it still meets.
    // The one exception is the Bridgemere north road, whose end ran on into
    // the tavern: it now stops at the tavern door.
    const map = parseMap(readFileSync(MAP_JSON, 'utf8'));
    expect(map).not.toBeNull();
    const legacy = map!.content.roads ?? [];
    const edits = map!.roadEdits ?? {};
    expect(Object.keys(edits).length).toBeGreaterThan(0);
    const network: { key: string; points: readonly Point[] }[] = [
      ...legacy.map((road, i) => {
        const edit = edits[roadEditKey(i)];
        return { key: `legacy ${i}`, points: edit && !('removed' in edit) ? edit.points : road };
      }),
      ...(map!.roadDefs ?? []).map((def) => ({ key: def.id, points: def.points })),
    ];
    const joined = (p: Point, self: string) =>
      network.some((r) => r.key !== self && distanceToPolyline(p, r.points) < 1);
    const trimmedEnd = new Set([43]);
    const moved: string[] = [];
    legacy.forEach((road, i) => {
      const edit = edits[roadEditKey(i)];
      if (!edit) return;
      if ('removed' in edit) {
        moved.push(`road ${i} removed`);
        return;
      }
      const self = `legacy ${i}`;
      const first = edit.points[0];
      const last = edit.points[edit.points.length - 1];
      if (Math.hypot(first.x - road[0].x, first.z - road[0].z) > 0.01 && !joined(first, self)) {
        moved.push(`road ${i} start`);
      }
      const end = road[road.length - 1];
      if (
        Math.hypot(last.x - end.x, last.z - end.z) > 0.01 &&
        !joined(last, self) &&
        !trimmedEnd.has(i)
      ) {
        moved.push(`road ${i} end`);
      }
    });
    // Every added road (a doorstep or graveyard path) meets the network.
    for (const def of map!.roadDefs ?? []) {
      const ends = [def.points[0], def.points[def.points.length - 1]];
      if (!ends.some((p) => joined(p, def.id))) moved.push(`${def.id} meets no road`);
    }
    expect(map!.roadDefs?.length ?? 0).toBeGreaterThan(30);
    expect(moved).toEqual([]);
  });
});
