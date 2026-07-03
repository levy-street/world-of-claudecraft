import { describe, expect, it } from 'vitest';
import { EditGeneration, shouldAutosave } from '../src/editor/save_lifecycle_core';

describe('EditGeneration (save race guard)', () => {
  it('a clean save clears dirty and the draft', () => {
    const gen = new EditGeneration();
    gen.bump(); // some edit happened
    const snapshot = gen.current;
    // ...network round-trip with no further edits...
    expect(gen.finalize(snapshot)).toEqual({ clearDirty: true, clearDraft: true });
  });

  it('REGRESSION: edits during the awaited save keep dirty and the draft', () => {
    // Audit A: save() snapshotted the doc, awaited the network, then
    // finishSave unconditionally set dirty=false and cleared the draft, so a
    // mid-save edit was silently marked saved and its backup destroyed.
    const gen = new EditGeneration();
    gen.bump();
    const snapshot = gen.current; // save starts here
    gen.bump(); // user keeps editing while the request is in flight
    const fin = gen.finalize(snapshot);
    expect(fin.clearDirty).toBe(false);
    expect(fin.clearDraft).toBe(false);
  });

  it('the next save (with a fresh snapshot) clears again', () => {
    const gen = new EditGeneration();
    gen.bump();
    const stale = gen.current;
    gen.bump();
    expect(gen.finalize(stale).clearDirty).toBe(false);
    const fresh = gen.current;
    expect(gen.finalize(fresh)).toEqual({ clearDirty: true, clearDraft: true });
  });

  it('bump changes current monotonically', () => {
    const gen = new EditGeneration();
    const a = gen.current;
    gen.bump();
    const b = gen.current;
    gen.bump();
    expect(b).toBeGreaterThan(a);
    expect(gen.current).toBeGreaterThan(b);
  });
});

describe('shouldAutosave', () => {
  const base = { enabled: true, dirty: true, saving: false, editing: false };

  it('fires only when enabled, dirty, idle, and no gesture is mid-flight', () => {
    expect(shouldAutosave(base)).toBe(true);
  });

  it('never fires while disabled (the default)', () => {
    expect(shouldAutosave({ ...base, enabled: false })).toBe(false);
  });

  it('never fires with nothing to save', () => {
    expect(shouldAutosave({ ...base, dirty: false })).toBe(false);
  });

  it('never races an in-flight save', () => {
    expect(shouldAutosave({ ...base, saving: true })).toBe(false);
  });

  it('never serializes mid-gesture (stroke or placement drag)', () => {
    expect(shouldAutosave({ ...base, editing: true })).toBe(false);
  });
});
