// Master loot: pure decision helpers shared by the sim's loot pipeline.
//
// Master loot is a party/raid loot method where a single designated looter
// assigns drops at or above a quality threshold, instead of opening a
// need/greed roll. These helpers carry no Sim state so they can be unit-tested
// directly and reused identically across the offline, server, and headless hosts.
import type { ItemDef, MasterLootSettings, MasterLootThreshold } from './types';

export type Quality = NonNullable<ItemDef['quality']>;

// Ascending rarity rank. A drop is master-looted when its rank is >= the
// threshold's rank. Unknown/undefined quality is treated as 'common'.
export const QUALITY_RANK: Record<Quality, number> = {
  poor: 0,
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

export function meetsMasterThreshold(
  quality: ItemDef['quality'] | undefined,
  threshold: MasterLootThreshold,
): boolean {
  return QUALITY_RANK[quality ?? 'common'] >= QUALITY_RANK[threshold];
}

// The effective master looter pid for a party, or null when master loot is off
// or no valid looter resolves. `settings.looter === 0` means "the current
// leader"; an explicitly-named looter who has left the party falls back to the
// leader so the role is never orphaned.
export function effectiveMasterLooter(
  settings: MasterLootSettings,
  leader: number,
  members: readonly number[],
): number | null {
  if (!settings.enabled) return null;
  const looter = settings.looter === 0 ? leader : settings.looter;
  return members.includes(looter) ? looter : leader;
}
