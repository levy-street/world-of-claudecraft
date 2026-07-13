// Manual bag arrangement: the bag has FIXED CELLS and a stack remembers the one it was
// dragged into (InvSlot.slot), so a stack parked in cell 9 STAYS in cell 9 and the cells
// before it stay empty. Holes are the point: without them, dropping a stack on a far
// square could only ever mean "put it last", which is the move that looks like nothing
// happened (the bug this replaces).
//
// The layout is deliberately total: no slot, a slot past a shrunken bag, or two stacks
// claiming one cell all still lay out deterministically, with no stack lost or cloned.

import { describe, expect, it } from 'vitest';
import { cellOfIndex, layoutBagCells, moveStackToCell } from '../src/sim/inventory_order';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const CAP = 8;
const stack = (itemId: string, slot?: number): InvSlot => ({
  itemId,
  count: 1,
  ...(slot !== undefined ? { slot } : {}),
});
const ids = (cells: (InvSlot | null)[]): (string | null)[] => cells.map((c) => c?.itemId ?? null);

describe('layoutBagCells', () => {
  it('puts unplaced stacks in the first free cells, in inventory order', () => {
    const inv = [stack('bread'), stack('sword')];
    expect(ids(layoutBagCells(inv, 4))).toEqual(['bread', 'sword', null, null]);
  });

  it('honors a parked stack and leaves a real HOLE before it', () => {
    const inv = [stack('bread', 3)];
    expect(ids(layoutBagCells(inv, 4))).toEqual([null, null, null, 'bread']);
  });

  it('flows the unplaced stacks around the parked ones', () => {
    const inv = [stack('bread', 3), stack('sword'), stack('potion')];
    expect(ids(layoutBagCells(inv, 4))).toEqual(['sword', 'potion', null, 'bread']);
  });

  it('ignores an unusable slot rather than losing the stack (shrunken bag, negative, fractional)', () => {
    for (const bad of [9, -1, 2.5, Number.NaN]) {
      const inv = [stack('bread', bad), stack('sword')];
      expect(ids(layoutBagCells(inv, 4)), `slot ${bad}`).toEqual(['bread', 'sword', null, null]);
    }
  });

  it('resolves two stacks claiming ONE cell: the first keeps it, the other flows on', () => {
    const inv = [stack('bread', 2), stack('sword', 2)];
    expect(ids(layoutBagCells(inv, 4))).toEqual(['sword', null, 'bread', null]);
  });

  it('keeps an over-capacity stack visible past the grid instead of dropping it', () => {
    const inv = [stack('a'), stack('b'), stack('c')];
    expect(ids(layoutBagCells(inv, 2))).toEqual(['a', 'b', 'c']);
  });

  it('an old save with no slots at all lays out exactly as it always did', () => {
    const inv = [stack('a'), stack('b'), stack('c')];
    expect(ids(layoutBagCells(inv, 5))).toEqual(['a', 'b', 'c', null, null]);
  });
});

describe('cellOfIndex', () => {
  it('maps each inventory index to the cell it occupies', () => {
    const inv = [stack('bread', 3), stack('sword')];
    expect(cellOfIndex(inv, 4)).toEqual([3, 0]);
  });
});

describe('moveStackToCell', () => {
  it('parks a stack in an EMPTY far cell, leaving a hole behind it (nothing slides)', () => {
    const inv = [stack('bread'), stack('sword')];
    expect(moveStackToCell(inv, 0, 5, CAP)).toBe(true);
    // Cell 0 is now a real hole and the sword STAYS in cell 1: fixed cells mean a drag
    // moves exactly one stack, it never re-packs the bag.
    expect(ids(layoutBagCells(inv, CAP))).toEqual([
      null,
      'sword',
      null,
      null,
      null,
      'bread',
      null,
      null,
    ]);
  });

  it('TRADES cells with the stack already in the target cell', () => {
    const inv = [stack('bread'), stack('sword'), stack('potion')];
    expect(moveStackToCell(inv, 0, 2, CAP)).toBe(true);
    const cells = ids(layoutBagCells(inv, CAP));
    expect(cells[0]).toBe('potion');
    expect(cells[2]).toBe('bread');
    expect(cells[1]).toBe('sword'); // untouched: one drag never reshuffles the bag
  });

  it('moves the LAST stack to a far cell (the case that used to be a silent no-op)', () => {
    const inv = [stack('bread')];
    expect(moveStackToCell(inv, 0, 6, CAP)).toBe(true);
    expect(layoutBagCells(inv, CAP)[6]?.itemId).toBe('bread');
    expect(layoutBagCells(inv, CAP)[0]).toBeNull();
  });

  it('refuses a move onto the cell the stack is already in', () => {
    const inv = [stack('bread', 4)];
    expect(moveStackToCell(inv, 0, 4, CAP)).toBe(false);
  });

  it('refuses an out-of-bag or non-integer target, mutating nothing', () => {
    for (const [from, to] of [
      [0, CAP],
      [0, -1],
      [0, 1.5],
      [-1, 2],
      [3, 2], // no such stack
    ] as Array<[number, number]>) {
      const inv = [stack('bread'), stack('sword')];
      expect(moveStackToCell(inv, from, to, CAP), `${from} -> ${to}`).toBe(false);
      expect(ids(layoutBagCells(inv, CAP)).slice(0, 2)).toEqual(['bread', 'sword']);
    }
  });
});

describe('Sim.moveInventoryItem', () => {
  const makeSim = (): { sim: Sim & Record<string, any>; pid: number } => {
    const sim = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true }) as Sim &
      Record<string, any>;
    const pid = sim.addPlayer('warrior', 'Sorter');
    return { sim, pid };
  };
  const invOf = (sim: Sim & Record<string, any>, pid: number): InvSlot[] => {
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('no player');
    return meta.inventory;
  };

  it('parks a stack in the cell the player dropped it on, and the arrangement persists', () => {
    const { sim, pid } = makeSim();
    sim.addItem('baked_bread', 3, pid);
    sim.addItem('worn_sword', 1, pid);
    sim.moveInventoryItem(0, 7, pid);
    const inv = invOf(sim, pid);
    expect(inv[0]?.itemId).toBe('baked_bread');
    expect(inv[0]?.slot).toBe(7);
    // The arrangement rides on the stack, which is serialized with the character.
    const saved = sim.serializeCharacter(pid);
    if (!saved) throw new Error('character did not serialize');
    const savedBread = saved.inventory.find((s: InvSlot) => s.itemId === 'baked_bread');
    expect(savedBread?.slot).toBe(7);
  });

  it('refuses an illegal cell from the wire without touching the bag', () => {
    const { sim, pid } = makeSim();
    sim.addItem('baked_bread', 1, pid);
    sim.moveInventoryItem(0, 9999, pid); // past the bag
    sim.moveInventoryItem(5, 0, pid); // no such stack
    expect(invOf(sim, pid)[0]?.slot).toBeUndefined();
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
