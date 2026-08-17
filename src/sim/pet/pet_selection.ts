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
