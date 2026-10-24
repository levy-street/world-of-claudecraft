// The GameSettings the Key Bindings panel renders alongside the rebindable keys
// (the settingToggleKeybind + clickMoveMouseButtonRow calls in options_window.ts
// renderKeybinds). Its Reset to Defaults must restore these too, not just the
// key-code map: without this list, a player's custom mouse-camera, cursor-lock,
// raw-input, click-to-move (and its mouse button), attack-move, or
// left-handed-touch choice silently survived a "reset everything" click. (The
// profanity filter is a chat setting: it renders in Interface > Chat, whose own
// footer resets it.) Pinned by tests/options_window.test.ts.

import type { GameSettings } from '../game/settings';

export const KEYBIND_PANEL_SETTING_KEYS: (keyof GameSettings)[] = [
  'mouseCamera',
  'lockCursorOnRotate',
  'rawMouseInput',
  'clickToMove',
  'clickToMoveButton',
  'attackMove',
  'leftHandedTouch',
];
