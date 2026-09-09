// The one keybind conflict prompt (src/ui/keybind_conflict_prompt_core.ts) the
// Key Bindings rows, the keyboard overview and the on-bar mode all raise: a
// free key never asks; a key another action holds names both actions, and the
// same four label keys every time so the surfaces cannot drift.
import { describe, expect, it } from 'vitest';
import { keybindConflictPrompt } from '../src/ui/keybind_conflict_prompt_core';

describe('keybindConflictPrompt', () => {
  it('is null for a free key', () => {
    expect(keybindConflictPrompt({ key: 'R', other: null, action: 'Jump' })).toBeNull();
  });

  it('names the loser and the gainer under the fixed label keys', () => {
    expect(keybindConflictPrompt({ key: 'R', other: 'Toggle Autorun', action: 'Jump' })).toEqual({
      titleKey: 'hudChrome.actionBar.conflictTitle',
      bodyKey: 'hudChrome.actionBar.conflictBody',
      acceptKey: 'hudChrome.actionBar.conflictAccept',
      cancelKey: 'hudChrome.actionBar.cancel',
      params: { key: 'R', other: 'Toggle Autorun', action: 'Jump' },
    });
  });
});
