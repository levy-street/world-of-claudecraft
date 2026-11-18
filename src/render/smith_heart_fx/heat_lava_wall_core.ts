// Pure plan of the Guardian of the Heat's lava waves on screen (heat_lava_wall_fx.ts
// paints it; the sim is ../../sim/encounters/smith_heart/heat_waves.ts, the
// rework of 2026-11-18): a ring of lava rolling out of the wellspring is a WALL
// OF FIRE standing on a band of molten rock, parting in two corridors; the next
// ring's corridors glow on the floor before it comes. Everything here is read
// off the sim's objects and numbers (never tuned here) and the art's own sizes.
//
// Readability (binding, every tier): the wall's foot (the molten band at the
// sim's own front and depth), the corridors' parting (no flame in them, the
// floor dark there) and the corridors' glow on the floor (the next ring's, and
// the rolling one's ahead of its front) draw on every tier; the low tier sheds
// the smoke, the haze, most tongues and embers, never the wall nor a corridor.
//
// Which corridor a spot heeds: the next wall to reach it. A rolling ring's
// corridors are drawn from its front out to the next older ring's front (or the
// walls), the next ring's warning from the lip out to the newest ring's front
// (`corridorSpans`), so every yard of the floor shows ONE corridor pair, the
// one that saves whoever stands there.
//
// Three-free, DOM-free, deterministic.

import { HEARTH_WELL } from '../../sim/content/smith_heart_layout';
import { HEAT_TUNING as T } from '../../sim/encounters/smith_heart/heat_ids';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** The wall's art sizes (yards): the flames' standing height and its leaping
 *  tongues', the molten band's reach behind and ahead of the front (the sim's
 *  wall is `T.ringDepth` behind it), how far ahead the floor is lit, how far
 *  past a corridor's edge the flames lean back from it. */
export const LAVA_WALL = {
  height: 6.4,
  tongue: 10,
  bandBehind: T.ringDepth + 0.4,
  bandAhead: 0.6,
  lightAhead: 7,
  scorchBehind: 9,
  part: 2.2,
  /** The wall rises out of the lip over this long after it leaves. */
  rise: 0.45,
  /** It sinks into the walls over its last yards. */
  sinkYards: 3,
  /** The curtain's angular resolution and its stacked sheets. */
  segments: 320,
  heightSegments: 10,
  sheets: 3,
  /** Tongues and embers per ring (the low tier's share in `wallBudget`). */
  tongues: 120,
  embers: 900,
} as const;

/** The rings the fight can hold at once and the corridor strips they need
 *  (each rolling ring's pair and the next ring's warning). */
export const LAVA_WALL_POOLS = {
  rings: 3,
  corridors: 3 * 2 + 2,
} as const;

/** The low tier's share of the cosmetic layers. */
export function wallBudget(detail: boolean): {
  sheets: number;
  tongues: number;
  embers: number;
  smoke: boolean;
  haze: boolean;
} {
  return detail
    ? {
        sheets: LAVA_WALL.sheets,
        tongues: LAVA_WALL.tongues,
        embers: LAVA_WALL.embers,
        smoke: true,
        haze: true,
      }
    : {
        sheets: 1,
        tongues: Math.round(LAVA_WALL.tongues * 0.35),
        embers: Math.round(LAVA_WALL.embers * 0.3),
        smoke: false,
        haze: false,
      };
}

/** A ring's front (yards from the wellspring's middle) off its object's spot. */
export function ringFront(localX: number, localZ: number): number {
  return Math.hypot(localX - HEARTH_WELL.x, localZ - HEARTH_WELL.z);
}

export interface WallLook {
  /** The wall's standing share (0 at the lip's first instant, 1 risen, back to
   *  0 sinking into the walls). */
  rise: number;
  /** Its heat (the core's push up the ramp; a fresh ring burns whitest). */
  heat: number;
}

/** A ring `age` seconds after it was first seen, its front `front` yards out. */
export function wallLook(
  age: number,
  front: number,
  out: WallLook = { rise: 0, heat: 0 },
): WallLook {
  const up = smooth(age / LAVA_WALL.rise);
  const down = smooth((T.ringEnd - front) / LAVA_WALL.sinkYards);
  out.rise = up * down;
  out.heat = 0.85 + 0.25 * (1 - smooth(age / 3));
  return out;
}

/** How much flame stands at a bearing of the wall (0 in a corridor, rising to
 *  1 `LAVA_WALL.part` past its edge): `across` the yards off the corridor's
 *  line, `half` its half width. Mirrors the wall shaders' `wallOpen`. */
export function wallOpen(across: number, half: number): number {
  return smooth((across - half) / LAVA_WALL.part);
}

/** The yards off a corridor's line (bearing `gap`) of the wall's point at
 *  bearing `a`, `front` out: the chord, or far when the point is behind the
 *  well from it. */
export function acrossGap(a: number, gap: number, front: number): number {
  const d = a - gap;
  if (Math.cos(d) <= 0) return 1e3;
  return Math.abs(Math.sin(d)) * front;
}

export interface GapWarnLook {
  /** 0..1 of the warning spent. */
  fill: number;
  /** Its throb (quickening to the launch). */
  beat: number;
  /** Its strength (brightening to the launch). */
  glow: number;
}

/** A corridor warning `age` seconds into its `seconds` to the launch. */
export function gapWarnLook(
  age: number,
  seconds: number,
  out: GapWarnLook = { fill: 0, beat: 0, glow: 0 },
): GapWarnLook {
  const f = clamp01(age / Math.max(0.1, seconds));
  out.fill = f;
  const phase = age * (1.2 + 2.4 * f * f);
  const b = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  out.beat = b * b;
  out.glow = smooth(age / 0.35) * (0.55 + 0.45 * f);
  return out;
}

/** One stretch of a corridor pair on the floor: its bearings, from and to
 *  (yards from the wellspring's middle), and whether it is a warning (the
 *  next ring's) or a rolling ring's. */
export interface CorridorSpan {
  gaps: readonly number[];
  half: number;
  from: number;
  to: number;
  warn: boolean;
}

/** A pool of spans for `corridorSpans` to write into (one per ring and one
 *  for the warning). */
export function corridorSpanPool(n: number): CorridorSpan[] {
  return Array.from({ length: n }, () => ({ gaps: [], half: 0, from: 0, to: 0, warn: false }));
}

/** The corridor stretches the floor shows: each rolling ring's from its front
 *  to the next older ring's front (the walls past the oldest), the next ring's
 *  warning from the lip to the newest ring's front (see the header). `rings`
 *  is sorted in place (farthest first); the spans are written into `pool`
 *  (never allocating); returns how many. */
export function corridorSpans(
  rings: { front: number; gaps: readonly number[]; half: number }[],
  next: { gaps: readonly number[]; half: number } | null,
  pool: CorridorSpan[],
): number {
  rings.sort((a, b) => b.front - a.front);
  let n = 0;
  let outer: number = T.ringEnd;
  const put = (gaps: readonly number[], half: number, from: number, to: number, warn: boolean) => {
    const s = pool[n++];
    s.gaps = gaps;
    s.half = half;
    s.from = from;
    s.to = to;
    s.warn = warn;
  };
  for (const r of rings) {
    if (n >= pool.length) return n;
    if (r.front < outer) put(r.gaps, r.half, r.front, outer, false);
    outer = Math.min(outer, r.front);
  }
  if (next && outer > T.ringStart && n < pool.length)
    put(next.gaps, next.half, T.ringStart, outer, true);
  return n;
}

/** The fire wall's roar for a listener at (x, z), local yards: the nearest
 *  burning point of the nearest wall (out of its corridors) and how close it
 *  is (0 far, 1 on it), or null when no wall stands. */
export function wallRoar(
  rings: readonly { front: number; gaps: readonly number[]; half: number }[],
  x: number,
  z: number,
): { x: number; z: number; near: number } | null {
  const d = ringFront(x, z);
  const a = Math.atan2(x - HEARTH_WELL.x, z - HEARTH_WELL.z);
  let best: { x: number; z: number; near: number } | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const r of rings) {
    let open = 1;
    for (const g of r.gaps) open = Math.min(open, wallOpen(acrossGap(a, g, r.front), r.half));
    const gap = Math.abs(r.front - d) + (1 - open) * 6;
    if (gap >= bestGap) continue;
    bestGap = gap;
    best = {
      x: HEARTH_WELL.x + Math.sin(a) * r.front,
      z: HEARTH_WELL.z + Math.cos(a) * r.front,
      near: clamp01(1 - gap / 30),
    };
  }
  return best;
}
