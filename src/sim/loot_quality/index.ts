import { itemLevel } from '../item_level';
import { RIFT_BAND_SHELLS, riftBandItemLevel, riftBandPrimaryStats } from '../rift/band_ladder';
import type { ItemDef, ItemInstancePayload, WeaponInfo } from '../types';
import {
  isEligibleLootQualityItem,
  lootQualityTier,
  qualityBonusesAtLevel,
  qualityWeaponAtLevel,
} from './core';
import { riftQualityPrimaryStats } from './rift';

export * from './core';
export * from './types';

export function lootQualityBonuses(
  item: ItemDef,
  instance?: ItemInstancePayload,
  baseLevel?: number,
): Record<string, number> {
  if (!lootQualityTier(instance) || !isEligibleLootQualityItem(item)) return {};
  const quality = instance!.lootQuality!;
  const rift = instance?.rift;
  const shell = RIFT_BAND_SHELLS[item.id];
  if (rift && shell) {
    const ordinary = riftBandPrimaryStats(shell, riftBandItemLevel(rift.tier, rift.upgradeLevel));
    const final = riftQualityPrimaryStats(shell, rift.tier, rift.upgradeLevel, quality);
    return Object.fromEntries(
      Object.entries(final)
        .map(([key, value]) => [key, value - (ordinary[key as keyof typeof ordinary] ?? 0)])
        .filter(([, value]) => (value as number) > 0),
    );
  }
  const level = baseLevel ?? itemLevel(item);
  return level && Number.isFinite(level) && level > 0
    ? qualityBonusesAtLevel(item, quality, level)
    : {};
}

export function lootQualityWeapon(
  item: ItemDef,
  instance?: ItemInstancePayload,
): WeaponInfo | undefined {
  const level = itemLevel(item);
  return level && isEligibleLootQualityItem(item)
    ? qualityWeaponAtLevel(item, lootQualityTier(instance), level)
    : item.weapon;
}
