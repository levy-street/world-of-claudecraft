import { describe, expect, it } from 'vitest';
import type { CrossHotbarAction } from '../src/game/cross_hotbar';
import {
  type CrossHotbarCellRef,
  clearCell,
  confirmCell,
  IDLE_EDIT_STATE,
  isValidCell,
  pickUpAction,
  toggleEdit,
} from '../src/game/cross_hotbar_edit';

const ability = (id: string): CrossHotbarAction => ({ type: 'ability', id });
const cell = (set: number, position: number): CrossHotbarCellRef => ({ set, position });

/** A bar where cell (0,0) holds 'a' and (0,1) holds 'b'; everything else empty. */
const actionAt = (c: CrossHotbarCellRef): CrossHotbarAction => {
  if (c.set === 0 && c.position === 0) return ability('a');
  if (c.set === 0 && c.position === 1) return ability('b');
  return null;
};

const editing = { active: true, carried: null, from: null };

describe('isValidCell', () => {
  it('accepts a real cell and rejects everything else', () => {
    expect(isValidCell(cell(0, 0))).toBe(true);
    expect(isValidCell(cell(1, 15))).toBe(true);
    expect(isValidCell(cell(-1, 0))).toBe(false);
    expect(isValidCell(cell(9, 0))).toBe(false);
    expect(isValidCell(cell(0, 16))).toBe(false);
    expect(isValidCell(cell(0, 1.5))).toBe(false);
  });
});

describe('toggleEdit', () => {
  it('enters and leaves', () => {
    const on = toggleEdit(IDLE_EDIT_STATE);
    expect(on.state.active).toBe(true);
    expect(toggleEdit(on.state).state.active).toBe(false);
  });

  it('puts a carried action back when leaving mid-move', () => {
    // Exiting while holding something must never lose it.
    const carrying = { active: true, carried: ability('a'), from: cell(0, 0) };
    const off = toggleEdit(carrying);
    expect(off.state).toEqual(IDLE_EDIT_STATE);
    expect(off.restore).toEqual({ cell: cell(0, 0), action: ability('a') });
  });

  it('has nothing to restore when it was not carrying', () => {
    expect(toggleEdit(editing).restore).toBeNull();
  });
});

describe('confirmCell', () => {
  it('lifts the action off the cell', () => {
    const r = confirmCell(editing, cell(0, 0), actionAt);
    expect(r.state.carried).toEqual(ability('a'));
    expect(r.state.from).toEqual(cell(0, 0));
    expect(r.swap).toBeNull();
  });

  it('refuses to lift an empty cell', () => {
    // Otherwise the cursor "carries" nothing and the next press blanks whatever
    // it lands on.
    const r = confirmCell(editing, cell(0, 5), actionAt);
    expect(r.state.carried).toBeNull();
    expect(r.swap).toBeNull();
  });

  it('drops onto another cell as a SWAP', () => {
    // The action already on the target has to go somewhere, and the cell the
    // player just came from is the only place they will think to look.
    const carrying = confirmCell(editing, cell(0, 0), actionAt).state;
    const dropped = confirmCell(carrying, cell(0, 1), actionAt);
    expect(dropped.swap).toEqual({ from: cell(0, 0), to: cell(0, 1) });
    expect(dropped.state.carried).toBeNull();
    expect(dropped.state.from).toBeNull();
  });

  it('drops across sets', () => {
    const carrying = confirmCell(editing, cell(0, 0), actionAt).state;
    const dropped = confirmCell(carrying, cell(1, 3), actionAt);
    expect(dropped.swap).toEqual({ from: cell(0, 0), to: cell(1, 3) });
  });

  it('dropping onto the cell it came from is a no-op swap, not a loss', () => {
    const carrying = confirmCell(editing, cell(0, 0), actionAt).state;
    const dropped = confirmCell(carrying, cell(0, 0), actionAt);
    expect(dropped.swap).toEqual({ from: cell(0, 0), to: cell(0, 0) });
    expect(dropped.state.carried).toBeNull();
  });

  it('does nothing at all while not editing', () => {
    const r = confirmCell(IDLE_EDIT_STATE, cell(0, 0), actionAt);
    expect(r.state).toEqual(IDLE_EDIT_STATE);
    expect(r.swap).toBeNull();
  });

  it('ignores a cell that does not exist', () => {
    expect(confirmCell(editing, cell(9, 0), actionAt).state.carried).toBeNull();
  });
});

describe('clearCell', () => {
  it('clears the cell when not carrying', () => {
    const r = clearCell(editing, cell(0, 0));
    expect(r.clear).toEqual(cell(0, 0));
    expect(r.restore).toBeNull();
  });

  it('cancels the carry instead of clearing, when carrying', () => {
    // "Put it back" is far likelier to be meant than "delete two things at once".
    const carrying = { active: true, carried: ability('a'), from: cell(0, 0) };
    const r = clearCell(carrying, cell(0, 7));
    expect(r.clear).toBeNull();
    expect(r.restore).toEqual({ cell: cell(0, 0), action: ability('a') });
    expect(r.state.carried).toBeNull();
  });

  it('does nothing while not editing', () => {
    expect(clearCell(IDLE_EDIT_STATE, cell(0, 0)).clear).toBeNull();
  });

  it('ignores a cell that does not exist', () => {
    expect(clearCell(editing, cell(0, 99)).clear).toBeNull();
  });
});

describe('pickUpAction', () => {
  it('carries an action that came from off the bar', () => {
    const s = pickUpAction(editing, ability('new'));
    expect(s.carried).toEqual(ability('new'));
    // No origin cell: it was never on the bar, so a drop writes rather than swaps.
    expect(s.from).toBeNull();
  });

  it('refuses to overwrite a carry already in progress', () => {
    const carrying = { active: true, carried: ability('a'), from: cell(0, 0) };
    expect(pickUpAction(carrying, ability('new'))).toBe(carrying);
  });

  it('does nothing while not editing, or with nothing to pick up', () => {
    expect(pickUpAction(IDLE_EDIT_STATE, ability('new'))).toBe(IDLE_EDIT_STATE);
    expect(pickUpAction(editing, null)).toBe(editing);
  });

  it('places onto a cell instead of swapping with it', () => {
    // A swap would send whatever was on the cell back to an origin that does not
    // exist, which is how an action would silently vanish.
    const carrying = pickUpAction(editing, ability('new'));
    const dropped = confirmCell(carrying, cell(0, 1), actionAt);
    expect(dropped.place).toEqual({ cell: cell(0, 1), action: ability('new') });
    expect(dropped.swap).toBeNull();
    expect(dropped.state.carried).toBeNull();
  });

  it('is put down, not put back, when cancelled', () => {
    const carrying = pickUpAction(editing, ability('new'));
    const r = clearCell(carrying, cell(0, 4));
    expect(r.restore).toBeNull();
    expect(r.clear).toBeNull();
    expect(r.state.carried).toBeNull();
  });
});
