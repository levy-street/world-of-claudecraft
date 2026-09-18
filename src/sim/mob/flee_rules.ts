// Which mobs may panic and flee at low HP. Extracted from sim.ts (the monolith
// ratchet): pure over the mob template catalog, no SimContext, so the rule pins
// directly under a Vitest and the Sim keeps only the flee state machine.
//
// Only sentient, cowardly families flee; beasts/undead/elementals/dragonkin fight
// to the death. Elites, rares, and bosses never flee regardless of family, and a
// mob flees at most once per pull (hasFled) and never while enraged.

import { MOBS } from '../data';
import type { Entity, MobFamily } from '../types';

export const FLEEING_FAMILIES: ReadonlySet<MobFamily> = new Set([
  'humanoid',
  'burrower',
  'mudfin',
  'troll',
]);

export function canFlee(mob: Entity): boolean {
  if (mob.hasFled || mob.enraged) return false;
  const tmpl = MOBS[mob.templateId];
  if (!tmpl || tmpl.boss || tmpl.elite || tmpl.rare) return false;
  return FLEEING_FAMILIES.has(tmpl.family);
}
