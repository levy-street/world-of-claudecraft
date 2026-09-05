import { describe, expect, it } from 'vitest';
import { activeItemInstanceStats, isItemEnchantActive } from '../src/sim/item_instance_stats';
import type { ItemInstancePayload } from '../src/sim/types';

describe('active per-copy stats', () => {
  it('keeps ordinary, unknown and unenchanted aggregates untouched by identity', () => {
    expect(activeItemInstanceStats(undefined)).toBeUndefined();
    expect(isItemEnchantActive(undefined)).toBe(true);
    for (const enchant of [undefined, 'enchant_chest_greater_stamina', 'future_enchant']) {
      const payload: ItemInstancePayload = { enchant, rolled: { stats: { sta: 7, str: 2 } } };
      expect(activeItemInstanceStats(payload)).toBe(payload.rolled?.stats);
      expect(isItemEnchantActive(payload)).toBe(true);
    }
  });

  it('removes only the dormant enchant contribution and never mutates storage', () => {
    const payload: ItemInstancePayload = {
      enchant: 'enchant_lucent_infusion',
      rolled: { stats: { sta: 15, str: 2 } },
    };
    expect(isItemEnchantActive(payload)).toBe(false);
    expect(activeItemInstanceStats(payload)).toEqual({ sta: 2, str: 2 });
    expect(payload.rolled?.stats).toEqual({ sta: 15, str: 2 });
    const restored: ItemInstancePayload = { ...payload, perfected: true };
    expect(isItemEnchantActive(restored)).toBe(true);
    expect(activeItemInstanceStats(restored)).toBe(payload.rolled?.stats);
  });

  it('does not expose zero or negative residue for a dormant stat line', () => {
    for (const sta of [0, 5, 13]) {
      expect(
        activeItemInstanceStats({ enchant: 'enchant_lucent_infusion', rolled: { stats: { sta } } }),
      ).toEqual({});
    }
    expect(activeItemInstanceStats({ enchant: 'enchant_lucent_infusion' })).toBeUndefined();
  });
});
