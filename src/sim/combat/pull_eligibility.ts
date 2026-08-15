import { MOBS } from '../data';
import type { Entity } from '../types';

// A practice dummy (Highwatch training dummy, MOBS.*.dummy) is a fixed
// world fixture: moveSpeed 0, never chases, never flees. Any effect that
// physically relocates its target (a pull, a chain, a pullToCenter AOE)
// must skip it, or it drags off its marker. Scoped to the `dummy` flag
// rather than `ccImmune`: several existing suites deliberately land hard
// CC (root/incapacitate/polymorph) on MOBS.training_dummy as a generic,
// undying practice target, so ccImmune would silence those tests too.
export function isPullEligible(target: Entity): boolean {
  return MOBS[target.templateId]?.dummy !== true;
}
