// Stone Thrum's look, PURE (encounters/smith_heart/council_risen_pulse.ts:
// every risen pillar rings on the whole raid every 2 s). The ripple is the
// raid's read for "these pillars cost us": the raid kicks the next Wake on
// it, so it is never thinned by a graphics tier (a shock ring, the pooled
// engine's, which `density` never touches; only its dust puff thins). No
// THREE, no clock: the painter (council_thrum_fx.ts) feeds it the pillar.

import { COUNCIL_FX_COLORS } from './council_fx_core';

/** The ring's colour: a pale jade hum, apart from every other council ring
 *  (Restless Stone's danger red, the cursed pillar's crimson, the vein's
 *  ochre of the soul take, the stomps and the pillars' settle). */
export const STONE_THRUM_COLOR = 0x8fdcb4;

/** The ring's constant look (a soft, wide wake and a thin crest), shared by
 *  every ripple: no allocation per cue. */
export const STONE_THRUM_LOOK = { wake: 0.55, crest: 0.18, strength: 0.75 } as const;
/** The ring's life, seconds: gone before the next ring. */
export const STONE_THRUM_SECONDS = 0.85;
/** Dust shaken off the pillar's foot at full density. */
export const STONE_THRUM_PUFFS = 3;
export const STONE_THRUM_DUST = COUNCIL_FX_COLORS.dust;

/** Where the ring off a risen pillar of radius `pillarR` (yards) stops: well
 *  past the pillar's own reach (it hurts the whole raid, not the ones beside
 *  it). */
export function stoneThrumRadius(pillarR: number): number {
  return Math.max(0.5, pillarR) + 7;
}
