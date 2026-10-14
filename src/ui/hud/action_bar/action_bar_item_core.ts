import type { ItemDef } from '../../../sim/types';
import { isUsableTrinketId } from './trinket_slot_core';

/** Item shortcuts use the same item command as the bags. Keep placement,
 * activation, and stored-layout validation on this one eligibility rule. */
export function isActionBarItem(item: ItemDef | undefined): boolean {
  if (!item) return false;
  if (isUsableTrinketId(item.id)) return true;
  if ('feast' in item && item.feast) return true;
  // Tool-effect charms are consumed by Professions slotting, not item use.
  if (item.use) return item.use.type !== 'toolEffect';
  switch (item.kind) {
    case 'food':
    case 'drink':
    case 'potion':
    case 'elixir':
    case 'flask':
    case 'scroll':
    case 'mount':
    case 'recipe':
      return true;
    default:
      return false;
  }
}
