// The Settings view's rail model (issue #1653): which categories the rail
// lists per host, which category a sub-view belongs to, and where the Esc
// menu's Settings row lands. Pure, so every platform gate is pinned here
// without a DOM.

import { describe, expect, it } from 'vitest';
import {
  buildSettingsRail,
  SETTINGS_CATEGORY_IDS,
  settingsCategoryAvailable,
  settingsCategoryOf,
  settingsEntryCategory,
} from '../src/ui/options_settings_view';

const DESKTOP = { touch: false };
const TOUCH = { touch: true };

describe('options_settings_view: the category rail', () => {
  it('lists every category on desktop, in rail order, with its label key', () => {
    expect(buildSettingsRail('graphics', DESKTOP)).toEqual([
      { id: 'graphics', labelKey: 'hud.options.graphics', current: true },
      { id: 'interface', labelKey: 'hud.options.interface', current: false },
      { id: 'keybinds', labelKey: 'hud.options.keyBindings', current: false },
      { id: 'controller', labelKey: 'hudChrome.controller.title', current: false },
      { id: 'overlays', labelKey: 'hudChrome.options.overlays', current: false },
      { id: 'audio', labelKey: 'hud.options.audio', current: false },
      { id: 'transfer', labelKey: 'hudChrome.fullTransfer.menu', current: false },
    ]);
  });

  it('never lists Key Bindings on touch; every other category stays', () => {
    const touch = buildSettingsRail('graphics', TOUCH).map((e) => e.id);
    expect(touch).not.toContain('keybinds');
    expect(touch).toEqual(SETTINGS_CATEGORY_IDS.filter((id) => id !== 'keybinds'));
    expect(settingsCategoryAvailable('keybinds', TOUCH)).toBe(false);
    expect(settingsCategoryAvailable('keybinds', DESKTOP)).toBe(true);
    for (const id of SETTINGS_CATEGORY_IDS.filter((c) => c !== 'keybinds')) {
      expect(settingsCategoryAvailable(id, TOUCH)).toBe(true);
    }
  });

  it('marks exactly the open category current, an Overlays child marking Overlays', () => {
    for (const view of ['auras', 'cooldowns', 'performance'] as const) {
      const rail = buildSettingsRail(view, DESKTOP);
      expect(rail.filter((e) => e.current).map((e) => e.id)).toEqual(['overlays']);
    }
    const audio = buildSettingsRail('audio', DESKTOP);
    expect(audio.filter((e) => e.current).map((e) => e.id)).toEqual(['audio']);
  });

  it('places every sub-view: categories map to themselves, the rest lie outside Settings', () => {
    for (const id of SETTINGS_CATEGORY_IDS) expect(settingsCategoryOf(id)).toBe(id);
    expect(settingsCategoryOf('auras')).toBe('overlays');
    expect(settingsCategoryOf('cooldowns')).toBe('overlays');
    expect(settingsCategoryOf('performance')).toBe('overlays');
    expect(settingsCategoryOf('main')).toBeNull();
    expect(settingsCategoryOf('bugreport')).toBeNull();
    expect(buildSettingsRail('main', DESKTOP).some((e) => e.current)).toBe(false);
  });

  it('lands the Settings row on the last category when it still applies, else the first', () => {
    expect(settingsEntryCategory(null, DESKTOP)).toBe('graphics');
    expect(settingsEntryCategory(null, TOUCH)).toBe('graphics');
    expect(settingsEntryCategory('audio', DESKTOP)).toBe('audio');
    expect(settingsEntryCategory('keybinds', DESKTOP)).toBe('keybinds');
    // A player who switched to the touch layout since never lands on Key Bindings.
    expect(settingsEntryCategory('keybinds', TOUCH)).toBe('graphics');
  });
});
