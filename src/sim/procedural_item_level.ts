import { requiredLevelFor } from './item_level_req';
import type { ProceduralRarity } from './procedural_item';
import type { ItemDef, ItemInstancePayload } from './types';
import { MAX_LEVEL } from './types';

const PROCEDURAL_REQUIRED_LEVEL_OFFSET: Record<ProceduralRarity, number> = {
  common: 0,
  magic: 1,
  rare: 3,
  epic: 5,
  legendary: 6,
  mythic: 6,
};

function clampLevel(raw: number): number {
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(raw)));
}

export function proceduralRequiredLevel(itemLevel: number, rarity: ProceduralRarity): number {
  return clampLevel(itemLevel - PROCEDURAL_REQUIRED_LEVEL_OFFSET[rarity]);
}

export function requiredLevelForItemInstance(
  definition: ItemDef,
  instance?: ItemInstancePayload,
): number {
  const procedural = instance?.procedural;
  if (!procedural) return requiredLevelFor(definition);
  if (procedural.baseId !== definition.id)
    throw new Error(
      `procedural base ${procedural.baseId} does not match item definition ${definition.id}`,
    );
  return proceduralRequiredLevel(procedural.itemLevel, procedural.rarity);
}

export function meetsItemInstanceLevelRequirement(
  playerLevel: number,
  definition: ItemDef,
  instance?: ItemInstancePayload,
): boolean {
  return playerLevel >= requiredLevelForItemInstance(definition, instance);
}
