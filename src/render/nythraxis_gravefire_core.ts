// Nythraxis Gravefire presentation math. The authoritative sim row supplies
// the traveling lit window; this core projects its endpoints and head cap, the
// dressing of the footprint (a scorched ember bed with legible edge lines, not
// a painted stripe), the flame tongues that make it read as fire, and the
// readable pulse, without Three, DOM, clocks, randomness, or allocations. The
// tongue scatter hashes the instance index so it is deterministic and the same
// on every host.

import type { ActiveNythraxisGravefire } from '../sim/nythraxis_gravefire';
import { NYTHRAXIS_GRAVEFIRE_LENGTH } from '../sim/nythraxis_gravefire';
import { hash2 } from '../sim/rng';

export const NYTHRAXIS_GRAVEFIRE_HEAD_CAP_YARDS = 2;
export const NYTHRAXIS_GRAVEFIRE_GROUND_LIFT = 0.055;

/** Violet grave-fire: a dark scorched bed, bright edges, pale tongues. */
export const NYTHRAXIS_GRAVEFIRE_PALETTE = {
  underlay: 0x1a0a2a,
  glow: 0x5a2e9a,
  edge: 0xa06cff,
  head: 0xd9b8ff,
  tongue: 0xd9b8ff,
} as const;

/** Layer opacities at the pulse midpoint. The edges are the legible footprint
 *  (they mark the exact half-width the sim burns), so they sit highest; the
 *  inside is scorched ground, not a fill. */
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

/** Flame tongues per lit yard, identical on every graphics tier. */
export const NYTHRAXIS_GRAVEFIRE_TONGUES_PER_YARD = 3;
/** Tongue re-pose cadence: 20 Hz stays visually continuous and bounds the CPU. */
export const NYTHRAXIS_GRAVEFIRE_TONGUE_UPDATE_SECONDS = 1 / 20;
/** Tongues in the head cap burn this much taller: the advancing edge is the fire's face. */
export const NYTHRAXIS_GRAVEFIRE_HEAD_TONGUE_BOOST = 1.4;
const TONGUE_HASH_SEED = 0x6f1a3;

/** The fixed instance budget for one line: enough tongues for the whole length. */
export function nythraxisGravefireTongueCount(): number {
  return NYTHRAXIS_GRAVEFIRE_TONGUES_PER_YARD * NYTHRAXIS_GRAVEFIRE_LENGTH;
}

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

export interface NythraxisGravefireTonguePose {
  /** yards from the ignition point along the line */
  along: number;
  /** world units across the line, signed */
  across: number;
  /** lift above the ground, in world units */
  y: number;
  /** vertical scale of the unit tongue */
  height: number;
  /** horizontal scale of the unit tongue */
  width: number;
  yaw: number;
  /** false when this tongue's yard is outside the lit window (scale it away) */
  visible: boolean;
}

/**
 * One flame tongue of the line. Instance `index` owns a fixed spot: yard
 * `floor(index / perYard)` plus a hashed offset along and across the line, so
 * the fire does not shimmer as the window slides; only tongues whose spot is
 * inside `[tail, head]` are visible. Heights flicker with the phase, the head
 * cap burns taller, and reduced motion holds the flicker at its midpoint with
 * no spin.
 */
export function nythraxisGravefireTonguePoseInto(
  out: NythraxisGravefireTonguePose,
  index: number,
  plan: NythraxisGravefirePlan,
  phase: number,
  reducedMotion: boolean,
  geometryHalfHeight: number,
): NythraxisGravefireTonguePose {
  const yard = Math.floor(index / NYTHRAXIS_GRAVEFIRE_TONGUES_PER_YARD);
  out.along = yard + hash2(index, 0, TONGUE_HASH_SEED);
  out.visible = out.along >= plan.tail && out.along <= plan.head;
  out.across = (hash2(index, 1, TONGUE_HASH_SEED) * 2 - 1) * plan.halfWidth * 0.8;
  const flicker = reducedMotion ? 0.72 : 0.62 + 0.2 * Math.sin(phase * 7 + index * 1.73);
  const headBoost = out.along >= plan.headCapTail ? NYTHRAXIS_GRAVEFIRE_HEAD_TONGUE_BOOST : 1;
  out.height = (0.55 + (index % 4) * 0.12) * flicker * headBoost;
  out.width = 0.45 + (index % 3) * 0.1;
  out.y = geometryHalfHeight * out.height;
  out.yaw = hash2(index, 2, TONGUE_HASH_SEED) * Math.PI + (reducedMotion ? 0 : phase * 0.4);
  return out;
}
