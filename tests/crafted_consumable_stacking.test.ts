import { describe, expect, it } from 'vitest';
import { addStacked, consumeOneScratch, countFit, stackSizeOf } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { countFungibleItem, removeItem } from '../src/sim/inventory_consumption';
import { grantInventoryInstances } from '../src/sim/inventory_grant';
import { sortInventoryStacks } from '../src/sim/inventory_sort';
import { consumeSelectedInventorySlot } from '../src/sim/item_copy_ref';
import { isMaterialItemId } from '../src/sim/material_ids';
import type { SimContext } from '../src/sim/sim_context';
import type { InvSlot } from '../src/sim/types';

const POTION = 'minor_healing_potion';
const FOOD = 'baked_bread';
const sources = (inventory: InvSlot[]) => inventory.flatMap((slot) => slot.materialSources ?? []);

describe('crafted consumables retain per-unit provenance while sharing bag stacks', () => {
  it.each([POTION, FOOD])(
    'tops up %s across crafters without needing a free general slot',
    (itemId) => {
      const inventory: InvSlot[] = [{ itemId, count: 18, instance: { signer: 'Ana' } }];
      expect(isMaterialItemId(itemId)).toBe(false);
      expect(countFit(inventory, { general: 1, materials: 10 }, itemId, 3, { signer: 'Bru' })).toBe(
        2,
      );
      addStacked(inventory, itemId, 2, { signer: 'Bru' });
      expect(inventory).toHaveLength(1);
      expect(inventory[0].count).toBe(20);
      expect(sources(inventory)).toEqual([
        { source: { signer: 'Ana' }, count: 18 },
        { source: { signer: 'Bru' }, count: 2 },
      ]);
      expect(countFit(inventory, { general: 1, materials: 10 }, itemId, 1)).toBe(0);
    },
  );

  it('consolidates legacy stacks and keeps unsigned, differently signed and overflow units', () => {
    const inventory: InvSlot[] = [
      { itemId: POTION, count: 12, instance: { signer: 'Ana' } },
      { itemId: POTION, count: 7, instance: { signer: 'Bru' } },
      { itemId: POTION, count: 4 },
    ];
    sortInventoryStacks(inventory, (id) => ITEMS[id], stackSizeOf);
    expect(inventory.map((slot) => slot.count)).toEqual([20, 3]);
    expect(sources(inventory).reduce((sum, entry) => sum + entry.count, 0)).toBe(23);
    expect(sources(inventory).filter((entry) => entry.source.signer === 'Ana')).toEqual([
      { source: { signer: 'Ana' }, count: 12 },
    ]);
    const first = structuredClone(inventory);
    sortInventoryStacks(inventory, (id) => ITEMS[id], stackSizeOf);
    expect(inventory).toEqual(first);
  });

  it('grants signed units through the instance hub and returns each consumed signer independently', () => {
    const inventory: InvSlot[] = [];
    grantInventoryInstances(inventory, POTION, 2, { signer: 'Ana' });
    grantInventoryInstances(inventory, POTION, 1, { signer: 'Bru' });
    expect(inventory).toHaveLength(1);
    expect(consumeOneScratch(inventory, POTION)).toEqual({ signer: 'Ana' });
    expect(inventory[0].count).toBe(2);
    const selected = consumeSelectedInventorySlot(inventory, POTION, 0);
    expect(selected?.materialSources).toEqual([{ source: { signer: 'Ana' }, count: 1 }]);
    expect(consumeOneScratch(inventory, POTION)).toEqual({ signer: 'Bru' });
    expect(inventory).toEqual([]);
  });

  it('does not merge different recipe identity, binding, charges or locked copies', () => {
    const inventory: InvSlot[] = [
      { itemId: POTION, count: 1, instance: { signer: 'Ana' }, craftedRecipeId: 'one' },
    ];
    addStacked(inventory, POTION, 1, { signer: 'Bru' }, 'two');
    addStacked(inventory, POTION, 1, { signer: 'Bru', boundTo: 22 }, 'one');
    addStacked(inventory, POTION, 1, { signer: 'Bru', locked: true }, 'one');
    addStacked(inventory, POTION, 2, { signer: 'Bru', charges: { zap: 2 } }, 'one');
    expect(inventory).toHaveLength(6);
    expect(inventory.every((slot) => slot.count === 1)).toBe(true);
  });

  it('counts unsigned units inside a mixed stack and removes actual signer payloads', () => {
    const inventory: InvSlot[] = [];
    addStacked(inventory, POTION, 2, { signer: 'Ana' });
    addStacked(inventory, POTION, 1);
    let changed = 0;
    const ctx = {
      resolve: () => ({ meta: { inventory } }),
      onInventoryChangedForQuests: () => {
        changed++;
      },
    } as unknown as SimContext;
    expect(countFungibleItem(ctx, POTION)).toBe(1);
    expect(removeItem(ctx, POTION, 2)).toEqual([{ signer: 'Ana' }]);
    expect(inventory[0].count).toBe(1);
    expect(sources(inventory)).toEqual([{ source: { signer: 'Ana' }, count: 1 }]);
    expect(changed).toBe(1);
  });

  it('preserves unknown payload identity and refuses malformed source state atomically', () => {
    const inventory: InvSlot[] = [];
    const payload = { signer: 'Ana', future: { quality: 3 } };
    addStacked(inventory, POTION, 1, payload);
    addStacked(inventory, POTION, 1, { signer: 'Bru', future: { quality: 3 } } as typeof payload);
    addStacked(inventory, POTION, 1, { signer: 'Cy', future: { quality: 4 } } as typeof payload);
    expect(inventory.map((slot) => slot.count)).toEqual([2, 1]);
    payload.future.quality = 99;
    expect(inventory[0].instance).toEqual({ future: { quality: 3 } });
    inventory[0].materialSources = [{ source: { signer: 'Ana' }, count: 1 }];
    const before = structuredClone(inventory);
    expect(countFit(inventory, { general: 16, materials: 0 }, POTION, 1)).toBe(0);
    expect(() => addStacked(inventory, POTION, 1)).toThrow();
    expect(inventory).toEqual(before);
  });
});
