// Undo/redo. Entries are {label, undo(), redo()} closures, each captures
// whatever context it needs (selection key, matrices, vertex arrays), so the
// stack itself knows nothing about the tools. `merge` lets rapid edits of the
// same control coalesce into one step (nudge keys, slider scrubs).

const MAX = 120;
const undoStack = [];
const redoStack = [];
const listeners = new Set();
let lastPush = { key: null, at: 0 };

function emit() {
  for (const fn of listeners) fn();
}

export const history = {
  /** entry: {label, undo, redo, merge?: string}, merge entries with the same
   *  key within 900ms update the previous entry's redo instead of stacking. */
  push(entry) {
    const now = performance.now();
    const prev = undoStack[undoStack.length - 1];
    if (
      entry.merge &&
      prev?.merge === entry.merge &&
      lastPush.key === entry.merge &&
      now - lastPush.at < 900
    ) {
      prev.redo = entry.redo;
      prev.label = entry.label;
    } else {
      undoStack.push(entry);
      if (undoStack.length > MAX) undoStack.shift();
    }
    lastPush = { key: entry.merge ?? null, at: now };
    redoStack.length = 0;
    emit();
  },
  async undo() {
    const e = undoStack.pop();
    if (!e) return null;
    lastPush = { key: null, at: 0 };
    await e.undo();
    redoStack.push(e);
    emit();
    return e.label;
  },
  async redo() {
    const e = redoStack.pop();
    if (!e) return null;
    lastPush = { key: null, at: 0 };
    await e.redo();
    undoStack.push(e);
    emit();
    return e.label;
  },
  canUndo: () => undoStack.length > 0,
  canRedo: () => redoStack.length > 0,
  peekUndo: () => undoStack[undoStack.length - 1]?.label ?? null,
  peekRedo: () => redoStack[redoStack.length - 1]?.label ?? null,
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  clear() {
    undoStack.length = 0;
    redoStack.length = 0;
    emit();
  },
};
