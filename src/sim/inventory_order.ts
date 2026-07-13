// Manual bag order: the bag has FIXED CELLS, and a stack remembers the cell it sits in.
//
// The inventory itself stays a dense array (every other system, from addItem to the
// wire encoder, depends on that), so the arrangement rides as an optional `slot` on each
// stack: the cell it was dragged to. This layer is the one place that turns those hints
// into the grid the player sees, and it is deliberately TOTAL: a stack with no slot (a
// fresh drop, an old save, an item that came back from the bank), a slot past a shrunken
// bag, or two stacks claiming the same cell all still lay out, deterministically, with
// no stack ever lost or duplicated.
//
// Holes are the whole point: a bag with a stack parked in cell 9 has empty cells before
// it, and they stay empty. Without them, dropping a stack on a far square could only ever
// mean "put it last", which is exactly the move that looks like nothing happened.
//
// Pure leaf: no SimContext, no rng, no clock. The sim's move command and the HUD's grid
// both call this, so what the player drags onto is what the server rearranges.

import type { InvSlot } from './types';

/** A laid-out bag: one entry per cell, null where the cell is empty. */
export type BagCells = (InvSlot | null)[];

/** Place every stack into a cell. A stack's `slot` is honored when it is a real, free
 *  cell of this bag; every other stack (and every stack whose hint was unusable) falls
 *  into the first free cell, in inventory order. Stacks past the bag's capacity (a
 *  legacy over-capacity save) are appended beyond the grid rather than dropped, so the
 *  caller can still see and move them. */
export function layoutBagCells(inventory: readonly InvSlot[], capacity: number): BagCells {
  const cells: BagCells = Array.from({ length: Math.max(0, Math.floor(capacity)) }, () => null);
  const unplaced: InvSlot[] = [];
  for (const stack of inventory) {
    const hint = stack.slot;
    if (
      typeof hint === 'number' &&
      Number.isInteger(hint) &&
      hint >= 0 &&
      hint < cells.length &&
      cells[hint] === null
    ) {
      cells[hint] = stack;
    } else {
      unplaced.push(stack);
    }
  }
  let next = 0;
  for (const stack of unplaced) {
    while (next < cells.length && cells[next] !== null) next++;
    if (next >= cells.length) {
      // Over capacity (a shrunken bag): keep the stack visible past the grid instead of
      // vanishing it. The bag refuses new items long before this can be reached normally.
      cells.push(stack);
      continue;
    }
    cells[next] = stack;
  }
  return cells;
}

/** The cell each inventory index currently occupies (the inverse of layoutBagCells).
 *  Used by the HUD to stamp a stack's cell and by the move command to find the stack
 *  the player dropped onto. */
export function cellOfIndex(inventory: readonly InvSlot[], capacity: number): number[] {
  const cells = layoutBagCells(inventory, capacity);
  const at = new Array<number>(inventory.length).fill(-1);
  for (let cell = 0; cell < cells.length; cell++) {
    const stack = cells[cell];
    if (!stack) continue;
    const index = inventory.indexOf(stack);
    if (index >= 0) at[index] = cell;
  }
  return at;
}

/** Move the stack at inventory index `from` into bag cell `to`.
 *
 *  Empty cell: the stack simply parks there, leaving a hole behind it.
 *  Occupied cell: the two stacks TRADE cells, so nothing is ever displaced into limbo.
 *
 *  Returns false (mutating nothing) when the move is illegal, so a hand-crafted wire
 *  command cannot park a stack outside the bag or move a stack that is not there. */
export function moveStackToCell(
  inventory: InvSlot[],
  from: number,
  to: number,
  capacity: number,
): boolean {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from < 0 || from >= inventory.length) return false;
  if (to < 0 || to >= Math.floor(capacity)) return false;
  const moved = inventory[from];
  if (!moved) return false;
  const cells = layoutBagCells(inventory, capacity);
  const fromCell = cells.indexOf(moved);
  if (fromCell === to) return false;
  const displaced = cells[to] ?? null;
  // Write BOTH stacks' cells explicitly: the displaced one keeps its position by taking
  // the cell the moved stack vacated, and every other stack keeps whatever cell the
  // layout already gave it, so a single drag can never reshuffle the whole bag.
  for (let cell = 0; cell < cells.length; cell++) {
    const stack = cells[cell];
    if (stack) stack.slot = cell;
  }
  moved.slot = to;
  if (displaced) displaced.slot = fromCell;
  return true;
}
