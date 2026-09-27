// The Interface & Comfort body-class table (src/game/interface_body_classes.ts):
// main.ts's applySetting dispatcher mirrors each of these settings onto ONE body
// class, so the CSS hooks and the Colorblind Mode renderer hand-off ride one
// consumer instead of a branch per switch.

import { describe, expect, it } from 'vitest';
import {
  applyInterfaceBodyClass,
  INTERFACE_BODY_CLASSES,
  isInterfaceBodyClassSetting,
} from '../src/game/interface_body_classes';
import { Settings } from '../src/game/settings';

describe('interface body classes', () => {
  it('pins the historical class names so saved CSS hooks keep working', () => {
    expect(INTERFACE_BODY_CLASSES).toEqual({
      highContrastText: 'high-contrast-text',
      frostedPanels: 'frosted-panels',
      compactChat: 'compact-chat',
      hideUnusedActionSlots: 'hide-unused-action-slots',
      colorblindMode: 'colorblind-mode',
    });
  });

  it('recognises exactly the table keys, every one a boolean setting', () => {
    const settings = new Settings();
    for (const key of Object.keys(INTERFACE_BODY_CLASSES)) {
      expect(isInterfaceBodyClassSetting(key)).toBe(true);
      expect(typeof settings.get(key as keyof typeof INTERFACE_BODY_CLASSES)).toBe('boolean');
    }
    expect(isInterfaceBodyClassSetting('reduceMotion')).toBe(false);
    expect(isInterfaceBodyClassSetting('hudOpacity')).toBe(false);
    // A prototype name must not read as a setting.
    expect(isInterfaceBodyClassSetting('toString')).toBe(false);
  });

  it('toggles the mapped class on the host with the exact force value', () => {
    const calls: [string, boolean][] = [];
    const body = { classList: { toggle: (c: string, f: boolean) => (calls.push([c, f]), f) } };
    expect(applyInterfaceBodyClass(body, 'colorblindMode', true)).toBe('colorblind-mode');
    expect(applyInterfaceBodyClass(body, 'colorblindMode', false)).toBe('colorblind-mode');
    expect(applyInterfaceBodyClass(body, 'compactChat', true)).toBe('compact-chat');
    expect(calls).toEqual([
      ['colorblind-mode', true],
      ['colorblind-mode', false],
      ['compact-chat', true],
    ]);
  });
});
