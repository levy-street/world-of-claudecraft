// Player item lock, the cell arm: a locked bag stack is pinned to the cell it
// sits in. No drag moves it and no drag displaces it, the sort button flows
// around it, it never leaves for the bank or the guild bank, and equipping it
// puts the piece it replaces into the exact cell it left (so a second gear set
// parked in the bags swaps in place). Either side of the swap being locked
// counts, so the round trip lands the locked piece back in its own cell.

import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { bankPools, emptyBankState } from '../src/sim/bank';
import { BUILTIN_WORLD, ITEMS } from '../src/sim/data';
import { layoutBagCells, moveStackToCell } from '../src/sim/inventory_order';
import { sortInventoryStacks } from '../src/sim/inventory_sort';
import { isItemLocked } from '../src/sim/item_lock';
import { Sim } from '../src/sim/sim';
import type { Entity, InvSlot, SimEvent, WorldContent } from '../src/sim/types';
import { bagReorderBlockedByLock } from '../src/ui/bags_view';
import { planDepositAllMaterials } from '../src/ui/bank_view';

const OLD_SWORD = 'worn_sword';
const SET_SWORD = 'eastbrook_arming_sword';
const FILLER = 'wolf_fang';
const FOOD = 'roasted_boar';
const BANKER = 'bursar_fernando';
const GUILD_ID = 7;

const BANK_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: { [BANKER]: BUILTIN_WORLD.npcs[BANKER] },
  groundObjects: [],
};

function makeSim(world?: WorldContent) {
  const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: false, world });
  const pid = sim.playerId;
  const meta = sim.players.get(pid);
  if (!meta) throw new Error('missing meta');
  meta.inventory.length = 0;
  meta.equipment.mainhand = OLD_SWORD;
  if (meta.equipmentInstance) delete meta.equipmentInstance.mainhand;
  return { sim, pid, meta };
}

function moveToBanker(sim: Sim): void {
  const banker = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === BANKER,
  ) as Entity | undefined;
  if (!banker) throw new Error('banker is not spawned');
  const p = sim.entities.get(sim.playerId);
  if (!p) throw new Error('missing player');
  p.pos = { ...banker.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

function cellOf(inventory: readonly InvSlot[], capacity: number, itemId: string): number {
  return layoutBagCells(inventory, capacity).findIndex((s) => s?.itemId === itemId);
}

function indexAtCell(inventory: readonly InvSlot[], capacity: number, cell: number): number {
  const stack = layoutBagCells(inventory, capacity)[cell];
  return stack ? inventory.indexOf(stack) : -1;
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

describe('moveStackToCell pins a locked stack', () => {
  const inv = (): InvSlot[] => [
    { itemId: 'a', count: 1, slot: 0 },
    { itemId: 'b', count: 1, slot: 1, instance: { locked: true } },
    { itemId: 'c', count: 1, slot: 2 },
  ];

  it('refuses to move a locked stack, mutating nothing', () => {
    const inventory = inv();
    const before = JSON.stringify(inventory);
    expect(moveStackToCell(inventory, 1, 5, 10)).toBe(false);
    expect(JSON.stringify(inventory)).toBe(before);
  });

  it('refuses to drop another stack onto a locked cell, mutating nothing', () => {
    const inventory = inv();
    const before = JSON.stringify(inventory);
    expect(moveStackToCell(inventory, 0, 1, 10)).toBe(false);
    expect(JSON.stringify(inventory)).toBe(before);
  });

  it('still trades two unlocked stacks (control)', () => {
    const inventory = inv();
    expect(moveStackToCell(inventory, 0, 2, 10)).toBe(true);
    expect(inventory[0].slot).toBe(2);
    expect(inventory[2].slot).toBe(0);
    expect(inventory[1].slot).toBe(1);
  });

  it('the bag window predicate agrees on both ends', () => {
    const inventory = inv();
    expect(bagReorderBlockedByLock(inventory, 10, 1, 5)).toBe(true);
    expect(bagReorderBlockedByLock(inventory, 10, 0, 1)).toBe(true);
    expect(bagReorderBlockedByLock(inventory, 10, 0, 2)).toBe(false);
    expect(bagReorderBlockedByLock(inventory, 10, 0, 7)).toBe(false);
  });
});

describe('locking stamps the cell the stack sits in', () => {
  it('a hint-less locked stack no longer slides when an earlier stack leaves', () => {
    const { sim, meta } = makeSim();
    meta.inventory.push(
      { itemId: FILLER, count: 3 },
      { itemId: FOOD, count: 2 },
      { itemId: SET_SWORD, count: 1 },
    );
    const capacity = bagCapacity(meta.bags);
    expect(cellOf(meta.inventory, capacity, SET_SWORD)).toBe(2);
    sim.setItemLocked(SET_SWORD, true, { slotIndex: 2 });
    expect(isItemLocked(meta.inventory[2].instance)).toBe(true);
    // The first stack leaves; the unlocked hint-less one slides up, the locked one stays.
    meta.inventory.splice(0, 1);
    expect(cellOf(meta.inventory, capacity, FOOD)).toBe(0);
    expect(cellOf(meta.inventory, capacity, SET_SWORD)).toBe(2);
  });

  it('a drag through the sim command cannot move it', () => {
    const { sim, meta } = makeSim();
    meta.inventory.push({ itemId: FILLER, count: 3 }, { itemId: SET_SWORD, count: 1 });
    sim.setItemLocked(SET_SWORD, true, { slotIndex: 1 });
    const capacity = bagCapacity(meta.bags);
    sim.moveInventoryItem(1, 8);
    expect(cellOf(meta.inventory, capacity, SET_SWORD)).toBe(1);
    sim.moveInventoryItem(0, 1);
    expect(cellOf(meta.inventory, capacity, FILLER)).toBe(0);
    expect(cellOf(meta.inventory, capacity, SET_SWORD)).toBe(1);
  });
});

describe('equipping across a locked cell swaps in place', () => {
  // Bag: filler parked in cell 1 (cell 0 is a hole), the set sword parked in cell 5.
  function parkedSet(locked: boolean) {
    const ctx = makeSim();
    const { sim, meta } = ctx;
    meta.inventory.push({ itemId: FILLER, count: 3 }, { itemId: SET_SWORD, count: 1 });
    sim.moveInventoryItem(0, 1);
    sim.moveInventoryItem(1, 5);
    const capacity = bagCapacity(meta.bags);
    expect(cellOf(meta.inventory, capacity, FILLER)).toBe(1);
    expect(cellOf(meta.inventory, capacity, SET_SWORD)).toBe(5);
    if (locked) sim.setItemLocked(SET_SWORD, true, { slotIndex: 1 });
    return { ...ctx, capacity };
  }

  it('unlocked (control): the replaced piece falls into the first free cell, as before', () => {
    const { sim, meta, capacity } = parkedSet(false);
    sim.equipItem(SET_SWORD, { slotIndex: 1 }, 'mainhand');
    expect(meta.equipment.mainhand).toBe(SET_SWORD);
    expect(cellOf(meta.inventory, capacity, OLD_SWORD)).toBe(0);
  });

  it('locked: the replaced piece takes the exact cell the locked copy left', () => {
    const { sim, meta, capacity } = parkedSet(true);
    sim.equipItem(SET_SWORD, { slotIndex: 1 }, 'mainhand');
    expect(meta.equipment.mainhand).toBe(SET_SWORD);
    expect(meta.equipmentInstance?.mainhand?.locked).toBe(true);
    expect(cellOf(meta.inventory, capacity, OLD_SWORD)).toBe(5);
    expect(cellOf(meta.inventory, capacity, FILLER)).toBe(1);
    expect(layoutBagCells(meta.inventory, capacity)[0]).toBeNull();
  });

  it('the id-only equip (no named slot) swaps in place too', () => {
    const { sim, meta, capacity } = parkedSet(true);
    sim.equipItem(SET_SWORD, undefined, 'mainhand');
    expect(meta.equipment.mainhand).toBe(SET_SWORD);
    expect(cellOf(meta.inventory, capacity, OLD_SWORD)).toBe(5);
  });

  it('round trip: equipping the other set back returns the locked piece to its own cell', () => {
    const { sim, meta, capacity } = parkedSet(true);
    sim.equipItem(SET_SWORD, { slotIndex: 1 }, 'mainhand');
    const oldIndex = indexAtCell(meta.inventory, capacity, 5);
    expect(meta.inventory[oldIndex]?.itemId).toBe(OLD_SWORD);
    sim.equipItem(OLD_SWORD, { slotIndex: oldIndex }, 'mainhand');
    expect(meta.equipment.mainhand).toBe(OLD_SWORD);
    const back = layoutBagCells(meta.inventory, capacity)[5];
    expect(back?.itemId).toBe(SET_SWORD);
    expect(isItemLocked(back?.instance)).toBe(true);
    expect(layoutBagCells(meta.inventory, capacity)[0]).toBeNull();
  });
});

describe('taking a locked piece off with nothing to replace it', () => {
  it('lands in the first free cell and is pinned there', () => {
    const { sim, meta } = makeSim();
    meta.inventory.push({ itemId: FILLER, count: 3 }, { itemId: FOOD, count: 2 });
    meta.equipment.mainhand = SET_SWORD;
    meta.equipmentInstance = { ...meta.equipmentInstance, mainhand: { locked: true } };
    const capacity = bagCapacity(meta.bags);
    expect(sim.unequipItem('mainhand')).toBe(true);
    const sword = meta.inventory.find((s) => s.itemId === SET_SWORD);
    expect(isItemLocked(sword?.instance)).toBe(true);
    expect(cellOf(meta.inventory, capacity, SET_SWORD)).toBe(2);
    expect(sword?.slot).toBe(2);
    // An earlier hint-less stack leaves: the unlocked one slides, the locked one stays.
    meta.inventory.splice(0, 1);
    expect(cellOf(meta.inventory, capacity, FOOD)).toBe(0);
    expect(cellOf(meta.inventory, capacity, SET_SWORD)).toBe(2);
  });

  it('an unlocked piece keeps the historical hint-less return (control)', () => {
    const { sim, meta } = makeSim();
    meta.inventory.push({ itemId: FILLER, count: 3 });
    expect(sim.unequipItem('mainhand')).toBe(true);
    const sword = meta.inventory.find((s) => s.itemId === OLD_SWORD);
    expect(sword?.slot).toBeUndefined();
    expect(cellOf(meta.inventory, bagCapacity(meta.bags), OLD_SWORD)).toBe(1);
  });
});

describe('sort flows around a locked stack', () => {
  it('the locked stack keeps its cell; the rest sort into the remaining cells', () => {
    const { sim, meta } = makeSim();
    meta.inventory.push(
      { itemId: FILLER, count: 3 },
      { itemId: FOOD, count: 2 },
      { itemId: SET_SWORD, count: 1 },
      { itemId: OLD_SWORD, count: 1 },
    );
    const capacity = bagCapacity(meta.bags);
    sim.moveInventoryItem(1, 0);
    sim.moveInventoryItem(0, 6);
    // Lock the food stack, wherever the drags left it.
    const foodIndex = meta.inventory.findIndex((s) => s.itemId === FOOD);
    const foodCell = cellOf(meta.inventory, capacity, FOOD);
    sim.setItemLocked(FOOD, true, { slotIndex: foodIndex });
    sim.sortInventory();
    expect(cellOf(meta.inventory, capacity, FOOD)).toBe(foodCell);
    const taken = meta.inventory.map((s) => s.slot);
    expect(new Set(taken).size).toBe(taken.length);
    // Every unlocked stack lands in the lowest cells that are not the pinned one.
    const expected = [0, 1, 2, 3].filter((c) => c !== foodCell).slice(0, 3);
    const unlockedCells = meta.inventory
      .filter((s) => s.itemId !== FOOD)
      .map((s) => cellOf(meta.inventory, capacity, s.itemId))
      .sort((a, b) => a - b);
    expect(unlockedCells).toEqual(expected);
  });

  it('without a capacity the pure sort keeps its historical behavior', () => {
    const inventory: InvSlot[] = [
      { itemId: FILLER, count: 3 },
      { itemId: SET_SWORD, count: 1, slot: 9, instance: { locked: true } },
    ];
    sortInventoryStacks(
      inventory,
      (id) => ITEMS[id],
      () => 20,
    );
    expect(inventory.map((s) => s.slot).sort()).toEqual([0, 1]);
  });
});

describe('a locked copy never leaves for storage', () => {
  it('personal bank: refused with the locked line, nothing moves', () => {
    const { sim, meta } = makeSim(BANK_WORLD);
    moveToBanker(sim);
    meta.inventory.push({ itemId: FOOD, count: 2 }, { itemId: SET_SWORD, count: 1 });
    sim.setItemLocked(SET_SWORD, true, { slotIndex: 1 });
    sim.drainEvents();
    sim.bankDeposit(1);
    expect(errorTexts(sim.drainEvents())).toContain(
      'That item is locked and cannot be stored in the bank.',
    );
    expect(meta.inventory.some((s) => s.itemId === SET_SWORD)).toBe(true);
    expect(meta.bank.inventory).toEqual([]);
    // Control: the unlocked stack beside it still deposits.
    sim.bankDeposit(0);
    expect(meta.bank.inventory.map((s) => s.itemId)).toEqual([FOOD]);
  });

  it('guild bank: refused with the locked line, nothing moves', () => {
    const { sim, pid, meta } = makeSim(BANK_WORLD);
    moveToBanker(sim);
    sim.setPlayerGuildMembership(pid, { guildId: GUILD_ID, rank: 'officer' });
    sim.loadGuildBank(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    meta.inventory.push({ itemId: FOOD, count: 2 }, { itemId: SET_SWORD, count: 1 });
    sim.setItemLocked(SET_SWORD, true, { slotIndex: 1 });
    sim.drainEvents();
    sim.guildBankDepositFor(pid, 1);
    expect(errorTexts(sim.drainEvents())).toContain(
      'That item is locked and cannot be stored in the guild bank.',
    );
    expect(sim.guildBanks.get(GUILD_ID)?.inventory).toEqual([]);
    sim.guildBankDepositFor(pid, 0);
    expect(sim.guildBanks.get(GUILD_ID)?.inventory.map((s) => s.itemId)).toEqual([FOOD]);
  });

  it('deposit-all materials skips a locked material stack', () => {
    const inventory: InvSlot[] = [
      { itemId: FILLER, count: 3 },
      { itemId: FILLER, count: 2, instance: { locked: true } },
    ];
    const plan = planDepositAllMaterials(inventory, [], bankPools(emptyBankState()), (id) => {
      return ITEMS[id];
    });
    expect(plan.sends).toEqual([{ slot: 0, count: 3 }]);
  });
});
