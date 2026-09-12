// Pure core (tests/architecture.test.ts UI_PURE_CORES; it imports only the
// i18n surface) behind the Key Bindings
// panel's input-device notes: which "this device binds too" notes the panel
// shows under the key list, and which note explains a capture that bind()
// refused. options_window.ts is the thin painter.

import type { TranslationKey } from './i18n';

/** Mirrors keybinds.ts BindRefusalReason (a pure core imports nothing from game/). */
export type KeybindRefusalReason = 'reserved' | 'wheelHeld';

/**
 * The device notes to paint under the Key Bindings header, in order. Both are
 * pointless on touch, which has neither mouse buttons nor a wheel, so a touch
 * interface gets none (the same gate the desktop-only rows use).
 */
export function keybindDeviceNoteKeys(touch: boolean): TranslationKey[] {
  if (touch) return [];
  return ['hudChrome.keybinds.mouseHint', 'hudChrome.keybinds.wheelHint'];
}

export interface KeybindRefusalNote {
  key: TranslationKey;
  params?: Record<string, string>;
}

/**
 * The note the panel shows for a capture bind() refused (keybinds.ts
 * bindRefusalReason): a reserved code, named by its keycap label, or a wheel
 * notch on a held action, which has no release to end it. Null when nothing was
 * refused.
 */
export function keybindRefusalNote(
  reason: KeybindRefusalReason | null,
  keyLabel: string,
): KeybindRefusalNote | null {
  if (reason === 'reserved')
    return { key: 'hud.options.keybindReserved', params: { key: keyLabel } };
  if (reason === 'wheelHeld') return { key: 'hudChrome.keybinds.wheelHeldRefused' };
  return null;
}
