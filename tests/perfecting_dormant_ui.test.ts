import { describe, expect, it } from 'vitest';
import type { ItemDef, ItemInstancePayload } from '../src/sim/types';
import { itemStatDeltas } from '../src/ui/item_compare';
import { instanceBonusStatLines, wornTooltipInstance } from '../src/ui/item_instance_tooltip';

const chest: ItemDef = {
  id: 'test_chest',
  name: 'Test chest',
  kind: 'armor',
  armorType: 'mail',
  slot: 'chest',
  sellValue: 0,
  stats: { sta: 10 },
};
const dormant: ItemInstancePayload = {
  enchant: 'enchant_lucent_infusion',
  perfecting: 1,
  rolled: { quality: 'legendary', stats: { str: 2, sta: 13 } },
};

describe('dormant Perfected-only enchant presentation', () => {
  it('omits inactive enchant power from both comparison sides without losing unrelated stats', () => {
    expect(itemStatDeltas(chest, chest, dormant)).toEqual([{ stat: 'str', delta: 2, decimals: 0 }]);
    expect(itemStatDeltas(chest, chest, undefined, dormant)).toEqual([
      { stat: 'str', delta: -2, decimals: 0 },
    ]);
  });

  it('shows an explicit inactive marker instead of an active enchanted stat', () => {
    const html = instanceBonusStatLines(dormant);
    expect(html).toContain('inactive');
    expect(html).not.toContain('+13');
    expect(html).toContain('+2');
  });

  it('reactivates the full effect when Perfected returns and preserves worn state', () => {
    const active: ItemInstancePayload = { ...dormant, perfected: true };
    expect(instanceBonusStatLines(active)).toContain('+13');
    expect(instanceBonusStatLines(active)).not.toContain('inactive');
    expect(instanceBonusStatLines(wornTooltipInstance(dormant))).toContain('inactive');
  });
});
