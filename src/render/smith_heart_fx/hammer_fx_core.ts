// Pure plan of the Hammer guardian's and the Slab's effects (hammer_fx.ts
// paints them; docs/design/raid/smith_heart.md, section 7.1): what Mountain's
// Wrath looks like over its bar and when it lands, what Hammerfall tears up,
// how the Slab breaks. Presentation only: the sim's numbers (the nova's
// radius and bar, the cleave's arc and range) are read here, never changed,
// and the readable telegraph stays the trash engine's sight field
// (../trash_engine_fx/engine_nova.ts); these are the cosmetic layers over it.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import {
  SMITH_HEART_CASTS,
  SMITH_HEART_GUARDIANS,
  SMITH_HEART_MOBS,
} from '../../sim/content/smith_heart';
import { NOVA_WAVE_SECONDS } from '../trash_engine_fx/trash_engine_fx_core';

/** The guardian whose kit these effects dress. */
export const HAMMER_GUARDIAN = SMITH_HEART_GUARDIANS.hammer;
/** Its Mountain's Wrath cast id. */
export const MOUNTAINS_WRATH = SMITH_HEART_CASTS.hammerWrath;
/** The ability id the sim's front-arc cleave sends on its windup. */
export const ARC_CLEAVE_ABILITY = 'brood_cleave';

/** The sim's own numbers (read, never tuned here). */
export function hammerGuardianKit(): {
  radius: number;
  castTime: number;
  arcDeg: number;
  range: number;
} {
  const t = SMITH_HEART_MOBS[HAMMER_GUARDIAN];
  return {
    radius: t?.trashKit?.nova?.radius ?? 45,
    castTime: t?.trashKit?.nova?.castTime ?? 3,
    arcDeg: t?.arcCleave?.arcDeg ?? 110,
    range: t?.arcCleave?.range ?? 9,
  };
}

/** The palette (linear 0..1): molten cracks, quarry dust, the vein's flash. */
export const HAMMER_FX_COLORS = {
  /** The cracks' white-hot core and their amber edge. */
  crackCore: [1.0, 0.86, 0.55] as const,
  crackEdge: [0.95, 0.46, 0.12] as const,
  /** The fissure's dark lip on the floor. */
  crackDark: [0.08, 0.05, 0.03] as const,
  dust: [0.78, 0.66, 0.5] as const,
  dustDark: [0.46, 0.37, 0.28] as const,
  flash: [1.0, 0.78, 0.42] as const,
  /** The shock rings (hex for the shared ring pool). */
  ring: 0xffc27a,
  ringDust: 0xc89a66,
} as const;

/** Deterministic hash in [0, 1). */
export function fxHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** One crack on the floor: points (x, z, local to its origin) and the share
 *  of the crack's length reached at each point. */
export interface CrackLine {
  pts: { x: number; z: number; t: number }[];
  /** Half its width at the root (yards); it tapers to nothing at its tip. */
  width: number;
}

/**
 * Cracks racing out from a point: `count` jagged lines, each a few
 * segments, fanned over `arcDeg` degrees round `heading` (sim convention:
 * 0 is +z), reaching `reach` yards (each a little short of it, a few
 * forking). Deterministic per `seed`.
 */
export function crackLines(
  seed: number,
  count: number,
  reach: number,
  heading = 0,
  arcDeg = 360,
): CrackLine[] {
  const out: CrackLine[] = [];
  const arc = (arcDeg * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    const share = arcDeg >= 360 ? (i + fxHash(seed, i) * 0.6) / count : (i + 0.5) / count;
    let a = heading - arc / 2 + arc * share;
    const len = reach * (0.55 + fxHash(seed + 7, i) * 0.45);
    const segs = 6 + Math.floor(fxHash(seed + 3, i) * 4);
    const pts: { x: number; z: number; t: number }[] = [{ x: 0, z: 0, t: 0 }];
    let x = 0;
    let z = 0;
    for (let s = 1; s <= segs; s++) {
      a += (fxHash(seed + 11 * s, i) - 0.5) * 0.7;
      const step = len / segs;
      x += Math.sin(a) * step;
      z += Math.cos(a) * step;
      pts.push({ x, z, t: s / segs });
    }
    out.push({ pts, width: 0.45 + fxHash(seed + 5, i) * 0.35 });
    // A fork off the middle of every third crack.
    if (i % 3 === 0) {
      const root = pts[Math.floor(segs / 2)];
      let fa = a + (fxHash(seed + 13, i) < 0.5 ? -0.8 : 0.8);
      const fpts: { x: number; z: number; t: number }[] = [{ x: root.x, z: root.z, t: root.t }];
      let fx = root.x;
      let fz = root.z;
      const fs = 3;
      for (let s = 1; s <= fs; s++) {
        fa += (fxHash(seed + 17 * s, i) - 0.5) * 0.6;
        fx += Math.sin(fa) * (len * 0.12);
        fz += Math.cos(fa) * (len * 0.12);
        fpts.push({ x: fx, z: fz, t: root.t + (1 - root.t) * (s / fs) });
      }
      out.push({ pts: fpts, width: 0.28 });
    }
  }
  return out;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** Mountain's Wrath over its bar (`progress` 0..1 of the cast): how far the
 *  cracks have run, how hot they burn, how high the loose stones float, how
 *  hard the dust is drawn in toward the guardian. */
export function wrathChargeLook(progress: number): {
  grow: number;
  heat: number;
  rise: number;
  gather: number;
} {
  const p = clamp01(progress);
  return {
    grow: smooth(p / 0.85),
    heat: 0.6 + 0.8 * smooth((p - 0.25) / 0.75) + 0.15 * Math.sin(p * 40) * p,
    rise: smooth((p - 0.1) / 0.8),
    gather: smooth((p - 0.2) / 0.6),
  };
}

/** Seconds the blast's cracks smoulder after it lands. */
export const WRATH_AFTERGLOW = 2.4;

/** The blast `elapsed` seconds after it landed: the dust wall's radius
 *  (riding the trash engine's wave front, the same clock), its height and
 *  alpha, and the cracks' fading heat. */
export function wrathBlastLook(
  elapsed: number,
  radius: number,
): { front: number; height: number; alpha: number; heat: number } {
  const t = clamp01(elapsed / NOVA_WAVE_SECONDS);
  const ease = 1 - (1 - t) ** 2.4;
  const after = Math.max(0, elapsed - NOVA_WAVE_SECONDS);
  return {
    front: radius * ease,
    height: 1.2 + 4.8 * (1 - t) + 1.6 * t,
    alpha: elapsed < NOVA_WAVE_SECONDS ? 0.85 : Math.max(0, 0.85 - after / 0.9),
    heat: Math.max(0, 1.6 * (1 - elapsed / WRATH_AFTERGLOW)),
  };
}

/** Hammerfall's crack fan `elapsed` seconds after the swing: its heat. */
export function hammerfallHeat(elapsed: number): number {
  if (elapsed < 0) return 0;
  if (elapsed < 0.12) return 1.6 * (elapsed / 0.12);
  return Math.max(0, 1.6 * (1 - (elapsed - 0.12) / 1.6));
}

/** Seconds the Slab's break plays (flash, burst, dust and falling grit). */
export const SLAB_BREAK_SECONDS = 4.5;

/** The Slab breaking `since` seconds after its gate began to open: the
 *  split's flash, whether this frame is the burst (once, at BURST_AT), the
 *  dust and grit rates (particles a second, before the tier's density). */
export const SLAB_BURST_AT = 0.35;
export function slabBreakLook(since: number): { flash: number; dust: number; grit: number } {
  if (since < 0 || since > SLAB_BREAK_SECONDS) return { flash: 0, dust: 0, grit: 0 };
  const flash =
    since < SLAB_BURST_AT
      ? smooth(since / SLAB_BURST_AT)
      : Math.max(0, 1 - (since - SLAB_BURST_AT) / 0.6);
  return {
    flash,
    dust: since > SLAB_BURST_AT ? 40 * Math.max(0, 1 - (since - SLAB_BURST_AT) / 3) : 0,
    grit: since > SLAB_BURST_AT * 0.5 ? 26 * Math.max(0, 1 - since / SLAB_BREAK_SECONDS) : 0,
  };
}

/** Whether a gate's watched change is one this page should play a break
 *  for: the gate seen opening (never one first met open), within the break's
 *  time, and a change not already played (its start time differs). */
export function slabBreakDue(
  view: { state: string; changed: boolean; since: number },
  now: number,
  played: number | undefined,
): number | null {
  if (view.state !== 'open' || !view.changed || view.since > SLAB_BREAK_SECONDS) return null;
  const start = now - view.since;
  if (played !== undefined && Math.abs(played - start) < 0.05) return null;
  return start;
}

/** Pool sizes at full density (the low tier and reduced motion thin the
 *  emitted counts; the pools themselves are sized once). */
export const HAMMER_FX_POOLS = {
  debris: 220,
  pebbles: 40,
  crackStars: 2,
} as const;
