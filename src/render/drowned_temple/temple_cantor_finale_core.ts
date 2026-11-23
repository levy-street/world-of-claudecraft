// The plan of Laverock's finale on the Moon Altar (the Drowned Temple's lore
// guide, src/sim/dungeon_guide), the emotional close of the run:
//  - a column of moonlight falls on him at the altar and a pool of light opens
//    at his feet; the lagoon round the island stills and glows;
//  - every fallen pilgrim, novice, guard, singer and their Choirmother breaks
//    into moonlight where they fell, one after another across the song: the
//    body's outline glows on the stones, then the light peels upward off it as
//    motes and wisps, and a stream of light climbs from it across the temple
//    toward the moon (north, over the crater rim);
//  - it all swells as the song begins, holds while the fallen rise, then calms
//    to a steady glow that stays for as long as he sings, so a player who comes
//    in late still finds the song lit (with slow streams rising off the lagoon).
// Pure and deterministic (hashed, never Math.random): temple_cantor_finale_fx.ts
// paints it through the shared GPU particle kit and a few meshes built once.

import { ALTAR_STONE } from '../../sim/content/drowned_temple_layout';

/** Seconds from the song's first note to the first of the fallen rising. */
export const RISE_LEAD_SEC = 1.6;
/** The window the risings are spread across (the song's first verses). */
export const RISE_SPREAD_SEC = 16;
/** Seconds one fallen keeps rising (motes still emitting). */
export const RISE_EMIT_SEC = 3;
/** Motes one fallen sheds over its rise, at full density. */
export const RISE_MOTES = 70;
/** The large slow wisps of one fallen's light (its shape going up whole). */
export const RISE_WISPS = 7;
/** Motes per second round the singer, at full density. */
export const SONG_MOTES_PER_SEC = 9;
/** The moon's direction from the temple (north, +z, a touch west: the sky
 *  dome's DROWNED_TEMPLE_MOON_DIRECTION), as a drift per second. */
export const MOON_DRIFT = { x: -0.13, z: 0.9 };

export interface RiseSpot {
  x: number;
  y: number;
  z: number;
  /** Clock time the rising starts. */
  at: number;
}

/** A plain particle launch (the ParticleSpec shape, three-free). */
export interface MoteLaunch {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ay: number;
  life: number;
  drag: number;
  size0: number;
  size1: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A stable 0..1 hash of two integers. */
export function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** When each fallen rises: the event's flat (x, y, z) triplets, staggered
 *  across the song by a golden-ratio walk so neighbours never rise together. */
export function riseSchedule(spots: readonly number[], start: number): RiseSpot[] {
  const out: RiseSpot[] = [];
  const n = Math.floor(spots.length / 3);
  for (let i = 0; i < n; i++) {
    const x = spots[i * 3];
    const y = spots[i * 3 + 1];
    const z = spots[i * 3 + 2];
    if (![x, y, z].every(Number.isFinite)) continue;
    const t = (i * 0.6180339887) % 1;
    out.push({ x, y, z, at: start + RISE_LEAD_SEC + t * RISE_SPREAD_SEC });
  }
  return out;
}

/** A fallen body's footprint on the stones (it lies where it fell): an
 *  ellipse `len` by `wid` yards turned by `yaw`, hashed from its index. */
export interface BodyShape {
  len: number;
  wid: number;
  yaw: number;
}

export function bodyShape(index: number): BodyShape {
  return {
    len: 2.2 + hash01(index * 53 + 1, 17) * 0.9,
    wid: 0.95 + hash01(index * 53 + 2, 29) * 0.35,
    yaw: hash01(index * 53 + 3, 41) * Math.PI,
  };
}

/** A point on (u = 1) or inside (u < 1) a body's footprint, at angle `a`. */
export function bodyPoint(
  spot: RiseSpot,
  body: BodyShape,
  a: number,
  u: number,
): { x: number; z: number } {
  const lx = Math.cos(a) * body.len * 0.5 * u;
  const lz = Math.sin(a) * body.wid * 0.5 * u;
  const c = Math.cos(body.yaw);
  const sn = Math.sin(body.yaw);
  return { x: spot.x + lx * c - lz * sn, z: spot.z + lx * sn + lz * c };
}

/** The k-th mote a rising fallen sheds: it peels off the body's glowing
 *  outline (and, later, its middle) close to the stones, lifts and drifts
 *  toward the moon, a pale silver shading to blue. */
export function riseMote(spot: RiseSpot, index: number, k: number): MoteLaunch {
  const h1 = hash01(index * 131 + 7, k);
  const h2 = hash01(index * 131 + 11, k * 3 + 1);
  const h3 = hash01(index * 131 + 13, k * 5 + 2);
  // The first motes come off the rim (the outline breaking), the later ones
  // from the whole body as it gives itself up.
  const u = k < RISE_MOTES * 0.4 ? 0.9 + h2 * 0.15 : Math.sqrt(h2);
  const p = bodyPoint(spot, bodyShape(index), h1 * Math.PI * 2, u);
  return {
    x: p.x,
    y: spot.y + 0.08 + h3 * 0.5,
    z: p.z,
    vx: MOON_DRIFT.x + (h2 - 0.5) * 0.4,
    vy: 1.6 + h1 * 2.2,
    vz: MOON_DRIFT.z + (h1 - 0.5) * 0.4,
    ay: 0.7,
    life: 5.5 + h2 * 3,
    drag: 0.05,
    size0: 0.45 + h3 * 0.5,
    size1: 0.06,
    r: 0.8 - h3 * 0.14,
    g: 0.9,
    b: 1,
    a: 0.85,
  };
}

/** The k-th large wisp of a rising fallen: a soft body-tall glow that lifts
 *  slowly and keeps rising toward the moon long after the motes thin out. */
export function riseWisp(spot: RiseSpot, index: number, k: number): MoteLaunch {
  const h1 = hash01(index * 197 + 3, k);
  const h2 = hash01(index * 197 + 5, k * 3 + 1);
  // Off the body's footprint, each at its own pace, so together they draw a
  // soft column of light lifting off the body rather than a stack of balls.
  const p = bodyPoint(spot, bodyShape(index), h1 * Math.PI * 2, 0.2 + h2 * 0.6);
  return {
    x: p.x,
    y: spot.y + 0.4 + h2 * 0.6,
    z: p.z,
    vx: MOON_DRIFT.x,
    vy: 0.9 + k * 0.32 + h1 * 0.5,
    vz: MOON_DRIFT.z * 1.3,
    ay: 0.3,
    life: 8 + h2 * 4,
    drag: 0.02,
    size0: 1.5 + h1 * 1.1,
    size1: 0.4,
    r: 0.72,
    g: 0.85,
    b: 1,
    a: 0.34,
  };
}

/** The k-th mote round the singer: rising slowly off the water and stones
 *  within a few yards of him. */
export function songMote(cx: number, cy: number, cz: number, k: number): MoteLaunch {
  const h1 = hash01(9001, k);
  const h2 = hash01(9002, k * 7 + 3);
  const ang = h1 * Math.PI * 2;
  const rad = 1.2 + h2 * 5.5;
  return {
    x: cx + Math.cos(ang) * rad,
    y: cy + 0.05,
    z: cz + Math.sin(ang) * rad,
    vx: 0,
    vy: 0.7 + h2 * 0.6,
    vz: 0.15,
    ay: 0.05,
    life: 5 + h1 * 3,
    drag: 0.02,
    size0: 0.16 + h2 * 0.14,
    size1: 0.03,
    r: 0.86,
    g: 0.92,
    b: 1,
    a: 0.6,
  };
}

/** How many motes a span emits at `perSec` (carrying the fraction forward). */
export function moteBudget(
  debt: number,
  dt: number,
  perSec: number,
): { count: number; debt: number } {
  const total = debt + Math.max(0, dt) * perSec;
  const count = Math.floor(total);
  return { count, debt: total - count };
}

// ---- the song's light: the swell, the hold and the steady glow ----------------

/** Seconds the light takes to swell to its peak as the song begins. */
export const SWELL_SEC = 3.5;
/** The peak (the steady glow's column, lagoon and pool at full is 1). */
export const PEAK = 1.35;
/** Seconds from the first note the peak holds: until the last fallen rose. */
export const HOLD_END_SEC = RISE_LEAD_SEC + RISE_SPREAD_SEC + RISE_EMIT_SEC + 2;
/** Seconds the calm after the risings takes. */
export const CALM_SEC = 8;
/** The steady glow while he sings on, and what a late arrival finds. */
export const STEADY = 0.62;
/** Seconds a late arrival's glow (or the last fade out) takes. */
export const FADE_SEC = 1.6;

function smooth01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** How bright the song's light is: `sinceSong` is the seconds since this client
 *  saw the song begin (null when it began before this client arrived), and
 *  `sinceSeen` the seconds since this client found him singing. */
export function finaleIntensity(sinceSong: number | null, sinceSeen: number): number {
  if (sinceSong === null || sinceSong < 0) return STEADY * smooth01(sinceSeen / FADE_SEC);
  if (sinceSong < SWELL_SEC) return PEAK * smooth01(sinceSong / SWELL_SEC);
  if (sinceSong < HOLD_END_SEC) return PEAK;
  return PEAK + (STEADY - PEAK) * smooth01((sinceSong - HOLD_END_SEC) / CALM_SEC);
}

/** How still the lagoon is (0 its usual stir, 1 a mirror): it stills as the
 *  song swells and stays still. */
export function lagoonStillness(sinceSong: number | null, sinceSeen: number): number {
  if (sinceSong === null || sinceSong < 0) return smooth01(sinceSeen / FADE_SEC);
  return smooth01(sinceSong / (SWELL_SEC * 2.2));
}

/** The stand (the finale path's last point, drowned_temple_cantor.ts) to the
 *  altar stone's centre: the walk ends at the stone's west face in every claim. */
export const ALTAR_FROM_STAND = { x: 7, z: -1 } as const;

/** The altar stone's centre from where the singer stands. */
export function altarFromSinger(x: number, z: number): { x: number; z: number } {
  return { x: x + ALTAR_FROM_STAND.x, z: z + ALTAR_FROM_STAND.z };
}

/** The lagoon's glow: a ring of water round the island (yards from the stone). */
export const LAGOON_GLOW = { inner: ALTAR_STONE.r + 21, outer: 82 } as const;

// ---- the streams of light climbing to the moon ---------------------------------

/** A stream of light: a ribbon climbing from (x, y, z) toward the moon. */
export interface StreamLaunch {
  x: number;
  y: number;
  z: number;
  /** Clock time the stream starts climbing. */
  at: number;
  /** 0..1 hash: its sway and pace. */
  seed: number;
  /** How high it climbs and how far toward the moon it reaches (yards). */
  height: number;
  reach: number;
  /** Width at the base (yards) and brightness. */
  width: number;
  bright: number;
}

/** Seconds a stream lives (its head reaches the sky, its tail follows). */
export const STREAM_LIFE = 7.5;
/** Streams a rising fallen sends up (at full density). */
export const STREAMS_PER_FALLEN = 2;
/** Streams per second rising off the lagoon while he sings on (full density). */
export const AMBIENT_STREAMS_PER_SEC = 0.55;

/** The k-th stream of a rising fallen: it leaves the body as the outline
 *  breaks, wide and bright. */
export function fallenStream(spot: RiseSpot, index: number, k: number): StreamLaunch {
  const h1 = hash01(index * 977 + 5, k);
  const h2 = hash01(index * 977 + 9, k * 7 + 3);
  const p = bodyPoint(spot, bodyShape(index), h1 * Math.PI * 2, 0.35);
  return {
    x: p.x,
    y: spot.y + 0.2,
    z: p.z,
    at: spot.at + 0.7 + k * 0.45,
    seed: h2,
    height: 34 + h1 * 14,
    reach: 40 + h2 * 20,
    width: 2.6 + h2 * 1.0 - k * 0.6,
    bright: 1 - k * 0.25,
  };
}

/** The k-th slow stream off the lagoon round the island while he sings on. */
export function ambientStream(
  ax: number,
  az: number,
  waterY: number,
  k: number,
  at: number,
): StreamLaunch {
  const h1 = hash01(7717, k);
  const h2 = hash01(7718, k * 5 + 1);
  const ang = h1 * Math.PI * 2;
  const rad = LAGOON_GLOW.inner + 2 + h2 * (LAGOON_GLOW.outer - LAGOON_GLOW.inner - 20);
  return {
    x: ax + Math.cos(ang) * rad,
    y: waterY + 0.1,
    z: az + Math.sin(ang) * rad,
    at,
    seed: h2,
    height: 26 + h2 * 16,
    reach: 30 + h1 * 18,
    width: 1.5 + h2 * 0.7,
    bright: 0.34,
  };
}
