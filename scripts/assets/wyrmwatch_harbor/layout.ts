// The Wyrmwatch cliff harbor's layout, exported for the Blender build
// (build_wyrmwatch_harbor.py reads layout.json beside this file): the decks, rails,
// props and path of src/sim/content/wyrmwatch_harbor.ts in the MODEL's frame (yards,
// origin on the waterline at WYRMWATCH_HARBOR_ORIGIN, axes the world's), each rail
// point and prop base seated on the live ground height, and a terrain height grid
// under the structure so every pile and post in the model runs down into the rock,
// the Harbormaster's House (src/sim/content/wyrmwatch_harbor_house.ts: its frame, doorway
// and furnishings), and the wall map inside it (the world's coasts as a coarse raster and
// the two ferry routes' outbound lanes, projected onto the map's face).
// The sim content is the one source of truth; tests/wyrmwatch_harbor_asset.test.ts
// fails when layout.json drifts from it (or from the terrain).
//
//   npx tsx scripts/assets/wyrmwatch_harbor/layout.ts            (writes layout.json)
//   npx tsx scripts/assets/wyrmwatch_harbor/layout.ts --context F (also a wide terrain
//                                                                  patch for the owner scene)

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARBOR_ROUTE_MARKERS } from '../../../src/sim/content/harbor_route_markers';
import { TRANSPORT_ROUTES } from '../../../src/sim/content/transport_ships';
import {
  WYRMWATCH_HARBOR_DECKS,
  WYRMWATCH_HARBOR_ORIGIN,
  WYRMWATCH_HARBOR_PATH,
  WYRMWATCH_HARBOR_PATH_HALF_WIDTH,
  WYRMWATCH_HARBOR_PROPS,
  WYRMWATCH_HARBOR_RAILS,
  WYRMWATCH_RAIL_HEIGHT,
} from '../../../src/sim/content/wyrmwatch_harbor';
import {
  HARBOR_HOUSE,
  HARBOR_HOUSE_FLOOR_ABOVE_WATER,
  HARBOR_HOUSE_INTERIOR,
  HARBOR_HOUSE_LANTERNS,
  HARBOR_HOUSE_MAP,
  HARBOR_HOUSE_NPC_FACING,
  HARBOR_HOUSE_NPC_POS,
  HARBOR_HOUSE_PROPS,
} from '../../../src/sim/content/wyrmwatch_harbor_house';
import { ZONES } from '../../../src/sim/data';
import { FERRY_PIERS } from '../../../src/sim/ferry_piers';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../../../src/sim/world';
import { WORLD_SEED } from '../../../src/sim/world_seed';

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const r3 = (v: number): number => Math.round(v * 1e3) / 1e3;

/** The terrain grid under the structure (model frame), at this spacing. */
export const TERRAIN_GRID = { x0: -6, x1: 10, z0: -26, z1: 18, step: 0.5 } as const;

/** The world the wall map shows (world yards: the overworld with a sea margin), the rows
 *  its coasts are traced on, and the step each row is sampled at. */
export const MAP_WORLD = { x0: -600, x1: 600, z0: -230, z1: 2470, rows: 90, step: 5 } as const;
/** Map land is ground this far over the sea; a strait narrower than MAP_FILL is inland
 *  water the chart leaves out, a sliver of land narrower than MAP_MIN_RUN is dropped. */
const MAP_LAND = 0.5;
const MAP_FILL = 45;
const MAP_MIN_RUN = 30;

/** The wall map, a stylized sea chart: per row, the coasts as land runs split at the zone
 *  borders [row, u0, u1, zone index] (each run tinted by its zone's land), each route's
 *  outbound lane and its two berths, in map units (u east, v south, 0..1 over MAP_WORLD). */
function wallMap() {
  const { x0, x1, z0, z1, rows, step } = MAP_WORLD;
  const u = (x: number): number => r4((x - x0) / (x1 - x0));
  const v = (z: number): number => r4((z - z0) / (z1 - z0));
  const zoneIds = ZONES.map((zn) => zn.id);
  const zoneAt = (x: number, z: number): number =>
    ZONES.findIndex(
      (zn) => x >= (zn.xMin ?? -180) && x < (zn.xMax ?? 180) && z >= zn.zMin && z < zn.zMax,
    );
  const runs: number[][] = [];
  const ch = (z1 - z0) / rows;
  for (let r = 0; r < rows; r++) {
    const z = z0 + (r + 0.5) * ch;
    // the row's land spans, sampled every `step` yards
    const spans: [number, number][] = [];
    let start: number | null = null;
    for (let x = x0; x <= x1; x += step) {
      const land = terrainHeight(x, z, WORLD_SEED) - WATER_LEVEL > MAP_LAND;
      if (land && start === null) start = x;
      if (!land && start !== null) {
        spans.push([start, x - step]);
        start = null;
      }
    }
    if (start !== null) spans.push([start, x1]);
    // fill inland water, drop slivers
    const merged: [number, number][] = [];
    for (const sp of spans) {
      const last = merged[merged.length - 1];
      if (last && sp[0] - last[1] <= MAP_FILL) last[1] = sp[1];
      else merged.push([sp[0], sp[1]]);
    }
    for (const [a, b] of merged) {
      if (b - a < MAP_MIN_RUN) continue;
      // split at the zone borders, each piece tinted by its zone
      const cuts = [a, ...[-180, 180].filter((c) => c > a && c < b), b];
      for (let i = 0; i + 1 < cuts.length; i++) {
        const zi = zoneAt((cuts[i] + cuts[i + 1]) / 2, z);
        // ground outside every zone is the world's rim, not a coast the chart shows
        if (zi >= 0) runs.push([r, u(cuts[i]), u(cuts[i + 1]), zi]);
      }
    }
  }
  return {
    world: MAP_WORLD,
    zones: zoneIds,
    runs,
    routes: TRANSPORT_ROUTES.map((route) => ({
      id: route.id,
      lane: route.lanes[0].map((w) => [u(w.x), v(w.z)]),
      berths: route.berths.map((b) => [u(b.x), v(b.z)]),
    })),
  };
}

/** The Harbormaster's House in the model's frame. */
function house(aw: (x: number, z: number) => number) {
  const ox = WYRMWATCH_HARBOR_ORIGIN.x;
  const oz = WYRMWATCH_HARBOR_ORIGIN.z;
  const i = HARBOR_HOUSE_INTERIOR;
  return {
    floor: HARBOR_HOUSE_FLOOR_ABOVE_WATER,
    x: r4(HARBOR_HOUSE.x - ox),
    z: r4(HARBOR_HOUSE.z - oz),
    hw: HARBOR_HOUSE.hw,
    hd: HARBOR_HOUSE.hd,
    wall: HARBOR_HOUSE.wall,
    wallTop: HARBOR_HOUSE.wallTop,
    tieBeam: HARBOR_HOUSE.tieBeam,
    ridge: HARBOR_HOUSE.ridge,
    roof: HARBOR_HOUSE.roof,
    door: { ...HARBOR_HOUSE.door, x: r4(HARBOR_HOUSE.door.x - ox) },
    interior: { x0: r4(i.x0 - ox), x1: r4(i.x1 - ox), z0: r4(i.z0 - oz), z1: r4(i.z1 - oz) },
    props: HARBOR_HOUSE_PROPS.map((p) => ({
      kind: p.kind,
      x: r4(p.x - ox),
      z: r4(p.z - oz),
      rot: r4(p.rot),
      ...(p.r !== undefined ? { r: p.r } : { hw: p.hw ?? 0.5, hd: p.hd ?? 0.5 }),
      height: p.height,
      base: aw(p.x, p.z),
    })),
    lanterns: HARBOR_HOUSE_LANTERNS.map((l) => ({
      x: r4(l.x - ox),
      z: r4(l.z - oz),
      drop: l.drop,
    })),
    map: { ...HARBOR_HOUSE_MAP, x: r4(HARBOR_HOUSE_MAP.x - ox), ...wallMap() },
    npc: {
      x: r4(HARBOR_HOUSE_NPC_POS.x - ox),
      z: r4(HARBOR_HOUSE_NPC_POS.z - oz),
      facing: r4(HARBOR_HOUSE_NPC_FACING),
    },
  };
}

function grid(x0: number, x1: number, z0: number, z1: number, step: number) {
  const ox = WYRMWATCH_HARBOR_ORIGIN.x;
  const oz = WYRMWATCH_HARBOR_ORIGIN.z;
  const nx = Math.round((x1 - x0) / step) + 1;
  const nz = Math.round((z1 - z0) / step) + 1;
  const h: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      h.push(r3(terrainHeight(ox + x0 + i * step, oz + z0 + j * step, WORLD_SEED) - WATER_LEVEL));
    }
  }
  return { x0, z0, step, nx, nz, h };
}

export function wyrmwatchHarborLayout() {
  const ox = WYRMWATCH_HARBOR_ORIGIN.x;
  const oz = WYRMWATCH_HARBOR_ORIGIN.z;
  const aw = (x: number, z: number): number => r4(groundHeight(x, z, WORLD_SEED) - WATER_LEVEL);
  const pier = FERRY_PIERS[1][0];
  const marker = HARBOR_ROUTE_MARKERS.find((m) => m.berth === 'drakelands');
  return {
    version: 2,
    origin: { x: ox, z: oz },
    railHeight: WYRMWATCH_RAIL_HEIGHT,
    decks: WYRMWATCH_HARBOR_DECKS.map((d) => ({
      id: d.id,
      kind: d.kind,
      x: r4(d.x - ox),
      z: r4(d.z - oz),
      rot: r4(d.rot),
      hl: d.hl,
      hw: d.hw,
      near: d.nearAboveWater ?? 0,
      far: d.farAboveWater ?? 0,
    })),
    pier: {
      x: r4(pier.x - ox),
      z: r4(pier.z - oz),
      rot: r4(pier.rot),
      hl: pier.hl,
      hw: pier.hw,
      top: pier.nearAboveWater ?? 0,
    },
    marker: marker ? { x: r4(marker.x - ox), z: r4(marker.z - oz) } : null,
    // each rail as its corners (where posts must stand) and, per leg, the planks'
    // height every half yard (a rail climbing a flight bends onto its landing)
    rails: WYRMWATCH_HARBOR_RAILS.map((rail) => ({
      corners: rail.map(([x, z]) => ({ x: r4(x - ox), z: r4(z - oz), y: aw(x, z) })),
      legs: rail.slice(1).map(([x1, z1], i) => {
        const [x0, z0] = rail[i];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5));
        return Array.from({ length: n + 1 }, (_, k) => {
          const x = x0 + ((x1 - x0) * k) / n;
          const z = z0 + ((z1 - z0) * k) / n;
          return { x: r4(x - ox), z: r4(z - oz), y: aw(x, z) };
        });
      }),
    })),
    props: WYRMWATCH_HARBOR_PROPS.map((p) => ({
      kind: p.kind,
      x: r4(p.x - ox),
      z: r4(p.z - oz),
      rot: r4(p.rot),
      ...(p.r !== undefined ? { r: p.r } : { hw: p.hw ?? 0.5, hd: p.hd ?? 0.5 }),
      height: p.height,
      base: aw(p.x, p.z),
    })),
    path: {
      points: WYRMWATCH_HARBOR_PATH.map(([x, z]) => [r4(x - ox), r4(z - oz)]),
      halfWidth: WYRMWATCH_HARBOR_PATH_HALF_WIDTH,
    },
    house: house(aw),
    terrain: grid(
      TERRAIN_GRID.x0,
      TERRAIN_GRID.x1,
      TERRAIN_GRID.z0,
      TERRAIN_GRID.z1,
      TERRAIN_GRID.step,
    ),
  };
}

export const WYRMWATCH_LAYOUT_FILE = 'scripts/assets/wyrmwatch_harbor/layout.json';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const layout = wyrmwatchHarborLayout();
  writeFileSync(path.join(root, WYRMWATCH_LAYOUT_FILE), `${JSON.stringify(layout)}\n`);
  console.log(`wrote ${WYRMWATCH_LAYOUT_FILE}`);
  const i = process.argv.indexOf('--context');
  if (i > 0 && process.argv[i + 1]) {
    // the owner's scene: a wide terrain patch (harbor to the path's end), not shipped
    writeFileSync(process.argv[i + 1], `${JSON.stringify(grid(-60, 30, -30, 26, 1))}\n`);
    console.log(`wrote ${process.argv[i + 1]}`);
  }
}
