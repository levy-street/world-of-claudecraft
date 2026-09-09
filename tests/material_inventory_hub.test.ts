import { describe, expect, it } from 'vitest';
import { removeUnlockedFromSlots } from '../src/sim/item_lock';
import type { MaterialComposition } from '../src/sim/material_sources';
import { Sim } from '../src/sim/sim';
import type { ItemInstancePayload } from '../src/sim/types';

const sources: MaterialComposition = [
  { source: { gatherer: { kind: 'character', id: 11, name: 'Ana' } }, count: 2 },
  { source: { signer: 'Bru' }, count: 1 },
];
function world(): Sim {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
  sim.inventory.splice(0);
  return sim;
}
describe('material grants through the live inventory hub', () => {
  it('mixes signed and unsigned grants in one normal stack', () => {
    const sim = world();
    sim.addItem('copper_ore', 2);
    sim.addItemInstance('copper_ore', { signer: 'Ana' }, undefined, 3);
    sim.addItemInstance('copper_ore', { signer: 'Bru' }, undefined, 4);
    expect(sim.inventory).toEqual([
      {
        itemId: 'copper_ore',
        count: 9,
        materialSources: [
          { source: {}, count: 2 },
          { source: { signer: 'Ana' }, count: 3 },
          { source: { signer: 'Bru' }, count: 4 },
        ],
      },
    ]);
  });
  it('carries exact transferred composition through plain and payload grants', () => {
    const sim = world();
    sim.addItem('copper_ore', 3, undefined, { movement: true, materialSources: sources });
    sim.addItemInstance('copper_ore', { boundTo: 11 }, undefined, 3, {
      movement: true,
      materialSources: sources,
    });
    expect(sim.inventory).toHaveLength(2);
    for (const slot of sim.inventory) {
      expect(slot.count).toBe(3);
      expect(slot.materialSources).toEqual(expect.arrayContaining([...sources]));
      expect(slot.materialSources).not.toBe(sources);
    }
    expect(sim.inventory[1].instance).toEqual({ boundTo: 11 });
  });
  it('preserves the first payload reference and separate copies for nonmaterial gear', () => {
    const sim = world();
    const instance: ItemInstancePayload = { signer: 'Ana', charges: { test_charge: 3 } };
    sim.addItemInstance('worn_sword', instance, undefined, 2);
    expect(sim.inventory).toHaveLength(2);
    expect(sim.inventory[0].instance).toBe(instance);
    expect(sim.inventory[1].instance).toEqual(instance);
    expect(sim.inventory[1].instance).not.toBe(instance);
    expect(sim.inventory.every((s) => s.materialSources === undefined)).toBe(true);
  });
});

describe('nonmaterial grant provenance after hub extraction', () => {
  it('retains the recipe marker on fresh payload-bearing equipment', () => {
    const sim = world();
    sim.addItemInstance('worn_sword', { signer: 'Ana' }, undefined, 1, {
      craftedRecipeId: 'test_recipe',
    });
    expect(sim.inventory).toEqual([
      {
        itemId: 'worn_sword',
        count: 1,
        instance: { signer: 'Ana' },
        craftedRecipeId: 'test_recipe',
      },
    ]);
  });
});

describe('material consumption through live inventory entry points', () => {
  it('spends ordinary sources before premium and reports the premium actually consumed', () => {
    const sim = world();
    sim.addItem('copper_ore', 2);
    sim.addItemInstance('copper_ore', { signer: 'Ana' }, undefined, 1);
    expect(sim.removeItem('copper_ore', 2)).toEqual([]);
    expect(sim.inventory).toEqual([
      {
        itemId: 'copper_ore',
        count: 1,
        materialSources: [{ source: { signer: 'Ana' }, count: 1 }],
      },
    ]);
    expect(sim.removeItem('copper_ore', 1)).toEqual([{ signer: 'Ana' }]);
    expect(sim.inventory).toEqual([]);
  });
  it('counts and removes only the eligible portion of a mixed fungible stack', () => {
    const sim = world();
    sim.addItem('copper_ore', 3, undefined, { materialSources: sources });
    expect(sim.countFungibleItem('copper_ore')).toBe(2);
    sim.removeFungibleItem('copper_ore', 3);
    expect(sim.inventory).toEqual([
      {
        itemId: 'copper_ore',
        count: 1,
        materialSources: [{ source: { signer: 'Bru' }, count: 1 }],
      },
    ]);
    expect(sim.countFungibleItem('copper_ore')).toBe(0);
  });
  it('crafting removal preserves sources and leaves locked material untouched', () => {
    const sim = world();
    sim.addItem('copper_ore', 3, undefined, { materialSources: sources });
    sim.addItemInstance('copper_ore', { locked: true }, undefined, 1);
    removeUnlockedFromSlots(sim.inventory, 'copper_ore', 2);
    expect(sim.inventory.map((s) => s.count)).toEqual([1, 1]);
    expect(sim.inventory[0].materialSources).toEqual([{ source: { signer: 'Bru' }, count: 1 }]);
    expect(sim.inventory[1].instance?.locked).toBe(true);
  });
});
