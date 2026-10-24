// The ocean's answer to the render budget's post shed (post_shed_core.ts):
// post.ts writes the rung in force, the simulation reads how much to slow its
// step. A leaf with no imports, so post.ts can reach it without pulling the
// ocean's world-data modules into every chain that builds a composer.

import type { PostShedRung } from '../post_shed_core';

let stepScale = 1;

/**
 * Apply a post-shed rung. Bloom gone means the frame is under real pressure:
 * the sea steps at half rate; AO gone as well, at a third (the capture
 * release that goes with that rung is post.ts's own, on the capture).
 */
export function setOceanShedRung(rung: PostShedRung | 'full'): void {
  stepScale = rung === 'ao-off' ? 1 / 3 : rung === 'bloom-off' ? 0.5 : 1;
}

/** Multiplier on the simulation's step rate (1 when nothing is shed). */
export function oceanShedStepScale(): number {
  return stepScale;
}
