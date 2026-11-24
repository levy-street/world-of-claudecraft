// The Quartered Isle's floating isles as plain numbers: where every torn-up
// island hangs in the sky north of the Gyre, the chains trailing under some of
// them, and the cloud bank they float over. Three-free and DOM-free so a
// Vitest pins the layout without a renderer; quartered_landmark_dressing.ts is
// the thin consumer that instances the island models, the chain links and the
// cloud puffs.
//
// The design's Gyre concept shows chunks of land torn from the isle and left
// hanging in the storm beyond the council's peak, dark jagged islands in cloud
// with broken chains trailing below them. Seen from the Gyre's crown, looking
// north over the sea, they frame one view: a few islets hang in a flank to
// the left and a few to the right, each at its own height, and the middle of
// the view is left open for the raid isle, a mock-up of the raid's outside
// (not the raid's own map), held far out and high in the storm. Nothing hangs over the isle itself: the sky over the town,
// the crater and the quarters stays clear.
//
// The islets are authored slots (ISLE_SLOTS), not a hashed scatter: the view
// is composed, so every islet's bearing from the crown, distance and height is
// chosen, and their heights are deliberately uneven. Each is one of six
// generated island models (public/models/props/sky_isle_*.glb, base at y 0:
// the hanging tip, its top at the model height): the broad terraced, twin and
// pine islands lead, the crag, slab and spire are the smaller fillers. The raid
// isle is a seventh model (sky_isle_raid.glb). A model turns by three
// rotations, in this order: its own base correction (the slab is drawn steeply
// tilted and is levelled here), the yaw, then a small lean about a horizontal
// axis. The consumer composes exactly the same order (premultiplied
// quaternions).
//
// Cosmetic only: nothing here feeds a collider or the sim. Deterministic: no
// rng stream, only fixed integer hashes, so every client hangs the same isles.

import { GYRE_PEAK } from '../sim/quartered_landmarks';
import { hash2 } from '../sim/rng';

type GroundAt = (x: number, z: number) => number;
type Vec3 = [number, number, number];

/** The Gyre's crown height, yards: every islet's height is measured from it. */
export const CROWN_Y = GYRE_PEAK.baseY + GYRE_PEAK.rise;
/** The least open sky between two islets' edges, yards: wide enough that
 *  each island reads alone from the Gyre's summit. */
export const ISLE_GAP = 24;
/** The share of islets a low-tier host keeps (see shedFloatingIsles). */
export const LOW_TIER_DEBRIS_SHARE = 0.6;
/** The least air under an islet's lowest point (and a chain's end), yards. */
export const ISLE_GROUND_CLEAR = 6;

/** The six island models, and the raid isle. */
export type IsleModel = 'pines' | 'twin' | 'slab' | 'spire' | 'terraced' | 'crag' | 'raid';
/** The cull cluster an islet rides: near, middle or far from the Gyre. */
export type DebrisCluster = 'near' | 'mid' | 'far';

/** Which side of the view north from the crown an islet hangs on: left is
 *  +X (the world's west, map-left), right is -X. The raid isle is the middle. */
export type IsleSide = 'left' | 'right' | 'middle';

/** One authored islet: where it hangs, seen from the Gyre's crown. */
export interface IsleSlot {
  side: IsleSide;
  model: IsleModel;
  /** bearing from due north, degrees: positive turns left (+X), negative right */
  bearing: number;
  /** horizontal distance from the Gyre's peak, yards */
  dist: number;
  /** the islet's width (its model's longest horizontal extent), yards */
  width: number;
  /** its top above the crown, yards */
  rise: number;
  /** chains trailing from its underside, and how far they hang, yards */
  chains: number;
  chainLength: [number, number];
  /** 0..1: a low-tier host keeps the islets below its share (the raid isle is
   *  0, kept everywhere; the small fillers shed first) */
  keep: number;
  /** a fixed yaw (radians) instead of the hashed one: the raid isle turns its
   *  heart to face the crown */
  yaw?: number;
  /** with a fixed yaw, a fixed lean (radians) about the world x axis instead
   *  of none: negative tips the top south, toward the Gyre */
  lean?: number;
}

/** The raid isle: due north of the crown, far out over the sea and high, the
 *  middle of the view. The heart (the crystal on its keep, the model's +X face)
 *  turns south to face the Gyre: a quarter turn takes +X to -Z. */
export const RAID_ISLE_SLOT: IsleSlot = {
  side: 'middle',
  model: 'raid',
  bearing: 0,
  dist: 300,
  width: 210,
  rise: 172,
  chains: 4,
  chainLength: [42, 78],
  keep: 0,
  yaw: Math.PI / 2,
  // the highest thing in the sky is seen from below: tipped toward the crown,
  // its keep, heart and towers still show over the rim
  lean: -0.36,
};

/** The flanking islets, three a side. Their heights are uneven on purpose
 *  (24 to 150yd over the crown), every one tops out below the raid isle (the
 *  highest point in the sky), and every one stays outside the raid isle's
 *  share of the view (RAID_VIEW_CLEAR). */
export const ISLE_SLOTS: readonly IsleSlot[] = [
  {
    side: 'left',
    model: 'crag',
    bearing: 47,
    dist: 120,
    width: 21,
    rise: 24,
    chains: 0,
    chainLength: [0, 0],
    keep: 0.9,
  },
  {
    side: 'left',
    model: 'twin',
    bearing: 36,
    dist: 185,
    width: 50,
    rise: 62,
    chains: 2,
    chainLength: [15, 34],
    keep: 0.3,
  },
  {
    side: 'left',
    model: 'pines',
    bearing: 31,
    dist: 305,
    width: 58,
    rise: 128,
    chains: 1,
    chainLength: [20, 40],
    keep: 0.5,
  },
  {
    side: 'right',
    model: 'spire',
    bearing: -45,
    dist: 140,
    width: 22,
    rise: 38,
    chains: 0,
    chainLength: [0, 0],
    keep: 0.8,
  },
  {
    side: 'right',
    model: 'terraced',
    bearing: -34,
    dist: 225,
    width: 54,
    rise: 92,
    chains: 2,
    chainLength: [18, 38],
    keep: 0.4,
  },
  {
    side: 'right',
    model: 'slab',
    bearing: -28,
    dist: 330,
    width: 34,
    rise: 150,
    chains: 1,
    chainLength: [15, 30],
    keep: 0.7,
  },
];

/** The least angle, degrees, between the raid isle's edge and a flanking
 *  islet's edge, seen from the crown: the middle of the view stays the raid
 *  isle's alone. */
export const RAID_VIEW_CLEAR = 4;

/** An islet slot's world centre (xz), yards. */
export function slotXZ(slot: Pick<IsleSlot, 'bearing' | 'dist'>): [number, number] {
  const a = (slot.bearing * Math.PI) / 180;
  return [GYRE_PEAK.x + Math.sin(a) * slot.dist, GYRE_PEAK.z + Math.cos(a) * slot.dist];
}

/** The half-angle, degrees, an islet of `width` subtends at `dist` from the crown. */
export function slotHalfAngle(slot: Pick<IsleSlot, 'width' | 'dist'>): number {
  return (Math.atan(slot.width / 2 / slot.dist) * 180) / Math.PI;
}

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
  terraced: { w: 11.48, d: 9.7, h: 14, filler: false },
  crag: { w: 6.63, d: 6.71, h: 9.94, filler: true },
  spire: { w: 6.52, d: 4.4, h: 18, filler: true },
  slab: { w: 10.14, d: 6.37, h: 8, filler: true, base: { ax: -0.761, az: 0.649, angle: 0.61 } },
  raid: { w: 9.81, d: 9.81, h: 9, filler: false },
};
export const ISLE_MODEL_KEYS = Object.keys(ISLE_MODELS) as IsleModel[];

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

/** The cull cluster for a slot at `dist` from the peak. */
export function clusterOf(dist: number): DebrisCluster {
  return dist < 170 ? 'near' : dist < 260 ? 'mid' : 'far';
}

/** One islet at a slot, its top at `top` (its turned box's highest point).
 *  `ordinal` seeds its hashed yaw and lean (a slot with a fixed yaw keeps it,
 *  and hangs level). */
function isletAt(slot: IsleSlot, top: number, isle: number, ordinal: number): FloatingIsle {
  const h = (salt: number) => hash2(ordinal, salt, 7201);
  const spec = ISLE_MODELS[slot.model];
  const scale = slot.width / Math.max(spec.w, spec.d);
  const [x, z] = slotXZ(slot);
  const fixed = slot.yaw !== undefined;
  const turn = {
    model: slot.model,
    x,
    y: 0,
    z,
    scale,
    yaw: slot.yaw ?? h(1) * Math.PI * 2,
    tilt: fixed ? (slot.lean ?? 0) : (h(4) - 0.5) * 0.16,
    // the world x axis (sin, 0, cos of a quarter turn) for a fixed lean
    tiltAxisYaw: fixed ? Math.PI / 2 : h(5) * Math.PI * 2,
  };
  const [lo, hi] = turnedYRange(turn);
  const y = top - hi;
  return {
    ...turn,
    y,
    width: slot.width,
    isle,
    cluster: clusterOf(slot.dist),
    keep: slot.keep,
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
/** The span a flanking islet's chain may hang, yards, before the ground
 *  clamp (the raid isle's own run longer, RAID_ISLE_SLOT.chainLength). */
export const ISLE_CHAIN_MIN = 15;
export const ISLE_CHAIN_MAX = 40;

/** The chains under one islet (its slot's count), anchored round its underside. */
function chainsFor(
  isle: FloatingIsle,
  slot: IsleSlot,
  ordinal: number,
  groundAt: GroundAt,
): IsleChain[] {
  const h = (salt: number) => hash2(ordinal, salt, 7301);
  const spec = ISLE_MODELS[isle.model];
  const count = slot.chains;
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
    const [lmin, lmax] = slot.chainLength;
    let length = lmin + (lmax - lmin) * h(30 + k);
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

/** The raid isle first, then the flanking slots: every islet the view hangs. */
export const ALL_SLOTS: readonly IsleSlot[] = [RAID_ISLE_SLOT, ...ISLE_SLOTS];

/**
 * Every floating islet north of the Gyre, its chains and the cloud bank under
 * them: the raid isle in the middle of the view and the flanking slots either
 * side. `groundAt` is the finished terrain sampler: an islet whose turned box
 * would reach within `ISLE_GROUND_CLEAR` of the ground (the Gyre's own north
 * face) is lifted until it clears, and a chain stops short of it.
 */
export function planFloatingIsles(groundAt: GroundAt): FloatingIslesPlan {
  const isles: FloatingIsle[] = [];
  const chains: IsleChain[] = [];
  const clouds: CloudPuff[] = [];
  ALL_SLOTS.forEach((slot, index) => {
    // ordinals follow the slot's place in the list, so appending a slot never
    // moves another slot's hashed yaw (inserting or removing one shifts those
    // after it)
    const ordinal = 31 + index * 7;
    const top = CROWN_Y + slot.rise;
    let isle = isletAt(slot, top, index, ordinal);
    const [x, z] = slotXZ(slot);
    const ground = groundUnder(groundAt, x, z, slot.width * 0.6);
    const lift = ground + ISLE_GROUND_CLEAR - isle.minY;
    if (lift > 0) isle = isletAt(slot, top + lift, index, ordinal);
    isles.push(isle);
    chains.push(...chainsFor(isle, slot, ordinal, groundAt));
    clouds.push(...cloudsFor(isle, ordinal, groundAt));
  });
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
