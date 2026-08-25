import { isLivingSecondaryPetEntity, isPrimaryOwnedPetEntity } from '../../sim/pet/pet_selection';
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

/** Mirror of isLivingSecondaryPetEntity for the pet ACTION BAR's fallback anchor
 *  (renderPetBar in hud.ts): the first living temporary Necromancy summon the
 *  owner still commands, used only once the primary pet is dead or gone. Never
 *  read by the pet FRAME or the target-pet keybind, which stay on
 *  primaryOwnedPet as their one authority (src/ui/CLAUDE.md). */
export function livingSecondaryPet(entities: Iterable<Entity>, ownerId: number): Entity | null {
  for (const entity of entities) {
    if (isLivingSecondaryPetEntity(entity, ownerId)) {
      return entity;
    }
  }
  return null;
}
