// The storm round the raid isle (the raid's outside, hung in the middle
// of the view north of the Gyre) as plain numbers: the ring of dark cloud that
// wheels slowly round its waist, the thunderhead over its towers, the lightning
// bolts that strike from it, and when each strike flashes. Three-free and
// DOM-free so a Vitest pins it; quartered_raid_storm.ts is the thin painter.
//
// A strike every couple of seconds, one bolt at a time, a soft
// double flicker that fades in well under a second, never a strobe. Lightning
// is the photosensitive case, so the schedule keeps every strike at least
// STRIKE_GAP_MIN apart (no more than two flashes in any one second) and the
// painter draws no bolt at all under reduced motion. Cosmetic only: nothing
// here feeds the sim. Deterministic: fixed integer hashes, no rng stream.

import { hash2 } from '../sim/rng';
import type { FloatingIsle } from './quartered_floating_debris_core';

/** The isle the storm wraps, by its own axis: the hanging tip, the centre of
 *  its top (where the keep stands; south of the tip when the isle leans toward
 *  the Gyre), and its width. Every card and bolt is placed along that axis, so
 *  the storm leans with the isle. */
export interface StormIsle {
  tip: { x: number; y: number; z: number };
  top: { x: number; y: number; z: number };
  width: number;
}

/** The isle's axis point at height fraction `f` (0 the tip, 1 the top),
 *  written into `out` (a per-frame caller passes its own, so nothing is
 *  allocated). */
export function axisAt(
  isle: StormIsle,
  f: number,
  out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): { x: number; y: number; z: number } {
  out.x = isle.tip.x + (isle.top.x - isle.tip.x) * f;
  out.y = isle.tip.y + (isle.top.y - isle.tip.y) * f;
  out.z = isle.tip.z + (isle.top.z - isle.tip.z) * f;
  return out;
}

/** The storm axis of a planned floating isle: its tip is the model origin,
 *  its top the turned point at the model's height over it. */
export function stormIsleOf(
  isle: FloatingIsle,
  topOf: (isle: FloatingIsle) => [number, number, number],
): StormIsle {
  const [x, y, z] = topOf(isle);
  return { tip: { x: isle.x, y: isle.y, z: isle.z }, top: { x, y, z }, width: isle.width };
}

/** One dark cloud card. Every card faces south (the Gyre, where the storm is
 *  seen from). The storm wraps the isle top and bottom and never hides its
 *  fortress: a tight ring round the hanging tip, a churning sea of cloud round
 *  the spike, a rim ring curling round the cliff edge just under the walls, a
 *  dark wall BEHIND (the backdrop its towers and the lightning stand out
 *  against), and the thunderhead over and behind the towers. The three rings
 *  turn round the isle's own axis, square to it, so they tilt as the isle
 *  leans: the rim ring follows the cliff edge down at the front. No card hangs
 *  in front of the fortress's walls. */
export interface StormPuff {
  /** 'tip', 'base' and 'rim' cards wheel round the isle's axis (the rim the
   *  other way); 'back' cards sway in the wall behind; 'cap' cards hang over
   *  the towers as the thunderhead */
  layer: 'tip' | 'base' | 'rim' | 'back' | 'cap';
  /** rings: orbit radius and starting angle; back and cap: the fixed offset
   *  across the view (x) and behind the isle (z), yards */
  radius: number;
  angle: number;
  /** height above the isle's tip, yards */
  y: number;
  /** card width and height, yards */
  w: number;
  h: number;
  /** slow bob: amplitude (yards), rate (radians per second) and phase */
  bob: number;
  bobRate: number;
  phase: number;
  /** this card's tone, a multiplier on the storm's colour (so the mass is
   *  never one flat grey) */
  shade: number;
}

/** The rings: each one's orbit radius as a share of the isle's width and its
 *  band of heights as a share of the isle's height above the tip. The tip
 *  ring hugs the hanging point, the cloud sea churns round the spike, the rim
 *  ring curls round the cliff edge just under the fortress. */
export const TIP_RADIUS = [0.1, 0.34] as const;
export const TIP_BAND = [0.0, 0.18] as const;
export const BASE_RADIUS = [0.3, 0.72] as const;
export const BASE_BAND = [0.16, 0.42] as const;
export const RIM_RADIUS = [0.46, 0.66] as const;
export const RIM_BAND = [0.88, 0.97] as const;
/** The wall behind: how far behind the isle's axis (share of its width) and
 *  its band of heights (share of the isle's height). */
export const BACK_DEPTH = [0.38, 0.62] as const;
export const BACK_BAND = [0.25, 1.05] as const;
/** Card counts per layer. */
export const TIP_PUFFS = 12;
export const RIM_PUFFS = 16;
export const BASE_PUFFS = 18;
export const BACK_PUFFS = 16;
export const CAP_PUFFS = 12;
/** Each ring wheels once in this many seconds (a slow churn, never a spin);
 *  the rim turns against the rings below it, so the storm reads as a swirl. */
export const TIP_PERIOD = 200;
export const BASE_PERIOD = 240;
export const RIM_PERIOD = -300;
/** How high the thunderhead floats over the isle's top (share of its width),
 *  how wide it spreads either side of the axis, and how far behind it sits. */
export const CAP_LIFT = [0.0, 0.16] as const;
export const CAP_SPREAD = 0.72;
export const CAP_DEPTH = [0.1, 0.28] as const;
/** The wall's sideways sway, yards, and its period, seconds. */
export const BACK_SWAY = 6;
export const BACK_SWAY_PERIOD = 90;

/** Every dark cloud card round the raid isle. */
export function stormPuffs(isle: StormIsle): StormPuff[] {
  const height = isle.top.y - isle.tip.y;
  const out: StormPuff[] = [];
  const span = (lo: number, hi: number, t: number) => lo + (hi - lo) * t;
  for (let i = 0; i < TIP_PUFFS; i++) {
    const h = (salt: number) => hash2(i, salt, 8051);
    const w = isle.width * span(0.34, 0.56, h(1));
    out.push({
      layer: 'tip',
      radius: isle.width * span(TIP_RADIUS[0], TIP_RADIUS[1], h(2)),
      angle: ((i + 0.6 * h(3)) / TIP_PUFFS) * Math.PI * 2,
      y: height * span(TIP_BAND[0], TIP_BAND[1], h(4)),
      w,
      h: w * span(0.4, 0.55, h(5)),
      bob: span(1.5, 3.5, h(6)),
      bobRate: span(0.2, 0.4, h(7)),
      phase: h(8) * Math.PI * 2,
      shade: span(0.86, 1.04, h(9)),
    });
  }
  for (let i = 0; i < RIM_PUFFS; i++) {
    const h = (salt: number) => hash2(i, salt, 8076);
    const w = isle.width * span(0.38, 0.6, h(1));
    out.push({
      layer: 'rim',
      radius: isle.width * span(RIM_RADIUS[0], RIM_RADIUS[1], h(2)),
      angle: ((i + 0.6 * h(3)) / RIM_PUFFS) * Math.PI * 2,
      y: height * span(RIM_BAND[0], RIM_BAND[1], h(4)),
      w,
      // flat wisps, so a rim card at the front stays under the walls
      h: w * span(0.28, 0.36, h(5)),
      bob: span(1, 2, h(6)),
      bobRate: span(0.15, 0.3, h(7)),
      phase: h(8) * Math.PI * 2,
      shade: span(0.92, 1.1, h(9)),
    });
  }
  for (let i = 0; i < BASE_PUFFS; i++) {
    const h = (salt: number) => hash2(i, salt, 8101);
    const w = isle.width * span(0.55, 0.9, h(1));
    out.push({
      layer: 'base',
      radius: isle.width * span(BASE_RADIUS[0], BASE_RADIUS[1], h(2)),
      // evenly round the ring, nudged, so no wide gap opens
      angle: ((i + 0.6 * h(3)) / BASE_PUFFS) * Math.PI * 2,
      y: height * span(BASE_BAND[0], BASE_BAND[1], h(4)),
      w,
      h: w * span(0.34, 0.46, h(5)),
      bob: span(1.5, 4, h(6)),
      bobRate: span(0.18, 0.38, h(7)),
      phase: h(8) * Math.PI * 2,
      shade: span(0.9, 1.1, h(9)),
    });
  }
  for (let i = 0; i < BACK_PUFFS; i++) {
    const h = (salt: number) => hash2(i, salt, 8151);
    const w = isle.width * span(0.7, 1.1, h(1));
    // spread evenly across the view behind the isle, nudged
    const across = ((i + 0.5 + (h(2) - 0.5) * 0.6) / BACK_PUFFS) * 2 - 1;
    out.push({
      layer: 'back',
      radius: isle.width * 1.05 * across,
      angle: isle.width * span(BACK_DEPTH[0], BACK_DEPTH[1], h(3)),
      y: height * span(BACK_BAND[0], BACK_BAND[1], h(4)),
      w,
      h: w * span(0.5, 0.68, h(5)),
      bob: span(1, 3, h(6)),
      bobRate: span(0.12, 0.24, h(7)),
      phase: h(8) * Math.PI * 2,
      // the wall darker than the sea below, so the isle stands out from it
      shade: span(0.8, 0.96, h(9)),
    });
  }
  for (let i = 0; i < CAP_PUFFS; i++) {
    const h = (salt: number) => hash2(i, salt, 8201);
    const w = isle.width * span(0.7, 1.0, h(1));
    const lift = isle.width * span(CAP_LIFT[0], CAP_LIFT[1], h(4));
    out.push({
      layer: 'cap',
      // one wide anvil of cloud across the view, never a single column
      radius: isle.width * CAP_SPREAD * ((i / (CAP_PUFFS - 1)) * 2 - 1 + (h(2) - 0.5) * 0.25),
      angle: isle.width * span(CAP_DEPTH[0], CAP_DEPTH[1], h(3)),
      y: height + lift,
      w,
      h: w * span(0.36, 0.58, h(5)),
      bob: span(1, 2.5, h(6)),
      bobRate: span(0.1, 0.22, h(7)),
      phase: h(8) * Math.PI * 2,
      shade: span(0.84, 1.0, h(9)),
    });
  }
  return out;
}

/** A static sphere round everything the storm can reach, for culling: the
 *  widest orbit, the wall's spread and sway, the thunderhead's lift, every
 *  card's half size with its glow, and every bolt. Centred on the isle's axis
 *  at 0.6 of its height. */
export function stormReach(isle: StormIsle): { x: number; y: number; z: number; radius: number } {
  const height = isle.top.y - isle.tip.y;
  return {
    x: (isle.tip.x + isle.top.x) / 2,
    y: isle.tip.y + height * 0.6,
    z: (isle.tip.z + isle.top.z) / 2,
    radius: Math.hypot(isle.width * 1.8, height * 1.2),
  };
}

const AXIS_SCRATCH = { x: 0, y: 0, z: 0 };

/** How far the isle's axis leans per yard of height: the top's horizontal
 *  offset from the tip over its height (x and z). A ring square to the axis
 *  rises by this much per yard it reaches behind (and drops in front). */
export function axisLean(
  isle: StormIsle,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  const height = isle.top.y - isle.tip.y;
  out.x = (isle.top.x - isle.tip.x) / height;
  out.z = (isle.top.z - isle.tip.z) / height;
  return out;
}

const LEAN_SCRATCH = { x: 0, z: 0 };

/** One ring layer's period, seconds per turn (negative turns the other way). */
function ringPeriod(layer: StormPuff['layer']): number {
  return layer === 'tip' ? TIP_PERIOD : layer === 'rim' ? RIM_PERIOD : BASE_PERIOD;
}

/** Where a storm card sits at time `t` (seconds), world yards. Ring cards
 *  (tip, base, rim) orbit the isle's axis on a circle square to it, so they
 *  tilt as the isle leans; the wall behind sways slowly side to side; the
 *  thunderhead only bobs. */
export function puffPosition(
  isle: StormIsle,
  puff: StormPuff,
  t: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const bob = Math.sin(puff.phase + t * puff.bobRate) * puff.bob;
  const height = isle.top.y - isle.tip.y;
  const axis = axisAt(isle, Math.min(1, puff.y / height), AXIS_SCRATCH);
  if (puff.layer === 'tip' || puff.layer === 'base' || puff.layer === 'rim') {
    const a = puff.angle + (t / ringPeriod(puff.layer)) * Math.PI * 2;
    const dx = Math.cos(a) * puff.radius;
    const dz = Math.sin(a) * puff.radius;
    out.x = axis.x + dx;
    out.z = axis.z + dz;
    // square to the leaning axis: the plane through the axis point whose
    // normal is the axis drops by lean per yard toward the lean's side
    const lean = axisLean(isle, LEAN_SCRATCH);
    out.y = isle.tip.y + puff.y + bob - (lean.x * dx + lean.z * dz);
    return out;
  }
  const sway =
    puff.layer === 'back'
      ? Math.sin(puff.phase + (t / BACK_SWAY_PERIOD) * Math.PI * 2) * BACK_SWAY
      : 0;
  out.x = axis.x + puff.radius + sway;
  out.z = axis.z + puff.angle;
  out.y = isle.tip.y + puff.y + bob;
  return out;
}

/** A sorter that puts the cards in drawing order, farthest from the Gyre
 *  first: they never write depth, so a nearer card must draw after the one
 *  behind it. `zs[i]` is card i's current z (the viewer is always south, low
 *  z); the comparator is made once, so a per-frame sort allocates nothing.
 *  The returned function fills `order` and returns it. */
export function makeBackToFront(zs: ArrayLike<number>): (order: number[]) => number[] {
  const farFirst = (a: number, b: number) => zs[b] - zs[a];
  return (order) => {
    order.length = zs.length;
    for (let i = 0; i < zs.length; i++) order[i] = i;
    return order.sort(farFirst);
  };
}

/** The glow ribbon's width as a multiple of the core's. */
export const GLOW_WIDTH = 4;
/** Midpoint-displacement depth of a bolt's main path and its fork, so every
 *  bolt has the same point counts (a painter preallocates one buffer). */
const BOLT_DEPTH = 5;
const FORK_DEPTH = 3;
export const BOLT_POINTS = 2 ** BOLT_DEPTH + 1;
export const FORK_POINTS = 2 ** FORK_DEPTH + 1;
/** The core ribbon's width, yards, as a share of the isle's width. */
export const BOLT_WIDTH_SHARE = 0.017;
/** How far a bolt may wander sideways for each yard it falls: lightning comes
 *  DOWN out of its cloud, never across the sky. */
export const BOLT_MAX_SLANT = 0.7;
/** The least drop of any bolt, yards. */
export const BOLT_MIN_DROP = 30;
/** How far off the keep's middle (share of the isle's width) a thunderhead
 *  cloud must hang to strike the isle, so the anvil keep never hides the bolt;
 *  and the band beside the isle's axis a flank strike's cloud hangs in, just
 *  past the cliffs and well inside the flanking islets. */
export const STRIKE_KEEP_CLEAR = 0.1;
export const FLANK_BAND = [0.45, 0.62] as const;
/** How far toward the crown of the isle's axis (share of its width) a flank
 *  strike's cloud must hang, so nothing of the isle hides it. */
export const FLANK_NEAR = 0.08;
/** The share of strikes that hit the isle (the plaza before its keep); the
 *  rest fall past a flank into the storm below. */
export const ISLE_STRIKE_SHARE = 0.6;

type P3 = [number, number, number];

/** A jagged path from a to b by midpoint displacement: the offset is sideways
 *  in x (across the view) and shrinks each level, z runs straight from a to b.
 *  `depth` levels give 2^depth + 1 points. */
function jag(a: P3, b: P3, depth: number, rough: number, seed: number): P3[] {
  let pts: P3[] = [a, b];
  for (let level = 0; level < depth; level++) {
    const next: P3[] = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const p = pts[k];
      const q = pts[k + 1];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const off = (hash2(seed, level * 64 + k, 8301) - 0.5) * 2 * rough * len;
      next.push([(p[0] + q[0]) / 2 + off, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]);
      next.push(q);
    }
    pts = next;
  }
  return pts;
}

/** One strike: the cloud it comes out of, the clouds it lights (that cloud
 *  and its two nearest), whether it hits the isle or falls past a flank, and
 *  its bolt (a main path and a fork, world yards, always falling). */
export interface StrikePlan {
  source: number;
  glow: [number, number, number];
  hits: 'isle' | 'flank';
  main: P3[];
  fork: P3[];
  width: number;
}

/**
 * Plan strike `n` from the clouds as they hang right now (`xs`, `ys`, `zs`,
 * each card's current centre, indexed like `puffs`). A strike that hits the
 * isle comes out of the thunderhead over the isle's top and falls onto the
 * plaza in front of the keep (toward the Gyre, so the keep never hides it);
 * one that falls past a flank comes out of a cloud beside the isle and drops
 * straight down into the storm sea. Every bolt starts in its cloud's belly.
 * Deterministic in `n`.
 */
export function planStrike(
  isle: StormIsle,
  puffs: readonly StormPuff[],
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  zs: ArrayLike<number>,
  n: number,
): StrikePlan {
  const h = (salt: number) => hash2(n, salt, 8701);
  const w = isle.width;
  const height = isle.top.y - isle.tip.y;
  const top = isle.top;
  const lean = axisLean(isle);
  const high = isle.tip.y + height * 0.62;
  // the thunderhead over the isle's top strikes the isle; clouds beside it
  // (the rim's sides, the wall, the thunderhead's wings) strike down past a
  // flank. The rim under the cliff edge never strikes up onto the towers.
  // Seen from the crown, the anvil keep stands in the middle of the top and
  // the flanking islets hang out beyond the isle's sides: a strike onto the
  // isle comes from a thunderhead cloud off to the side of the keep, and one
  // past a flank from a cloud just beside the cliffs, never out where a
  // flanking islet would hide it.
  const over: number[] = [];
  const beside: number[] = [];
  for (let i = 0; i < puffs.length; i++) {
    const layer = puffs[i].layer;
    if (ys[i] < high || layer === 'tip' || layer === 'base') continue;
    const dx = Math.abs(xs[i] - top.x);
    if (layer === 'cap' && dx >= w * STRIKE_KEEP_CLEAR && dx < w * 0.42 && ys[i] >= top.y - 3) {
      over.push(i);
    } else if (dx >= w * FLANK_BAND[0] && dx <= w * FLANK_BAND[1]) {
      // and only a cloud clearly on the isle's near side, toward the crown:
      // one tucked behind the top or its edge is hidden by the isle, light,
      // bolt and all
      const f = Math.min(1, Math.max(0, (ys[i] - isle.tip.y) / height));
      const axis = axisAt(isle, f, AXIS_SCRATCH);
      if (zs[i] < axis.z - w * FLANK_NEAR) beside.push(i);
    }
  }
  const hitIsle = over.length > 0 && (beside.length === 0 || h(1) < ISLE_STRIKE_SHARE);
  const pool = hitIsle ? over : beside.length > 0 ? beside : over;
  const source = pool[Math.min(pool.length - 1, Math.floor(h(2) * pool.length))];
  // out of the cloud's belly, always: a bolt never starts in clear sky
  const start: P3 = [xs[source], ys[source] - puffs[source].h * 0.12, zs[source]];
  let end: P3;
  if (hitIsle) {
    // onto the plaza in front of the keep, under the cloud (the front of the
    // top, toward the Gyre, so the keep never hides the strike)
    const tx = top.x + Math.max(-0.34 * w, Math.min(0.34 * w, (start[0] - top.x) * 0.85));
    const tz = top.z - w * (0.18 + 0.14 * h(3));
    const floor = top.y - (lean.x * (tx - top.x) + lean.z * (tz - top.z));
    end = [tx, floor + height * 0.04 * h(4), tz];
  } else {
    // straight down past the cliffs into the storm sea, hugging them
    const out = Math.sign(start[0] - top.x) || 1;
    end = [
      start[0] - out * w * 0.04 + (h(3) - 0.5) * w * 0.08,
      isle.tip.y + height * (0.2 + 0.18 * h(4)),
      start[2],
    ];
  }
  // never a short bolt (a low cloud strikes on down into the isle's top,
  // which hides the rest) and never a sideways one (the end is pulled under
  // the start until the slant is a lightning's)
  if (start[1] - end[1] < BOLT_MIN_DROP) end[1] = start[1] - BOLT_MIN_DROP;
  const drop = start[1] - end[1];
  const slant = (end[0] - start[0]) / drop;
  if (Math.abs(slant) > BOLT_MAX_SLANT * 0.8) {
    end[0] = start[0] + Math.sign(slant) * BOLT_MAX_SLANT * 0.8 * drop;
  }
  const main = jag(start, end, BOLT_DEPTH, 0.18, n * 13 + 3);
  // one fork, leaving partway down and running off downward
  const at = main[Math.floor(BOLT_POINTS * (0.3 + 0.3 * h(5)))];
  const side = h(6) < 0.5 ? -1 : 1;
  const forkDrop = drop * (0.25 + 0.15 * h(7));
  const forkEnd: P3 = [at[0] + side * forkDrop * 0.45, at[1] - forkDrop, at[2]];
  const fork = jag(at, forkEnd, FORK_DEPTH, 0.22, n * 13 + 7);
  // the source lights, and its two nearest clouds a little
  let n1 = -1;
  let n2 = -1;
  let d1 = Number.POSITIVE_INFINITY;
  let d2 = Number.POSITIVE_INFINITY;
  for (let i = 0; i < puffs.length; i++) {
    if (i === source) continue;
    const d = Math.hypot(xs[i] - xs[source], ys[i] - ys[source], zs[i] - zs[source]);
    if (d < d1) {
      n2 = n1;
      d2 = d1;
      n1 = i;
      d1 = d;
    } else if (d < d2) {
      n2 = i;
      d2 = d;
    }
  }
  return {
    source,
    glow: [source, n1 < 0 ? source : n1, n2 < 0 ? source : n2],
    hits: hitIsle ? 'isle' : 'flank',
    main,
    fork,
    width: Math.max(0.8, w * BOLT_WIDTH_SHARE),
  };
}

/** Strikes: the gap between one and the next, seconds. Never under the floor,
 *  so the storm stays far from a strobe. */
export const STRIKE_GAP_MIN = 1.5;
export const STRIKE_GAP_MAX = 3;
/** How long one strike's light lasts, seconds (both flickers and the fade). */
export const STRIKE_LENGTH = 0.85;

/** The start time of strike `n` (n >= 0), seconds from the storm's start. */
export function strikeAt(n: number): number {
  let start = 1.5;
  for (let k = 0; k < n; k++) {
    start += STRIKE_GAP_MIN + (STRIKE_GAP_MAX - STRIKE_GAP_MIN) * hash2(k, 1, 8501);
  }
  return start;
}

/** A strike's light, 0..1, at `tau` seconds after it starts: a quick rise, a
 *  fade, and one softer re-flicker, all done inside STRIKE_LENGTH. */
export function strikeLight(tau: number): number {
  if (tau < 0 || tau >= STRIKE_LENGTH) return 0;
  const main = tau < 0.04 ? tau / 0.04 : Math.exp(-(tau - 0.04) / 0.2);
  const again = 0.65 * Math.exp(-(((tau - 0.3) / 0.07) ** 2));
  // and closes to nothing at the end of the window
  const close = Math.min(1, (STRIKE_LENGTH - tau) / 0.1);
  return Math.min(1, main + again) * close;
}

/** A walker over the strike schedule that a per-frame painter steps with its
 *  own clock: it never re-walks the schedule from the start. */
export class StrikeClock {
  private n = 0;
  private next = strikeAt(0);
  private current = -1;
  private currentStart = 0;
  /** the one result object every lit frame fills (nothing allocated per frame) */
  private readonly lit = { n: 0, light: 0 };

  /** The strike lit at time `t` (seconds, never going back): its index and
   *  light, or null between strikes. The result is reused: read it before the
   *  next call. */
  at(t: number): { readonly n: number; readonly light: number } | null {
    while (t >= this.next) {
      this.current = this.n;
      this.currentStart = this.next;
      this.next += STRIKE_GAP_MIN + (STRIKE_GAP_MAX - STRIKE_GAP_MIN) * hash2(this.n, 1, 8501);
      this.n++;
    }
    if (this.current < 0) return null;
    const light = strikeLight(t - this.currentStart);
    if (light <= 0) return null;
    this.lit.n = this.current;
    this.lit.light = light;
    return this.lit;
  }
}

/** A 3D polyline as a flat ribbon facing south (the Gyre): two vertices a
 *  point, offset either side of the path by half `width` across it in x and y
 *  (z follows the path), along the averaged direction so joints stay closed.
 *  Writes `points.length * 2` vertices into `out` from vertex `at` and
 *  returns the next free vertex; thins toward the end, so it reads as a
 *  strike, not a bar. */
export function ribbonInto(
  points: readonly P3[],
  width: number,
  out: Float32Array,
  at: number,
): number {
  const n = points.length;
  let v = at;
  for (let k = 0; k < n; k++) {
    const prev = points[Math.max(0, k - 1)];
    const next = points[Math.min(n - 1, k + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const half = (1 - 0.75 * (k / Math.max(1, n - 1))) * width * 0.5;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    const p = points[k];
    out[v * 3] = p[0] + nx;
    out[v * 3 + 1] = p[1] + ny;
    out[v * 3 + 2] = p[2];
    out[v * 3 + 3] = p[0] - nx;
    out[v * 3 + 4] = p[1] - ny;
    out[v * 3 + 5] = p[2];
    v += 2;
  }
  return v;
}

/** The triangle indices of a ribbon of `points` points whose first vertex is
 *  `base` (two triangles a segment). */
export function ribbonIndices(points: number, base: number, out: number[]): void {
  for (let k = 1; k < points; k++) {
    const a = base + (k - 1) * 2;
    out.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

/** The storm cloud texture's side in texels (a power of two, so it mips). */
export const STORM_TEXTURE_SIZE = 128;

/** A smooth tileless value noise in [0, 1] from integer hashes. */
function noise(x: number, y: number, seed: number): number {
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

/**
 * One storm cloud card as RGBA bytes: one soft billowing mass, flatter
 * underneath than on top, lit from above and dark in the belly (the storm's
 * colour multiplies it), its alpha fading to nothing well inside the card's
 * edge. Row 0 is the card's BOTTOM (a DataTexture's first row meets uv y 0,
 * the plane's lower edge).
 */
export function stormPuffTexels(size = STORM_TEXTURE_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const u = (col + 0.5) / size;
      const up = (row + 0.5) / size;
      let n = 0;
      let amp = 0.5;
      let freq = 3;
      for (let o = 0; o < 5; o++) {
        n += noise(u * freq, up * freq, 8601 + o) * amp;
        amp *= 0.5;
        freq *= 2;
      }
      // a mass wider than tall, its base flatter than its top
      const du = (u - 0.5) * 2;
      const dv = (up - 0.48) * (up < 0.48 ? 2.8 : 2.0);
      const r = Math.hypot(du, dv);
      const edge = 1 - Math.min(1, Math.max(0, (r - 0.12 - 0.5 * n) / 0.42));
      // and a window that is zero on every edge, so no card corner shows
      const win = Math.min(1, u * 10, (1 - u) * 10, up * 10, (1 - up) * 10);
      const alpha = Math.min(1, edge * (0.8 + 0.5 * n)) * win;
      // lit top, dark belly, mottled by the same noise
      const height = Math.min(1, Math.max(0, (up - 0.2 + 0.3 * (n - 0.5)) / 0.7));
      const shade = 0.52 + 0.44 * height * height * (3 - 2 * height) + 0.08 * (n - 0.5);
      const o = (row * size + col) * 4;
      out[o] = Math.round(Math.min(1, shade) * 232);
      out[o + 1] = Math.round(Math.min(1, shade) * 240);
      out[o + 2] = Math.round(Math.min(1, shade * 1.04) * 255);
      out[o + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
    }
  }
  return out;
}
