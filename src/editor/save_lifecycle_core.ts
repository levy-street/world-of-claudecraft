// Pure save-lifecycle bookkeeping for the map editor. The app snapshots the
// edit generation when a save starts; edits made while the save is in flight
// bump the generation, so finalizing compares the snapshot against the current
// value and only clears the dirty flag / autosave draft when nothing changed
// mid-save. DOM-free; Vitest drives it directly
// (tests/editor_save_lifecycle.test.ts).

export interface SaveFinalization {
  /** True when no edit landed since the snapshot: safe to mark the doc clean. */
  clearDirty: boolean;
  /** True when the autosave draft no longer protects anything and may be cleared. */
  clearDraft: boolean;
}

export class EditGeneration {
  private gen = 0;

  /** Record one edit (call from markDirty). */
  bump(): void {
    this.gen++;
  }

  /** Snapshot to capture right before a save serializes the document. */
  get current(): number {
    return this.gen;
  }

  /**
   * Decide what a completed save may clear. A save only covers the document as
   * it was at `snapshot`; if edits arrived since, the doc stays dirty and the
   * draft backup stays on disk.
   */
  finalize(snapshot: number): SaveFinalization {
    const unchanged = snapshot === this.gen;
    return { clearDirty: unchanged, clearDraft: unchanged };
  }
}

// ---- autosave gate ----------------------------------------------------------

export interface AutosaveState {
  /** The user's topbar toggle (default off; disabled again on any save error). */
  enabled: boolean;
  /** The document has unsaved edits. */
  dirty: boolean;
  /** A save is already in flight. */
  saving: boolean;
  /** A pointer edit (stroke / placement drag) is mid-gesture. */
  editing: boolean;
}

/**
 * Whether the periodic tick may fire an automatic save. Deliberately strict:
 * autosave must never race a manual save, serialize mid-gesture, or run while
 * there is nothing to save.
 */
export function shouldAutosave(s: AutosaveState): boolean {
  return s.enabled && s.dirty && !s.saving && !s.editing;
}
