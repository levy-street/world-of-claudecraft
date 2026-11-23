// Decode immutable parcel descriptors once for live and saved-state grants.
import { cloneLootQuality } from '../loot_quality';
import type { InvSlot } from '../types';
import type { HoardRewardItem } from './hoard_reward_roll';

export function hoardRewardGrantItems(items: readonly Readonly<HoardRewardItem>[]): InvSlot[] {
  return items.map((item) => {
    const lootQuality = cloneLootQuality(item.lootQuality);
    return {
      itemId: item.itemId,
      count: item.count,
      ...(lootQuality && { instance: { lootQuality } }),
    };
  });
}
