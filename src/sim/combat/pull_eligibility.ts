import { MOBS } from '../data';
import type { Entity } from '../types';

// Bosses and practice dummies are fixed combat anchors. Any effect that
// physically relocates its target (a pull, a chain, a pullToCenter AOE)
// must skip them. Keep this scoped to the authored `boss` / `dummy` flags
// rather than `ccImmune`: several existing suites deliberately land hard
// CC (root/incapacitate/polymorph) on MOBS.training_dummy as a generic,
// undying practice target, so ccImmune would silence those tests too.
export function isPullEligible(target: Entity): boolean {
  return MOBS[target.templateId]?.boss !== true && !isPlantedPracticeDummy(target);
}

// Practice dummies are planted on their markers outright: no displacement of
// any kind (pull, chain, grip, or knockback) may move one. Narrower than
// isPullEligible on purpose: bosses still take knockbacks.
export function isPlantedPracticeDummy(target: Entity): boolean {
  return MOBS[target.templateId]?.dummy === true;
}
