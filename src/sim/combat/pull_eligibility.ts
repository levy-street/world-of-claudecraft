import { MOBS } from '../data';
import type { Entity } from '../types';

// Bosses and practice dummies are fixed combat anchors. Any effect that
// physically relocates its target (a pull, a chain, a pullToCenter AOE)
// must skip them. Keep this scoped to the authored `boss` / `dummy` flags
// rather than `ccImmune`: several existing suites deliberately land hard
// CC (root/incapacitate/polymorph) on MOBS.training_dummy as a generic,
// undying practice target, so ccImmune would silence those tests too.
export function isPullEligible(target: Entity): boolean {
  const template = MOBS[target.templateId];
  return template?.boss !== true && template?.dummy !== true;
}
