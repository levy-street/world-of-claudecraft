import type { Entity } from '../sim/types';

type OwnedMobIdentity = Pick<Entity, 'kind' | 'ownerId' | 'templateId'>;

/** Resolve any player-owned combat source for floating text and combat-log credit. */
export function ownedCombatSourceOwnerId(
  entity: OwnedMobIdentity | null | undefined,
): number | null {
  return entity?.kind === 'mob' && entity.ownerId !== null ? entity.ownerId : null;
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
