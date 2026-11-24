// The Hailstorm's stones as numbers (the painter is final_hail_fx.ts, a part
// of FinalElementsFx, which keeps each stone's circle on the floor: the sim's
// radius, its danger edge, on every tier).
// The second polish pass of 2026-11-24: Jose read the first pass's stones as
// big smooth blue balloons. Now each spot drops a cluster of jagged ice
// chunks (a main stone and smaller ones round it, several shapes), tumbling
// as they fall with a frost trail, all landing on the sim's beat, and each
// shatters into flying ice shards when it hits.
//
// Binding (readability): every chunk lands inside the spot's circle (its
// offset plus its own size within the sim's radius), and every chunk of a
// spot lands at the same moment as the main stone (the sim's beat:
// `hailFall`). The shards fly only after the hit (cosmetic debris).
//
// Three-free, DOM-free, deterministic.

/** The look (yards, seconds). */
export const HAIL_LOOK = {
  /** Chunks a spot drops (the main stone first; the low tier's share). */
  stones: 6,
  stonesLow: 3,
  /** The main stone's size (its radius, yards) and the smaller ones'. */
  mainSize: 0.62,
  smallSize: [0.24, 0.42] as readonly [number, number],
  /** How far out the smaller ones fall (share of the sim's radius, before
   *  their own size is taken off). */
  spread: 0.62,
  /** How far up the smaller ones trail the main stone (share of its height:
   *  they all land together, the share of nothing being nothing). */
  lag: 0.22,
  /** How fast they tumble (radians a second). */
  spin: [2.2, 6.5] as readonly [number, number],
  /** Bursts alive at once, shards a burst (the low tier's share). */
  bursts: 10,
  shards: 16,
  shardsLow: 7,
  /** A shard's life (seconds), its throw (yards a second out and up), the
   *  pull down, its size. */
  shardLife: 0.85,
  shardOut: [3.5, 9] as readonly [number, number],
  shardUp: [3, 7.5] as readonly [number, number],
  gravity: 22,
  shardSize: [0.16, 0.4] as readonly [number, number],
  /** The frost trail's length behind a stone (yards, slow to fast). */
  trail: [1.5, 6.5] as readonly [number, number],
  /** Chunk shapes (one draw each). */
  shapes: 3,
} as const;

/** A deterministic 0..1 hash. */
export function hailHash(i: number, salt: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 13, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const mix = (a: number, b: number, k: number) => a + (b - a) * k;

export interface HailChunk {
  /** Its offset from the spot's centre (yards). */
  dx: number;
  dz: number;
  /** Its size (radius, yards) and its stretch on each axis. */
  size: number;
  sx: number;
  sy: number;
  sz: number;
  /** How far up it trails the main stone (share of the main's height). */
  lag: number;
  /** Its shape (0..shapes-1), tumble axis and speed. */
  shape: number;
  ax: number;
  ay: number;
  az: number;
  spin: number;
}

/** Chunk `k` (0 the main stone) of the spot `seed` with the sim's radius `r`. */
export function hailChunk(k: number, seed: number, r: number, out: HailChunk): HailChunk {
  const L = HAIL_LOOK;
  const h = (salt: number) => hailHash(seed * 17 + k, salt);
  const size = k === 0 ? L.mainSize : mix(L.smallSize[0], L.smallSize[1], h(3));
  // Its stretch: a lump, never a ball (the longest axis 1.25 of its size).
  const st = 0.8 + 0.45 * h(5);
  out.size = size;
  out.sx = size * st;
  out.sy = size * (1.25 - 0.3 * h(7));
  out.sz = size * (1.05 - 0.2 * h(9));
  const widest = size * Math.max(st, 1.25, 1.05);
  if (k === 0) {
    out.dx = 0;
    out.dz = 0;
    out.lag = 0;
  } else {
    const a = (k / Math.max(1, L.stones - 1) + 0.25 * h(11)) * Math.PI * 2;
    const far = Math.max(0, Math.min(r * L.spread, r - widest)) * (0.45 + 0.55 * h(13));
    out.dx = Math.sin(a) * far;
    out.dz = Math.cos(a) * far;
    out.lag = L.lag * (0.3 + 0.7 * h(15));
  }
  out.shape = Math.floor(h(17) * L.shapes) % L.shapes;
  const ax = h(19) - 0.5;
  const ay = h(21) - 0.5;
  const az = h(23) - 0.5;
  const n = Math.hypot(ax, ay, az) || 1;
  out.ax = ax / n;
  out.ay = ay / n;
  out.az = az / n;
  out.spin = mix(L.spin[0], L.spin[1], h(25));
  return out;
}

/** A chunk's height over the floor while the main stone stands `height` up:
 *  it trails by its lag, so every chunk lands with the main stone. */
export function hailChunkHeight(height: number, lag: number): number {
  return Math.max(0, height) * (1 + lag);
}

/** The frost trail's length behind a stone `height` up of a `drop` fall
 *  (longer as it speeds up). */
export function hailTrailLength(height: number, drop: number): number {
  const k = 1 - Math.max(0, Math.min(1, height / Math.max(0.1, drop)));
  return mix(HAIL_LOOK.trail[0], HAIL_LOOK.trail[1], k);
}

export interface HailShard {
  /** Its place from the burst's centre (yards; y over the floor). */
  x: number;
  y: number;
  z: number;
  /** Its size this moment (0: gone) and its tumble angle. */
  scale: number;
  spin: number;
}

/** Shard `i` of burst `seed`, `age` seconds after the hit: thrown out and up,
 *  falling back, skidding to a stop on the floor and melting away. */
export function hailShardAt(i: number, seed: number, age: number, out: HailShard): HailShard {
  const L = HAIL_LOOK;
  const h = (salt: number) => hailHash(seed * 31 + i, salt);
  if (age < 0 || age >= L.shardLife) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    out.scale = 0;
    out.spin = 0;
    return out;
  }
  const a = (i / L.shards + 0.4 * h(3)) * Math.PI * 2;
  const v = mix(L.shardOut[0], L.shardOut[1], h(5));
  const up = mix(L.shardUp[0], L.shardUp[1], h(7));
  // Its flight to the floor, then a skid (slowing) once it lands.
  const land = (2 * up) / L.gravity;
  const t = Math.min(age, land);
  const skid = Math.max(0, age - land);
  const run = v * t + v * 0.35 * (skid - (skid * skid) / (2 * L.shardLife));
  out.x = Math.sin(a) * run;
  out.z = Math.cos(a) * run;
  out.y = Math.max(0, up * t - 0.5 * L.gravity * t * t) + 0.08;
  const size = mix(L.shardSize[0], L.shardSize[1], h(9));
  const k = age / L.shardLife;
  out.scale = size * (1 - k * k * k);
  out.spin = age * mix(8, 18, h(11)) + h(13) * 6.28;
  return out;
}

/** The farthest a shard flies from its burst (yards): the debris stays
 *  round the circle it hit. */
export function hailShardReach(): number {
  const L = HAIL_LOOK;
  const land = (2 * L.shardUp[1]) / L.gravity;
  const skid = L.shardLife - land;
  return L.shardOut[1] * land + L.shardOut[1] * 0.35 * (skid - (skid * skid) / (2 * L.shardLife));
}

/** A chunk shape's corner pushed in or out (a jagged lump, never a ball):
 *  the radial scale of the corner at (x, y, z) on a unit solid. The same
 *  corner always moves the same way, so shared corners stay shut. */
export function iceCornerScale(x: number, y: number, z: number, shape: number): number {
  const q = (v: number) => Math.round(v * 1000);
  const key = (q(x) * 73856093) ^ (q(y) * 19349663) ^ (q(z) * 83492791);
  const r = hailHash(key >>> 0, 101 + shape * 7);
  return 0.72 + 0.42 * r;
}
