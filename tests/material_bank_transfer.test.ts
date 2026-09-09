import { describe, expect, it } from 'vitest';
import { moveBetweenContainers } from '../src/sim/bank';
import type { MaterialSource } from '../src/sim/material_sources';
import type { InvSlot } from '../src/sim/types';

const ANA: MaterialSource = { gatherer: { kind: 'character', id: 11, name: 'Ana' } };
const BRU: MaterialSource = { signer: 'Bru' };
const pools = { general: 2, materials: 0 };
const stack = (): InvSlot => ({
  itemId: 'copper_ore',
  count: 7,
  materialSeparated: true,
  slot: 9,
  materialSources: [
    { source: ANA, count: 3 },
    { source: BRU, count: 4 },
  ],
});

describe('material source transfers between bags and storage', () => {
  it('partially moves ordinary units while leaving premium units and owner grouping behind', () => {
    const source = [stack()];
    const dest: InvSlot[] = [];
    expect(moveBetweenContainers(source, 0, 2, dest, pools)).toEqual({ moved: 2 });
    expect(source[0]).toMatchObject({ count: 5, materialSeparated: true, slot: 9 });
    expect(source[0].materialSources).toEqual(
      expect.arrayContaining([
        { source: ANA, count: 1 },
        { source: BRU, count: 4 },
      ]),
    );
    expect(dest).toEqual([
      { itemId: 'copper_ore', count: 2, materialSources: [{ source: ANA, count: 2 }] },
    ]);
  });
  it('moves exactly the selected premium quantities', () => {
    const source = [stack()];
    const dest: InvSlot[] = [];
    expect(moveBetweenContainers(source, 0, 2, dest, pools, [{ source: BRU, count: 2 }])).toEqual({
      moved: 2,
    });
    expect(dest[0].materialSources).toEqual([{ source: BRU, count: 2 }]);
    expect(source[0].materialSources).toEqual(
      expect.arrayContaining([
        { source: ANA, count: 3 },
        { source: BRU, count: 2 },
      ]),
    );
  });
  it('refuses an unavailable selected source without substituting another', () => {
    const source = [stack()];
    const before = structuredClone(source);
    const dest: InvSlot[] = [];
    expect(moveBetweenContainers(source, 0, 5, dest, pools, [{ source: BRU, count: 5 }])).toEqual({
      moved: 0,
      refusal: 'invalid',
    });
    expect(source).toEqual(before);
    expect(dest).toEqual([]);
  });
  it('lands a whole legacy signed stack across normal caps without dropping identity', () => {
    const source: InvSlot[] = [{ itemId: 'copper_ore', count: 24, instance: { signer: 'Bru' } }];
    const dest: InvSlot[] = [];
    expect(moveBetweenContainers(source, 0, undefined, dest, pools)).toEqual({ moved: 24 });
    expect(source).toEqual([]);
    expect(dest.map((s) => s.count)).toEqual([20, 4]);
    expect(dest.every((s) => s.materialSources?.[0].source.signer === 'Bru')).toBe(true);
  });
  it('refuses malformed destination composition before either side changes', () => {
    const source = [stack()];
    const dest: InvSlot[] = [
      { itemId: 'copper_ore', count: 1, materialSources: [{ source: ANA, count: 2 }] },
    ];
    const before = structuredClone({ source, dest });
    expect(moveBetweenContainers(source, 0, 2, dest, pools).moved).toBe(0);
    expect({ source, dest }).toEqual(before);
  });
});
