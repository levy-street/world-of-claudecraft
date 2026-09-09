import { describe, expect, it } from 'vitest';
import { planMaterialStackCombination } from '../src/sim/material_stack_combination';
import { captureMaterialStackSelection } from '../src/sim/material_stack_selection';
import { planMaterialStackSeparation } from '../src/sim/material_stack_separation';
import type { InvSlot } from '../src/sim/types';

const ids = new Set(['ore']);
const a = { gatherer: { kind: 'character' as const, id: 11, name: 'Ana' } };
const b = { gatherer: { kind: 'character' as const, id: 22, name: 'Bru' } };
const mixed = (): InvSlot => ({
  itemId: 'ore',
  count: 9,
  slot: 4,
  materialSources: [
    { source: {}, count: 2 },
    { source: a, count: 3 },
    { source: { ...a, signer: 'Ana' }, count: 1 },
    { source: b, count: 3 },
  ],
});
const request = (inventory: InvSlot[], maxNewSlots = 2) => ({
  inventory,
  itemId: 'ore',
  selection: captureMaterialStackSelection(inventory, 'ore', 0)!,
  materialIds: ids,
  stackSize: 20,
  maxNewSlots,
});
describe('manual material stack separation', () => {
  it('groups by stable gatherer while retaining premium descriptors and the existing cell', () => {
    const inventory = [mixed()];
    const before = structuredClone(inventory);
    const result = planMaterialStackSeparation(request(inventory));
    expect(result).toEqual({
      ok: true,
      value: [
        {
          itemId: 'ore',
          count: 2,
          slot: 4,
          materialSeparated: true,
          materialSources: [{ source: {}, count: 2 }],
        },
        {
          itemId: 'ore',
          count: 4,
          materialSeparated: true,
          materialSources: [
            { source: a, count: 3 },
            { source: { ...a, signer: 'Ana' }, count: 1 },
          ],
        },
        {
          itemId: 'ore',
          count: 3,
          materialSeparated: true,
          materialSources: [{ source: b, count: 3 }],
        },
      ],
    });
    expect(inventory).toEqual(before);
  });
  it('extracts a chosen quantity into one separated block without changing other sources', () => {
    const inventory = [mixed()];
    const result = planMaterialStackSeparation({
      ...request(inventory, 1),
      selectedSources: [{ source: a, count: 2 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((s) => s.count)).toEqual([7, 2]);
    expect(result.value[0].materialSources).toEqual([
      { source: {}, count: 2 },
      { source: a, count: 1 },
      { source: { ...a, signer: 'Ana' }, count: 1 },
      { source: b, count: 3 },
    ]);
    expect(result.value[1]).toEqual({
      itemId: 'ore',
      count: 2,
      materialSeparated: true,
      materialSources: [{ source: a, count: 2 }],
    });
  });
  it('refuses insufficient space and stale same-quantity source changes without touching bags', () => {
    const inventory = [mixed()];
    const captured = request(inventory, 1);
    expect(planMaterialStackSeparation(captured)).toEqual({
      ok: false,
      error: 'insufficient-space',
    });
    inventory[0].materialSources = [{ source: b, count: 9 }];
    const before = structuredClone(inventory);
    expect(planMaterialStackSeparation({ ...captured, maxNewSlots: 3 })).toEqual({
      ok: false,
      error: 'stale-selection',
    });
    expect(inventory).toEqual(before);
  });
  it('refuses a huge legacy split before allocating one row per stack', () => {
    const inventory: InvSlot[] = [{ itemId: 'ore', count: Number.MAX_SAFE_INTEGER }];
    expect(planMaterialStackSeparation(request(inventory))).toEqual({
      ok: false,
      error: 'insufficient-space',
    });
    expect(inventory[0].count).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('preserves name snapshots of one gatherer together and keeps same-named people distinct', () => {
    const old = { gatherer: { kind: 'character' as const, id: 11, name: 'Oldname' } };
    const twin = { gatherer: { kind: 'character' as const, id: 22, name: 'Ana' } };
    const inventory: InvSlot[] = [
      {
        itemId: 'ore',
        count: 3,
        materialSources: [
          { source: a, count: 1 },
          { source: old, count: 1 },
          { source: twin, count: 1 },
        ],
      },
    ];
    const result = planMaterialStackSeparation(request(inventory));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((s) => s.count)).toEqual([2, 1]);
  });
});

describe('manual material stack combination', () => {
  it('clears grouping only for the selected compatible identity and merges its sources', () => {
    const inventory: InvSlot[] = [
      {
        itemId: 'ore',
        count: 2,
        materialSeparated: true,
        materialSources: [{ source: a, count: 2 }],
      },
      {
        itemId: 'ore',
        count: 3,
        materialSeparated: true,
        materialSources: [{ source: b, count: 3 }],
      },
      {
        itemId: 'ore',
        count: 1,
        instance: { boundTo: 1 },
        materialSeparated: true,
        materialSources: [{ source: a, count: 1 }],
      },
    ];
    const before = structuredClone(inventory);
    const result = planMaterialStackCombination(request(inventory));
    expect(result).toEqual({
      ok: true,
      value: [
        {
          itemId: 'ore',
          count: 5,
          materialSources: [
            { source: a, count: 2 },
            { source: b, count: 3 },
          ],
        },
        before[2],
      ],
    });
    expect(inventory).toEqual(before);
  });
});
