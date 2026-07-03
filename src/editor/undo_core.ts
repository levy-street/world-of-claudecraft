// Undo/redo command stack for the map editor. Pure and DOM-free: commands are
// do/undo closures over the document plus view-refresh calls the app supplies.
// The stack is capped (oldest entries drop off) so a long session cannot grow
// without bound. Vitest drives this directly (tests/editor_undo_core.test.ts).

export interface EditorCommand {
  /** Stable machine label (for debugging / tests); never rendered raw. */
  label: string;
  undo(): void;
  redo(): void;
}

export const UNDO_STACK_CAP = 200;

export class UndoStack {
  private readonly done: EditorCommand[] = [];
  private readonly undone: EditorCommand[] = [];

  constructor(private readonly cap: number = UNDO_STACK_CAP) {}

  /**
   * Record an already-applied command (the caller performs the initial edit
   * itself; `redo` must reproduce it). Clears the redo branch, like every
   * editor's undo model.
   */
  push(cmd: EditorCommand): void {
    this.done.push(cmd);
    this.undone.length = 0;
    const over = this.done.length - this.cap;
    if (over > 0) this.done.splice(0, over);
  }

  undo(): EditorCommand | null {
    const cmd = this.done.pop();
    if (!cmd) return null;
    cmd.undo();
    this.undone.push(cmd);
    return cmd;
  }

  redo(): EditorCommand | null {
    const cmd = this.undone.pop();
    if (!cmd) return null;
    cmd.redo();
    this.done.push(cmd);
    return cmd;
  }

  get depth(): number {
    return this.done.length;
  }

  get redoDepth(): number {
    return this.undone.length;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
  }
}
