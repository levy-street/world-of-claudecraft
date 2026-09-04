// Nythraxis Gravefire presentation math. The authoritative sim row supplies
// the traveling lit window; this core projects its endpoints and head cap, the
// dressing of the footprint (a scorched ember bed with legible edge lines, not
// a painted stripe), and the readable pulse, without Three, DOM, clocks,
// randomness, or allocations. The fire over the strip is the soft sprite cloud
// of nythraxis_soft_fire_core.ts.

import type { ActiveNythraxisGravefire } from '../sim/nythraxis_gravefire';

export const NYTHRAXIS_GRAVEFIRE_HEAD_CAP_YARDS = 2;
export const NYTHRAXIS_GRAVEFIRE_GROUND_LIFT = 0.055;

/** Violet grave-fire: a dark scorched bed, bright edges, pale fire. */
export const NYTHRAXIS_GRAVEFIRE_PALETTE = {
  underlay: 0x1a0a2a,
  glow: 0x5a2e9a,
  edge: 0xa06cff,
  head: 0xd9b8ff,
  tongue: 0xd9b8ff,
} as const;

/** Layer opacities at the pulse midpoint. The edges are the legible footprint
 *  (they mark the exact half-width the sim burns), so they sit highest; the
 *  inside is scorched ground, not a fill. `tongue` is the sprite fire's. */
export const NYTHRAXIS_GRAVEFIRE_LAYER_OPACITY = {
  underlay: 0.55,
  glow: 0.3,
  edge: 0.95,
  head: 0.9,
  tongue: 0.75,
} as const;

/** Width of each legible edge line, in world units, inside the half-width. */
export const NYTHRAXIS_GRAVEFIRE_EDGE_WIDTH = 0.18;
/** The glow band covers this fraction of the half-width on each side. */
export const NYTHRAXIS_GRAVEFIRE_GLOW_FRACTION = 0.6;
/** Fire in the head cap burns this much taller: the advancing edge is the fire's face. */
export const NYTHRAXIS_GRAVEFIRE_HEAD_TONGUE_BOOST = 1.4;

export interface NythraxisGravefirePlan {
  tail: number;
  head: number;
  tailX: number;
  tailZ: number;
  headX: number;
  headZ: number;
  headCapTail: number;
  length: number;
  halfWidth: number;
}

export function nythraxisGravefirePlanInto(
  out: NythraxisGravefirePlan,
  row: ActiveNythraxisGravefire,
): NythraxisGravefirePlan {
  out.tail = row.tail;
  out.head = row.head;
  out.tailX = row.x + row.dirX * row.tail;
  out.tailZ = row.z + row.dirZ * row.tail;
  out.headX = row.x + row.dirX * row.head;
  out.headZ = row.z + row.dirZ * row.head;
  out.headCapTail = Math.max(row.tail, row.head - NYTHRAXIS_GRAVEFIRE_HEAD_CAP_YARDS);
  out.length = Math.max(0, row.head - row.tail);
  out.halfWidth = Math.max(0, row.halfWidth);
  return out;
}

export interface NythraxisGravefirePulse {
  edge: number;
  glow: number;
  head: number;
  tongue: number;
}

/** The edge lines never drop below 0.9. Reduced motion settles at the midpoint. */
export function nythraxisGravefirePulseInto(
  out: NythraxisGravefirePulse,
  phase: number,
  reducedMotion: boolean,
): NythraxisGravefirePulse {
  const wave = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(phase);
  out.edge = 0.9 + wave * 0.1;
  out.glow = 0.22 + wave * 0.16;
  out.head = 0.84 + wave * 0.12;
  out.tongue = 0.62 + wave * 0.26;
  return out;
}
