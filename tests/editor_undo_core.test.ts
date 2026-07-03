import { describe, expect, it } from 'vitest';
import { UNDO_STACK_CAP, UndoStack } from '../src/editor/undo_core';

// The editor's do/undo command stack: LIFO order, redo-branch clearing on a new
// push, and the hard cap that drops the oldest entries.

function counterCmd(state: { value: number }, delta: number, label = 'step') {
  return {
    label,
    undo: () => {
      state.value -= delta;
    },
    redo: () => {
      state.value += delta;
    },
  };
}

describe('editor undo stack', () => {
  it('starts empty and refuses undo/redo', () => {
    const stack = new UndoStack();
    expect(stack.depth).toBe(0);
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
    expect(stack.undo()).toBeNull();
    expect(stack.redo()).toBeNull();
  });

  it('undoes and redoes in LIFO order', () => {
    const state = { value: 0 };
    const stack = new UndoStack();
    // The caller applies the edit itself before pushing.
    state.value += 1;
    stack.push(counterCmd(state, 1, 'a'));
    state.value += 10;
    stack.push(counterCmd(state, 10, 'b'));
    expect(state.value).toBe(11);

    expect(stack.undo()?.label).toBe('b');
    expect(state.value).toBe(1);
    expect(stack.undo()?.label).toBe('a');
    expect(state.value).toBe(0);
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(true);

    expect(stack.redo()?.label).toBe('a');
    expect(stack.redo()?.label).toBe('b');
    expect(state.value).toBe(11);
    expect(stack.canRedo).toBe(false);
  });

  it('clears the redo branch when a new command is pushed after an undo', () => {
    const state = { value: 0 };
    const stack = new UndoStack();
    state.value += 1;
    stack.push(counterCmd(state, 1));
    state.value += 2;
    stack.push(counterCmd(state, 2));
    stack.undo(); // value 1, redo branch holds the +2
    state.value += 5;
    stack.push(counterCmd(state, 5));
    expect(stack.canRedo).toBe(false);
    expect(stack.redoDepth).toBe(0);
    expect(state.value).toBe(6);
    stack.undo();
    stack.undo();
    expect(state.value).toBe(0);
  });

  it('caps the stack at 200 entries, dropping the oldest', () => {
    const state = { value: 0 };
    const stack = new UndoStack();
    for (let i = 0; i < UNDO_STACK_CAP + 25; i++) {
      state.value += 1;
      stack.push(counterCmd(state, 1, `cmd-${i}`));
    }
    expect(stack.depth).toBe(UNDO_STACK_CAP);
    let undone = 0;
    while (stack.undo()) undone++;
    expect(undone).toBe(UNDO_STACK_CAP);
    // The 25 dropped commands can no longer be undone: their effect persists.
    expect(state.value).toBe(25);
  });

  it('supports a custom cap and clear()', () => {
    const stack = new UndoStack(3);
    const state = { value: 0 };
    for (let i = 0; i < 5; i++) stack.push(counterCmd(state, 1));
    expect(stack.depth).toBe(3);
    stack.clear();
    expect(stack.depth).toBe(0);
    expect(stack.canUndo).toBe(false);
  });
});
