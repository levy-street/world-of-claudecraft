// Select-mode moving of the built-in gameplay objects a map can move (farm
// beds, practice dummies, gather nodes, dungeon doors): the selection, the
// drag, the arrow-key nudge volley, Reset, and one undo step per gesture.
// DOM-free; app.ts composes it over the document and the 3D viewport, and
// object_move_panel.ts paints the inspector half.
//
// Every write goes through the pure record edit (object_moves_core.ts
// withObjectMovedTo), which always returns a fresh frozen record, so the sim
// resolvers (sim/moved_objects.ts) never read a stale memo.

import type { ObjectMove, ObjectMoves } from '../sim/moved_objects';
import { movableObjectByKey, objectPosition, withObjectMovedTo } from './object_moves_core';

export interface ObjectMoveUndoEntry {
  label: string;
  undo(): void;
  redo(): void;
}

export interface ObjectMoveDeps {
  /** The document's current record (MapDoc.objectMoves). */
  getMoves(): ObjectMoves | undefined;
  /** Store a new record on the document AND the live active world. */
  setMoves(next: ObjectMoves | undefined): void;
  /** Move the object's live representation between two records, and keep
   *  the selection ring where the object is (the viewport's half). */
  moveLive(key: string, before: ObjectMoves | undefined, after: ObjectMoves | undefined): void;
  /** Ring the selected object (null clears it). */
  showSelection(key: string | null): void;
  pushUndo(entry: ObjectMoveUndoEntry): void;
  /** A committed change: mark the document dirty, rebuild the static
   *  colliders the moved object carries, refresh the inspector. */
  committed(): void;
}

export class ObjectMoveController {
  private selected: string | null = null;
  /** The record before the open gesture (a drag or a nudge volley). */
  private base: { key: string; before: ObjectMoves | undefined } | null = null;

  constructor(private readonly deps: ObjectMoveDeps) {}

  /** The selected object's key, or null. */
  get selectedKey(): string | null {
    return this.selected;
  }

  /** Select one object (or none). Any open gesture commits first. */
  select(key: string | null): void {
    const next = key && movableObjectByKey(key) ? key : null;
    if (next === this.selected) return;
    this.commitPending();
    this.selected = next;
    this.deps.showSelection(next);
  }

  /** A press-drag claimed an object: select it and open the gesture. */
  beginDrag(key: string): boolean {
    if (!movableObjectByKey(key)) return false;
    this.select(key);
    this.base = { key, before: this.deps.getMoves() };
    return true;
  }

  /** One drag sample: the object follows the ground point under the cursor. */
  dragMove(to: ObjectMove): void {
    if (!this.base) return;
    this.apply(this.base.key, to);
  }

  endDrag(): void {
    this.commitPending();
  }

  /** Arrow-key nudge of the selected object; consecutive presses fold into
   *  one undo step through commitPending (the app's debounce). */
  nudge(dx: number, dz: number): boolean {
    const key = this.selected;
    const object = key ? movableObjectByKey(key) : undefined;
    if (!key || !object) return false;
    if (!this.base) this.base = { key, before: this.deps.getMoves() };
    const at = objectPosition(this.deps.getMoves(), object);
    this.apply(key, { x: at.x + dx, z: at.z + dz });
    return true;
  }

  /** Put the selected object back on its built-in spot (one undo step). */
  resetSelected(): void {
    const key = this.selected;
    const object = key ? movableObjectByKey(key) : undefined;
    if (!key || !object) return;
    this.commitPending();
    this.base = { key, before: this.deps.getMoves() };
    this.apply(key, object.builtin);
    this.commitPending();
  }

  /** Close the open gesture as ONE undo step (a no-op when nothing moved). */
  commitPending(): void {
    const base = this.base;
    this.base = null;
    if (!base) return;
    const before = base.before;
    const after = this.deps.getMoves();
    if (before === after) return;
    const restore = (from: ObjectMoves | undefined, to: ObjectMoves | undefined): void => {
      this.deps.setMoves(to);
      this.deps.moveLive(base.key, from, to);
      this.deps.committed();
    };
    this.deps.pushUndo({
      label: 'move-object',
      undo: () => restore(this.deps.getMoves(), before),
      redo: () => restore(this.deps.getMoves(), after),
    });
    this.deps.committed();
  }

  private apply(key: string, to: ObjectMove): void {
    const before = this.deps.getMoves();
    const after = withObjectMovedTo(before, key, to);
    if (after === before) return;
    this.deps.setMoves(after);
    this.deps.moveLive(key, before, after);
  }
}
