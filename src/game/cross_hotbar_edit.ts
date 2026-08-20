// Arranging the cross hotbar on the bar itself, the way a console MMO does it:
// pick an action up off a cell, carry it, drop it on another. No dropdowns, no
// separate screen, and you are looking at the layout while you change it.
//
// Pure: a carry is two indices and a decision, so the rules unit-test without a
// pad or a DOM. The controller owns the DOM half (which cell has focus, what the
// carried action looks like) and the bindings store owns the write.

import type { CrossHotbarAction } from './cross_hotbar';
import { CROSS_HOTBAR_SET_COUNT, CROSS_HOTBAR_SLOTS_PER_SET } from './cross_hotbar';

/** Which cell: a set plus a position inside it. */
export interface CrossHotbarCellRef {
  set: number;
  position: number;
}

export interface CrossHotbarEditState {
  /** Editing at all. The bar stays on screen for the whole session. */
  active: boolean;
  /** The action lifted off a cell and travelling with the cursor, if any. */
  carried: CrossHotbarAction;
  /** Where it was lifted from, so a drop can put the displaced action back. Null
   *  when it came from OUTSIDE the bar (the spellbook), which is a plain place
   *  rather than a swap: there is nothing behind it to exchange with. */
  from: CrossHotbarCellRef | null;
}

export const IDLE_EDIT_STATE: CrossHotbarEditState = { active: false, carried: null, from: null };

export function isValidCell(cell: CrossHotbarCellRef): boolean {
  return (
    Number.isInteger(cell.set) &&
    cell.set >= 0 &&
    cell.set < CROSS_HOTBAR_SET_COUNT &&
    Number.isInteger(cell.position) &&
    cell.position >= 0 &&
    cell.position < CROSS_HOTBAR_SLOTS_PER_SET
  );
}

/** Enter or leave edit mode. Leaving always drops whatever was being carried back
 *  where it came from, so exiting mid-move can never lose an action. */
export function toggleEdit(state: CrossHotbarEditState): {
  state: CrossHotbarEditState;
  restore: { cell: CrossHotbarCellRef; action: CrossHotbarAction } | null;
} {
  if (!state.active) return { state: { active: true, carried: null, from: null }, restore: null };
  const restore =
    state.carried !== null && state.from !== null
      ? { cell: state.from, action: state.carried }
      : null;
  return { state: IDLE_EDIT_STATE, restore };
}

/** Pick up an action that is not on the bar (a spellbook entry). It carries with
 *  no origin, so dropping it writes rather than swaps. */
export function pickUpAction(
  state: CrossHotbarEditState,
  action: CrossHotbarAction,
): CrossHotbarEditState {
  if (!state.active || action === null || state.carried !== null) return state;
  return { ...state, carried: action, from: null };
}

/** What pressing confirm on a cell does: lift its action, or drop the carried one.
 *
 * A drop SWAPS, so dropping onto an occupied cell exchanges the two rather than
 * overwriting one: the action already there has to go somewhere, and the cell you
 * just came from is the only place the player will think to look for it.
 */
export function confirmCell(
  state: CrossHotbarEditState,
  cell: CrossHotbarCellRef,
  actionAt: (cell: CrossHotbarCellRef) => CrossHotbarAction,
): {
  state: CrossHotbarEditState;
  swap: { from: CrossHotbarCellRef; to: CrossHotbarCellRef } | null;
  place: { cell: CrossHotbarCellRef; action: CrossHotbarAction } | null;
} {
  const nothing = { state, swap: null, place: null };
  if (!state.active || !isValidCell(cell)) return nothing;
  if (state.carried === null) {
    const action = actionAt(cell);
    // Lifting nothing is not a carry: it would leave the cursor "holding" an empty
    // cell, and the next press would silently blank whatever it landed on.
    if (action === null) return nothing;
    return { state: { ...state, carried: action, from: cell }, swap: null, place: null };
  }
  const dropped = { ...state, carried: null, from: null };
  const from = state.from;
  // Carried in from off the bar: write it, overwriting whatever was there. There
  // is no origin cell to send the displaced action back to.
  if (from === null) {
    return { state: dropped, swap: null, place: { cell, action: state.carried } };
  }
  return { state: dropped, swap: { from, to: cell }, place: null };
}

/** Clearing a cell. While carrying, this cancels the carry instead: the player is
 *  much more likely to mean "put it back" than "delete two things at once". */
export function clearCell(
  state: CrossHotbarEditState,
  cell: CrossHotbarCellRef,
): {
  state: CrossHotbarEditState;
  restore: { cell: CrossHotbarCellRef; action: CrossHotbarAction } | null;
  clear: CrossHotbarCellRef | null;
} {
  if (!state.active) return { state, restore: null, clear: null };
  if (state.carried !== null) {
    // Nothing to restore for something carried in from off the bar: it was never
    // taken out of a cell, so cancelling just puts it down.
    const restore = state.from !== null ? { cell: state.from, action: state.carried } : null;
    return { state: { ...state, carried: null, from: null }, restore, clear: null };
  }
  if (!isValidCell(cell)) return { state, restore: null, clear: null };
  return { state, restore: null, clear: cell };
}
