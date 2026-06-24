import type { Entity } from '../sim/types';

// How the renderer decides whether a *targetable* unit reads as hostile (red) or
// friendly to the local player, for nameplate text and the ground selection ring.
//
// The classic catch: a controlled pet (a mob with `ownerId`) has no faction of
// its own — it inherits its owner's reaction. A hunter's tamed beast or a
// warlock's demon is `hostile === false`, so a naive `hostile` check is fine for
// *your* pet, but the renderer also has to fold in the owner so that an enemy
// player's pet (PvP) reads hostile, and a friendly pet never reads as an enemy.
//
// These helpers are pure so they can be unit-tested without a DOM/renderer; the
// renderer supplies the entity lookup and the player-vs-player verdict.

// True when an owned pet should be drawn as hostile to the viewer. A pet owned
// by a player mirrors that player's reaction; any other owner (or a missing
// owner) falls back to the pet's own `hostile` flag.
export function isOwnedPetHostile(
  pet: Entity,
  entities: Map<number, Entity>,
  isPlayerHostile: (p: Entity) => boolean,
): boolean {
  const owner = pet.ownerId !== null ? entities.get(pet.ownerId) : undefined;
  return owner && owner.kind === 'player' ? isPlayerHostile(owner) : pet.hostile;
}

// True when a mob is a friendly controlled pet (owned and not hostile to the
// viewer) — the case that should get a friendly nameplate instead of the
// level-difference "con" color.
export function isFriendlyPet(
  e: Entity,
  entities: Map<number, Entity>,
  isPlayerHostile: (p: Entity) => boolean,
): boolean {
  return e.kind === 'mob' && e.ownerId !== null && !isOwnedPetHostile(e, entities, isPlayerHostile);
}

// The classic level-difference ("con") color for a wild mob's nameplate, with a
// friendly-pet override so an owned pet reads as friendly green rather than a
// scary red. Kept here (pure) so the exact color thresholds are unit-tested.
export const FRIENDLY = '#9fdc7f';
export function mobNameColor(levelDiff: number, dead: boolean, friendly: boolean): string {
  if (dead) return '#999';
  if (friendly) return FRIENDLY;
  return levelDiff >= 3
    ? '#ff4444'
    : levelDiff >= 1
      ? '#ffaa33'
      : levelDiff >= -2
        ? '#ffe97a'
        : levelDiff >= -5
          ? '#7fdc4f'
          : '#9d9d9d';
}
