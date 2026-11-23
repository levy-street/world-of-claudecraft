// Pure plan for the Wildheart Basin's renderer (docs/design/dungeon-rework/
// wildheart_basin.md section 7): the palette, where the afternoon sun stands,
// every waterfall's lip and fall line (the rim falls, the Weeping Falls and the
// veil the Waterfall Walk passes behind, the ford's spill into the gorge), the
// rainbows in their spray placed against that sun, the river ribbon, the ford
// shallows and the plunge pool, the braziers' lights, the life (birds,
// fireflies, pollen, god rays) and the gates' motion curves. Everything is
// derived from the one field record the sim walks
// (sim/content/wildheart_basin_layout.ts).
//
// Three-free, DOM-free, deterministic (hash noise, no Math.random).

import {
  GORGEBLOOM_DAIS,
  JAGUAR_HEAD,
  RIM_FALLS,
  RIVER_COURSE,
  RIVER_FORD,
  VINE_BRIDGES,
  WEEPING_FALLS,
  WEEPING_FALLS_TERRACE,
  WILDHEART_BASIN_FIELD,
  WILDHEART_BASIN_VOID_HEIGHT,
  WILDHEART_HEIGHTS,
} from '../../sim/content/wildheart_basin_layout';
import { authoredFieldHeight } from '../../sim/instances/authored_field';

/** A stable hash in [0, 1). */
export function basinHash(i: number, k: number): number {
  const v = Math.sin(i * 127.1 + k * 311.7 + 0.5) * 43758.5453;
  return v - Math.floor(v);
}

/** The art direction's palette (design section 7). */
export const BASIN_PALETTE = {
  canopy: 0x3f7d4e,
  moss: 0x6c8a3a,
  basalt: 0x3a3f3a,
  sunbone: 0xd9b26a,
  warRed: 0xa3322a,
  falls: 0xddf3f2,
  sky: 0xf0c877,
  pollen: 0xe8e05a,
  spirit: 0x5fe0a0,
} as const;

function normalize3(x: number, y: number, z: number): readonly [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** Where the golden-hour sun stands, from the ground toward it: low in the
 *  west-south-west, over the Idol Maw's left shoulder, so the caldera is RAKED
 *  from the side as the party looks in (long shadows reaching east across the
 *  terraces, every trunk and stair modelled, the canopy's shafts slanting in),
 *  every fall's spray still holds its rainbow toward the maw, and the jaguar
 *  head is lit across its left cheek with its right in shadow. */
export const BASIN_SUN_DIRECTION = normalize3(-0.84, 0.4, -0.37);

/** The humid haze (fog colour and the sky's horizon). */
export const BASIN_FOG_COLOR = 0xbfb98a;

/** The water levels of the basin. */
export const BASIN_WATER = {
  /** The ford's shallows: ankle-deep, a hand above its basalt sill. */
  ford: RIVER_FORD.h + 0.32,
  /** The plunge pool at the Weeping Falls' foot. */
  pool: WEEPING_FALLS.poolY,
} as const;

// ---- waterfalls ------------------------------------------------------------------

export type BasinFallKind = 'rim' | 'weeping' | 'veil' | 'spill';

export interface BasinFall {
  id: string;
  kind: BasinFallKind;
  /** The lip, from end a to end b (instance-local x, z). */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Unit outward direction the water is thrown (and the curtain faces). */
  nx: number;
  nz: number;
  top: number;
  bottom: number;
  /** Yards the water arcs out from the lip before it falls plumb. */
  throwOut: number;
  /** Where the water lands (the middle of the foot). */
  footX: number;
  footZ: number;
}

/** The Waterfall Walk's veil: a curtain spilling off a rock shelf high over
 *  the path behind the Weeping Falls, falling past the ledge's open (west)
 *  side, so a player on the ledge walks between the cliff and the water. */
export const WALK_VEIL = {
  /** The lip runs along this x, past the ledge's west edge (x 92). */
  x: 90.4,
  z0: -26,
  z1: 2,
  top: 44,
  /** It breaks into the gorge mist well under the ledge. */
  bottom: -12,
  throwOut: 6,
} as const;

/** The rock shelf the veil pours off (render only, high over the walk). */
export const WALK_SHELF = {
  x0: 86,
  x1: 118,
  z0: -30,
  z1: 6,
  y: WALK_VEIL.top,
} as const;

/** The ford's west sill, where the shallows spill into the gorge. */
export const FORD_SPILL = {
  x: RIVER_FORD.x0,
  z0: RIVER_FORD.z0 + 1,
  z1: RIVER_FORD.z1 - 1,
  top: RIVER_FORD.h + 0.3,
  bottom: WILDHEART_BASIN_VOID_HEIGHT + 1,
  throwOut: 3.5,
} as const;

function yawVector(facing: number): [number, number] {
  return [Math.sin(facing), Math.cos(facing)];
}

/** Every waterfall of the basin: the rim falls (their lips from the layout),
 *  the Walk's veil and the ford's wide low spill. */
export function planBasinFalls(): BasinFall[] {
  const out: BasinFall[] = [];
  for (const f of RIM_FALLS) {
    const [nx, nz] = yawVector(f.facing);
    // The lip runs across the facing.
    const tx = nz;
    const tz = -nx;
    const half = f.width / 2;
    const throwOut = f.id === 'weeping' ? 3 : 5;
    out.push({
      id: f.id,
      kind: f.id === 'weeping' ? 'weeping' : 'rim',
      ax: f.x - tx * half,
      az: f.z - tz * half,
      bx: f.x + tx * half,
      bz: f.z + tz * half,
      nx,
      nz,
      top: f.topY,
      bottom: f.bottomY,
      throwOut,
      footX: f.x + nx * throwOut,
      footZ: f.z + nz * throwOut,
    });
  }
  out.push({
    id: 'walk_veil',
    kind: 'veil',
    ax: WALK_VEIL.x,
    az: WALK_VEIL.z0,
    bx: WALK_VEIL.x,
    bz: WALK_VEIL.z1,
    nx: -1,
    nz: 0,
    top: WALK_VEIL.top,
    bottom: WALK_VEIL.bottom,
    throwOut: WALK_VEIL.throwOut,
    footX: WALK_VEIL.x - WALK_VEIL.throwOut,
    footZ: (WALK_VEIL.z0 + WALK_VEIL.z1) / 2,
  });
  out.push({
    id: 'ford_spill',
    kind: 'spill',
    ax: FORD_SPILL.x,
    az: FORD_SPILL.z0,
    bx: FORD_SPILL.x,
    bz: FORD_SPILL.z1,
    nx: -1,
    nz: 0,
    top: FORD_SPILL.top,
    bottom: FORD_SPILL.bottom,
    throwOut: FORD_SPILL.throwOut,
    footX: FORD_SPILL.x - FORD_SPILL.throwOut,
    footZ: (FORD_SPILL.z0 + FORD_SPILL.z1) / 2,
  });
  return out;
}

/** The point on a fall's curtain at lip fraction `u` and fall fraction `t`
 *  (the water leaves the lip in an arc: out fast, then straight down). */
export function fallPoint(f: BasinFall, u: number, t: number): [number, number, number] {
  const lx = f.ax + (f.bx - f.ax) * u;
  const lz = f.az + (f.bz - f.az) * u;
  const out = f.throwOut * (1 - (1 - t) ** 2.2);
  return [lx + f.nx * out, f.top + (f.bottom - f.top) * t ** 1.15, lz + f.nz * out];
}

/** Lip length of a fall (yards). */
export function fallWidth(f: BasinFall): number {
  return Math.hypot(f.bx - f.ax, f.bz - f.az);
}

// ---- rainbows ----------------------------------------------------------------------

export interface BasinRainbow {
  fallId: string;
  /** The arc's centre (its bow stands on this point). */
  x: number;
  y: number;
  z: number;
  /** Yaw of the arc's plane: its face looks toward the sun (sim yaw, 0 = +z),
   *  so it reads to a viewer with the sun at their back. */
  yaw: number;
  /** Arc radius and band width (yards). */
  radius: number;
  band: number;
  /** 0..1 peak opacity of the band. */
  strength: number;
}

/** The horizontal unit direction toward the sun. */
export function sunHorizontal(sun: readonly [number, number, number]): [number, number] {
  const l = Math.hypot(sun[0], sun[2]) || 1;
  return [sun[0] / l, sun[2] / l];
}

/** A rainbow in the spray of every fall big enough to throw one, standing in
 *  the drifting spray on the sun's side of the fall's foot. Its plane faces
 *  the sun, so from the Idol Maw and the Waterfall Walk (the sun behind the
 *  viewer) the bow reads; from the far side it is edge-on or faint. */
export function planBasinRainbows(
  falls: readonly BasinFall[],
  sun: readonly [number, number, number] = BASIN_SUN_DIRECTION,
): BasinRainbow[] {
  const [sx, sz] = sunHorizontal(sun);
  const yaw = Math.atan2(sx, sz);
  const out: BasinRainbow[] = [];
  for (const f of falls) {
    if (f.kind === 'spill') continue;
    const height = f.top - f.bottom;
    const width = fallWidth(f);
    // In the spray cloud: a stride toward the sun from the foot, the bow
    // standing out of the mist over the water.
    const reach = Math.max(6, width * 0.5);
    const radius = Math.min(height * 0.42, width * 1.5 + 10);
    const mistTop = f.kind === 'veil' ? f.bottom + 6 : f.bottom;
    out.push({
      fallId: f.id,
      x: f.footX + sx * reach,
      y: mistTop,
      z: f.footZ + sz * reach,
      yaw,
      radius,
      band: Math.max(2.2, radius * 0.16),
      strength: f.kind === 'veil' ? 0.38 : f.kind === 'weeping' ? 0.5 : 0.46,
    });
  }
  return out;
}

// ---- the river, the ford, the pool -------------------------------------------------

export interface RiverStation {
  x: number;
  z: number;
  y: number;
  /** Unit across-stream direction (left bank side). */
  nx: number;
  nz: number;
  /** Distance downstream from the source (yards). */
  s: number;
  /** Half width of the water here. */
  halfWidth: number;
}

/** Stations along the river's course every `step` yards (the ribbon's rows):
 *  it widens and slows as it runs out of the narrow gorge under the causeway. */
export function riverStations(step: number): RiverStation[] {
  const out: RiverStation[] = [];
  let s = 0;
  for (let i = 0; i + 1 < RIVER_COURSE.length; i++) {
    const [ax, az, ay] = RIVER_COURSE[i];
    const [bx, bz, by] = RIVER_COURSE[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n || (i + 2 === RIVER_COURSE.length && k === n); k++) {
      const t = k / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      // Direction: blend the two neighbouring segments at the joint.
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      const total = s + len * t;
      const halfWidth = 7 + 2.5 * Math.sin(total * 0.031) + (i >= 5 ? 2.5 : 0);
      out.push({ x, z, y: ay + (by - ay) * t, nx: -dz, nz: dx, s: total, halfWidth });
    }
    s += len;
  }
  return out;
}

/** The ford's water sheet (instance-local), over the whole shallow box. */
export const FORD_SHEET = {
  x0: RIVER_FORD.x0,
  x1: RIVER_FORD.x1,
  z0: RIVER_FORD.z0,
  z1: RIVER_FORD.z1,
  y: BASIN_WATER.ford,
} as const;

/** The plunge pool at the Weeping Falls' foot, east of the Gorgebloom's
 *  terrace (its rim meets the terrace's east edge). */
export const PLUNGE_POOL = {
  x: WEEPING_FALLS.x + 1,
  z: WEEPING_FALLS.z,
  r: 13,
  y: BASIN_WATER.pool,
} as const;

/** The Gorgebloom's root pool: a skin of water over its dais (the model's
 *  origin is the waterline: its roots, rags and resting vines sink into it,
 *  and it drowns in it when it dies). Inside the dais's rim stones. */
export const GORGEBLOOM_ROOT_POOL = {
  x: GORGEBLOOM_DAIS.x,
  z: GORGEBLOOM_DAIS.z,
  r: GORGEBLOOM_DAIS.r - 0.4,
  y: WILDHEART_HEIGHTS.fallsTerrace + GORGEBLOOM_DAIS.rise + 0.08,
} as const;

/** Distance from (x, z) to the terrace edge (negative inside). Tests use it to
 *  keep the pool's water off the walkable terrace. */
export function terraceEdgeDistance(x: number, z: number): number {
  const t = WEEPING_FALLS_TERRACE;
  return Math.hypot(x - t.x, z - t.z) - t.r;
}

// ---- lights ------------------------------------------------------------------------

export type BasinLightKind = 'brazier' | 'eyes';

export interface BasinLightSpot {
  kind: BasinLightKind;
  x: number;
  z: number;
  /** Lift of the flame over the floor. */
  lift: number;
}

export const BASIN_LIGHT_STYLE: Readonly<
  Record<BasinLightKind, { color: number; flame: number; intensity: number; range: number }>
> = {
  // Sunbone braziers: a warm troll fire in ochre bowls.
  brazier: { color: 0xffa64a, flame: 0xffc56a, intensity: 26, range: 18 },
  // The jaguar head's burning eyes (jade spirit flame).
  eyes: { color: 0x5fe0a0, flame: 0xa8ffd6, intensity: 60, range: 46 },
};

/** The stone jaguar's eyes, in the head carved into the north rim: the kit's
 *  Kit_JaguarEyes lenses (authored at (+-12, 49.2, 13.4) on the head, which
 *  stands at JAGUAR_HEAD turned to face the terrace). */
export const JAGUAR_EYES: readonly { x: number; y: number; z: number }[] = [-12, 12].map((ex) => ({
  x: JAGUAR_HEAD.x - ex,
  y: JAGUAR_HEAD.y + 49.2 * (JAGUAR_HEAD.height / 70),
  z: JAGUAR_HEAD.z - 13.4 * (JAGUAR_HEAD.height / 70),
}));

/** Every brazier of the field (its `wb_brazier` props) and the jaguar's eyes. */
export function planBasinLights(): BasinLightSpot[] {
  const out: BasinLightSpot[] = [];
  for (const p of WILDHEART_BASIN_FIELD.props) {
    if (p.kind === 'wb_brazier') out.push({ kind: 'brazier', x: p.x, z: p.z, lift: 2.3 });
  }
  return out;
}

/** The light zone a point falls in (nearest zone centre within its radius). */
export function lightZoneOf(x: number, z: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const zone of WILDHEART_BASIN_FIELD.lightZones) {
    const d = Math.hypot(x - zone.x, z - zone.z);
    if (d <= zone.r && d < bestD) {
      bestD = d;
      best = zone.id;
    }
  }
  return best;
}

// ---- life ---------------------------------------------------------------------------

/** A walkable top at (x, z), or null over the gorge. */
export function basinFloorAt(x: number, z: number): number | null {
  const y = authoredFieldHeight(WILDHEART_BASIN_FIELD, x, z);
  return y > WILDHEART_BASIN_VOID_HEIGHT + 1 ? y : null;
}

/** Spots for the fireflies and pollen motes: hashed points over the walkable
 *  floor (never over the gorge), `count` of them. */
export function planMoteSpots(count: number, seed: number): [number, number, number][] {
  const b = WILDHEART_BASIN_FIELD.bounds;
  const out: [number, number, number][] = [];
  for (let i = 0; out.length < count && i < count * 12; i++) {
    const x = b.minX + basinHash(i, seed) * (b.maxX - b.minX);
    const z = b.minZ + basinHash(seed, i * 1.37) * (b.maxZ - b.minZ);
    const y = basinFloorAt(x, z);
    if (y === null) continue;
    out.push([x, y, z]);
  }
  return out;
}

export interface BirdFlock {
  /** Centre of the flock's circuit. */
  x: number;
  z: number;
  /** Height of the circuit and its radius. */
  y: number;
  radius: number;
  count: number;
  /** Radians per second round the circuit (signed). */
  speed: number;
  /** Seconds of a rise from the canopy (the flock lifts, circles, settles). */
  cycle: number;
  seed: number;
}

/** Flocks circling over the canopy, lifting from the gorge and the rim. */
export function planBirdFlocks(): BirdFlock[] {
  const centres: [number, number, number][] = [
    [-70, 120, 42],
    [70, 40, 36],
    [-96, -120, 30],
    [40, -170, 46],
    [0, 150, 60],
    [96, 140, 54],
    [-40, -40, 28],
  ];
  return centres.map(([x, z, y], i) => ({
    x,
    z,
    y,
    radius: 18 + basinHash(i, 3) * 22,
    count: 7 + Math.floor(basinHash(i, 5) * 6),
    speed: (0.16 + basinHash(i, 7) * 0.12) * (i % 2 === 0 ? 1 : -1),
    cycle: 22 + basinHash(i, 9) * 16,
    seed: i * 13.7,
  }));
}

export interface GodRay {
  x: number;
  z: number;
  /** Where the shaft meets the floor. */
  y: number;
  length: number;
  width: number;
  seed: number;
}

/** Shafts of sun slanting down through the canopy beside the big trees and
 *  over the falls' spray (the shaft leans along the sun's direction). */
export function planGodRays(): GodRay[] {
  const out: GodRay[] = [];
  let i = 0;
  for (const p of WILDHEART_BASIN_FIELD.props) {
    if (p.kind !== 'wb_jungle_tree') continue;
    i++;
    if (i % 3 === 0) continue;
    const y = basinFloorAt(p.x, p.z) ?? 0;
    out.push({
      x: p.x + (basinHash(i, 2) - 0.5) * 6,
      z: p.z + (basinHash(i, 4) - 0.5) * 6,
      y,
      length: 34 + basinHash(i, 6) * 14,
      width: 3.5 + basinHash(i, 8) * 3,
      seed: i,
    });
  }
  return out;
}

// ---- gorge haze ---------------------------------------------------------------------

/** The walkable mask over the field's bounds: 1 on a top, 0 over the gorge,
 *  softened by `blur` cells (the gorge haze thins against every walkway). */
export function planWalkMask(size: number, blur = 2): Float32Array {
  const b = WILDHEART_BASIN_FIELD.bounds;
  const raw = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = b.minX + ((i + 0.5) / size) * (b.maxX - b.minX);
      const z = b.minZ + ((j + 0.5) / size) * (b.maxZ - b.minZ);
      raw[j * size + i] = basinFloorAt(x, z) === null ? 0 : 1;
    }
  }
  if (blur <= 0) return raw;
  const out = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let s = 0;
      let n = 0;
      for (let dj = -blur; dj <= blur; dj++) {
        for (let di = -blur; di <= blur; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= size || jj >= size) continue;
          s += raw[jj * size + ii];
          n++;
        }
      }
      out[j * size + i] = s / n;
    }
  }
  return out;
}

// ---- the vine bridges ---------------------------------------------------------------

export interface VineSegment {
  /** Order from the ford end (the weave runs this way). */
  index: number;
  /** Centre of the segment's deck top. */
  x: number;
  y: number;
  z: number;
  /** Unit direction along the deck (3D: it pitches up the ramp). */
  dx: number;
  dy: number;
  dz: number;
  /** Length of the segment (yards). */
  length: number;
}

/** The deck segments of a vine bridge along its path, about `segLen` yards
 *  each, laid exactly on the path's own centreline heights. */
export function planVineSegments(
  points: readonly (readonly [number, number, number])[],
  segLen = 4,
): VineSegment[] {
  const out: VineSegment[] = [];
  let index = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az, ah] = points[i];
    const [bx, bz, bh] = points[i + 1];
    const run = Math.hypot(bx - ax, bz - az, bh - ah);
    if (run < 1e-6) continue;
    const n = Math.max(1, Math.round(run / segLen));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      out.push({
        index: index++,
        x: ax + (bx - ax) * t,
        y: ah + (bh - ah) * t,
        z: az + (bz - az) * t,
        dx: (bx - ax) / run,
        dy: (bh - ah) / run,
        dz: (bz - az) / run,
        length: run / n,
      });
    }
  }
  return out;
}

export const VINE_BRIDGE_PATHS = { west: VINE_BRIDGES.west, east: VINE_BRIDGES.east } as const;
export const VINE_BRIDGE_HALF_WIDTH = VINE_BRIDGES.halfWidth;

function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** How grown segment `index` of `count` is at bridge openness `openness`:
 *  the vines race out from the ford and weave the deck one segment after the
 *  next (0 a frayed stub, 1 woven). */
export function vineWeaveGrowth(openness: number, index: number, count: number): number {
  const lead = openness * (count + 1.5);
  return smooth(lead - index);
}

/** Thorn hedge height share at openness (1 standing, 0 sunk into the ground):
 *  it sinks with a slow start (the rustle) and a quick last drop. */
export function thornRise(openness: number): number {
  const o = Math.max(0, Math.min(1, openness));
  return 1 - (o < 0.25 ? o * 0.6 : 0.15 + (o - 0.25) * (0.85 / 0.75)) ** 1.2;
}

/** The dark red pulse of a sealed hedge (0..1) at clock `t`. */
export function thornSealPulse(sealed: boolean, t: number): number {
  return sealed ? 0.55 + 0.45 * Math.sin(t * 4.2) ** 2 : 0;
}

/** A ward's charge at openness (1 burning, 0 gone), flickering as it fails. */
export function wardCharge(openness: number, t: number): number {
  const o = Math.max(0, Math.min(1, openness));
  if (o <= 0) return 1;
  if (o >= 1) return 0;
  const flicker = 0.5 + 0.5 * Math.sin(t * 37 + o * 11) * Math.sin(t * 13.3);
  return (1 - o) * (0.55 + 0.45 * flicker);
}

/** The heights the route reads at (for tests and the shot script's framing). */
export const BASIN_LEVELS = WILDHEART_HEIGHTS;
