// The hazard pool's pure decisions (no three, no DOM, no clock): the look of
// each style, the footprint rule, how a pool stands on the floor, and the
// dynamic life of a boss-dropped pool. The painters (static_pools.ts,
// dynamic_pools.ts) and the one shader (hazard_pool_shader.ts) read these.
//
// Fairness: a pool is a mechanic a player reacts to, so nothing here takes a
// graphics tier, the FPS governor or a reduced-motion flag. The tar is unlit
// colour math, so the Low preset draws exactly what every other tier draws.

import type { HazardPoolStyle } from '../../world_api/dungeons';

/** How a style looks. Colours are sRGB hex; heights are yards above the floor. */
export interface HazardPoolLook {
  /** The tar body: dark, dense. */
  base: number;
  /** Light seen through thin tar (the body's own sickly glow). */
  film: number;
  /** The brightest light, where the tar thins to nothing at its edge. */
  glow: number;
  /** Room light reflected off the glossy surface. */
  sheen: number;
  /** 0 = a thin, wide pool; 1 = thick and dense (darker core, stronger gloss). */
  thick: number;
  /** Rim height over the floor (clears the floor tiles, never z-fights). */
  lift: number;
  /** Extra height at the centre: a thick pool bulges like poured tar. */
  dome: number;
  /** Rung inside the floor ladder's encounter band. */
  step: number;
}

/**
 * The three looks. Shallow Blackwater is marsh-green tar, deep Blackwater a
 * banked-ember tar (tinted just enough to tell apart at a glance, never a
 * bright lava), and a boss-dropped pool violet. Deep sits a rung above
 * shallow so a deep core always paints over the shallow ring around it, and a
 * boss pool above both.
 */
export const HAZARD_POOL_LOOKS: Readonly<Record<HazardPoolStyle, HazardPoolLook>> = {
  marsh: {
    base: 0x0a120c,
    film: 0x1d4024,
    glow: 0x377a3a,
    sheen: 0x1c201e,
    thick: 0,
    lift: 0.06,
    dome: 0.02,
    step: 2,
  },
  ember: {
    base: 0x120a08,
    film: 0x3e1c0e,
    glow: 0x8f3f1c,
    sheen: 0x201c1a,
    thick: 1,
    lift: 0.08,
    dome: 0.09,
    step: 3,
  },
  violet: {
    base: 0x0d0912,
    film: 0x2e1850,
    glow: 0x6a3cae,
    sheen: 0x1f1b26,
    thick: 0.6,
    lift: 0.07,
    dome: 0.05,
    step: 4,
  },
};

/** The top of the Litany's dry stepping stones (delve_marsh_dressing.ts): a
 *  pool's highest point must stay under it so an island always reads dry. */
export const HAZARD_POOL_ISLAND_TOP = 0.2;

/** The highest point of a pool of this style. */
export function hazardPoolPeak(style: HazardPoolStyle): number {
  const look = HAZARD_POOL_LOOKS[style];
  return look.lift + look.dome;
}

/** The Litany's static Blackwater tiers: shallow is marsh tar; deep, and a zone
 *  with no tier (which the sim treats as deep), is ember tar. */
export function litanyHazardStyle(tier: 'shallow' | 'deep' | undefined): HazardPoolStyle {
  return tier === 'shallow' ? 'marsh' : 'ember';
}

/**
 * How far past the damage radius the organic edge may wander, in yards. The
 * noise only ever pushes OUTWARD: inside the radius the tar is always full, so
 * a player never takes damage on floor that looks dry, and the wander stays
 * small so the visible edge still reads as the real one.
 */
export function hazardPoolEdgeMargin(r: number): number {
  return Math.min(0.6, Math.max(0.25, r * 0.06));
}

/** Width in yards of the soft fade at the very rim. */
export const HAZARD_POOL_EDGE_SOFT = 0.12;

/** How far the drawn disc reaches, as a multiple of the radius. */
export function hazardPoolDiscExtent(r: number): number {
  const rr = Math.max(r, 0.1);
  return 1 + (hazardPoolEdgeMargin(rr) + HAZARD_POOL_EDGE_SOFT) / rr;
}

/** A stable per-pool noise seed from its centre, so two pools never share a
 *  silhouette and a rebuilt room draws the same one. */
export function hazardPoolSeed(x: number, z: number): number {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return (h - Math.floor(h)) * 97;
}

/** Seconds a removed boss pool keeps draining after the sim dropped it. */
export const HAZARD_POOL_DRAIN_SEC = 0.45;

/** A dynamic pool's state for one frame, every channel in 0..1. */
export interface HazardPoolPhase {
  /** The thin film over the whole footprint: on from the first frame. */
  film: number;
  /** The thick tar spreading out from the centre: full once it can hurt. */
  body: number;
  /** 1 while the pool has landed but not yet ticked (the shader pulses it). */
  arming: number;
  /** 0 while the sim keeps the pool; rises to 1 as a dropped pool drains. */
  fade: number;
}

/** The look of a pool the sim keeps forever (static dressing). */
export const HAZARD_POOL_STATIC_PHASE: Readonly<HazardPoolPhase> = Object.freeze({
  film: 1,
  body: 1,
  arming: 0,
  fade: 0,
});

/**
 * One frame of a boss-dropped pool's life.
 *  - The FULL footprint shows from the first frame (the film), so a player can
 *    step out before it ever ticks.
 *  - The thick body spreads to full by `armSec`, the moment of the first damage
 *    tick, and stays full for as long as the sim keeps the pool, however late
 *    a clock runs (online ages are counted from first sight).
 *  - Only after the sim drops it (`goneSec` = seconds since) does it drain.
 */
export function hazardPoolPhase(
  ageSec: number,
  armSec: number,
  goneSec: number | null,
  out: HazardPoolPhase = { film: 0, body: 0, arming: 0, fade: 0 },
): HazardPoolPhase {
  const age = Math.max(0, ageSec);
  const t = armSec > 0 ? Math.min(1, age / armSec) : 1;
  out.film = 1;
  out.body = t * t * (3 - 2 * t);
  out.arming = armSec > 0 && age < armSec ? 1 : 0;
  out.fade = goneSec === null ? 0 : Math.min(1, Math.max(0, goneSec) / HAZARD_POOL_DRAIN_SEC);
  if (goneSec !== null) out.arming = 0;
  return out;
}
