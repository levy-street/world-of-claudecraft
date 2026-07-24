import { describe, expect, it } from 'vitest';
import { proceduralCorpseLootMarker } from '../src/render/procedural_loot_marker';
import type { ProceduralRarity } from '../src/sim/procedural_item';
import type { CorpseLoot, LootSlot } from '../src/sim/types';

function slot(rarity: ProceduralRarity, personalFor?: number[]): LootSlot {
  return {
    itemId: 'gravecaller_ring',
    count: 1,
    ...(personalFor && { personalFor }),
    instance: {
      procedural: {
        version: 1,
        uid: `pi1:test:${rarity.length}`,
        baseId: 'gravecaller_ring',
        itemLevel: 20,
        rarity,
        affixes: [],
        generatedName: { baseId: 'gravecaller_ring' },
        seed: 1,
      },
    },
  };
}

function loot(...items: LootSlot[]): CorpseLoot {
  return { copper: 0, items };
}

describe('procedural corpse loot marker', () => {
  it('returns null for an empty, currency-only, or static-item corpse', () => {
    expect(proceduralCorpseLootMarker(null, 1)).toBeNull();
    expect(proceduralCorpseLootMarker({ copper: 100, items: [] }, 1)).toBeNull();
    expect(
      proceduralCorpseLootMarker(loot({ itemId: 'minor_healing_potion', count: 1 }), 1),
    ).toBeNull();
  });

  it.each([
    ['common', 'common', 'itemUi.procedural.rarity.common'],
    ['magic', 'uncommon', 'itemUi.procedural.rarity.magic'],
    ['rare', 'rare', 'itemUi.procedural.rarity.rare'],
    ['epic', 'epic', 'itemUi.procedural.rarity.epic'],
    ['legendary', 'legendary', 'itemUi.procedural.rarity.legendary'],
    ['mythic', 'legendary', 'itemUi.procedural.rarity.mythic'],
  ] as const)(
    'maps %s to the supported %s quality class and a non-color text label',
    (rarity, quality, labelKey) => {
      expect(proceduralCorpseLootMarker(loot(slot(rarity)), 7)).toEqual({
        rarity,
        quality,
        labelKey,
      });
    },
  );

  it('selects the highest visible rarity regardless of slot order', () => {
    const forward = loot(slot('common'), slot('legendary'), slot('rare'), slot('epic'));
    const reverse = loot(...[...forward.items].reverse());
    expect(proceduralCorpseLootMarker(forward, 4)).toEqual({
      rarity: 'legendary',
      quality: 'legendary',
      labelKey: 'itemUi.procedural.rarity.legendary',
    });
    expect(proceduralCorpseLootMarker(reverse, 4)).toEqual({
      rarity: 'legendary',
      quality: 'legendary',
      labelKey: 'itemUi.procedural.rarity.legendary',
    });
  });

  it('does not disclose another player’s personal procedural drop', () => {
    const corpse = loot(slot('common'), slot('legendary', [99]), slot('rare', [7]));
    expect(proceduralCorpseLootMarker(corpse, 7)).toEqual({
      rarity: 'rare',
      quality: 'rare',
      labelKey: 'itemUi.procedural.rarity.rare',
    });
    expect(proceduralCorpseLootMarker(corpse, 8)).toEqual({
      rarity: 'common',
      quality: 'common',
      labelKey: 'itemUi.procedural.rarity.common',
    });
    expect(proceduralCorpseLootMarker(loot(slot('legendary', [99])), 8)).toBeNull();
  });

  it('keeps open-to-all procedural drops visible to every player', () => {
    expect(proceduralCorpseLootMarker(loot({ ...slot('epic'), openToAll: true }), 1234)).toEqual({
      rarity: 'epic',
      quality: 'epic',
      labelKey: 'itemUi.procedural.rarity.epic',
    });
  });
});
