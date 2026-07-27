import { describe, expect, it } from 'vitest';
import { PROCEDURAL_BASE_ITEMS } from '../src/sim/content/procedural_loot';
import type { ProceduralItemInstance } from '../src/sim/procedural_item';
import { itemVendorSellValue } from '../src/sim/procedural_vendor_value';

function affix(id: string, stat: string) {
  return {
    affixId: id,
    family: id,
    position: 'prefix' as const,
    tier: 1,
    revision: 1 as const,
    budget: 1,
    values: { [stat]: 1 },
    ranges: { [stat]: { min: 1, max: 1 } },
  };
}

function procedural(overrides: Partial<ProceduralItemInstance> = {}): {
  procedural: ProceduralItemInstance;
} {
  return {
    procedural: {
      version: 1,
      uid: 'pi1:vendor-value:1',
      baseId: 'gravecaller_ring',
      itemLevel: 18,
      rarity: 'common',
      affixes: [],
      generatedName: { baseId: 'gravecaller_ring' },
      seed: 1,
      ...overrides,
    },
  };
}

describe('procedural vendor valuation', () => {
  const ring = PROCEDURAL_BASE_ITEMS.gravecaller_ring;

  it('leaves static, legacy, priceless, and unknown-base instances unchanged', () => {
    expect(itemVendorSellValue(ring)).toBe(ring.sellValue);
    expect(itemVendorSellValue(ring, {})).toBe(ring.sellValue);
    expect(itemVendorSellValue({ sellValue: 0 }, procedural())).toBe(0);
    expect(itemVendorSellValue(ring, procedural({ baseId: 'retired_unknown_base' }))).toBe(
      ring.sellValue,
    );
  });

  it('applies level, rarity, and affix-count factors from persisted fields', () => {
    const baseValue = ring.sellValue;
    expect(itemVendorSellValue(ring, procedural())).toBe(baseValue);
    expect(
      itemVendorSellValue(
        ring,
        procedural({
          itemLevel: 20,
          rarity: 'rare',
          affixes: [affix('a', 'sta'), affix('b', 'int'), affix('c', 'spi')],
        }),
      ),
    ).toBe(Math.round(baseValue * 1.08 * 1.65 * 1.24));
  });

  it('bounds extreme level and affix inputs without consulting demand', () => {
    const high = itemVendorSellValue(
      ring,
      procedural({
        itemLevel: 999,
        rarity: 'legendary',
        affixes: Array.from({ length: 20 }, (_, index) => affix(`a${index}`, 'sta')),
      }),
    );
    expect(high).toBe(Math.round(ring.sellValue * 2.5 * 3 * 1.4));
  });
});
