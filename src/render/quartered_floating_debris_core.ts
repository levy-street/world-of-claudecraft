// The Quartered Isle's floating isles as plain numbers: where every torn-up
// island hangs in the sky north of the Gyre, the chains trailing under some of
// them, and the cloud bank they float over. Three-free and DOM-free so a
// Vitest pins the layout without a renderer; quartered_landmark_dressing.ts is
// the thin consumer that instances the island models, the chain links and the
// cloud puffs.
//
// The design's Gyre concept shows chunks of land torn from the isle and left
// hanging in the storm beyond the council's peak, dark jagged islands in cloud
// with broken chains trailing below them. So the isles fall in one trail that
// leaves the Gyre's north face and winds out over the sea toward the council's
// seat (the Smith's Heart), each islet higher and larger than the last so the
// far ones still read through the haze. Nothing hangs over the isle itself:
// the sky over the town, the crater and the quarters stays clear.
//
// Each islet is one of six generated island models (public/models/props/
// sky_isle_*.glb, base at y 0: the hanging tip, its top at the model height):
// the broad terraced, twin and pine islands lead the far trail, the crag, slab
// and spire are the smaller fillers. A model turns by three rotations, in this
// order: its own base correction (the slab is drawn steeply tilted and is
// levelled here), the yaw, then a small lean about a horizontal axis. The
// consumer composes exactly the same order (premultiplied quaternions).
//
// Cosmetic only: nothing here feeds a collider or the sim. Deterministic: no
// rng stream, only fixed integer hashes, so every client hangs the same isles.

import { GYRE_PEAK } from '../sim/quartered_landmarks';
import { hash2 } from '../sim/rng';

type GroundAt = (x: number, z: number) => number;
type Vec3 = [number, number, number];

/** Where the trail starts (just off the Gyre's north face) and how far north
 *  it winds out over the sea. */
export const ISLE_TRAIL = { startZ: GYRE_PEAK.z + 70, endZ: GYRE_PEAK.z + 400 } as const;
/** The trail's widest swing either side of the Gyre's axis, yards. */
export const ISLE_TRAIL_SWING = 90;
/** The least open sky between two islets' edges, yards: wide enough that
 *  each island reads alone from the Gyre's summit. */
export const ISLE_GAP = 24;
/** How many islets the trail aims for before the spacing cuts it. */
export const ISLE_TARGET = 22;
/** An islet's width (its model's longest horizontal extent), nearest to
 *  farthest, before the per-islet spread (0.9 to 1.2): the far islands read
 *  40 to 70yd across from the Gyre's summit. */
export const ISLE_WIDTH_NEAR = 26;
export const ISLE_WIDTH_FAR = 58;
/** The fillers (crag, slab, spire) hang at this share of the trail's width. */
export const ISLE_FILLER_SHARE = 0.55;
/** The height of an islet's top above the sea, nearest to farthest: the
 *  nearest sit above the Gyre's crown, the far ones well above it. */
export const ISLE_TOP_NEAR = GYRE_PEAK.baseY + GYRE_PEAK.rise + 25;
export const ISLE_TOP_FAR = ISLE_TOP_NEAR + 80;
/** The share of islets a low-tier host keeps (see shedFloatingIsles). */
export const LOW_TIER_DEBRIS_SHARE = 0.6;
/** The least air under an islet's lowest point (and a chain's end), yards. */
export const ISLE_GROUND_CLEAR = 6;

/** The six island models. */
export type IsleModel = 'pines' | 'twin' | 'slab' | 'spire' | 'terraced' | 'crag';
/** The cull cluster an islet rides: the trail's near, middle or far stretch. */
export type DebrisCluster = 'near' | 'mid' | 'far';

export interface IsleModelSpec {
  /** the model's native box, yards: x and z extents and its height */
  w: number;
  d: number;
  h: number;
  /** a filler (smaller, between the big islands) or a lead island */
  filler: boolean;
  /** the base correction: a turn of `angle` about the horizontal model axis
   *  (ax, 0, az), applied before the yaw (the slab's authored tilt) */
  base?: { ax: number; az: number; angle: number };
}

/** The models' native boxes, measured from the pipeline's normalized GLBs.
 *  The slab's top faces (0.37, 0.82, 0.44): its correction turns that normal
 *  back up about their cross product with up. */
export const ISLE_MODELS: Readonly<Record<IsleModel, IsleModelSpec>> = {
  pines: { w: 10.6, d: 8.79, h: 14, filler: false },
  twin: { w: 10.55, d: 12.37, h: 16, filler: false },
  terraced: { w: 11.48, d: 9.73, h: 14, filler: false },
  crag: { w: 6.67, d: 6.71, h: 10, filler: true },
  spire: { w: 6.59, d: 4.54, h: 18, filler: true },
  slab: { w: 10.14, d: 6.37, h: 8, filler: true, base: { ax: -0.761, az: 0.649, angle: 0.61 } },
};
export const ISLE_MODEL_KEYS = Object.keys(ISLE_MODELS) as IsleModel[];
const LEADS: readonly IsleModel[] = ['terraced', 'twin', 'pines'];
const FILLERS: readonly IsleModel[] = ['crag', 'slab', 'spire'];

export interface FloatingIsle {
  model: IsleModel;
  /** the model's origin (its tip, xz-centred) in world yards */
  x: number;
  y: number;
  z: number;
  /** uniform scale on the model's native size */
  scale: number;
  /** the islet's width, yards (its model's longest horizontal extent, scaled) */
  width: number;
  yaw: number;
  tilt: number;
  tiltAxisYaw: number;
  /** the islet's index in the trail */
  isle: number;
  cluster: DebrisCluster;
  /** a stable 0..1 draw: a host that sheds keeps the islets below its share */
  keep: number;
  /** the lowest and highest world y its turned box reaches */
  minY: number;
  maxY: number;
}

/** A chain hanging straight down from an islet's underside, ending loose. */
export interface IsleChain {
  isle: number;
  cluster: DebrisCluster;
  keep: number;
  /** the anchor on the islet's underside, world yards */
  x: number;
  y: number;
  z: number;
  /** how far it hangs, yards */
  length: number;
  /** the distance from one link to the next, yards (links overlap) */
  pitch: number;
  /** how many links it holds */
  links: number;
  /** the first link's yaw; links alternate a quarter turn */
  yaw: number;
}

/** One soft cloud puff of the bank under the trail. */
export interface CloudPuff {
  x: number;
  y: number;
  z: number;
  /** the puff's width and height, yards */
  w: number;
  h: number;
  /** the upright card's yaw (0 faces the isle, south) */
  yaw: number;
  /** 0..1 opacity of this puff */
  alpha: number;
  cluster: DebrisCluster;
}

export interface FloatingIslesPlan {
  isles: FloatingIsle[];
  chains: IsleChain[];
  clouds: CloudPuff[];
}

/** Rotate `v` about the unit axis (ax, ay, az) by `angle` (Rodrigues). */
function rotateAbout(v: Vec3, ax: number, ay: number, az: number, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dot = v[0] * ax + v[1] * ay + v[2] * az;
  return [
    v[0] * c + (ay * v[2] - az * v[1]) * s + ax * dot * (1 - c),
    v[1] * c + (az * v[0] - ax * v[2]) * s + ay * dot * (1 - c),
    v[2] * c + (ax * v[1] - ay * v[0]) * s + az * dot * (1 - c),
  ];
}

/** A model-space point (native yards) turned and scaled into world space
 *  around the islet's origin: base correction, yaw, lean, the order the
 *  consumer's quaternions compose. */
export function isleWorldPoint(
  isle: Pick<FloatingIsle, 'model' | 'x' | 'y' | 'z' | 'scale' | 'yaw' | 'tilt' | 'tiltAxisYaw'>,
  local: Vec3,
): Vec3 {
  const spec = ISLE_MODELS[isle.model];
  let v: Vec3 = [local[0] * isle.scale, local[1] * isle.scale, local[2] * isle.scale];
  if (spec.base) {
    const n = Math.hypot(spec.base.ax, spec.base.az);
    v = rotateAbout(v, spec.base.ax / n, 0, spec.base.az / n, spec.base.angle);
  }
  v = rotateAbout(v, 0, 1, 0, isle.yaw);
  v = rotateAbout(v, Math.sin(isle.tiltAxisYaw), 0, Math.cos(isle.tiltAxisYaw), isle.tilt);
  return [isle.x + v[0], isle.y + v[1], isle.z + v[2]];
}

/** The lowest and highest offset (from the origin) the turned, scaled model
 *  box reaches in y: a box bound, so it holds for any shape inside it. */
function turnedYRange(isle: Parameters<typeof isleWorldPoint>[0]): [number, number] {
  const spec = ISLE_MODELS[isle.model];
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const sx of [-0.5, 0.5]) {
    for (const sy of [0, 1]) {
      for (const sz of [-0.5, 0.5]) {
        const p = isleWorldPoint({ ...isle, x: 0, y: 0, z: 0 }, [
          sx * spec.w,
          sy * spec.h,
          sz * spec.d,
        ]);
        lo = Math.min(lo, p[1]);
        hi = Math.max(hi, p[1]);
      }
    }
  }
  return [lo, hi];
}

/** The highest ground under a footprint of radius `r` (centre plus eight
 *  probes), so an islet near the Gyre's face never dips into it. */
function groundUnder(groundAt: GroundAt, x: number, z: number, r: number): number {
  let hi = groundAt(x, z);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    hi = Math.max(hi, groundAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
  }
  return hi;
}

const CANDIDATES = 120;

interface IsleSite {
  x: number;
  z: number;
  /** 0 at the Gyre, 1 at the trail's far end */
  t: number;
  model: IsleModel;
  width: number;
  top: number;
  ordinal: number;
}

/** The model an islet at trail fraction `t` draws: a lead island three times
 *  in four at the far end, half the time near the Gyre. */
function modelFor(i: number, t: number): IsleModel {
  const leadShare = 0.5 + 0.25 * t;
  const list = hash2(i, 7, 7161) < leadShare ? LEADS : FILLERS;
  // step through the list by candidate, nudged by a hash, so the trail mixes
  // all three of a kind instead of repeating one
  return list[(i + Math.floor(hash2(i, 6, 7153) * 2)) % list.length];
}

/** The trail's candidate sites, in a hash order so the target fills evenly
 *  along the whole trail instead of exhausting its near end. */
function trailSites(): (IsleSite & { order: number })[] {
  const out: (IsleSite & { order: number })[] = [];
  const { startZ, endZ } = ISLE_TRAIL;
  for (let i = 0; i < CANDIDATES; i++) {
    const t = (i + hash2(i, 1, 7101)) / CANDIDATES;
    // the trail swings in a slow S, and the islets spread wider from it the
    // farther out they hang
    const spine = Math.sin(t * Math.PI * 1.4 + 0.5) * ISLE_TRAIL_SWING * (0.4 + 0.6 * t);
    const spread = (hash2(i, 2, 7111) - 0.5) * 2 * (55 + 95 * t);
    const model = modelFor(i, t);
    const width =
      (ISLE_WIDTH_NEAR + (ISLE_WIDTH_FAR - ISLE_WIDTH_NEAR) * t) *
      (0.9 + 0.3 * hash2(i, 3, 7121)) *
      (ISLE_MODELS[model].filler ? ISLE_FILLER_SHARE : 1);
    out.push({
      x: GYRE_PEAK.x + spine + spread,
      z: startZ + (endZ - startZ) * t,
      t,
      model,
      width,
      top: ISLE_TOP_NEAR + (ISLE_TOP_FAR - ISLE_TOP_NEAR) * t + (hash2(i, 4, 7131) - 0.5) * 24,
      ordinal: i,
      order: hash2(i, 5, 7141),
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

/** True when two islets would touch: their widths plus some sky between. */
function crowds(a: IsleSite, b: IsleSite): boolean {
  const gap = (a.width + b.width) * 0.5 + ISLE_GAP;
  return Math.hypot(a.x - b.x, a.z - b.z) < gap;
}

function clusterOf(t: number): DebrisCluster {
  return t < 0.34 ? 'near' : t < 0.67 ? 'mid' : 'far';
}

/** One islet at a site, its top at `top` (its turned box's highest point). */
function isletAt(site: IsleSite, top: number, isle: number): FloatingIsle {
  const i = site.ordinal;
  const h = (salt: number) => hash2(i, salt, 7201);
  const spec = ISLE_MODELS[site.model];
  const scale = site.width / Math.max(spec.w, spec.d);
  const turn = {
    model: site.model,
    x: site.x,
    y: 0,
    z: site.z,
    scale,
    yaw: h(1) * Math.PI * 2,
    tilt: (h(4) - 0.5) * 0.16,
    tiltAxisYaw: h(5) * Math.PI * 2,
  };
  const [lo, hi] = turnedYRange(turn);
  const y = top - hi;
  return {
    ...turn,
    y,
    width: site.width,
    isle,
    cluster: clusterOf(site.t),
    keep: h(2),
    minY: y + lo,
    maxY: y + hi,
  };
}

/** How far a chain's links sit apart, as a share of its islet's width, and
 *  its bounds (so a near islet's chain still shows and a far one is not a
 *  hawser). */
const CHAIN_PITCH_SHARE = 0.05;
const CHAIN_PITCH_MIN = 1.5;
const CHAIN_PITCH_MAX = 3.2;
/** The share of islets that trail chains. */
export const ISLE_CHAIN_SHARE = 0.4;
/** The span a chain hangs, yards, before the ground clamp. */
export const ISLE_CHAIN_MIN = 15;
export const ISLE_CHAIN_MAX = 40;

/** The chains under one islet: one to three, anchored round its underside. */
function chainsFor(isle: FloatingIsle, ordinal: number, groundAt: GroundAt): IsleChain[] {
  const h = (salt: number) => hash2(ordinal, salt, 7301);
  if (h(1) >= ISLE_CHAIN_SHARE) return [];
  const spec = ISLE_MODELS[isle.model];
  const count = 1 + Math.min(2, Math.floor(h(2) * 3));
  const pitch = Math.min(
    CHAIN_PITCH_MAX,
    Math.max(CHAIN_PITCH_MIN, isle.width * CHAIN_PITCH_SHARE),
  );
  const out: IsleChain[] = [];
  for (let k = 0; k < count; k++) {
    // a point on the underside cone: partway up from the tip, partway out
    const f = 0.3 + 0.3 * h(10 + k);
    const a = h(20 + k) * Math.PI * 2;
    const r = 0.5 * f * 0.75;
    const anchor = isleWorldPoint(isle, [
      Math.cos(a) * spec.w * r,
      f * spec.h,
      Math.sin(a) * spec.d * r,
    ]);
    let length = ISLE_CHAIN_MIN + (ISLE_CHAIN_MAX - ISLE_CHAIN_MIN) * h(30 + k);
    const floor = groundAt(anchor[0], anchor[2]) + ISLE_GROUND_CLEAR;
    length = Math.min(length, anchor[1] - floor);
    const links = Math.floor(length / pitch);
    if (links < 4) continue;
    out.push({
      isle: isle.isle,
      cluster: isle.cluster,
      keep: isle.keep,
      x: anchor[0],
      y: anchor[1],
      z: anchor[2],
      length: links * pitch,
      pitch,
      links,
      yaw: h(40 + k) * Math.PI,
    });
  }
  return out;
}

/** How far under the islets the cloud bank floats, yards. */
export const CLOUD_BELOW_MIN = 25;
export const CLOUD_BELOW_MAX = 40;
/** How many puffs the bank holds under each islet. */
const PUFFS_PER_ISLE = 2;

/** The bank's puffs under one islet: wider than the islet, under its tip. */
function cloudsFor(isle: FloatingIsle, ordinal: number, groundAt: GroundAt): CloudPuff[] {
  const out: CloudPuff[] = [];
  for (let k = 0; k < PUFFS_PER_ISLE; k++) {
    const h = (salt: number) => hash2(ordinal * 4 + k, salt, 7401);
    const below = CLOUD_BELOW_MIN + (CLOUD_BELOW_MAX - CLOUD_BELOW_MIN) * h(1);
    const a = h(2) * Math.PI * 2;
    const off = isle.width * 0.6 * h(3);
    const x = isle.x + Math.cos(a) * off;
    const z = isle.z + Math.sin(a) * off;
    const w = isle.width * (1.6 + 1.2 * h(4));
    const ph = w * (0.3 + 0.15 * h(5));
    // the puff's lowest edge stays clear of the ground (the Gyre's face)
    const y = Math.max(isle.minY - below, groundAt(x, z) + ISLE_GROUND_CLEAR + ph / 2);
    out.push({
      x,
      y,
      z,
      w,
      h: ph,
      yaw: (h(6) - 0.5) * 0.7,
      alpha: 0.35 + 0.3 * h(7),
      cluster: isle.cluster,
    });
  }
  return out;
}

/**
 * Every floating islet north of the Gyre, its chains and the cloud bank under
 * the trail. `groundAt` is the finished terrain sampler: an islet whose turned
 * box would reach within `ISLE_GROUND_CLEAR` of the ground (the Gyre's own
 * north face) is lifted until it clears, and a chain stops short of it.
 */
export function planFloatingIsles(groundAt: GroundAt): FloatingIslesPlan {
  const placed: IsleSite[] = [];
  const isles: FloatingIsle[] = [];
  const chains: IsleChain[] = [];
  const clouds: CloudPuff[] = [];
  for (const site of trailSites()) {
    if (placed.length >= ISLE_TARGET) break;
    if (placed.some((p) => crowds(p, site))) continue;
    const index = placed.length;
    let isle = isletAt(site, site.top, index);
    const ground = groundUnder(groundAt, site.x, site.z, site.width * 0.6);
    const lift = ground + ISLE_GROUND_CLEAR - isle.minY;
    if (lift > 0) isle = isletAt(site, site.top + lift, index);
    placed.push(site);
    isles.push(isle);
    chains.push(...chainsFor(isle, site.ordinal, groundAt));
    clouds.push(...cloudsFor(isle, site.ordinal, groundAt));
  }
  return { isles, chains, clouds };
}

/** The plan a host keeps at its graphics share (1 keeps all). The isles are
 *  cosmetic sky dressing with nothing a player acts on, so a lower tier may
 *  shed some; the keep draw is per islet, so an islet goes with its chains,
 *  whole or not at all. The cloud bank stays: it is a few cards. */
export function shedFloatingIsles(plan: FloatingIslesPlan, share: number): FloatingIslesPlan {
  if (share >= 1)
    return { isles: [...plan.isles], chains: [...plan.chains], clouds: [...plan.clouds] };
  return {
    isles: plan.isles.filter((i) => i.keep < share),
    chains: plan.chains.filter((c) => c.keep < share),
    clouds: [...plan.clouds],
  };
}

/** The world centre of link `k` of a chain (link 0 hangs at the anchor). */
export function chainLinkY(chain: Pick<IsleChain, 'y' | 'pitch'>, k: number): number {
  return chain.y - (k + 0.5) * chain.pitch;
}

/** The cloud puff texture's side in texels (a power of two, so it mips). */
export const CLOUD_TEXTURE_SIZE = 128;

/** A smooth tileless value noise in [0, 1] from integer hashes. */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** One soft cloud puff as RGBA bytes: white, its alpha a billowing blob that
 *  fades to nothing well inside the card's edge (so no card corner shows). */
export function cloudPuffTexels(size = CLOUD_TEXTURE_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      // an ellipse wider than tall, its base flatter than its top
      const du = (u - 0.5) * 2;
      const dv = (v - 0.55) * (v > 0.55 ? 2.6 : 2.0);
      const r = Math.hypot(du, dv);
      let n = 0;
      let amp = 0.5;
      let freq = 4;
      for (let o = 0; o < 4; o++) {
        n += valueNoise(u * freq, v * freq, 7501 + o) * amp;
        amp *= 0.5;
        freq *= 2;
      }
      const edge = 1 - Math.min(1, Math.max(0, (r - 0.15 - 0.4 * n) / 0.45));
      const alpha = edge * edge * edge * (0.45 + 0.55 * n);
      const o = (y * size + x) * 4;
      const shade = Math.round(225 + 30 * n);
      out[o] = shade;
      out[o + 1] = shade;
      out[o + 2] = Math.min(255, shade + 6);
      out[o + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
    }
  }
  return out;
}
