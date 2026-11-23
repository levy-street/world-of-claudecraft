import { describe, expect, it } from 'vitest';
import { hoardRewardGrantItems } from '../src/sim/rift/hoard_reward_items';
import type { HoardRewardItem } from '../src/sim/rift/hoard_reward_roll';

describe('hoard reward grant items', () => {
  it('preserves quantities and isolates rolled quality from the immutable parcel', () => {
    const items: HoardRewardItem[] = [
      { itemId: 'pristine_silk', count: 6 },
      {
        itemId: 'slagbreaker_helmet',
        count: 2,
        lootQuality: { version: 1, tier: 3, weights: [5, 4, 3, 2, 1] },
      },
    ];
    const before = structuredClone(items);
    const grants = hoardRewardGrantItems(items);
    expect(grants).toEqual([
      { itemId: 'pristine_silk', count: 6 },
      { itemId: 'slagbreaker_helmet', count: 2, instance: { lootQuality: items[1].lootQuality } },
    ]);
    grants[1].instance!.lootQuality!.weights[0] = 1;
    expect(items).toEqual(before);
  });

  it('grants a plain copy when a persisted quality descriptor is malformed', () => {
    const items = [
      { itemId: 'slagbreaker_helmet', count: 1, lootQuality: { version: 99 } },
    ] as unknown as HoardRewardItem[];
    expect(hoardRewardGrantItems(items)).toEqual([{ itemId: 'slagbreaker_helmet', count: 1 }]);
  });
});
