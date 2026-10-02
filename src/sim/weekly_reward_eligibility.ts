import { classListAdmits } from './equipment_rules';
import { canEquipItem } from './equipment_rules';
import type { ItemDef, PlayerClass } from './types';

/** Class and stat restrictions shared by vault catalogs and new authoritative rolls. */
export function weeklyRewardFitsClass(cls: PlayerClass, item: ItemDef): boolean {
  if (!canEquipItem(cls, item) || (item.requiredClass && !classListAdmits(item.requiredClass, cls)))
    return false;
  if (cls === 'warrior' || cls === 'rogue' || cls === 'ninja' || cls === 'hunter') {
    return (item.stats?.int ?? 0) <= 0 && (item.spellPower ?? 0) <= 0 && (item.healPower ?? 0) <= 0;
  }
  return cls !== 'warlock' || (item.healPower ?? 0) <= 0;
}
