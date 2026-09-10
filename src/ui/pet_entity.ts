import { isBuddyMob } from '../sim/pet/buddy_ai';
import type { Entity } from '../sim/types';

type OwnedMobIdentity = Pick<Entity, 'kind' | 'ownerId' | 'templateId'>;

/** Resolve any player-owned combat source for floating text and combat-log credit. */
export function ownedCombatSourceOwnerId(
  entity: OwnedMobIdentity | null | undefined,
): number | null {
  return entity?.kind === 'mob' && entity.ownerId !== null ? entity.ownerId : null;
}

/** Client-safe pet discriminator. Guardian state is simulation-only, while every
 * temporary guardian has a reserved guardian_ template id on the wire. A
 * cosmetic buddy (src/sim/content/buddy_mobs.ts) is excluded too: it takes no
 * pet commands (rename/abandon/attack/stance), so right-clicking a targeted
 * buddy must not open the pet command menu. */
export function isControllableOwnedPet(entity: OwnedMobIdentity, ownerId: number): boolean {
  return (
    entity.kind === 'mob' &&
    entity.ownerId === ownerId &&
    !entity.templateId.startsWith('guardian_') &&
    !isBuddyMob(entity)
  );
}

/** The other half of the pair above: YOUR OWN cosmetic buddy, the one owned
 * mob that opens the buddy menu (autoloot) rather than the pet command menu.
 * Someone else's buddy is excluded, so right-clicking a stranger's follower
 * offers nothing, exactly as before. */
export function isOwnBuddy(entity: OwnedMobIdentity, ownerId: number): boolean {
  return entity.kind === 'mob' && entity.ownerId === ownerId && isBuddyMob(entity);
}
