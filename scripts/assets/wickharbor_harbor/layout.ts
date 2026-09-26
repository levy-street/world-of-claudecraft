// Wickharbor's wooden harbor layout, exported for the Blender build
// (build_wickharbor_harbor.py reads layout.json beside this file): the decks, rails and
// props of src/sim/content/wickharbor_harbor.ts in the MODEL's frame (yards, origin on the
// waterline at the harbor frame's centre, WICKHARBOR_HARBOR_FRAME, axes the world's), each
// deck's footprint as a convex polygon in its own frame (its cuts applied), each rail point
// and prop base seated on the live ground height, the ferry wharf flight that stands on the
// boardwalk's south end, and terrain height grids under the structures so every pile and
// post in the model runs down into the seabed and the bluff.
// The sim content is the one source of truth; tests/wickharbor_harbor_asset.test.ts fails
// when layout.json drifts from it (or from the terrain).
//
//   npx tsx scripts/assets/wickharbor_harbor/layout.ts            (writes layout.json)
//   npx tsx scripts/assets/wickharbor_harbor/layout.ts --context F (also a wide terrain
//                                                                   patch for the owner scene)

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QUAY_ARM_EDGE_A,
  QUAY_BERTH_HEAD_C,
  QUAY_FACE_A,
  QUAY_MID_A1,
  QUAY_MID_C0,
  QUAY_MID_C1,
  QUAY_NORTH_EDGE_C,
  QUAY_ORIGIN,
  QUAY_ROT,
  QUAY_WHARF_EDGE_C,
  WICKHARBOR_BOARDWALK_TOP,
  WICKHARBOR_HARBOR_DECKS,
  WICKHARBOR_HARBOR_FRAME,
  WICKHARBOR_HARBOR_PROPS,
  WICKHARBOR_HARBOR_RAILS,
  WICKHARBOR_STAIR_FIRST_RISE,
} from '../../../src/sim/content/wickharbor_harbor';
import {
  WICKHARBOR_ARM_C1,
  WICKHARBOR_FLIGHT_FOOT_C,
  WICKHARBOR_WHARF_ABOVE_WATER,
  WICKHARBOR_WHARF_DECKS,
  WICKHARBOR_WHARF_ORIGIN,
} from '../../../src/sim/content/wickharbor_wharf';
import { WYRMWATCH_RAIL_HEIGHT } from '../../../src/sim/content/wyrmwatch_harbor';
import type { GaleDeckDef } from '../../../src/sim/gale_harbor';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../../../src/sim/world';
import { WORLD_SEED } from '../../../src/sim/world_seed';

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const r3 = (v: number): number => Math.round(v * 1e3) / 1e3;
const OX = WICKHARBOR_HARBOR_FRAME.x;
const OZ = WICKHARBOR_HARBOR_FRAME.z;

/** The terrain grids under the structures (model frame): the shore network with the great
 *  quay, and the Old Beacon's dock and stair. */
export const TERRAIN_GRIDS = [
  { x0: -16, x1: 30, z0: -16, z1: 24, step: 0.5 },
  { x0: 26, x1: 65, z0: -44, z1: -5, step: 0.5 },
] as const;

/** A deck's footprint in its own frame (along, across): its rectangle clipped by its cuts,
 *  counter-clockwise, every corner exact. */
export function deckPolygon(d: GaleDeckDef): [number, number][] {
  let poly: [number, number][] = [
    [-d.hl, -d.hw],
    [d.hl, -d.hw],
    [d.hl, d.hw],
    [-d.hl, d.hw],
  ];
  const sa = Math.sin(d.rot);
  const ca = Math.cos(d.rot);
  for (const cut of d.cuts ?? []) {
    // the cut as a half-plane in the deck's frame: n . (p - q) >= 0
    const qa = (cut.x - d.x) * sa + (cut.z - d.z) * ca;
    const qc = (cut.x - d.x) * ca - (cut.z - d.z) * sa;
    const na = cut.nx * sa + cut.nz * ca;
    const nc = cut.nx * ca - cut.nz * sa;
    const side = ([a, c]: [number, number]): number => (a - qa) * na + (c - qc) * nc;
    const out: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp * sq < 0) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    poly = out;
  }
  return poly;
}

function grid(g: { x0: number; x1: number; z0: number; z1: number; step: number }) {
  const nx = Math.round((g.x1 - g.x0) / g.step) + 1;
  const nz = Math.round((g.z1 - g.z0) / g.step) + 1;
  const h: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      h.push(
        r3(terrainHeight(OX + g.x0 + i * g.step, OZ + g.z0 + j * g.step, WORLD_SEED) - WATER_LEVEL),
      );
    }
  }
  return { x0: g.x0, z0: g.z0, step: g.step, nx, nz, h };
}

export function wickharborHarborLayout() {
  const aw = (x: number, z: number): number => r4(groundHeight(x, z, WORLD_SEED) - WATER_LEVEL);
  const flight = WICKHARBOR_WHARF_DECKS.find((d) => d.id === 'flight');
  if (!flight) throw new Error('the wharf lost its flight');
  return {
    version: 1,
    origin: { x: OX, z: OZ },
    frameRot: WICKHARBOR_HARBOR_FRAME.rot,
    boardwalkTop: WICKHARBOR_BOARDWALK_TOP,
    firstRise: WICKHARBOR_STAIR_FIRST_RISE,
    railHeight: WYRMWATCH_RAIL_HEIGHT,
    decks: WICKHARBOR_HARBOR_DECKS.map((d) => ({
      id: d.id,
      kind: d.kind,
      x: r4(d.x - OX),
      z: r4(d.z - OZ),
      rot: r4(d.rot),
      hl: r4(d.hl),
      hw: r4(d.hw),
      near: r4(d.nearAboveWater ?? 0),
      far: r4(d.farAboveWater ?? 0),
      polygon: deckPolygon(d).map(([a, c]) => [r4(a), r4(c)]),
    })),
    // the ferry wharf's flight, whose first tread stands on the boardwalk's south end
    // (scripts/assets/wickharbor_wharf/ draws it): nothing of this model stands under it
    wharfFlight: {
      x: r4(flight.x - OX),
      z: r4(flight.z - OZ),
      rot: r4(flight.rot),
      hl: r4(flight.hl),
      hw: r4(flight.hw),
    },
    wharfOrigin: { x: r4(WICKHARBOR_WHARF_ORIGIN.x - OX), z: r4(WICKHARBOR_WHARF_ORIGIN.z - OZ) },
    // the great quay's frame (the wharf's) and the edges the model dresses: the sea face, the
    // wharf's pier, arm and berth head it meets (their planks stand wharfTop over the water),
    // the north pier's side, the middle pier's finger, and the arm's north end (the flight)
    quay: {
      x: r4(QUAY_ORIGIN.x - OX),
      z: r4(QUAY_ORIGIN.z - OZ),
      rot: QUAY_ROT,
      face: QUAY_FACE_A,
      wharfEdge: QUAY_WHARF_EDGE_C,
      armEdge: QUAY_ARM_EDGE_A,
      armEnd: WICKHARBOR_ARM_C1,
      flightFoot: WICKHARBOR_FLIGHT_FOOT_C,
      berthHeadC: QUAY_BERTH_HEAD_C,
      northEdge: r4(QUAY_NORTH_EDGE_C),
      midC0: QUAY_MID_C0,
      midC1: QUAY_MID_C1,
      midA1: QUAY_MID_A1,
      wharfTop: WICKHARBOR_WHARF_ABOVE_WATER,
    },
    // each rail as its corners (where posts must stand) and, per leg, the planks' height
    // every half yard (a rail down a stair climbs with it)
    rails: WICKHARBOR_HARBOR_RAILS.map((rail) => ({
      corners: rail.map(([x, z]) => ({ x: r4(x - OX), z: r4(z - OZ), y: aw(x, z) })),
      legs: rail.slice(1).map(([x1, z1], i) => {
        const [x0, z0] = rail[i];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5));
        return Array.from({ length: n + 1 }, (_, k) => {
          const x = x0 + ((x1 - x0) * k) / n;
          const z = z0 + ((z1 - z0) * k) / n;
          return { x: r4(x - OX), z: r4(z - OZ), y: aw(x, z) };
        });
      }),
    })),
    props: WICKHARBOR_HARBOR_PROPS.map((p) => ({
      kind: p.kind,
      x: r4(p.x - OX),
      z: r4(p.z - OZ),
      rot: r4(p.rot),
      ...(p.r !== undefined ? { r: p.r } : { hw: p.hw ?? 0.5, hd: p.hd ?? 0.5 }),
      height: p.height,
      base: aw(p.x, p.z),
    })),
    terrain: TERRAIN_GRIDS.map(grid),
  };
}

export const WICKHARBOR_HARBOR_LAYOUT_FILE = 'scripts/assets/wickharbor_harbor/layout.json';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  writeFileSync(
    path.join(root, WICKHARBOR_HARBOR_LAYOUT_FILE),
    `${JSON.stringify(wickharborHarborLayout())}\n`,
  );
  console.log(`wrote ${WICKHARBOR_HARBOR_LAYOUT_FILE}`);
  const i = process.argv.indexOf('--context');
  if (i > 0 && process.argv[i + 1]) {
    // the owner's scene: one wide terrain patch over the whole harbor, not shipped
    const context = grid({ x0: -40, x1: 80, z0: -60, z1: 36, step: 1 });
    writeFileSync(process.argv[i + 1], `${JSON.stringify(context)}\n`);
    console.log(`wrote ${process.argv[i + 1]}`);
  }
}
