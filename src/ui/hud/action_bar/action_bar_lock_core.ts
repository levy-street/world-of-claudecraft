// Pure manual action-bar edit policy shared by desktop, touch, spellbook, and
// the contextual toggle. Locking never blocks casts or saved loadout restores.

import type { TranslationKey } from '../../i18n.catalog';

export function actionBarEditAllowed(locked: boolean): boolean {
  return !locked;
}

export function actionBarLockMenuAction(locked: boolean): {
  nextLocked: boolean;
  labelKey: TranslationKey;
} {
  return locked
    ? { nextLocked: false, labelKey: 'hudChrome.actionBar.unlock' }
    : { nextLocked: true, labelKey: 'hudChrome.actionBar.lock' };
}
