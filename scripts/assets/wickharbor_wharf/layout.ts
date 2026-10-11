// The Wickharbor ferry wharf's layout, exported for the Blender build
// (build_wickharbor_wharf.py reads layout.json beside this file): the decks, rails and
// props of src/sim/content/wickharbor_wharf.ts in the MODEL's frame (yards, origin on the
// waterline at WICKHARBOR_WHARF_ORIGIN, axes the world's), each rail point and prop base
// seated on the live ground height, the town boardwalk the flight stands on, the route
// marker and the berth, and a terrain height grid under the structure so every pile and
// post in the model runs down into the seabed and the bluff.
// The sim content is the one source of truth; tests/wickharbor_wharf_asset.test.ts fails
// when layout.json drifts from it (or from the terrain).
//
//   npx tsx scripts/assets/wickharbor_wharf/layout.ts            (writes layout.json)
//   npx tsx scripts/assets/wickharbor_wharf/layout.ts --context F (also a wide terrain
//                                                                  patch for the owner scene)

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARBOR_ROUTE_MARKERS } from '../../../src/sim/content/harbor_route_markers';
import { WICKHARBOR_DRAKELANDS_FERRY } from '../../../src/sim/content/transport_ships';
import {
  WICKHARBOR_BOARDWALK_ABOVE_WATER,
  WICKHARBOR_WHARF_ABOVE_WATER,
  WICKHARBOR_WHARF_DECKS,
  WICKHARBOR_WHARF_ORIGIN,
  WICKHARBOR_WHARF_PROPS,
  WICKHARBOR_WHARF_RAILS,
  WICKHARBOR_WHARF_ROT,
} from '../../../src/sim/content/wickharbor_wharf';
import { WYRMWATCH_RAIL_HEIGHT } from '../../../src/sim/content/wyrmwatch_harbor';
import { GALE_HARBOR_DECKS, galeDeckSurfaceAt } from '../../../src/sim/gale_harbor';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../../../src/sim/world';
import { WORLD_SEED } from '../../../src/sim/world_seed';

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const r3 = (v: number): number => Math.round(v * 1e3) / 1e3;

/** The terrain grid under the structure (model frame), at this spacing. */
export const TERRAIN_GRID = { x0: -4, x1: 34, z0: -13, z1: 17, step: 0.5 } as const;

/** The town's shore boardwalk the flight stands on (gale_harbor.ts: the deck the wharf's
 *  flight rests its foot on). */
function boardwalk() {
  const d = GALE_HARBOR_DECKS.find((g) => g.x === 467.5 && g.z === 358);
  if (!d) throw new Error('the shore boardwalk moved');
  const top = galeDeckSurfaceAt(d, 0, (x, z) => terrainHeight(x, z, WORLD_SEED), WATER_LEVEL);
  return {
    x: r4(d.x - WICKHARBOR_WHARF_ORIGIN.x),
    z: r4(d.z - WICKHARBOR_WHARF_ORIGIN.z),
    rot: r4(d.rot),
    hl: d.hl,
    hw: d.hw,
    top: r4(top - WATER_LEVEL),
  };
}

function grid(x0: number, x1: number, z0: number, z1: number, step: number) {
  const ox = WICKHARBOR_WHARF_ORIGIN.x;
  const oz = WICKHARBOR_WHARF_ORIGIN.z;
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

export function wickharborWharfLayout() {
  const ox = WICKHARBOR_WHARF_ORIGIN.x;
  const oz = WICKHARBOR_WHARF_ORIGIN.z;
  const aw = (x: number, z: number): number => r4(groundHeight(x, z, WORLD_SEED) - WATER_LEVEL);
  const marker = HARBOR_ROUTE_MARKERS.find((m) => m.berth === 'wickharbor');
  const berth = WICKHARBOR_DRAKELANDS_FERRY.berths[0];
  return {
    version: 1,
    origin: { x: ox, z: oz },
    rot: WICKHARBOR_WHARF_ROT,
    level: WICKHARBOR_WHARF_ABOVE_WATER,
    boardwalkTop: r4(WICKHARBOR_BOARDWALK_ABOVE_WATER),
    railHeight: WYRMWATCH_RAIL_HEIGHT,
    decks: WICKHARBOR_WHARF_DECKS.map((d) => ({
      id: d.id,
      kind: d.kind,
      frame: d.frame,
      x: r4(d.x - ox),
      z: r4(d.z - oz),
      rot: r4(d.rot),
      hl: r4(d.hl),
      hw: r4(d.hw),
      near: r4(d.nearAboveWater ?? 0),
      far: r4(d.farAboveWater ?? 0),
    })),
    boardwalk: boardwalk(),
    marker: marker ? { x: r4(marker.x - ox), z: r4(marker.z - oz) } : null,
    berth: { x: r4(berth.x - ox), z: r4(berth.z - oz), rot: r4(berth.rot) },
    // each rail as its corners (where posts must stand) and, per leg, the planks' height
    // every half yard (a rail down the flight bends onto the arm)
    rails: WICKHARBOR_WHARF_RAILS.map((rail) => ({
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
    props: WICKHARBOR_WHARF_PROPS.map((p) => ({
      kind: p.kind,
      x: r4(p.x - ox),
      z: r4(p.z - oz),
      rot: r4(p.rot),
      ...(p.r !== undefined ? { r: p.r } : { hw: p.hw ?? 0.5, hd: p.hd ?? 0.5 }),
      height: p.height,
      base: aw(p.x, p.z),
    })),
    terrain: grid(
      TERRAIN_GRID.x0,
      TERRAIN_GRID.x1,
      TERRAIN_GRID.z0,
      TERRAIN_GRID.z1,
      TERRAIN_GRID.step,
    ),
  };
}

export const WICKHARBOR_LAYOUT_FILE = 'scripts/assets/wickharbor_wharf/layout.json';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const layout = wickharborWharfLayout();
  writeFileSync(path.join(root, WICKHARBOR_LAYOUT_FILE), `${JSON.stringify(layout)}\n`);
  console.log(`wrote ${WICKHARBOR_LAYOUT_FILE}`);
  const i = process.argv.indexOf('--context');
  if (i > 0 && process.argv[i + 1]) {
    // the owner's scene: a wide terrain patch (the town's edge to the berth) and the town's
    // harbor decks the wharf joins (drawn as slabs), not shipped
    const terrain = (x: number, z: number): number => terrainHeight(x, z, WORLD_SEED);
    const harborDecks = GALE_HARBOR_DECKS.map((d) => ({
      x: r4(d.x - WICKHARBOR_WHARF_ORIGIN.x),
      z: r4(d.z - WICKHARBOR_WHARF_ORIGIN.z),
      rot: d.rot,
      hl: d.hl,
      hw: d.hw,
      y0: r4(galeDeckSurfaceAt(d, -d.hl, terrain, WATER_LEVEL) - WATER_LEVEL),
      y1: r4(galeDeckSurfaceAt(d, d.hl, terrain, WATER_LEVEL) - WATER_LEVEL),
    }));
    const context = { ...grid(-40, 48, -30, 34, 1), harborDecks };
    writeFileSync(process.argv[i + 1], `${JSON.stringify(context)}\n`);
    console.log(`wrote ${process.argv[i + 1]}`);
  }
}
