// The Quartered Isle's shattered ground: the war's damage laid over the whole
// island, so it reads as an elemental wasteland broken into pieces rather
// than rolling land (the zone design; the design's key art
// shows the quarters as fractured plates split by chasms). The land is cut
// into Voronoi plates; each plate is heaved up and tilted by its own hash,
// and most borders between plates open into deep, narrow fissures. Some
// borders stay closed and every fissure pinches into necks along its run, so
// the plates stay joined on foot: a player can always find a way across.
//
// Kept off everything that must stay walkable or level: the roads (and a
// margin beside them), Rivalmoot's rise, the great crater, the Gyre, the
// level landmarks (the tarn, the Glassfield), the isle's lakes, and the low
// shore (a fissure never opens a channel to the sea). Applied in FINISHED
// height space by quartered_landmarks.ts, before the landmarks themselves.
//
// Pure leaf: deterministic integer hashes, no rng stream, no clock.

import { GATHER_NODES } from './content/gather_nodes';
import { GOURDLIGHT_PUMPKINS } from './content/gourdlight_pumpkins';
import { QUARTERED_BAYS, QUARTERED_LAND_LOBES } from './content/quartered_coast';
import { QUARTERED_ISLE_LAKES, QUARTERED_ISLE_ROADS } from './content/quartered_isle_ways';
import { TREASURE_SITES } from './content/treasure_maps';
import { boundedBlobs, metaballLandness } from './metaball_landness';
import { CHALLENGERS_RING, RIVALMOOT_HILL } from './quartered_isle_terrain';
import { quarterWeightsAt } from './quartered_quarters';

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** A deterministic hash of two integers and a salt, to [0, 1). */
function hash3(i: number, j: number, salt: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1) on a unit grid. */
function valueNoise(x: number, z: number, salt: number): number {
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash3(i, j, salt);
  const b = hash3(i + 1, j, salt);
  const c = hash3(i, j + 1, salt);
  const d = hash3(i + 1, j + 1, salt);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** The shattering's shape. */
export const ISLE_SHATTER = {
  /** a plate's typical span */
  cell: 26,
  /** the share of plate borders that open into a fissure */
  openShare: 0.75,
  /** a fissure's depth range and its half width at the lip: wide enough for
   *  the terrain mesh to draw a real chasm, not a soft dip */
  depthMin: 5,
  depthMax: 8,
  halfWMin: 3,
  halfWMax: 5.5,
  /** how far past its half width a fissure's wall runs out: the walls (and a
   *  plate's broken edge) climb over a run several mesh cells wide, so the
   *  drawn ground follows the ground players walk on (the render terrain
   *  meshes the isle every 1.2yd: quartered_ground_core.ts) */
  wallRun: 4,
  /** the run (from the border) a plate's broken edge rises over */
  edgeRun: 9,
  /** how high a plate is heaved, and how far it tilts end to end */
  heave: 4.5,
  tilt: 3.5,
  /** how high a fissure's broken edges stand proud of the plate */
  lip: 1.8,
  /** the Heavestone Wilds' plates: level-topped plateaus on stepped heights
   *  (`plateauStep` apart, at most `plateauMax`), with `shardShare` of them
   *  thrown up as tilted shards whose high edge stands `shardRise` proud */
  plateauStep: 3,
  plateauMax: 9,
  shardShare: 0.3,
  shardRise: 9,
  /** the isle's extent the shattering spans */
  minX: -250,
  maxX: 250,
  minZ: 1975,
  maxZ: 2400,
} as const;

/** A scar's bed is never cut below this (1.5yd above the sea, WATER_LEVEL
 *  -4.3), so no fissure floods. */
const FLOOR_MIN = -2.8;

function featurePoint(i: number, j: number): { x: number; z: number } {
  const c = ISLE_SHATTER.cell;
  return {
    x: (i + 0.15 + 0.7 * hash3(i, j, 11)) * c,
    z: (j + 0.15 + 0.7 * hash3(i, j, 12)) * c,
  };
}

interface PlateHit {
  /** the plate the point lies in (its cell indices) */
  i: number;
  j: number;
  /** distance to the nearest plate border */
  edge: number;
  /** the neighbouring plate across that border */
  ni: number;
  nj: number;
  /** the point's offset from its plate's centre, in cells */
  ux: number;
  uz: number;
}

const hit: PlateHit = { i: 0, j: 0, edge: 0, ni: 0, nj: 0, ux: 0, uz: 0 };

/** The plate under (x, z) and its distance to the nearest border (the exact
 *  bisector distance to the second-nearest feature point). */
function plateAt(x: number, z: number): PlateHit {
  const c = ISLE_SHATTER.cell;
  const ci = Math.floor(x / c);
  const cj = Math.floor(z / c);
  let best = Infinity;
  let bi = 0;
  let bj = 0;
  let bx = 0;
  let bz = 0;
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const p = featurePoint(ci + di, cj + dj);
      const d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < best) {
        best = d;
        bi = ci + di;
        bj = cj + dj;
        bx = p.x;
        bz = p.z;
      }
    }
  }
  let edge = Infinity;
  let ni = bi;
  let nj = bj;
  for (let di = -2; di <= 2; di++) {
    for (let dj = -2; dj <= 2; dj++) {
      const i = bi + di;
      const j = bj + dj;
      if (i === bi && j === bj) continue;
      const p = featurePoint(i, j);
      const mx = p.x - bx;
      const mz = p.z - bz;
      const len = Math.hypot(mx, mz);
      if (len < 1e-6) continue;
      // distance from the point to the bisector between the two features
      const e = ((x - (bx + p.x) / 2) * -mx + (z - (bz + p.z) / 2) * -mz) / len;
      if (e < edge) {
        edge = e;
        ni = i;
        nj = j;
      }
    }
  }
  hit.i = bi;
  hit.j = bj;
  hit.edge = Math.max(0, edge);
  hit.ni = ni;
  hit.nj = nj;
  hit.ux = (x - bx) / c;
  hit.uz = (z - bz) / c;
  return hit;
}

// Every spot content stands on in the isle (the gather nodes, the treasure
// dig sites, the Gourdlight pumpkins): their ground stays whole, each placed
// on level, dry, reachable land the shattering must not break.
let spots: readonly { x: number; z: number }[] | null = null;
export function placedSpots(): readonly { x: number; z: number }[] {
  if (spots === null) {
    const isle = (row: { zoneId: string }) => row.zoneId === 'quartered_isle';
    spots = [
      ...GATHER_NODES.filter(isle).map((node) => node.pos),
      ...TREASURE_SITES.filter(isle),
      ...GOURDLIGHT_PUMPKINS.filter(isle),
    ].map((row) => ({ x: row.x, z: row.z }));
  }
  return spots;
}

let roadSegs: { ax: number; az: number; bx: number; bz: number }[] | null = null;
function roadDistance(x: number, z: number): number {
  if (roadSegs === null) {
    roadSegs = [];
    for (const road of QUARTERED_ISLE_ROADS) {
      for (let k = 0; k + 1 < road.length; k++) {
        roadSegs.push({ ax: road[k].x, az: road[k].z, bx: road[k + 1].x, bz: road[k + 1].z });
      }
    }
  }
  let best = Infinity;
  for (const s of roadSegs) {
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const lenSq = dx * dx + dz * dz;
    const u = lenSq > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / lenSq)) : 0;
    best = Math.min(best, Math.hypot(x - (s.ax + dx * u), z - (s.az + dz * u)));
  }
  return best;
}

// The isle's own coastline field (the same tables world.ts quarteredLandness
// reads), so the shore fade is a pure function of position: the terrain and
// the ground palette agree on every fissure without the palette knowing the
// height.
let landFields: {
  lobes: ReturnType<typeof boundedBlobs>;
  bays: ReturnType<typeof boundedBlobs>;
} | null = null;
function isleLandness(x: number, z: number): number {
  if (landFields === null) {
    landFields = { lobes: boundedBlobs(QUARTERED_LAND_LOBES), bays: boundedBlobs(QUARTERED_BAYS) };
  }
  return metaballLandness(landFields.lobes, landFields.bays, x, z);
}

/** How strongly the shattering shows at (x, z), 0..1: zero on the roads,
 *  the town, the crater and the lakes, easing in across their margins, and
 *  fading out at the isle's edges and toward its shore (no fissure opens a
 *  channel to the sea). `open` is the caller's own 0..1 room for it (the
 *  landmarks keep their ground: quartered_landmarks.ts). */
export function shatterWeight(x: number, z: number, open: number): number {
  const s = ISLE_SHATTER;
  if (x <= s.minX || x >= s.maxX || z <= s.minZ || z >= s.maxZ) return 0;
  let w =
    open *
    smoothstep(s.minX, s.minX + 22, x) *
    (1 - smoothstep(s.maxX - 22, s.maxX, x)) *
    smoothstep(s.minZ, s.minZ + 25, z) *
    (1 - smoothstep(s.maxZ - 20, s.maxZ, z));
  if (w <= 0) return 0;
  // the shore stays whole
  w *= smoothstep(0.1, 0.32, isleLandness(x, z));
  if (w <= 0) return 0;
  const hill = Math.hypot(x - RIVALMOOT_HILL.x, z - RIVALMOOT_HILL.z);
  w *= smoothstep(RIVALMOOT_HILL.footR - 6, RIVALMOOT_HILL.footR + 8, hill);
  const crater = Math.hypot(x - CHALLENGERS_RING.x, z - CHALLENGERS_RING.z);
  w *= smoothstep(CHALLENGERS_RING.outerR - 4, CHALLENGERS_RING.outerR + 10, crater);
  for (const spot of placedSpots()) {
    w *= smoothstep(10, 22, Math.hypot(x - spot.x, z - spot.z));
  }
  for (const lake of QUARTERED_ISLE_LAKES) {
    const d = Math.hypot(x - lake.x, z - lake.z);
    w *= smoothstep(lake.radius + 6, lake.radius + 18, d);
  }
  if (w <= 0) return 0;
  w *= smoothstep(7, 14, roadDistance(x, z));
  return w;
}

function fissureNeck(x: number, z: number): number {
  return smoothstep(0.18, 0.5, valueNoise(x * 0.025, z * 0.025, 24));
}

/** True when the border at a plate hit opens into a fissure. */
function borderOpen(p: PlateHit): boolean {
  const a = p.i * 7919 + p.j;
  const b = p.ni * 7919 + p.nj;
  return hash3(Math.min(a, b), Math.max(a, b), 21) < ISLE_SHATTER.openShare;
}

/** The fissure cut at a plate hit (before the weight): deep and narrow on an
 *  open border, nothing on a closed one, pinched shut at its necks. */
function fissureCut(p: PlateHit, x: number, z: number): number {
  const s = ISLE_SHATTER;
  // one draw per border, the same from either side of it
  const a = p.i * 7919 + p.j;
  const b = p.ni * 7919 + p.nj;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hash3(lo, hi, 21) >= s.openShare) return 0;
  const halfW = s.halfWMin + (s.halfWMax - s.halfWMin) * hash3(lo, hi, 22);
  if (p.edge >= halfW + s.wallRun) return 0;
  const depth = s.depthMin + (s.depthMax - s.depthMin) * hash3(lo, hi, 23);
  // necks: the fissure closes where a slow noise along it dips, its floor
  // ramping up over about 14yd so whoever falls in can always walk out
  const neck = fissureNeck(x, z);
  return depth * (1 - smoothstep(halfW * 0.3, halfW + s.wallRun, p.edge)) * neck;
}

/** The upthrust lip either side of an open fissure (before the weight): the
 *  plates' broken edges standing proud of the crack, a short walkable bank. */
function fissureLip(p: PlateHit, x: number, z: number): number {
  const s = ISLE_SHATTER;
  const a = p.i * 7919 + p.j;
  const b = p.ni * 7919 + p.nj;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hash3(lo, hi, 21) >= s.openShare) return 0;
  const halfW = s.halfWMin + (s.halfWMax - s.halfWMin) * hash3(lo, hi, 22);
  if (p.edge >= halfW + s.wallRun + 6) return 0;
  const neck = fissureNeck(x, z);
  const up = smoothstep(halfW + s.wallRun + 6, halfW + s.wallRun, p.edge);
  return s.lip * up * neck;
}

/** The plate's heave and tilt at a plate hit (before the weight). It eases to
 *  nothing over a long run into a closed border, so neighbours join flush and
 *  walkably, and stands at full height right to the lip of an open one, so
 *  the plate reads as a broken slab over its chasm. `earth` (0..1) turns the
 *  plate toward the Heavestone Wilds' shape: a level plateau on a stepped
 *  height, or a shard of ground thrown up on one edge. */
function plateLift(p: PlateHit, x: number, z: number, earth: number): number {
  const s = ISLE_SHATTER;
  const sharp = borderOpen(p) ? fissureNeck(x, z) : 0;
  const inner =
    smoothstep(1.5, 12, p.edge) * (1 - sharp) + smoothstep(2, s.edgeRun, p.edge) * sharp;
  if (inner <= 0) return 0;
  const heave = s.heave * hash3(p.i, p.j, 31);
  const ang = hash3(p.i, p.j, 32) * Math.PI * 2;
  const along = p.ux * Math.cos(ang) + p.uz * Math.sin(ang);
  const broken = heave + s.tilt * along;
  if (earth <= 0) return broken * inner;
  let wilds: number;
  if (hash3(p.i, p.j, 33) < s.shardShare) {
    // a shard: flush at its low edge, climbing to a broken ledge at its high
    // one (`along` runs about -0.5..0.5 across the plate)
    wilds = s.shardRise * smoothstep(-0.45, 0.5, along);
  } else {
    // a plateau: level-topped, on one of a few stepped heights
    const steps = Math.floor(s.plateauMax / s.plateauStep);
    wilds = s.plateauStep * (1 + Math.floor(hash3(p.i, p.j, 34) * steps));
  }
  return (broken + (wilds - broken) * earth) * inner;
}

/** The fissure depth the shattering cuts at (x, z), for the ground palette
 *  and the scatter clear: the same cut applyIsleShatter makes. */
export function isleFissureAt(x: number, z: number, open: number): number {
  const w = shatterWeight(x, z, open);
  if (w <= 0) return 0;
  return fissureCut(plateAt(x, z), x, z) * w;
}

/** The result of one shatter sample, reused (terrain sampling is hot). */
export const shatterOut = { h: 0, fissure: 0 };

/** The shattered ground over `h` into shatterOut, with the fissure depth it
 *  cut (for the palette and the scatter clear). */
export function applyIsleShatter(x: number, z: number, h: number, open: number): typeof shatterOut {
  shatterOut.h = h;
  shatterOut.fissure = 0;
  const w = shatterWeight(x, z, open);
  if (w <= 0) return shatterOut;
  const p = plateAt(x, z);
  const earth = smoothstep(0.4, 0.7, quarterWeightsAt(x, z).earth);
  const lifted = h + (plateLift(p, x, z, earth) + fissureLip(p, x, z)) * w;
  const cut = fissureCut(p, x, z) * w;
  shatterOut.h = lifted;
  if (cut <= 0) return shatterOut;
  shatterOut.h = Math.max(lifted - cut, Math.min(lifted, FLOOR_MIN));
  shatterOut.fissure = cut;
  return shatterOut;
}
