import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { armorTypeForItem } from '../src/sim/equipment_rules';

describe('armor type catalog coverage', () => {
  it('assigns every armor item a concrete armor type', () => {
    const missing = Object.values(ITEMS)
      .filter((item) => item.kind === 'armor')
      .filter((item) => !armorTypeForItem(item))
      .map((item) => item.id);

    expect(missing).toEqual([]);
  });
});
