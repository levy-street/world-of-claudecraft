import type { MobTemplate, PlayerClass } from '../types';
import { isTameableFamily } from './pet_scaling';

/** A tamed beast keeps its source's cosmetic size, independently of pet stats. */
export function retainedTamedPetScale(
  template: MobTemplate,
  ownerClass: PlayerClass | undefined,
  scale: unknown,
): number | undefined {
  if (ownerClass !== 'hunter' || !isTameableFamily(template.family)) return undefined;
  return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : undefined;
}
