import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { PublicItemInstanceView } from '../src/sim/procedural_item_public';
import { needDenialReason } from '../src/ui/hud/loot/need_roll_eligibility_view';

const warriorPower: PublicItemInstanceView = {
  procedural: {
    version: 1,
    baseId: 'iron_broadsword',
    itemLevel: 30,
    rarity: 'legendary',
    affixes: [],
    legendaryPowerId: 'greyjaws_edge',
    powerRevision: 1,
    generatedName: { baseId: 'iron_broadsword' },
  },
};

describe('needDenialReason', () => {
  it('distinguishes a class-restricted Legendary power from base-item eligibility', () => {
    expect(needDenialReason(ITEMS.iron_broadsword, warriorPower, 'paladin')).toBe(
      'legendary_power',
    );
  });

  it('keeps an ordinary equipment restriction on the item-class reason', () => {
    expect(needDenialReason(ITEMS.gravecaller_cloth_hood, undefined, 'warrior')).toBe('item_class');
  });
});
