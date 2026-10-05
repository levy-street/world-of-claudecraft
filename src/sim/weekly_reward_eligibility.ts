import { canEquipItem } from './equipment_rules';
import type { ItemDef, PlayerClass } from './types';
import type { WeeklyPoolId } from './weekly_rewards';

/** The Crucible core is the sole non-equipment reward, confined to raid slots. */
export function weeklyRewardItemAllowed(
  item: ItemDef,
  pool: WeeklyPoolId,
  allowUncommon = true,
): boolean {
  if (item.id === 'lastflame_core') return pool === 'raid' || pool === 'raid_heroic';
  return (
    ['weapon', 'armor', 'held_offhand'].includes(item.kind) &&
    (item.quality === 'rare' ||
      item.quality === 'epic' ||
      (allowUncommon && item.quality === 'uncommon'))
  );
}

/** Class and stat restrictions shared by vault catalogs and new authoritative rolls. */
export function weeklyRewardFitsClass(cls: PlayerClass, item: ItemDef): boolean {
  if (!canEquipItem(cls, item) || (item.requiredClass && !item.requiredClass.includes(cls)))
    return false;
  if (cls === 'warrior' || cls === 'rogue' || cls === 'hunter') {
    return (item.stats?.int ?? 0) <= 0 && (item.spellPower ?? 0) <= 0 && (item.healPower ?? 0) <= 0;
  }
  return cls !== 'warlock' || (item.healPower ?? 0) <= 0;
}
