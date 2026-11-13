// The Quartered Isle's landmarks: the war scars that make each quarter read as
// its own place (the zone design, "The quarters" and "The
// climb to the seat"). Every landform here is authored in FINISHED height
// space, applied late in world.ts terrainHeightUnpadded (after the arena
// floor), so what a player walks is exactly what these numbers say:
//
//   the Gyre        a storm peak with a switchback path wound twice round it,
//                   its faces between the turns steeper than a player can climb
//   the Fireice Rift the old war's scar between the Hoarshelf and the
//                   Cinderscar, crossed by the hill road's stone causeway
//   the Crevasses   four narrow cracks in the Hoarshelf's east ice
//   the Rimeglass   a frozen tarn: a level sheet of ice in the west shelf
//   the Burnways    three shallow fire channels draining from the Drakelands
//   the Glassfield  a level field of fused glass under the Cinderscar's crags
//   the Hammer's Cut a canyon with a blind branch through the Heavestone Wilds
//   the Heaved Slabs tilted plates of stone thrown up by the Hammer
//
// Pure leaf: deterministic, no rng, no SimContext, no content tables. The
// render ground palette reads the same shapes through quarteredLandmarkTint.

import { CHALLENGERS_RING, RIVALMOOT_HILL } from './quartered_isle_terrain';
import { quarterWeightsAt } from './quartered_quarters';
import { applyIsleShatter, ISLE_SHATTER, isleFissureAt } from './quartered_shatter';

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

type Pt = { readonly x: number; readonly z: number };

/** Distance from (x, z) to a polyline, and how far along it (0..1) the
 *  nearest point lies. */
function polylineNearest(line: readonly Pt[], x: number, z: number): { d: number; t: number } {
  let best = Infinity;
  let bestAlong = 0;
  let total = 0;
  const lengths: number[] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const len = Math.hypot(line[i + 1].x - line[i].x, line[i + 1].z - line[i].z);
    lengths.push(len);
    total += len;
  }
  let run = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const u = lenSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lenSq)) : 0;
    const d = Math.hypot(x - (a.x + dx * u), z - (a.z + dz * u));
    if (d < best) {
      best = d;
      bestAlong = (run + lengths[i] * u) / total;
    }
    run += lengths[i];
  }
  return { d: best, t: bestAlong };
}

/** Axis-aligned bounds of a polyline grown by `pad`. */
function lineBounds(line: readonly Pt[], pad: number) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of line) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

function inBounds(
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
  x: number,
  z: number,
) {
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

// ---- the Gyre -------------------------------------------------------------

/** The storm peak at the isle's north. The path leaves Rivalmoot's north
 *  road at the peak's south foot and winds anticlockwise (seen from above)
 *  round the peak, climbing on a gentle grade to the summit's level crown. */
export const GYRE_PEAK = {
  x: 0,
  z: 2356,
  /** the path's radius where it starts, at the peak's south foot */
  startR: 44,
  /** the path's radius at the summit, where it meets the crown */
  endR: 9,
  /** the radial step between one turn of the path and the next */
  turnStep: 15,
  /** the path's walking width */
  pathW: 7,
  /** finished height where the path starts (the north road's end) */
  baseY: 13,
  /** how far the crown stands above the path's start */
  rise: 30,
  /** the outer faces fall away at this slope (rise/run) */
  outerSlope: 2.4,
} as const;

/** The lowest a scar's bed is cut: 1.5yd above the sea (world.ts WATER_LEVEL
 *  -4.3), so no rift, crack or canyon floods. */
const SCAR_FLOOR_MIN = -2.8;

const GYRE_TURNS = (GYRE_PEAK.startR - GYRE_PEAK.endR) / GYRE_PEAK.turnStep;
const GYRE_SPAN = GYRE_TURNS * Math.PI * 2;
/** The path leaves the north road due south of the peak (toward -z). */
const GYRE_START_ANGLE = -Math.PI / 2;

function gyrePathR(phi: number): number {
  return GYRE_PEAK.startR - (GYRE_PEAK.startR - GYRE_PEAK.endR) * (phi / GYRE_SPAN);
}
function gyrePathY(phi: number): number {
  return GYRE_PEAK.baseY + GYRE_PEAK.rise * (phi / GYRE_SPAN);
}

/** Where along the path (radians climbed, 0 at the start) a point at angle
 *  `theta` and radius `r` sits: the turn of the path at that angle lying at
 *  or just outside r, or null when r lies outside every turn. */
function gyreTurnOutside(theta: number, r: number): number | null {
  let base = (theta - GYRE_START_ANGLE) % (Math.PI * 2);
  if (base < 0) base += Math.PI * 2;
  let found: number | null = null;
  for (let phi = base; phi <= GYRE_SPAN; phi += Math.PI * 2) {
    if (gyrePathR(phi) + GYRE_PEAK.pathW / 2 >= r) found = phi;
    else break;
  }
  return found;
}

/** The point on the Gyre path `t` (0..1) of the way up, for content placement
 *  (cairns, banners, the summit cleft) and the route test. */
export function gyrePathPoint(t: number): { x: number; z: number; y: number } {
  const phi = Math.max(0, Math.min(1, t)) * GYRE_SPAN;
  const a = GYRE_START_ANGLE + phi;
  const r = gyrePathR(phi);
  return { x: GYRE_PEAK.x + Math.cos(a) * r, z: GYRE_PEAK.z + Math.sin(a) * r, y: gyrePathY(phi) };
}

/** The approach to the path's start: a ramp running south down the north
 *  road from the path's foot, as wide as the path with walkable shoulders,
 *  so the road climbs onto the Gyre square-on from the town whatever the
 *  outer faces either side of it do. (dx, dz) is the offset from the peak. */
const GYRE_APRON = { slope: 0.4, shoulder: 1.1 } as const;
function gyreApron(dx: number, dz: number): number {
  const g = GYRE_PEAK;
  // yards south of the path start's outer edge, where the face's own start ramp is measured
  const along = -(g.startR + g.pathW / 2) - dz;
  if (along < 0) return -Infinity;
  const side = Math.max(0, Math.abs(dx) - g.pathW / 2);
  return g.baseY - along * GYRE_APRON.slope - side * GYRE_APRON.shoulder;
}

/** The Gyre's finished height at (x, z). `solid` marks the path, the faces
 *  between its turns and the crown, which ARE the ground; elsewhere the value
 *  is an outer face the ground only rises to meet. */
const gyreOut = { y: 0, solid: false };
function gyreHeight(x: number, z: number): typeof gyreOut {
  const g = GYRE_PEAK;
  const dx = x - g.x;
  const dz = z - g.z;
  const r = Math.hypot(dx, dz);
  const half = g.pathW / 2;
  // the crown stands inside the path's last turn, which arrives on its rim
  const crownR = g.endR - half;
  const top = g.baseY + g.rise;
  gyreOut.solid = true;
  if (r <= crownR) {
    gyreOut.y = top;
    return gyreOut;
  }
  const theta = Math.atan2(dz, dx);
  const phi = gyreTurnOutside(theta, r);
  if (phi === null) {
    // outside every turn: the outer face falls from the outermost turn at
    // this angle (the turn whose radius is largest) to the ground
    let base = (theta - GYRE_START_ANGLE) % (Math.PI * 2);
    if (base < 0) base += Math.PI * 2;
    const edge = gyrePathR(base) + half;
    gyreOut.solid = false;
    // right at the path's start the face is a ramp, so the north road walks
    // onto the path whatever height the town's edge settles at
    const slope = 0.4 + (g.outerSlope - 0.4) * smoothstep(0.12, 0.4, base);
    gyreOut.y = Math.max(gyrePathY(base) - (r - edge) * slope, gyreApron(dx, dz));
    return gyreOut;
  }
  const pr = gyrePathR(phi);
  if (r >= pr - half) {
    gyreOut.y = gyrePathY(phi); // on the path
    return gyreOut;
  }
  // between this turn and the next one inward: a face too steep to climb
  const innerPhi = phi + Math.PI * 2;
  const innerEdge = innerPhi <= GYRE_SPAN ? gyrePathR(innerPhi) + half : crownR;
  const innerY = innerPhi <= GYRE_SPAN ? gyrePathY(innerPhi) : top;
  const s = smoothstep(pr - half, innerEdge, r);
  gyreOut.y = gyrePathY(phi) + (innerY - gyrePathY(phi)) * s;
  return gyreOut;
}

// ---- the scars ------------------------------------------------------------

/** The Fireice Rift: where the Heat met the Quench, a chasm between the
 *  Hoarshelf and the Cinderscar. The hill road crosses it on a causeway of
 *  unbroken ground. */
export const FIREICE_RIFT = {
  line: [
    { x: 96, z: 2016 },
    { x: 128, z: 2056 },
    { x: 160, z: 2092 },
    { x: 196, z: 2122 },
    { x: 238, z: 2146 },
  ],
  depth: 10,
  floorHalfW: 3,
  topHalfW: 8,
  /** the causeway: the ground left whole where the east road crosses */
  causeway: { x: 158, z: 2092, halfW: 7 },
} as const;

/** The Crevasses: four narrow cracks in the Hoarshelf's east ice, parallel,
 *  each one a step across at its ends and a fall in its middle. */
export const HOARSHELF_CREVASSES = [
  [
    { x: 52, z: 2006 },
    { x: 82, z: 2020 },
  ],
  [
    { x: 56, z: 2022 },
    { x: 90, z: 2038 },
  ],
  [
    { x: 60, z: 2040 },
    { x: 92, z: 2054 },
  ],
  [
    { x: 64, z: 2058 },
    { x: 88, z: 2068 },
  ],
] as const;
const CREVASSE = { depth: 4.5, floorHalfW: 0.6, topHalfW: 2.4, endEase: 6 } as const;

/** A frozen lake: a level sheet of clear ice at `y` out to `r`, its ground
 *  pulled level out to `blendR`. Standing on one, a player slides
 *  (quartered_frozen_lakes.ts). */
export interface FrozenLake {
  x: number;
  z: number;
  r: number;
  blendR: number;
  y: number;
}

/** The Rimeglass: the largest of the Hoarshelf's frozen lakes, on the west
 *  shelf between the Hoarbridge road and the shore, its pull kept outside the
 *  great crater's bank. */
export const RIMEGLASS_TARN = { x: -104, z: 2026, r: 16, blendR: 22, y: 1 } as const;

/** Every frozen lake on the Hoarshelf: the Rimeglass, a smaller sheet below
 *  the crater's south rim, and one on each of the shelf's far shoulders. */
export const QUARTERED_FROZEN_LAKES: readonly FrozenLake[] = [
  RIMEGLASS_TARN,
  { x: -50, z: 2012, r: 10, blendR: 16, y: 1 },
  { x: -170, z: 2036, r: 14, blendR: 20, y: 1 },
  { x: 172, z: 2030, r: 13, blendR: 19, y: 1 },
];

/** The frozen lake under (x, z), or null. */
export function frozenLakeAt(x: number, z: number): FrozenLake | null {
  for (const lake of QUARTERED_FROZEN_LAKES) {
    const dx = x - lake.x;
    const dz = z - lake.z;
    if (dx * dx + dz * dz <= lake.r * lake.r) return lake;
  }
  return null;
}

/** The Burnways: shallow fire channels draining from the Drakelands toward
 *  the hill, their beds glowing (the render palette) and walkable. */
export const CINDERSCAR_BURNWAYS = [
  [
    { x: 230, z: 2184 },
    { x: 204, z: 2190 },
    { x: 164, z: 2176 },
    { x: 120, z: 2186 },
  ],
  [
    { x: 232, z: 2240 },
    { x: 208, z: 2246 },
    { x: 170, z: 2232 },
    { x: 132, z: 2244 },
  ],
  [
    { x: 228, z: 2294 },
    { x: 206, z: 2290 },
    { x: 176, z: 2300 },
  ],
] as const;
const BURNWAY = { depth: 1.4, halfW: 2.6, edgeW: 2.4 } as const;

/** The Glassfield: a level field of fused glass under the Cinderscar's crags. */
export const CINDERSCAR_GLASSFIELD = { x: 124, z: 2290, r: 22, blendR: 32, y: 4 } as const;

/** The Hammer's Cut: a canyon cut through the Heavestone Wilds, walkable end to
 *  end along its floor, with one blind branch running north into the crags. */
export const HAMMERS_CUT_CANYON = {
  main: [
    { x: -96, z: 2178 },
    { x: -128, z: 2160 },
    { x: -166, z: 2172 },
    { x: -200, z: 2152 },
    { x: -238, z: 2160 },
  ],
  branch: [
    { x: -166, z: 2172 },
    { x: -176, z: 2200 },
    { x: -160, z: 2226 },
  ],
  depth: 9,
  floorHalfW: 4,
  topHalfW: 10,
  /** the floor ramps up to the land over this run at each open end */
  endEase: 20,
} as const;

/** The Heaved Slabs: plates of stone the Hammer threw up, each tilted from
 *  flush with the ground at its low edge to a ledge at its high edge. */
export const HEAVED_SLABS = [
  { x: -196, z: 2222, halfL: 9, halfW: 5, rot: 0.4, lift: 3.6 },
  { x: -214, z: 2238, halfL: 8, halfW: 4.5, rot: -0.9, lift: 2.8 },
  { x: -182, z: 2240, halfL: 7, halfW: 4, rot: 1.6, lift: 3.2 },
  { x: -224, z: 2214, halfL: 6, halfW: 4, rot: 2.6, lift: 2.4 },
  { x: -204, z: 2202, halfL: 7, halfW: 3.5, rot: -0.2, lift: 2.0 },
] as const;

// the lips' banks (riftLip below) reach RIFT_LIP.outer past the line
const RIFT_LIP = { rise: 4, outer: 16 } as const;
const RIFT_BOUNDS = lineBounds(FIREICE_RIFT.line, RIFT_LIP.outer + 2);
const CANYON_BOUNDS = lineBounds(
  [...HAMMERS_CUT_CANYON.main, ...HAMMERS_CUT_CANYON.branch],
  HAMMERS_CUT_CANYON.topHalfW + 2,
);
const CREVASSE_BOUNDS = lineBounds(HOARSHELF_CREVASSES.flat(), CREVASSE.topHalfW + 2);
const BURNWAY_BOUNDS = lineBounds(CINDERSCAR_BURNWAYS.flat(), BURNWAY.halfW + BURNWAY.edgeW + 2);
const SLAB_BOUNDS = lineBounds(
  HEAVED_SLABS.map((s) => ({ x: s.x, z: s.z })),
  12,
);
const GYRE_REACH = GYRE_PEAK.startR + GYRE_PEAK.pathW / 2 + (GYRE_PEAK.baseY + 2) / 1;

/** Every region the landmark applier can touch (terrain_region_index bounds). */
// The shattered ground (quartered_shatter.ts) spans the whole isle, so this
// applier's bounds are the isle's own rect, the scars and the Gyre inside it.
export const QUARTERED_LANDMARK_BOUNDS = {
  minX: Math.min(ISLE_SHATTER.minX, GYRE_PEAK.x - GYRE_REACH, CANYON_BOUNDS.minX, SLAB_BOUNDS.minX),
  maxX: Math.max(
    ISLE_SHATTER.maxX,
    GYRE_PEAK.x + GYRE_REACH,
    RIFT_BOUNDS.maxX,
    BURNWAY_BOUNDS.maxX,
  ),
  minZ: Math.min(ISLE_SHATTER.minZ, RIFT_BOUNDS.minZ, CREVASSE_BOUNDS.minZ),
  maxZ: Math.max(ISLE_SHATTER.maxZ, GYRE_PEAK.z + GYRE_REACH),
} as const;

/** How much room (0..1) the landmarks leave the shattering at (x, z): none on
 *  a landmark or inside its margin, so every authored floor, wall, path and
 *  lip stays exactly as authored, easing to full room past the margin. */
function shatterRoom(x: number, z: number): number {
  let room = smoothstep(
    GYRE_REACH - 6,
    GYRE_REACH + 8,
    Math.hypot(x - GYRE_PEAK.x, z - GYRE_PEAK.z),
  );
  if (room <= 0) return 0;
  for (const area of [...QUARTERED_FROZEN_LAKES, CINDERSCAR_GLASSFIELD]) {
    room *= smoothstep(area.blendR, area.blendR + 12, Math.hypot(x - area.x, z - area.z));
  }
  if (room > 0 && inBounds(RIFT_BOUNDS, x, z)) {
    room *= smoothstep(
      RIFT_LIP.outer,
      RIFT_LIP.outer + 10,
      polylineNearest(FIREICE_RIFT.line, x, z).d,
    );
  }
  if (room > 0 && inBounds(CANYON_BOUNDS, x, z)) {
    const c = HAMMERS_CUT_CANYON;
    const d = Math.min(polylineNearest(c.main, x, z).d, polylineNearest(c.branch, x, z).d);
    room *= smoothstep(c.topHalfW + 2, c.topHalfW + 12, d);
  }
  if (room > 0 && inBounds(BURNWAY_BOUNDS, x, z)) {
    for (const line of CINDERSCAR_BURNWAYS) {
      room *= smoothstep(
        BURNWAY.halfW + BURNWAY.edgeW,
        BURNWAY.halfW + BURNWAY.edgeW + 10,
        polylineNearest(line, x, z).d,
      );
    }
  }
  if (room > 0 && inBounds(CREVASSE_BOUNDS, x, z)) {
    for (const line of HOARSHELF_CREVASSES) {
      room *= smoothstep(
        CREVASSE.topHalfW + 1,
        CREVASSE.topHalfW + 9,
        polylineNearest(line, x, z).d,
      );
    }
  }
  if (room > 0 && inBounds(SLAB_BOUNDS, x, z)) {
    for (const slab of HEAVED_SLABS) {
      room *= smoothstep(slab.halfL + 3, slab.halfL + 12, Math.hypot(x - slab.x, z - slab.z));
    }
  }
  return room;
}

/** A trench profile across a line: full depth over the floor, easing to 0 at
 *  the lip. `endT` eases the depth to 0 over the line's open ends. */
function trench(d: number, floorHalfW: number, topHalfW: number): number {
  return 1 - smoothstep(floorHalfW, topHalfW, d);
}

function riftDepth(x: number, z: number): number {
  if (!inBounds(RIFT_BOUNDS, x, z)) return 0;
  const r = FIREICE_RIFT;
  const { d, t } = polylineNearest(r.line, x, z);
  if (d >= r.topHalfW) return 0;
  const c = r.causeway;
  const whole = 1 - smoothstep(c.halfW, c.halfW + 5, Math.hypot(x - c.x, z - c.z));
  // the rift pinches shut at its two ends instead of stopping in a wall
  const ends = smoothstep(0, 0.08, t) * (1 - smoothstep(0.92, 1, t));
  return r.depth * trench(d, r.floorHalfW, r.topHalfW) * ends * (1 - whole);
}

/** The rift's thrown-up lips: a bank either side where the war heaved the
 *  ground aside, rising from the land to a crest at the chasm's edge (a walk
 *  up, never a wall), so the scar reads deep even where it runs through low
 *  ground near the cove. Left off at the causeway and the pinched ends. */
function riftLip(x: number, z: number): number {
  if (!inBounds(RIFT_BOUNDS, x, z)) return 0;
  const r = FIREICE_RIFT;
  const { d, t } = polylineNearest(r.line, x, z);
  if (d >= RIFT_LIP.outer) return 0;
  const c = r.causeway;
  const whole = 1 - smoothstep(c.halfW + 2, c.halfW + 10, Math.hypot(x - c.x, z - c.z));
  const ends = smoothstep(0.04, 0.14, t) * (1 - smoothstep(0.86, 0.96, t));
  // up from the land to the crest at the lip, then over the edge with the cut
  const bank = smoothstep(RIFT_LIP.outer, r.topHalfW, d);
  return RIFT_LIP.rise * bank * ends * (1 - whole);
}

function crevasseDepth(x: number, z: number): number {
  if (!inBounds(CREVASSE_BOUNDS, x, z)) return 0;
  let deepest = 0;
  for (const line of HOARSHELF_CREVASSES) {
    const { d, t } = polylineNearest(line, x, z);
    if (d >= CREVASSE.topHalfW) continue;
    const len = Math.hypot(line[1].x - line[0].x, line[1].z - line[0].z);
    const run = Math.min(t, 1 - t) * len;
    const ends = smoothstep(0, CREVASSE.endEase, run);
    deepest = Math.max(
      deepest,
      CREVASSE.depth * trench(d, CREVASSE.floorHalfW, CREVASSE.topHalfW) * ends,
    );
  }
  return deepest;
}

/** A Cinderscar burnway's bed depth at (x, z) as the landmark applier cuts
 *  it (0 off the beds), for the render layer's melt. Cosmetic only. */
export function quarteredBurnwayDepth(x: number, z: number): number {
  return burnwayDepth(x, z);
}

function burnwayDepth(x: number, z: number): number {
  if (!inBounds(BURNWAY_BOUNDS, x, z)) return 0;
  let deepest = 0;
  for (const line of CINDERSCAR_BURNWAYS) {
    const { d } = polylineNearest(line, x, z);
    deepest = Math.max(
      deepest,
      BURNWAY.depth * trench(d, BURNWAY.halfW, BURNWAY.halfW + BURNWAY.edgeW),
    );
  }
  return deepest;
}

function canyonDepth(x: number, z: number): number {
  if (!inBounds(CANYON_BOUNDS, x, z)) return 0;
  const c = HAMMERS_CUT_CANYON;
  const main = polylineNearest(c.main, x, z);
  const mainLen = c.main.reduce(
    (sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - c.main[i - 1].x, p.z - c.main[i - 1].z)),
    0,
  );
  const mainRun = Math.min(main.t, 1 - main.t) * mainLen;
  const mainD =
    c.depth * trench(main.d, c.floorHalfW, c.topHalfW) * smoothstep(0, c.endEase, mainRun);
  const branch = polylineNearest(c.branch, x, z);
  // the branch opens off the main floor at full depth and dies into the
  // crags at its far end (a blind gully, not a way out)
  const branchD =
    c.depth * trench(branch.d, c.floorHalfW, c.topHalfW) * (1 - smoothstep(0.7, 1, branch.t));
  return Math.max(mainD, branchD);
}

function slabLift(x: number, z: number): number {
  if (!inBounds(SLAB_BOUNDS, x, z)) return 0;
  let lift = 0;
  for (const s of HEAVED_SLABS) {
    const dx = x - s.x;
    const dz = z - s.z;
    const c = Math.cos(s.rot);
    const sn = Math.sin(s.rot);
    const u = dx * c + dz * sn; // along the slab
    const v = -dx * sn + dz * c; // across it
    if (Math.abs(u) > s.halfL + 0.6 || Math.abs(v) > s.halfW + 0.6) continue;
    // a hard-edged plate: 0.6yd of bevel round it, its top tilting up along u
    const edge =
      (1 - smoothstep(s.halfL, s.halfL + 0.6, Math.abs(u))) *
      (1 - smoothstep(s.halfW, s.halfW + 0.6, Math.abs(v)));
    const tilt = (u + s.halfL) / (2 * s.halfL);
    lift = Math.max(lift, s.lift * Math.max(0, Math.min(1, tilt)) * edge);
  }
  return lift;
}

function levelPull(
  area: { x: number; z: number; r: number; blendR: number; y: number },
  x: number,
  z: number,
  h: number,
): number {
  const d = Math.hypot(x - area.x, z - area.z);
  if (d >= area.blendR) return h;
  return h + (area.y - h) * (1 - smoothstep(area.r, area.blendR, d));
}

/** The landmarks over the finished ground. Runs late (world.ts, after the
 *  Challengers' Ring) so every floor, path and ledge is exactly as authored. */
export function applyQuarteredLandmarks(x: number, z: number, h: number): number {
  // the shattered ground first, round the landmarks, which then lay their own
  // authored shapes over the rest
  let out = applyIsleShatter(x, z, h, shatterRoom(x, z)).h;
  if (Math.hypot(x - GYRE_PEAK.x, z - GYRE_PEAK.z) < GYRE_REACH) {
    // on its path, faces and crown the peak IS the ground; its outer faces
    // rise out of the ground round it
    const g = gyreHeight(x, z);
    out = g.solid ? g.y : Math.max(out, g.y);
  } else if (Math.abs(x - GYRE_PEAK.x) < GYRE_PEAK.pathW) {
    // past the peak's reach the approach ramp runs on down the north road
    // until it meets the ground
    out = Math.max(out, gyreApron(x - GYRE_PEAK.x, z - GYRE_PEAK.z));
  }
  for (const lake of QUARTERED_FROZEN_LAKES) out = levelPull(lake, x, z, out);
  out = levelPull(CINDERSCAR_GLASSFIELD, x, z, out);
  out += slabLift(x, z) + riftLip(x, z);
  const cut = Math.max(riftDepth(x, z), crevasseDepth(x, z), canyonDepth(x, z), burnwayDepth(x, z));
  // a scar never cuts below the waterline's dry margin: its bed stays dry
  // ground even where it runs out toward a shore
  if (cut > 0) out = Math.max(out - cut, Math.min(out, SCAR_FLOOR_MIN));
  return out;
}

/** Rivalmoot's paving: whole out to `fullR` (past the three buildings' pads),
 *  gone by `endR`, inside the rise's level top. */
export const RIVALMOOT_PAVING = { fullR: 31, endR: RIVALMOOT_HILL.topR } as const;

/** How strongly each landmark surface shows at (x, z), 0..1, for the render
 *  ground palette (render/quartered_ground_core.ts). Cosmetic only. */
export interface QuarteredLandmarkTint {
  /** a shatter fissure's floor: the render palette colours it by quarter */
  fissure: number;
  ice: number;
  ember: number;
  glass: number;
  stone: number;
  basalt: number;
  /** Rivalmoot's paved top: worn flagstone laid over the rise */
  moot: number;
}

export function quarteredLandmarkTint(x: number, z: number, out: QuarteredLandmarkTint): void {
  out.fissure = inBounds(QUARTERED_LANDMARK_BOUNDS, x, z)
    ? Math.min(1, isleFissureAt(x, z, shatterRoom(x, z)) / 2)
    : 0;
  let lakeIce = 0;
  for (const lake of QUARTERED_FROZEN_LAKES) {
    const d = Math.hypot(x - lake.x, z - lake.z);
    lakeIce = Math.max(lakeIce, 1 - smoothstep(lake.r - 2, lake.r + 3, d));
  }
  const glass = Math.hypot(x - CINDERSCAR_GLASSFIELD.x, z - CINDERSCAR_GLASSFIELD.z);
  out.ice = Math.max(lakeIce, Math.min(1, crevasseDepth(x, z) / 1.5));
  out.ember = Math.min(1, burnwayDepth(x, z) / BURNWAY.depth);
  out.glass = 1 - smoothstep(CINDERSCAR_GLASSFIELD.r - 2, CINDERSCAR_GLASSFIELD.r + 4, glass);
  out.stone = Math.max(Math.min(1, canyonDepth(x, z) / 2), Math.min(1, slabLift(x, z) / 0.8));
  // the rift's walls, and the great crater's walls: the war's scorched
  // heart, burnt to basalt where the four arts met. Its floor stays clear
  // for the four quarters' wedges (render/quartered_ground_core.ts).
  const crater = Math.hypot(x - CHALLENGERS_RING.x, z - CHALLENGERS_RING.z);
  out.basalt = Math.max(
    Math.min(1, riftDepth(x, z) / 2),
    0.85 *
      smoothstep(CHALLENGERS_RING.floorR - 4, CHALLENGERS_RING.wallR, crater) *
      (1 - smoothstep(CHALLENGERS_RING.wallR, CHALLENGERS_RING.rimR + 4, crater)),
  );
  // the town's level top is paved: no quarter's ground runs under Rivalmoot,
  // the one place on the isle the four hold in common
  const moot = Math.hypot(x - RIVALMOOT_HILL.x, z - RIVALMOOT_HILL.z);
  out.moot = 1 - smoothstep(RIVALMOOT_PAVING.fullR, RIVALMOOT_PAVING.endR, moot);
}

/** True where scatter (trees, rocks, grass tufts) must not grow: the Gyre's
 *  path and crown, the rift and crevasse beds, the tarn's ice, the glass, the
 *  burnways' beds and the canyon floor (world.ts decoration exclusions). */
export function quarteredLandmarkClears(x: number, z: number): boolean {
  // most of the world's scatter candidates are nowhere near the isle
  if (!inBounds(QUARTERED_LANDMARK_BOUNDS, x, z)) return false;
  const r = Math.hypot(x - GYRE_PEAK.x, z - GYRE_PEAK.z);
  if (r <= GYRE_PEAK.endR + 1) return true;
  if (r <= GYRE_PEAK.startR + GYRE_PEAK.pathW) {
    const phi = gyreTurnOutside(Math.atan2(z - GYRE_PEAK.z, x - GYRE_PEAK.x), r);
    if (phi !== null && r >= gyrePathR(phi) - GYRE_PEAK.pathW / 2 - 1) return true;
  }
  for (const lake of QUARTERED_FROZEN_LAKES) {
    if (Math.hypot(x - lake.x, z - lake.z) < lake.r + 2) return true;
  }
  if (
    Math.hypot(x - CINDERSCAR_GLASSFIELD.x, z - CINDERSCAR_GLASSFIELD.z) < CINDERSCAR_GLASSFIELD.r
  )
    return true;
  return (
    riftDepth(x, z) > 0.5 ||
    crevasseDepth(x, z) > 0.3 ||
    burnwayDepth(x, z) > 0.3 ||
    canyonDepth(x, z) > 1 ||
    isleFissureAt(x, z, shatterRoom(x, z)) > 0.5 ||
    cinderscarMeltNear(x, z, CINDERSCAR_MELT_PAD)
  );
}

/** The fire weight past which the isle's ground is the Cinderscar (the
 *  render melt fills its cracks from LAVA_FIRE_LO, 0.42). */
export const CINDERSCAR_FIRE_WEIGHT = 0.4;
/** How far scatter keeps off the Cinderscar's melt, yards: a rock or tuft
 *  is wider than its centre, so a clear on the crack's floor alone still
 *  let one lean out over the lava. */
export const CINDERSCAR_MELT_PAD = 2.5;

/** True on the Quartered Isle's fire quarter (inside the shattered ground,
 *  where the fire weight leads), the Cinderscar. */
export function inCinderscar(x: number, z: number): boolean {
  if (x <= ISLE_SHATTER.minX || x >= ISLE_SHATTER.maxX) return false;
  if (z <= ISLE_SHATTER.minZ || z >= ISLE_SHATTER.maxZ) return false;
  return quarterWeightsAt(x, z).fire > CINDERSCAR_FIRE_WEIGHT;
}

/** True where a fissure or burnway bed lies within `pad` yards of (x, z) in
 *  the Cinderscar: the melt there would show through anything standing on it. */
export function cinderscarMeltNear(x: number, z: number, pad: number): boolean {
  if (!inCinderscar(x, z)) return false;
  const wet = (px: number, pz: number) =>
    isleFissureAt(px, pz, shatterRoom(px, pz)) > 0.3 || burnwayDepth(px, pz) > 0.3;
  if (wet(x, z)) return true;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    if (wet(x + Math.cos(ang) * pad, z + Math.sin(ang) * pad)) return true;
  }
  return false;
}

/** The shatter fissure's depth at (x, z) as the landmark applier cuts it (0
 *  off the fissures and on every landmark's kept ground), for the render
 *  layer's fissure dressing (the Cinderscar's lava). Cosmetic only. */
export function quarteredFissureDepth(x: number, z: number): number {
  if (!inBounds(QUARTERED_LANDMARK_BOUNDS, x, z)) return 0;
  return isleFissureAt(x, z, shatterRoom(x, z));
}
