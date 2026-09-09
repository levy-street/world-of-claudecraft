// The one are-you-sure prompt every rebind surface raises before a key is
// taken from another action: the Key Bindings rows, the keyboard overview's
// keys and the on-bar action bar mode. A key lives on one action at a time, so
// accepting UNBINDS the other one; the prompt names both. Pure: returns label
// keys plus their {token} values and the caller localizes, so the three
// surfaces can never drift in wording or in which key cancels. Registered in
// tests/architecture.test.ts UI_PURE_CORES.

import type { TranslationKey } from './i18n';

export interface KeybindConflictPrompt {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  acceptKey: TranslationKey;
  cancelKey: TranslationKey;
  params: { key: string; other: string; action: string };
}

/**
 * The prompt for binding `key` (its label) to `action` when `other` is the
 * name of the action that would lose it, or null when the key is free (no
 * prompt: the bind can commit silently). Replacing the action's own previous
 * key is never a reason to ask.
 */
export function keybindConflictPrompt(input: {
  key: string;
  other: string | null;
  action: string;
}): KeybindConflictPrompt | null {
  if (input.other === null) return null;
  return {
    titleKey: 'hudChrome.actionBar.conflictTitle',
    bodyKey: 'hudChrome.actionBar.conflictBody',
    acceptKey: 'hudChrome.actionBar.conflictAccept',
    cancelKey: 'hudChrome.actionBar.cancel',
    params: { key: input.key, other: input.other, action: input.action },
  };
}
