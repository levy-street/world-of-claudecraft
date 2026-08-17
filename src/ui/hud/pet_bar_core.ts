import { isPrimaryOwnedPetEntity } from '../../sim/pet/pet_selection';
import type { Entity } from '../../sim/types';

/** Mirror the authoritative petOf rule for the HUD without depending on Sim. */
export function primaryOwnedPet(entities: Iterable<Entity>, ownerId: number): Entity | null {
  for (const entity of entities) {
    if (isPrimaryOwnedPetEntity(entity, ownerId)) {
      return entity;
    }
  }
  return null;
}
