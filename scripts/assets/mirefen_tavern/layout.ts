// The Mirefen tavern's layout, exported for the Blender build (build_tavern.py reads
// layout.json beside this file): every number the sim walks and collides with, from
// src/sim/content/mirefen_tavern.ts and src/sim/mirefen_tavern.ts, in the MODEL's frame
// (the tavern's local yards: origin on the ground floor at TAVERN_ORIGIN, +x to the
// right of a player walking in, +y up, +z out of the front door), and the terrain under
// and around the building in that frame (heights over the ground floor), so the stone
// base runs down into the ground and the porch steps stop where they meet it.
// The sim content is the one source of truth; tests/mirefen_tavern_asset.test.ts fails
// when layout.json drifts from it (or from the terrain).
//
//   npx tsx scripts/assets/mirefen_tavern/layout.ts             (writes layout.json)
//   npx tsx scripts/assets/mirefen_tavern/layout.ts --context F  (also a wide terrain patch
//                                                                  for the owner's scene)

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TAVERN_ARCH,
  TAVERN_BAR_PLATFORM,
  TAVERN_CHANDELIER,
  TAVERN_DOOR,
  TAVERN_FLOOR_Y,
  TAVERN_HALL,
  TAVERN_HATCH,
  TAVERN_HOOD,
  TAVERN_JETTY,
  TAVERN_KEEPER_LOCAL,
  TAVERN_LANTERNS,
  TAVERN_NOOK,
  TAVERN_NOOK_BENCH_ANGLES,
  TAVERN_ORIGIN,
  TAVERN_PIT,
  TAVERN_PORCH,
  TAVERN_PROPS,
  TAVERN_SCONCES,
  TAVERN_STAGE,
  TAVERN_TOWER,
  TAVERN_WING,
  TAVERN_YAW,
  tavernToWorld,
} from '../../../src/sim/content/mirefen_tavern';
import {
  TAVERN_CHALKBOARD,
  TAVERN_DOG,
  TAVERN_FORECOURT,
  TAVERN_LANTERN_STRINGS,
  TAVERN_STABLE,
  TAVERN_TERRACE_LIGHTS,
} from '../../../src/sim/content/mirefen_tavern_grounds';
import {
  TAVERN_TOWER_WALL_RUNS,
  tavernHallWalls,
  tavernPropBaseY,
  tavernWingWalls,
} from '../../../src/sim/mirefen_tavern';
import { terrainHeight } from '../../../src/sim/world';
import { WORLD_SEED } from '../../../src/sim/world_seed';

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const r3 = (v: number): number => Math.round(v * 1e3) / 1e3;

/** The terrain grid under and round the building and its grounds (local yards: west far
 *  enough for the stable and the cart), at this spacing. */
export const TERRAIN_GRID = { x0: -32, x1: 20, z0: -32, z1: 26, step: 1 } as const;

/** Terrain heights over the ground floor on a local grid (row-major, x fastest). */
function grid(x0: number, x1: number, z0: number, z1: number, step: number) {
  const nx = Math.round((x1 - x0) / step) + 1;
  const nz = Math.round((z1 - z0) / step) + 1;
  const h: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const p = tavernToWorld(x0 + i * step, z0 + j * step);
      h.push(r3(terrainHeight(p.x, p.z, WORLD_SEED) - TAVERN_FLOOR_Y));
    }
  }
  return { x0, z0, step, nx, nz, h };
}

export function mirefenTavernLayout() {
  return {
    version: 3,
    origin: { ...TAVERN_ORIGIN, y: TAVERN_FLOOR_Y, yaw: r4(TAVERN_YAW) },
    hall: TAVERN_HALL,
    door: TAVERN_DOOR,
    jetty: TAVERN_JETTY,
    porch: TAVERN_PORCH,
    wing: TAVERN_WING,
    tower: TAVERN_TOWER,
    towerWallRuns: TAVERN_TOWER_WALL_RUNS.map(([a, b]) => [r4(a), r4(b)]),
    arch: TAVERN_ARCH,
    hatch: TAVERN_HATCH,
    pit: TAVERN_PIT,
    platform: TAVERN_BAR_PLATFORM,
    stage: TAVERN_STAGE,
    nook: {
      benchR: TAVERN_NOOK.benchR,
      benchAngles: TAVERN_NOOK_BENCH_ANGLES.map(r4),
      tableR: TAVERN_NOOK.tableR,
      tableAngles: TAVERN_NOOK.tableAngles.map(r4),
    },
    hallWalls: tavernHallWalls(),
    wingWalls: tavernWingWalls(),
    props: TAVERN_PROPS.map((p) => ({
      kind: p.kind,
      x: r4(p.x),
      z: r4(p.z),
      rot: r4(p.rot),
      ...(p.r !== undefined ? { r: p.r } : { hw: p.hw ?? 0.5, hd: p.hd ?? 0.5 }),
      height: p.height,
      base: tavernPropBaseY(p),
    })),
    lanterns: TAVERN_LANTERNS,
    sconces: TAVERN_SCONCES.map((s) => ({
      x: r4(s.x),
      z: r4(s.z),
      y: s.y,
      nx: r4(s.nx),
      nz: r4(s.nz),
    })),
    chandelier: TAVERN_CHANDELIER,
    hood: TAVERN_HOOD,
    keeper: TAVERN_KEEPER_LOCAL,
    grounds: {
      forecourt: TAVERN_FORECOURT,
      stable: TAVERN_STABLE,
      strings: TAVERN_LANTERN_STRINGS,
      terraceLights: TAVERN_TERRACE_LIGHTS,
      chalkboard: TAVERN_CHALKBOARD,
      dog: TAVERN_DOG,
    },
    terrain: grid(
      TERRAIN_GRID.x0,
      TERRAIN_GRID.x1,
      TERRAIN_GRID.z0,
      TERRAIN_GRID.z1,
      TERRAIN_GRID.step,
    ),
  };
}

export const MIREFEN_TAVERN_LAYOUT_FILE = 'scripts/assets/mirefen_tavern/layout.json';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  writeFileSync(
    path.join(root, MIREFEN_TAVERN_LAYOUT_FILE),
    `${JSON.stringify(mirefenTavernLayout())}\n`,
  );
  console.log(`wrote ${MIREFEN_TAVERN_LAYOUT_FILE}`);
  const i = process.argv.indexOf('--context');
  if (i > 0 && process.argv[i + 1]) {
    // the owner's scene: a wide terrain patch round the tavern and the road, not shipped
    writeFileSync(process.argv[i + 1], `${JSON.stringify(grid(-70, 70, -80, 70, 2))}\n`);
    console.log(`wrote ${process.argv[i + 1]}`);
  }
}
