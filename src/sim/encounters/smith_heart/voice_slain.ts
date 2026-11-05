// The Smith's Heart bosses' kill lines (docs/design/raid/smith_heart.md
// section 7, the voices): a boss speaks when a player of its fight falls,
// never more than once in SLAY_EVERY seconds, its variants in turn by the
// pull's death count. Pure over the entities and a fight state's watch, so
// every boss's voice module shares it and a test drives it directly; it
// reads `dead` only, changes nothing in the fight.
//
// Zero rng, no clock but the fight's.

import type { Entity } from '../../types';

/** The watch a fight state keeps: the players seen dead and the count of
 *  deaths this pull. */
export interface SlainWatch {
  dead: number[];
  kills: number;
}

/** Seconds between two kill lines of one boss (a wipe's chain of deaths
 *  says one, then the wipe line). */
export const SLAY_EVERY = 20;

/** The kill lines' moments, in the order their variants take turns. */
export const SLAY_MOMENTS = ['slay_a', 'slay_b', 'slay_c'] as const;
export type SlayMoment = (typeof SLAY_MOMENTS)[number];

/** Is a moment one of the kill lines? */
export function isSlayMoment(moment: string): moment is SlayMoment {
  return (SLAY_MOMENTS as readonly string[]).includes(moment);
}

/**
 * Watch `players` (the fight's listeners, dead or alive) for deaths since the
 * last call: each newly dead player is remembered and counted, a revived one
 * forgotten (it may fall again). Returns how many fell since the last call.
 */
export function watchSlain(watch: SlainWatch, players: readonly Entity[]): number {
  let fell = 0;
  for (const p of players) {
    const at = watch.dead.indexOf(p.id);
    if (p.dead) {
      if (at >= 0) continue;
      watch.dead.push(p.id);
      watch.kills++;
      fell++;
    } else if (at >= 0) watch.dead.splice(at, 1);
  }
  return fell;
}

/** The kill line for the pull's `kills`-th death, among the boss's first
 *  `variants` kill moments (in turn, deterministic). */
export function slayMoment(kills: number, variants: number): SlayMoment {
  const n = Math.max(1, Math.min(SLAY_MOMENTS.length, variants));
  return SLAY_MOMENTS[(((kills - 1) % n) + n) % n];
}

/** A fresh watch (a pull's). */
export function freshSlainWatch(): SlainWatch {
  return { dead: [], kills: 0 };
}
