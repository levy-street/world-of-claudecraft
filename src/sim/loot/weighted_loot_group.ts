import type { LootEntry } from '../types';

// Convert relative equipment weights into one guaranteed partition. Reserved
// entries retain their absolute per-kill odds (the raid's legendary chase).
export function weightedLootGroup(
  rollGroup: string,
  entries: readonly (readonly [string, number])[],
  reserved: readonly LootEntry[] = [],
): LootEntry[] {
  const reservedChance = reserved.reduce((sum, entry) => sum + entry.chance, 0);
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (
    !entries.length ||
    !Number.isFinite(totalWeight) ||
    reserved.some((entry) => !Number.isFinite(entry.chance) || entry.chance < 0) ||
    reservedChance < 0 ||
    reservedChance >= 1 ||
    entries.some(([, weight]) => !Number.isFinite(weight) || weight <= 0)
  ) {
    throw new Error('Invalid guaranteed loot partition');
  }
  let cumulative = reservedChance;
  return [
    ...reserved.map((entry) => ({ ...entry, rollGroup })),
    ...entries.map(([itemId, weight], index) => {
      const chance =
        index === entries.length - 1
          ? 1 - cumulative
          : ((1 - reservedChance) * weight) / totalWeight;
      cumulative += chance;
      return { itemId, chance, rollGroup };
    }),
  ];
}
