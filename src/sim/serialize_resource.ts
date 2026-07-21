// Which resource value to persist for a character at save time.
//
// Druid forms swap the live resource bar: bear runs on rage, cat on energy, and
// the character's real mana is parked in `e.savedMana` (see recalcPlayerStats in
// entity.ts). Forms are auras and are NOT persisted, so a reloaded character is
// always rebuilt in caster form. That makes saving the live form bar a bug: a
// mana class would persist e.g. 35 (rage) and reload clamped to 35 MANA.
//
// This leaf decides the value to write into CharacterState.resource. Kept pure
// and host-agnostic so a Vitest drives it directly and serializeCharacter stays a
// thin consumer.

import type { ResourceType } from './types';

/**
 * The resource value to persist for a character.
 *
 * @param classResourceType the class's natural resource (CLASSES[cls].resourceType)
 * @param liveResourceType   the entity's CURRENT bar (rage/energy while shifted)
 * @param liveResource       the entity's current resource amount (e.resource)
 * @param savedMana          mana parked while shifted (e.savedMana; 0 when unshifted)
 */
export function persistedResource(
  classResourceType: ResourceType | null,
  liveResourceType: ResourceType | null,
  liveResource: number,
  savedMana: number,
): number {
  // A mana class whose live bar is something else (rage/energy) is shapeshifted:
  // its real pool sits in savedMana. Persist that, so the reload path (which
  // rebuilds the character in caster form) restores the mana instead of the form
  // bar. Every other case persists the live resource unchanged.
  if (classResourceType === 'mana' && liveResourceType !== 'mana') return savedMana;
  return liveResource;
}
