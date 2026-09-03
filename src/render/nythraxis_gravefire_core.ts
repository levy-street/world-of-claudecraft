// Nythraxis Gravefire presentation math. The authoritative sim row supplies
// the traveling lit window; this core projects its endpoints, head cap, and
// readable pulse without Three, DOM, clocks, randomness, or allocations.

import type { ActiveNythraxisGravefire } from '../sim/nythraxis_gravefire';

export const NYTHRAXIS_GRAVEFIRE_HEAD_CAP_YARDS = 2;
export const NYTHRAXIS_GRAVEFIRE_GROUND_LIFT = 0.055;

export const NYTHRAXIS_GRAVEFIRE_PALETTE = {
  underlay: 0x1a0a2a,
  core: 0xa06cff,
  head: 0xd9b8ff,
  rim: 0xa06cff,
} as const;

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
  core: number;
  rim: number;
  head: number;
}

/** The core never drops below 0.8. Reduced motion settles at the midpoint. */
export function nythraxisGravefirePulseInto(
  out: NythraxisGravefirePulse,
  phase: number,
  reducedMotion: boolean,
): NythraxisGravefirePulse {
  const wave = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(phase);
  out.core = 0.8 + wave * 0.14;
  out.rim = 0.82 + wave * 0.16;
  out.head = 0.88 + wave * 0.1;
  return out;
}
