import type { MobTemplate } from '../types';

/** Resolves a summoned pet's authored visual scale for its owner's level. */
export function warlockPetScaleAtLevel(template: MobTemplate, ownerLevel: number): number {
  let scale = template.scale;
  for (const step of template.petScaleRanks ?? []) {
    if (step.level > ownerLevel) break;
    scale = step.scale;
  }
  return scale;
}
