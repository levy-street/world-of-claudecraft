// Manual inventory order: what dragging a stack onto another bag cell does.
//
// The bag grid paints the inventory ARRAY in order (the default "recent" view is
// literally the unsorted list), so a cell's position IS an inventory index and a
// drag between cells is a reorder of that array. The array is DENSE (there are no
// holes; the trailing squares in the grid are free capacity, not empty positions),
// which fixes the two cases:
//   - onto an occupied cell: SWAP the two stacks, so the dragged stack lands exactly
//     where the player dropped it and the displaced one takes its place.
//   - onto a free square past the end: MOVE the stack to the end (the array cannot
//     hold a hole, so "somewhere in the empty space" can only mean last).
// Order is persisted with the character (the inventory array is serialized as-is),
// so a manual arrangement survives a relog.
//
// Pure leaf: no SimContext, no rng, no clock. The equip path's equipment_rules is the
// model; the HUD imports this too, so the client's drop feedback and the server's
// authoritative move can never disagree.

import type { InvSlot } from './types';

/** Whether `from`/`to` name a legal move for an inventory of `length` stacks.
 *  `from` must be a real stack; `to` may point past the end (the free space), but
 *  never outside the bag's capacity, and a move onto itself is not a move. */
export function isInventoryMove(
  from: number,
  to: number,
  length: number,
  capacity: number,
): boolean {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from < 0 || from >= length) return false;
  if (to < 0 || to >= Math.max(length, capacity)) return false;
  return from !== to;
}

/** Apply the move in place. Returns false (and mutates nothing) when the move is
 *  illegal, so the caller can refuse a hand-crafted wire command outright. */
export function moveInventorySlot(
  inventory: InvSlot[],
  from: number,
  to: number,
  capacity: number,
): boolean {
  if (!isInventoryMove(from, to, inventory.length, capacity)) return false;
  const moved = inventory[from];
  if (!moved) return false;
  if (to < inventory.length) {
    // Swap: the dragged stack takes the target cell, the target stack takes its old one.
    const target = inventory[to];
    if (!target) return false;
    inventory[from] = target;
    inventory[to] = moved;
    return true;
  }
  // Dropped on free space: the array has no holes, so the stack goes last.
  if (from === inventory.length - 1) return false;
  inventory.splice(from, 1);
  inventory.push(moved);
  return true;
}
