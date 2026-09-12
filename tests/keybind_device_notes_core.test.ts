import { describe, expect, it } from 'vitest';
import { keybindDeviceNoteKeys, keybindRefusalNote } from '../src/ui/keybind_device_notes_core';

describe('keybindDeviceNoteKeys', () => {
  it('lists the mouse-button and wheel notes, in that order, on a desktop interface', () => {
    expect(keybindDeviceNoteKeys(false)).toEqual([
      'hudChrome.keybinds.mouseHint',
      'hudChrome.keybinds.wheelHint',
    ]);
  });

  it('shows neither on touch, which has no mouse and no wheel', () => {
    expect(keybindDeviceNoteKeys(true)).toEqual([]);
  });
});

describe('keybindRefusalNote', () => {
  it('names a reserved code with its keycap label', () => {
    expect(keybindRefusalNote('reserved', 'M1')).toEqual({
      key: 'hud.options.keybindReserved',
      params: { key: 'M1' },
    });
  });

  it('explains a wheel notch refused on a held action, with no key to name', () => {
    expect(keybindRefusalNote('wheelHeld', 'Wh↑')).toEqual({
      key: 'hudChrome.keybinds.wheelHeldRefused',
    });
  });

  it('has nothing to say about a code bind() accepted', () => {
    expect(keybindRefusalNote(null, 'P')).toBeNull();
  });
});
