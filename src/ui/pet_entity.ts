import type { Entity } from '../sim/types';

type OwnedMobIdentity = Pick<Entity, 'kind' | 'ownerId' | 'templateId'>;

/** Resolve any player-owned combat source for floating text and combat-log credit. */
export function ownedCombatSourceOwnerId(
  entity: OwnedMobIdentity | null | undefined,
): number | null {
  return entity?.kind === 'mob' && entity.ownerId !== null ? entity.ownerId : null;
}

/** Resolve the player who receives combat credit for a temporary guardian. */
export function guardianOwnerId(entity: OwnedMobIdentity | null | undefined): number | null {
  if (
    entity?.kind !== 'mob' ||
    entity.ownerId === null ||
    typeof entity.templateId !== 'string' ||
    !entity.templateId.startsWith('guardian_')
  ) {
    return null;
  }
  return entity.ownerId;
}

/** Client-safe pet discriminator. Guardian state is simulation-only, while every
 * temporary guardian has a reserved guardian_ template id on the wire. */
export function isControllableOwnedPet(entity: OwnedMobIdentity, ownerId: number): boolean {
  return (
    entity.kind === 'mob' &&
    entity.ownerId === ownerId &&
    !entity.templateId.startsWith('guardian_')
  );
}
