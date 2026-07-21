import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { armorTypeForItem } from '../src/sim/equipment_rules';

describe('armor type catalog coverage', () => {
  it('assigns every non-jewelry armor item a concrete armor type', () => {
    // Jewelry (neck/ring slots) is the one deliberate exception: it is kind
    // 'armor' with NO armor class, so any class can wear it (JewelryItemDef,
    // equipment_rules falls through the armorType gate).
    const missing = Object.values(ITEMS)
      .filter((item) => item.kind === 'armor')
      .filter((item) => item.slot !== 'neck' && item.slot !== 'ring')
      .filter((item) => !armorTypeForItem(item))
      .map((item) => item.id);

    expect(missing).toEqual([]);
  });

  it('jewelry carries no armor class', () => {
    const jewelry = Object.values(ITEMS).filter(
      (item) => item.slot === 'neck' || item.slot === 'ring',
    );
    expect(jewelry.length).toBeGreaterThan(0);
    for (const item of jewelry) expect(armorTypeForItem(item), item.id).toBeNull();
  });
});
