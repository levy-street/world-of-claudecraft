// Manual bag order: dragging a stack onto another bag cell puts it there. The grid
// paints the inventory ARRAY (its default view is the unsorted list), so a cell IS an
// index and the move is a reorder of that array, persisted with the character.
//
// The array is dense, which decides the two cases: a drop on a filled cell SWAPS, and
// a drop on free space moves the stack to the END. Everything else (a bogus index, a
// hand-crafted wire pair, a move onto itself) is refused with the bag untouched, since
// this command reorders real items and a sloppy guard would duplicate or drop one.

import { describe, expect, it } from 'vitest';
import { isInventoryMove, moveInventorySlot } from '../src/sim/inventory_order';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const CAP = 16;
const bag = (...ids: string[]): InvSlot[] => ids.map((itemId) => ({ itemId, count: 1 }));
const ids = (inv: readonly InvSlot[]): string[] => inv.map((s) => s.itemId);

describe('moveInventorySlot', () => {
  it('SWAPS when the target cell holds a stack', () => {
    const inv = bag('bread', 'sword', 'potion');
    expect(moveInventorySlot(inv, 0, 2, CAP)).toBe(true);
    expect(ids(inv)).toEqual(['potion', 'sword', 'bread']);
  });

  it('swaps in both directions (dragging backwards is the same move)', () => {
    const inv = bag('bread', 'sword', 'potion');
    expect(moveInventorySlot(inv, 2, 0, CAP)).toBe(true);
    expect(ids(inv)).toEqual(['potion', 'sword', 'bread']);
  });

  it('moves the stack to the END when dropped on free space', () => {
    const inv = bag('bread', 'sword', 'potion');
    // Cell 7 is a free square: the array has no holes, so "somewhere in the empty
    // space" can only mean last, and the stacks behind it close up.
    expect(moveInventorySlot(inv, 0, 7, CAP)).toBe(true);
    expect(ids(inv)).toEqual(['sword', 'potion', 'bread']);
    expect(inv).toHaveLength(3); // nothing was duplicated or lost
  });

  it('never leaves a hole: moving the LAST stack to free space is a no-op', () => {
    const inv = bag('bread', 'sword');
    expect(moveInventorySlot(inv, 1, 9, CAP)).toBe(false);
    expect(ids(inv)).toEqual(['bread', 'sword']);
  });

  it('refuses a move onto itself', () => {
    const inv = bag('bread', 'sword');
    expect(moveInventorySlot(inv, 1, 1, CAP)).toBe(false);
    expect(ids(inv)).toEqual(['bread', 'sword']);
  });

  it('refuses an out-of-range or non-integer index, mutating nothing', () => {
    const inv = bag('bread', 'sword');
    for (const [from, to] of [
      [-1, 1],
      [2, 0], // `from` is not a real stack
      [0, -1],
      [0, CAP], // past the bag's capacity, not just past the stacks
      [0.5, 1],
      [0, Number.NaN],
    ] as Array<[number, number]>) {
      expect(moveInventorySlot(inv, from, to, CAP), `${from} -> ${to}`).toBe(false);
    }
    expect(ids(inv)).toEqual(['bread', 'sword']);
  });

  it('isInventoryMove agrees with what moveInventorySlot will do', () => {
    expect(isInventoryMove(0, 2, 3, CAP)).toBe(true);
    expect(isInventoryMove(0, 7, 3, CAP)).toBe(true); // free space is a legal target
    expect(isInventoryMove(0, 0, 3, CAP)).toBe(false);
    expect(isInventoryMove(3, 0, 3, CAP)).toBe(false);
    expect(isInventoryMove(0, CAP, 3, CAP)).toBe(false);
  });
});

describe('Sim.moveInventoryItem', () => {
  const makeSim = (): { sim: Sim & Record<string, any>; pid: number } => {
    const sim = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true }) as Sim &
      Record<string, any>;
    const pid = sim.addPlayer('warrior', 'Sorter');
    return { sim, pid };
  };

  it('reorders the live bag and the order survives a save/load round trip', () => {
    const { sim, pid } = makeSim();
    sim.addItem('baked_bread', 1, pid);
    sim.addItem('worn_sword', 1, pid);
    sim.addItem('minor_healing_potion', 1, pid);
    const invOf = (): InvSlot[] => {
      const meta = sim.players.get(pid);
      if (!meta) throw new Error('no player');
      return meta.inventory;
    };
    const before = ids(invOf());
    sim.moveInventoryItem(0, 2, pid);
    const after = ids(invOf());
    expect(after).toEqual([before[2], before[1], before[0]]);
    // The order IS the serialized array, so a relog keeps the arrangement.
    const saved = sim.serializeCharacter(pid);
    if (!saved) throw new Error('character did not serialize');
    expect(saved.inventory.map((s: InvSlot) => s.itemId)).toEqual(after);
  });

  it('refuses an illegal pair from the wire without touching the bag', () => {
    const { sim, pid } = makeSim();
    sim.addItem('baked_bread', 1, pid);
    sim.addItem('worn_sword', 1, pid);
    const invOf = (): InvSlot[] => {
      const meta = sim.players.get(pid);
      if (!meta) throw new Error('no player');
      return meta.inventory;
    };
    const before = ids(invOf());
    sim.moveInventoryItem(0, 999, pid); // past capacity
    sim.moveInventoryItem(5, 0, pid); // no such stack
    expect(ids(invOf())).toEqual(before);
  });
});

describe('ClientWorld.moveInventoryItem (wire)', () => {
  it('sends the from/to pair on the inv_move command', async () => {
    const { ClientWorld } = await import('../src/net/online');
    const world = Object.create(ClientWorld.prototype) as any;
    const sent: unknown[] = [];
    world.cmd = (payload: unknown) => sent.push(payload);
    ClientWorld.prototype.moveInventoryItem.call(world, 3, 7);
    expect(sent).toEqual([{ cmd: 'inv_move', from: 3, to: 7 }]);
  });
});
