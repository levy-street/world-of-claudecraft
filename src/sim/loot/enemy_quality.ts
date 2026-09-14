// Apply quality once, after a source has finished selecting its ordinary drops.
// Never call this from pickup/award: ordinary copies intentionally have no marker.
import { ITEMS, MOBS } from '../data';
import { createLootQuality, isEligibleLootQualityItem } from '../loot_quality';
import type { Rng } from '../rng';
import { cloneItemInstancePayload, type Entity, type LootSlot } from '../types';

export function isEligibleEnemyQualitySource(mob: Entity): boolean {
  return (
    mob.kind === 'mob' &&
    mob.ownerId === null &&
    mob.devSpawnOwnerId === undefined &&
    !mob.affixSpawned &&
    !MOBS[mob.templateId]?.dummy
  );
}

export function rollEnemyLootQuality(
  rng: Rng,
  mob: Entity,
  slots: LootSlot[],
  excluded: ReadonlySet<LootSlot> = new Set(),
): LootSlot[] {
  if (!isEligibleEnemyQualitySource(mob)) return slots;
  return slots.flatMap((slot) => {
    const item = ITEMS[slot.itemId];
    if (
      excluded.has(slot) ||
      slot.instance?.lootQuality ||
      !item ||
      !isEligibleLootQualityItem(item)
    )
      return [slot];
    return Array.from({ length: slot.count }, () => {
      const lootQuality = createLootQuality(rng);
      const instance = slot.instance ? cloneItemInstancePayload(slot.instance) : undefined;
      return {
        ...slot,
        count: 1,
        ...(slot.personalFor ? { personalFor: [...slot.personalFor] } : {}),
        ...(lootQuality
          ? { instance: { ...instance, lootQuality } }
          : instance
            ? { instance }
            : {}),
      };
    });
  });
}
