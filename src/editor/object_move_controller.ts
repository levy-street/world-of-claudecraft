// Select-mode editing of the built-in gameplay objects a map can change (farm
// beds, practice dummies, gather nodes, dungeon doors): the selection, the
// drag, the arrow-key nudge volley, the turn and size sliders, Delete,
// Restore and Reset, with one undo step per gesture. DOM-free; app.ts
// composes it over the document and the 3D viewport, and
// object_move_panel.ts paints the inspector half.
//
// Every write goes through the pure record edit (object_moves_core.ts
// withObjectEdited), which always returns a fresh frozen record, so the sim
// resolvers (sim/moved_objects.ts) never read a stale memo.

import type { ObjectMove, ObjectMoves } from '../sim/moved_objects';
import {
  movableObjectByKey,
  type ObjectEditPatch,
  objectPosition,
  withObjectEdited,
} from './object_moves_core';

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
  /** Re-pose the object's live representation between two records (moved,
   *  turned, resized, hidden or shown), and keep the selection ring where
   *  the object is (the viewport's half). */
  moveLive(key: string, before: ObjectMoves | undefined, after: ObjectMoves | undefined): void;
  /** Ring the selected object (null clears it). */
  showSelection(key: string | null): void;
  pushUndo(entry: ObjectMoveUndoEntry): void;
  /** A committed change: mark the document dirty, rebuild the static
   *  colliders the edited object carries, refresh the inspector. */
  committed(): void;
}

export class ObjectMoveController {
  private selected: string | null = null;
  /** The record before the open gesture (a drag, a nudge volley, a slider). */
  private base: { key: string; before: ObjectMoves | undefined; label: string } | null = null;

  constructor(private readonly deps: ObjectMoveDeps) {}

  /** The selected object's key, or null. */
  get selectedKey(): string | null {
    return this.selected;
  }

  /** Select one object (or none). Any open gesture commits first. A deleted
   *  object cannot be selected: it is restored from the deleted list. */
  select(key: string | null): void {
    const next =
      key && movableObjectByKey(key) && this.deps.getMoves()?.[key]?.removed !== true ? key : null;
    if (next === this.selected) return;
    this.commitPending();
    this.selected = next;
    this.deps.showSelection(next);
  }

  /** A press-drag claimed an object: select it and open the gesture. */
  beginDrag(key: string): boolean {
    if (!movableObjectByKey(key)) return false;
    this.select(key);
    if (this.selected !== key) return false;
    this.open(key, 'move-object');
    return true;
  }

  /** One drag sample: the object follows the ground point under the cursor. */
  dragMove(to: ObjectMove): void {
    if (!this.base) return;
    this.apply(this.base.key, { x: to.x, z: to.z });
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
    this.open(key, 'move-object');
    const at = objectPosition(this.deps.getMoves(), object);
    this.apply(key, { x: at.x + dx, z: at.z + dz });
    return true;
  }

  /** Turn the selected object to `rotY` radians (live while a slider drags;
   *  `commit` closes the gesture as one undo step). */
  turnSelected(rotY: number, commit: boolean): void {
    this.editSelected({ rotY }, 'turn-object', commit);
  }

  /** Resize the selected object (a size multiplier; see turnSelected). */
  resizeSelected(scale: number, commit: boolean): void {
    this.editSelected({ scale }, 'resize-object', commit);
  }

  /** Delete the selected object from this map (one undo step); the
   *  selection clears, since a deleted object is no longer drawn. */
  deleteSelected(): boolean {
    const key = this.selected;
    if (!key) return false;
    this.commitPending();
    this.open(key, 'delete-object');
    this.apply(key, { removed: true });
    // Clear the selection before the commit refreshes the inspector, so it
    // shows the deleted list rather than the gone object's panel.
    this.selected = null;
    this.deps.showSelection(null);
    this.commitPending();
    return true;
  }

  /** Bring a deleted object back where it stood (one undo step). */
  restore(key: string): void {
    if (!movableObjectByKey(key) || this.deps.getMoves()?.[key]?.removed !== true) return;
    this.commitPending();
    this.open(key, 'restore-object');
    this.apply(key, { removed: false });
    this.commitPending();
  }

  /** Put the selected object back exactly as the built-in world has it: its
   *  spot, facing and size (one undo step). */
  resetSelected(): void {
    const key = this.selected;
    const object = key ? movableObjectByKey(key) : undefined;
    if (!key || !object) return;
    this.commitPending();
    this.open(key, 'reset-object');
    this.apply(key, {
      x: object.builtin.x,
      z: object.builtin.z,
      rotY: object.builtinFacing,
      scale: 1,
      removed: false,
    });
    this.commitPending();
  }

  /** Close the open gesture as ONE undo step (a no-op when nothing changed). */
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
      label: base.label,
      undo: () => restore(this.deps.getMoves(), before),
      redo: () => restore(this.deps.getMoves(), after),
    });
    this.deps.committed();
  }

  private editSelected(patch: ObjectEditPatch, label: string, commit: boolean): void {
    const key = this.selected;
    if (!key) return;
    this.open(key, label);
    this.apply(key, patch);
    if (commit) this.commitPending();
  }

  /** Open a gesture on `key` unless one is already open on it (a gesture on
   *  another object, or of another kind, commits first). */
  private open(key: string, label: string): void {
    if (this.base && (this.base.key !== key || this.base.label !== label)) this.commitPending();
    if (!this.base) this.base = { key, before: this.deps.getMoves(), label };
  }

  private apply(key: string, patch: ObjectEditPatch): void {
    const before = this.deps.getMoves();
    const after = withObjectEdited(before, key, patch);
    if (after === before) return;
    this.deps.setMoves(after);
    this.deps.moveLive(key, before, after);
  }
}
