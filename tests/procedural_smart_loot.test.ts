import { describe, expect, it } from 'vitest';
import { PROCEDURAL_BASE_ITEMS } from '../src/sim/content/procedural_loot/item_defs';
import { proceduralLootUsabilityMultiplier } from '../src/sim/loot/procedural/smart_loot';

describe('procedural smart-loot weighting', () => {
  it('uses one plus twice the fraction of recipients who can equip the base', () => {
    expect(
      proceduralLootUsabilityMultiplier(PROCEDURAL_BASE_ITEMS.gravecaller_ring, [
        'warrior',
        'mage',
      ]),
    ).toBe(3);
    expect(
      proceduralLootUsabilityMultiplier(PROCEDURAL_BASE_ITEMS.ashwood_staff, ['warrior', 'mage']),
    ).toBe(2);
    expect(
      proceduralLootUsabilityMultiplier(PROCEDURAL_BASE_ITEMS.mirefen_hunting_bow, [
        'warrior',
        'mage',
      ]),
    ).toBe(1);
  });

  it('keeps every base eligible and leaves unowned drops unbiased', () => {
    expect(
      proceduralLootUsabilityMultiplier(PROCEDURAL_BASE_ITEMS.mirefen_hunting_bow, ['mage']),
    ).toBe(1);
    expect(proceduralLootUsabilityMultiplier(PROCEDURAL_BASE_ITEMS.ashwood_staff, [])).toBe(1);
  });
});
