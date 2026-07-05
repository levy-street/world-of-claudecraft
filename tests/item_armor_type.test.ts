import { describe, expect, it } from 'vitest';
import type { ArmorItemDef } from '../src/sim/types';
import { itemArmorTypeLabelKey } from '../src/ui/item_armor_type';

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

describe('itemArmorTypeLabelKey', () => {
  it('uses the explicit armorType field when present', () => {
    expect(itemArmorTypeLabelKey(armor({ armorType: 'cloth' }))).toBe(
      'hudChrome.itemArmorType.cloth',
    );
    expect(itemArmorTypeLabelKey(armor({ armorType: 'leather' }))).toBe(
      'hudChrome.itemArmorType.leather',
    );
    expect(itemArmorTypeLabelKey(armor({ armorType: 'mail' }))).toBe(
      'hudChrome.itemArmorType.mail',
    );
  });

  it('returns null for non-armor items', () => {
    expect(
      itemArmorTypeLabelKey({
        id: 'sword',
        name: 'Sword',
        kind: 'weapon',
        slot: 'mainhand',
        weapon: { min: 1, max: 2, speed: 2 },
        sellValue: 1,
        requiredClass: ['warrior'],
      }),
    ).toBeNull();
  });

  it('is deterministic for a given item', () => {
    const item = armor({ requiredClass: ['shaman'] });
    expect(itemArmorTypeLabelKey(item)).toBe(itemArmorTypeLabelKey(item));
  });
});
