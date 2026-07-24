import { PROCEDURAL_ITEM_BASES } from '../sim/content/procedural_loot';

/**
 * Resolve a procedural base item to its reusable inventory artwork.
 *
 * Callers pass the static item definition id, never an instance UID, seed,
 * generated name, affix, or roll. Non-procedural ids remain unchanged so the
 * helper is safe at the shared item-icon boundary.
 */
export function proceduralItemVisualId(itemId: string): string {
  return PROCEDURAL_ITEM_BASES[itemId]?.visualItemId ?? itemId;
}

/**
 * Resolve the 3D weapon variant authored for a procedural base item.
 *
 * Non-weapons and non-procedural ids return undefined. The corresponding
 * inventory thumbnail is selected through proceduralItemVisualId.
 */
export function proceduralItemWeaponVisualId(itemId: string): string | undefined {
  return PROCEDURAL_ITEM_BASES[itemId]?.weaponVisualId;
}
