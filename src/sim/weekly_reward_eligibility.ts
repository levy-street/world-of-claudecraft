import { IGNIVAR_SIGIL_ITEMS } from './content/ignivar_loot';
import { canEquipItem } from './equipment_rules';
import { trinketLootFitsClass } from './trinket_loot_eligibility';
import type { ItemDef, PlayerClass } from './types';
import type { WeeklyPoolId } from './weekly_rewards';

/** New rewards: equipment and raid-only Crucible cores. */
export function weeklyRewardItemAllowed(
  item: ItemDef,
  pool: WeeklyPoolId,
  allowUncommon = true,
): boolean {
  if (item.id === 'lastflame_core') return pool === 'raid' || pool === 'raid_heroic';
  return (
    weeklyRewardKindAllowed(item) &&
    (item.quality === 'rare' ||
      item.quality === 'epic' ||
      (allowUncommon && item.quality === 'uncommon'))
  );
}

/** Preserve previously fixed sigils without admitting them to new reward pools. */
export function weeklySavedRewardItemAllowed(item: ItemDef, pool: WeeklyPoolId): boolean {
  return (
    weeklyRewardItemAllowed(item, pool) ||
    ((pool === 'raid' || pool === 'raid_heroic') &&
      item.kind === 'tool' &&
      Object.hasOwn(IGNIVAR_SIGIL_ITEMS, item.id))
  );
}

/** Equipment only; the core exception also needs a raid pool. */
export function weeklyRewardKindAllowed(item: ItemDef): boolean {
  return item.kind === 'weapon' || item.kind === 'armor' || item.kind === 'held_offhand';
}

/** Class and stat restrictions shared by vault catalogs and new authoritative rolls. */
export function weeklyRewardFitsClass(cls: PlayerClass, item: ItemDef): boolean {
  if (!canEquipItem(cls, item) || (item.requiredClass && !item.requiredClass.includes(cls)))
    return false;
  if (!trinketLootFitsClass(cls, item)) return false;
  if (cls === 'warrior' || cls === 'rogue' || cls === 'hunter') {
    return (item.stats?.int ?? 0) <= 0 && (item.spellPower ?? 0) <= 0 && (item.healPower ?? 0) <= 0;
  }
  if (cls === 'mage' || cls === 'priest' || cls === 'warlock') {
    if ((item.stats?.str ?? 0) > 0 || (item.stats?.agi ?? 0) > 0) return false;
  }
  return cls !== 'warlock' || (item.healPower ?? 0) <= 0;
}
