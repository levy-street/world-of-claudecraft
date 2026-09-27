/** Permanent per-copy allocation identity. No seed, derived totals, or rarity override. */
export interface LootQualityDescriptor {
  version: 1;
  tier: 1 | 2 | 3 | 4;
  /** Strength, Agility, Stamina, Intellect, Spirit. */
  weights: [number, number, number, number, number];
}

export function isValidLootQuality(value: unknown): value is LootQualityDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 3 &&
    keys.every((k) => ['version', 'tier', 'weights'].includes(k)) &&
    record.version === 1 &&
    Number.isInteger(record.tier) &&
    (record.tier as number) >= 1 &&
    (record.tier as number) <= 4 &&
    Array.isArray(record.weights) &&
    record.weights.length === 5 &&
    Object.keys(record.weights).length === 5 &&
    Object.keys(record.weights).every((key, index) => key === String(index)) &&
    record.weights.every((w) => Number.isInteger(w) && w >= 1 && w <= 1000)
  );
}

/** Validated public projection; copies only the fixed descriptor shape. */
export function cloneLootQuality(value: unknown): LootQualityDescriptor | undefined {
  return isValidLootQuality(value)
    ? { version: 1, tier: value.tier, weights: [...value.weights] }
    : undefined;
}
