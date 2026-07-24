import type { ProceduralRarity } from '../sim/procedural_item';
import { proceduralQuality } from '../sim/procedural_item';
import type { CorpseLoot, ItemDef } from '../sim/types';

const RARITY_RANK: Record<ProceduralRarity, number> = {
  common: 0,
  magic: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};

const RARITY_LABEL_KEY: Record<ProceduralRarity, `itemUi.procedural.rarity.${ProceduralRarity}`> = {
  common: 'itemUi.procedural.rarity.common',
  magic: 'itemUi.procedural.rarity.magic',
  rare: 'itemUi.procedural.rarity.rare',
  epic: 'itemUi.procedural.rarity.epic',
  legendary: 'itemUi.procedural.rarity.legendary',
  mythic: 'itemUi.procedural.rarity.mythic',
};

export interface ProceduralCorpseLootMarker {
  rarity: ProceduralRarity;
  quality: NonNullable<ItemDef['quality']>;
  labelKey: `itemUi.procedural.rarity.${ProceduralRarity}`;
}

/**
 * Highest procedural rarity this player may actually loot from a corpse.
 *
 * Corpse loot is represented as slots on one world entity, not as one entity per
 * dropped item. The renderer therefore draws one aggregate beam/ring marker while
 * preserving personal-loot privacy.
 */
export function proceduralCorpseLootMarker(
  loot: CorpseLoot | null,
  playerId: number,
): ProceduralCorpseLootMarker | null {
  let best: ProceduralRarity | null = null;
  for (const slot of loot?.items ?? []) {
    if (slot.personalFor && !slot.personalFor.includes(playerId)) continue;
    const rarity = slot.instance?.procedural?.rarity;
    if (!rarity || (best !== null && RARITY_RANK[rarity] <= RARITY_RANK[best])) continue;
    best = rarity;
  }
  if (best === null) return null;
  return {
    rarity: best,
    // The localized text label is a required non-color cue at ground distance.
    labelKey: RARITY_LABEL_KEY[best],
    // Mythic is a future fixed-item tier and has no native v0.30 ItemDef quality.
    quality: proceduralQuality(best) ?? 'legendary',
  };
}
