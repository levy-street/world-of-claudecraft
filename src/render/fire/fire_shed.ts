// The fire simulation's answer to the render budget's post shed
// (post_shed_core.ts), modelled on ocean/ocean_shed.ts: post.ts writes the
// active rung, and FireSimulation reads how much to slow its step cadence.

import type { PostShedRung } from '../post_shed_core';

let stepScale = 1;

/**
 * Apply a post-shed rung. Bloom shed halves the simulation step rate; AO shed
 * cuts it to a third (and post.ts suppresses the opaque-scene capture).
 */
export function setFireShedRung(rung: PostShedRung | 'full'): void {
  stepScale = rung === 'ao-off' ? 1 / 3 : rung === 'bloom-off' ? 0.5 : 1;
}

/** Multiplier on the fire simulation's step rate (1 when nothing is shed). */
export function fireShedStepScale(): number {
  return stepScale;
}
