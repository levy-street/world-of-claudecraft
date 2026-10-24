import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import {
  marketConsumableSellChoice,
  marketConsumableSellSources,
} from '../src/ui/market_consumable_sources_view';

const slot: InvSlot = {
  itemId: 'minor_healing_potion',
  count: 4,
  materialSources: [
    { source: {}, count: 1 },
    { source: { signer: 'Ana' }, count: 1 },
    { source: { signer: 'Bru' }, count: 2 },
  ],
};
describe('mixed consumable market maker selection', () => {
  it('exposes all makers and stages only the chosen effective payload', () => {
    expect(marketConsumableSellSources(slot)).toEqual(slot);
    expect(marketConsumableSellChoice(slot, [{ source: { signer: 'Bru' }, count: 1 }])).toEqual({
      instance: { signer: 'Bru' },
    });
    expect(marketConsumableSellChoice(slot, [{ source: {}, count: 1 }])).toEqual({
      instance: undefined,
    });
    expect(slot.count).toBe(4);
  });
  it('refuses unheld makers and more than one source unit', () => {
    expect(marketConsumableSellChoice(slot, [{ source: { signer: 'Fake' }, count: 1 }])).toBeNull();
    expect(marketConsumableSellChoice(slot, [{ source: { signer: 'Bru' }, count: 2 }])).toBeNull();
  });
  it('keeps other payload fields and preserves material and plain-item staging', () => {
    expect(
      marketConsumableSellChoice({ ...slot, instance: { enchant: 'ench_stat_str' } }, [
        { source: { signer: 'Ana' }, count: 1 },
      ]),
    ).toEqual({ instance: { enchant: 'ench_stat_str', signer: 'Ana' } });
    expect(marketConsumableSellSources({ ...slot, itemId: 'copper_ore' })).toBeNull();
    expect(marketConsumableSellSources({ itemId: slot.itemId, count: 2 })).toBeNull();
  });
});
