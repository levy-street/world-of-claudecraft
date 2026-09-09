import { describe, expect, it } from 'vitest';
import { stackSizeOf } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { consolidateBagStacks } from '../src/sim/inventory_sort';
import type { InvSlot } from '../src/sim/types';

const a = { gatherer: { kind: 'character' as const, id: 11, name: 'Ana' } };
const b = { gatherer: { kind: 'character' as const, id: 22, name: 'Bru' } };
const sort = (slots: InvSlot[]) => consolidateBagStacks(slots, (id) => ITEMS[id], stackSizeOf);
describe('material sort consolidation', () => {
  it('moves only the donor units that fit, preserving every source count', () => {
    const slots: InvSlot[] = [
      {
        itemId: 'copper_ore',
        count: 18,
        materialSources: [
          { source: {}, count: 10 },
          { source: a, count: 8 },
        ],
      },
      { itemId: 'copper_ore', count: 5, materialSources: [{ source: b, count: 5 }] },
    ];
    sort(slots);
    expect(slots).toEqual([
      {
        itemId: 'copper_ore',
        count: 20,
        materialSources: [
          { source: {}, count: 10 },
          { source: a, count: 8 },
          { source: b, count: 2 },
        ],
      },
      { itemId: 'copper_ore', count: 3, materialSources: [{ source: b, count: 3 }] },
    ]);
    const once = structuredClone(slots);
    sort(slots);
    expect(slots).toEqual(once);
  });
  it('preserves owner separation and incompatible payloads', () => {
    const slots: InvSlot[] = [
      {
        itemId: 'copper_ore',
        count: 2,
        materialSeparated: true,
        materialSources: [{ source: a, count: 2 }],
      },
      { itemId: 'copper_ore', count: 3, materialSources: [{ source: b, count: 3 }] },
      {
        itemId: 'copper_ore',
        count: 1,
        instance: { boundTo: 11 },
        materialSources: [{ source: {}, count: 1 }],
      },
    ];
    const before = structuredClone(slots);
    sort(slots);
    expect(slots).toEqual(before);
  });
  it('refuses malformed composition before merging any stack', () => {
    const slots: InvSlot[] = [
      { itemId: 'copper_ore', count: 2, materialSources: [{ source: a, count: 2 }] },
      { itemId: 'copper_ore', count: 3, materialSources: [{ source: b, count: 1 }] },
    ];
    const before = structuredClone(slots);
    expect(() => sort(slots)).toThrow();
    expect(slots).toEqual(before);
  });
});
