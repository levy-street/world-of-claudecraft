import { describe, expect, it } from 'vitest';
import type { ArmorItemDef, ItemDef } from '../src/sim/types';
import { marketArmorBadge } from '../src/ui/market_armor_badge';

function armor(extra: Partial<ArmorItemDef>): ArmorItemDef {
  return {
    id: 'test',
    name: 'Test',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    sellValue: 1,
    ...extra,
  };
}

const sword: ItemDef = {
  id: 'sword',
  name: 'Sword',
  kind: 'weapon',
  slot: 'mainhand',
  weapon: { min: 1, max: 2, speed: 2 },
  sellValue: 1,
  requiredClass: ['warrior'],
};

describe('marketArmorBadge', () => {
  it('resolves the armor type and its label key for each armor class', () => {
    expect(marketArmorBadge(armor({ armorType: 'cloth' }))).toEqual({
      armorType: 'cloth',
      labelKey: 'hudChrome.itemArmorType.cloth',
    });
    expect(marketArmorBadge(armor({ armorType: 'leather' }))).toEqual({
      armorType: 'leather',
      labelKey: 'hudChrome.itemArmorType.leather',
    });
    expect(marketArmorBadge(armor({ armorType: 'mail' }))).toEqual({
      armorType: 'mail',
      labelKey: 'hudChrome.itemArmorType.mail',
    });
  });

  it('returns null for non-armor listings (weapons, bags, materials, and so on)', () => {
    expect(marketArmorBadge(sword)).toBeNull();
  });

  it('is deterministic for a given item', () => {
    const item = armor({ armorType: 'mail', requiredClass: ['shaman'] });
    expect(marketArmorBadge(item)).toEqual(marketArmorBadge(item));
  });
});
