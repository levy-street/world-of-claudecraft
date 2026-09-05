import { describe, expect, it } from 'vitest';
import { requiredReagentCountFor } from '../src/sim/professions/crafting';

describe('discount-exempt raid reagents', () => {
  it.each([3, 6, 15])('charges all %i cores even with every discount', (count) => {
    expect(requiredReagentCountFor(true, { itemId: 'lastflame_core', count, noDiscount: true },
      { armorcrafting: 125 }, 'armorcrafting', true)).toEqual({
      count, selfSignedBonusApplied: false,
    });
  });

  it('still discounts ordinary gathering materials', () => {
    const result = requiredReagentCountFor(true, { itemId: 'fine_thorium_ore', count: 6 },
      { armorcrafting: 125 }, 'armorcrafting', true);
    expect(result.count).toBeLessThan(6);
    expect(result.selfSignedBonusApplied).toBe(true);
  });
});
