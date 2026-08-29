import { isTemporaryNecromancyUndeadTemplateId } from '../content/necromancy';
import type { Entity } from '../types';

/**
 * Pure owner/pet identity shared by the authoritative command path and its
 * offline/online HUD mirrors. Delve companions require a host lookup and remain
 * an additional authoritative exclusion in petOf().
 */
export function isPrimaryOwnedPetEntity(entity: Entity, ownerId: number): boolean {
  return (
    entity.kind === 'mob' &&
    entity.ownerId === ownerId &&
    !isTemporaryNecromancyUndeadTemplateId(entity.templateId) &&
    !entity.auras.some((aura) => aura.id === 'pyre_guardian')
  );
}

/**
 * True for a living temporary Necromancy summon (Skeletal Warrior, Bone Mage,
 * Gravewing) owned by ownerId. These fight and obey the owner's group
 * attack/mode commands independent of the persistent Graveguard
 * (pet/pet_commands.ts combatCommandPetsOf), so a caller that needs to know
 * whether the owner still has SOMETHING to command falls back to this once
 * isPrimaryOwnedPetEntity is dead or absent.
 */
export function isLivingSecondaryPetEntity(entity: Entity, ownerId: number): boolean {
  return (
    entity.kind === 'mob' &&
    entity.ownerId === ownerId &&
    !entity.dead &&
    isTemporaryNecromancyUndeadTemplateId(entity.templateId)
  );
}
