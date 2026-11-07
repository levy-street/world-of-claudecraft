// Pure plan of the Knotted Gale's look (breath_heart_fx.ts paints it; the sim is
// encounters/smith_heart/breath_heart.ts): which object a template is, the ball
// growing and more violent as its fuse runs out, the shrinking ring that IS its
// timer, the portals told apart by colour, letter and pattern (phase 2's second pair
// a bright family of its own, swirling the other way), the throw's arc and the
// burst's timeline. The sim's numbers are read (breath_ids.ts), never tuned here.
//
// Three-free, DOM-free, deterministic.

import { BREATH, CORNICE_GAPS } from '../../sim/content/smith_heart_layout';
import {
  BREATH_AURAS,
  BREATH_OBJECTS,
  BREATH_TUNING as T,
} from '../../sim/encounters/smith_heart/breath_ids';

/** Portal A the storm's teal, Portal B its violet (the first pair, cool); Portal
 *  C its spring green, Portal D its rose (the second pair, phase 2 only: a bright
 *  family of its own, never a shade of the first's); the fuse's end the lethal red.
 *  The HUD's alert borders match (tokens.css --color-knot-portal-c and -d). */
export const HEART_COLORS = {
  a: 0x48f0d8,
  b: 0xb478ff,
  c: 0xa8ff3e,
  d: 0xff5ab0,
  core: 0xdcecff,
  storm: 0x8fb4ff,
  danger: 0xff4a3a,
  load: 0xffd27a,
  dust: 0xc8c0d8,
} as const;

/** The floor rungs, above every Breath footprint and never tied with one another
 *  (pinned in tests/smith_heart_breath_heart_fx.test.ts). */
export const HEART_FLOOR = {
  disc: 34,
  letter: 35,
  ring: 36,
  mark: 37,
  load: 38,
} as const;

/** The floor rungs the rest of the Breath's fight draws on (its own telegraph kit's
 *  stay below 30). */
export function heartRungs(): number[] {
  return Object.values(HEART_FLOOR);
}

/** Pools: two balls, four portals (two pairs) and two links is all the sim
 *  makes; marks are spare by one. */
export const HEART_POOLS = {
  knots: 2,
  portals: 4,
  links: 2,
  marks: 5,
  flights: 2,
  bursts: 1,
} as const;

export type HeartPortalSide = 'A' | 'B' | 'C' | 'D';
export type HeartObjectKind = 'knot' | 'portalA' | 'portalB' | 'portalC' | 'portalD';

/** Every portal side in pool order: the first pair, then the second. */
export const HEART_SIDES: readonly HeartPortalSide[] = ['A', 'B', 'C', 'D'];

/** Which of this mechanic's objects a template is, or null. */
export function heartObjectKind(templateId: string): HeartObjectKind | null {
  if (templateId.startsWith(BREATH_OBJECTS.knotPrefix)) return 'knot';
  if (templateId === BREATH_OBJECTS.portalA) return 'portalA';
  if (templateId === BREATH_OBJECTS.portalB) return 'portalB';
  if (templateId === BREATH_OBJECTS.portalC) return 'portalC';
  if (templateId === BREATH_OBJECTS.portalD) return 'portalD';
  return null;
}

/** The portal side an object kind names (null for the ball). */
export function portalSideOfKind(kind: HeartObjectKind): HeartPortalSide | null {
  if (kind === 'portalA') return 'A';
  if (kind === 'portalB') return 'B';
  if (kind === 'portalC') return 'C';
  if (kind === 'portalD') return 'D';
  return null;
}

/** The side a mark aura names, or null. */
export function markSideOf(auraId: string): HeartPortalSide | null {
  if (auraId === BREATH_AURAS.portalA) return 'A';
  if (auraId === BREATH_AURAS.portalB) return 'B';
  if (auraId === BREATH_AURAS.portalC) return 'C';
  if (auraId === BREATH_AURAS.portalD) return 'D';
  return null;
}

export interface PortalSideLook {
  /** Its slot in the portal pool (side order). */
  slot: number;
  /** 0 the first pair (A, B), 1 the second (C, D). */
  pair: 0 | 1;
  color: number;
  /** The mouth's arms of wind: four for the first pair, three for the second. */
  arms: number;
  /** Which way the mouth and the funnel turn: the second pair the other way. */
  spin: 1 | -1;
  /** 1: a second, inner rim on the mouth (the second pair). */
  ring2: 0 | 1;
}

/** A portal side's look: the colour, and the pattern that tells the pairs apart
 *  even to an eye that cannot tell the colours apart. */
export function portalSideLook(side: HeartPortalSide): PortalSideLook {
  const slot = HEART_SIDES.indexOf(side);
  const pair = slot >= 2 ? 1 : 0;
  const color = [HEART_COLORS.a, HEART_COLORS.b, HEART_COLORS.c, HEART_COLORS.d][slot];
  return {
    slot,
    pair,
    color,
    arms: pair === 0 ? 4 : 3,
    spin: pair === 0 ? 1 : -1,
    ring2: pair === 0 ? 0 : 1,
  };
}

/** How high each pair's link of light rides over the higher mouth (yards): the
 *  first pair's beam at the waist, the second pair's braid above it, so two
 *  links that cross never merge into one. */
export const LINK_Y = [1.4, 2.3] as const;
/** The links' radius (yards): the first pair's round beam, the second pair's
 *  braid wound a little wider, so both read from across the Cornice. */
export const LINK_R = [0.42, 0.55] as const;

/** The fuse now: the template's half second, run down since it last changed. */
export function liveFuse(templateFuse: number, sinceChange: number): number {
  return Math.max(0, templateFuse - Math.max(0, sinceChange));
}

export interface KnotLook {
  /** 0 at a full fuse, 1 as it ends. */
  urge: number;
  /** The ball's radius (yards). */
  radius: number;
  /** The storm's crackle in the shader (0 to 1). */
  crackle: number;
  /** The knot of wind round it: its turn in radians a second. */
  spin: number;
  /** The timer's ring on the floor: its radius (at the pick-up's own when it ends). */
  ringR: number;
  /** How far the ring has turned from the storm's colour to the lethal red. */
  danger: number;
  /** How hard it throbs (0 to 1), in the last seconds. */
  throb: number;
}

const RING_START = 9;
/** The fuse left (seconds) from which the ball throbs. */
export const KNOT_THROB_AT = 3;

/** The ball at `fuse` seconds left. */
export function knotLook(fuse: number): KnotLook {
  const left = Math.max(0, Math.min(1, fuse / T.heartFuse));
  const urge = 1 - left;
  return {
    urge,
    radius: 0.85 + 0.75 * urge * urge,
    crackle: 0.3 + 0.7 * urge,
    spin: 1.2 + 7 * urge * urge,
    ringR: T.heartPickR + (RING_START - T.heartPickR) * left,
    danger: Math.max(0, Math.min(1, (urge - 0.5) * 2)),
    // The last 3 s (since the fuse was halved to 10 s, 2026-11-07: 5 s throbbed
    // from the moment the portals opened).
    throb: fuse < KNOT_THROB_AT ? 1 - fuse / KNOT_THROB_AT : 0,
  };
}

/** How high the carried ball rides over its carrier's feet (yards). */
export const KNOT_CARRY_Y = 3.4;
/** How high the free ball floats over the floor (yards). */
export const KNOT_FLOAT_Y = 1.5;

/** The link of light between the portals: its middle, length and yaw. */
export function portalLink(
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { mx: number; mz: number; len: number; yaw: number } {
  const dx = bx - ax;
  const dz = bz - az;
  return { mx: (ax + bx) / 2, mz: (az + bz) / 2, len: Math.hypot(dx, dz), yaw: Math.atan2(dx, dz) };
}

/** A mark's preview on the floor: its fill as the mark runs out (0 to 1). */
export function markFill(remaining: number, duration: number): number {
  if (!(duration > 0)) return 1;
  return Math.max(0, Math.min(1, 1 - remaining / duration));
}

/** The way out into the void at a local (x, z): from the Cornice's middle through
 *  the nearest gap (a unit vector). */
export function throwHeading(x: number, z: number): { x: number; z: number } {
  let best = CORNICE_GAPS[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const g of CORNICE_GAPS) {
    const d = Math.hypot(x - g.x, z - g.z);
    if (d < bestD) {
      best = g;
      bestD = d;
    }
  }
  const C = BREATH.cornice;
  const dx = best.x - C.x;
  const dz = best.z - C.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

/** A throw's seconds in the air, how far out it flies, how high and how far down. */
export const THROW_ARC = { seconds: 1.8, out: 26, up: 9, down: 34 } as const;

/** The thrown ball's offset from where it left the lip at `t` seconds, written into
 *  `out` (no allocation): out along the heading, up and then down into the void. */
export function throwOffset(
  t: number,
  heading: { x: number; z: number },
  out: { x: number; y: number; z: number },
): boolean {
  const k = t / THROW_ARC.seconds;
  if (k >= 1 || k < 0) return false;
  out.x = heading.x * THROW_ARC.out * k;
  out.z = heading.z * THROW_ARC.out * k;
  out.y = THROW_ARC.up * 4 * k * (1 - k) - THROW_ARC.down * k * k;
  return true;
}

/** The thrown ball's look in flight (the weak-spots pass's second round: a small pale
 *  additive orb shrinking to nothing was lost against the Cornice's pale sky). It flies
 *  as the ball the raid just carried (the Storm Orb's shell, its core and its knot of
 *  wind), held large, ringed by a dark storm halo that cuts it out of a pale sky, and
 *  trailing a wake of teal ghosts along its own arc. `scale` is the ball's radius at
 *  `t` seconds; the halo is `halo` times it. */
export const FLIGHT_LOOK = { start: 1.55, end: 1.05, halo: 1.45, spin: 9 } as const;
export function flightScale(t: number): number {
  const k = Math.max(0, Math.min(1, t / THROW_ARC.seconds));
  return FLIGHT_LOOK.start + (FLIGHT_LOOK.end - FLIGHT_LOOK.start) * k;
}

/** The wake: `ghosts` copies of the ball strung back along its arc, each `step`
 *  seconds behind the last, smaller and fainter the further back. */
export const FLIGHT_TRAIL = { ghosts: 7, step: 0.06 } as const;
export function flightGhost(i: number): { lag: number; scale: number; alpha: number } {
  const k = (i + 1) / (FLIGHT_TRAIL.ghosts + 1);
  return { lag: (i + 1) * FLIGHT_TRAIL.step, scale: 0.62 * (1 - 0.75 * k), alpha: 0.6 * (1 - k) };
}

/** The burst's timeline: the flash dying and the wall rushing out across the
 *  Cornice. Null once it has passed. */
export const BURST_SECONDS = 1.6;
export function burstLook(t: number): { radius: number; alpha: number; flash: number } | null {
  if (t < 0 || t >= BURST_SECONDS) return null;
  const k = t / BURST_SECONDS;
  return {
    radius: 4 + (BREATH.cornice.rx + 14) * (1 - (1 - k) * (1 - k)),
    alpha: (1 - k) * (1 - k),
    flash: Math.max(0, 1 - t / 0.35),
  };
}
