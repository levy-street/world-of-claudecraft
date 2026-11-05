// @vitest-environment happy-dom
// The full-screen Settings view, driven for real through the options window
// (issue #1653): the Esc menu's Settings row opens it, a persistent rail makes
// every category one press from any other, Back returns to the Esc menu, close
// still returns to the game, and the platform gates hold (Key Bindings never on
// touch). DOM relationships are the whole claim, so nothing here is a source pin.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/app_viewport', () => ({ syncAppViewport: vi.fn() }));
vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));
vi.mock('../src/game/music', () => ({
  music: { pauseForMenu: vi.fn(), resumeFromMenu: vi.fn(), enabled: true, setEnabled: vi.fn() },
}));
vi.mock('../src/ui/app_version', () => ({
  appVersionInfo: () => ({ version: 'test', build: 'test' }),
}));

import { normalizeGraphicsSettingsSnapshot } from '../src/game/graphics_rebuild_core';
import { setInterfaceMode } from '../src/game/mobile_controls';
import { t } from '../src/ui/i18n';
import {
  FULLSCREEN_WINDOW_CLASS,
  SETTINGS_VIEW_CLASS,
} from '../src/ui/options_settings_rail_controller';
import { OptionsWindow } from '../src/ui/options_window';
import { defaultPerfOverlayConfig } from '../src/ui/perf_overlay_config';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';

const BOOL_SETTING_KEYS = new Set(['waterRipples', 'forceHighPerfGpu']);

function optionsDeps(captureKey = vi.fn()) {
  const values: Record<string, number | boolean> = {};
  return {
    settings: {
      get: (key: string) => values[key] ?? (BOOL_SETTING_KEYS.has(key) ? false : 0),
      set: vi.fn((key: string, value: number | boolean) => {
        values[key] = value;
        return value;
      }),
      reset: vi.fn(),
    },
    onSettingChange: vi.fn(),
    graphicsApplied: () => normalizeGraphicsSettingsSnapshot({}),
    applyGraphics: () => Promise.resolve('applied'),
    perfOverlay: {
      get: () => defaultPerfOverlayConfig(),
      patch: vi.fn(),
      setMetric: vi.fn(),
      reset: vi.fn(),
      resetPosition: vi.fn(),
      setPlacement: vi.fn(),
    },
    gamepad: {
      kind: () => 'xbox',
      entries: () => [],
      bind: vi.fn(),
      reset: vi.fn(),
      resetCrossHotbar: vi.fn(),
    },
    captureKey,
    logout: vi.fn(),
    changeLanguage: () => Promise.resolve(true),
    refreshWocBalance: vi.fn(),
    theme: {
      get: () => ({ preset: 'classic', custom: {} }),
      setPreset: vi.fn(),
      setCustom: vi.fn(),
      resetCustom: vi.fn(),
    },
  };
}

function openWindow(root: HTMLElement, overrides: Record<string, unknown> = {}) {
  const restoreFocus = vi.fn();
  const window = new OptionsWindow({
    root: () => root,
    world: () => ({}) as never,
    keybinds: () =>
      ({ labelAt: () => '', snapshot: () => ({}), convertedLayout: () => null }) as never,
    refreshKeybindLabels: vi.fn(),
    beginActionBarKeybindMode: vi.fn(),
    slotActionName: () => null,
    options: () => optionsDeps() as never,
    bugReport: () => null,
    hideTooltip: vi.fn(),
    captureFocus: () => null,
    restoreFocus,
    focusFirstInteractive: vi.fn(),
    closeOthers: vi.fn(),
    resetUnitFrames: vi.fn(),
    buildDropdown: () => document.createElement('div'),
    setDropdownValue: vi.fn(),
    isInterfaceUnlocked: () => false,
    toggleInterfaceUnlock: () => false,
    getChatTimestamps: () => false,
    setChatTimestamps: vi.fn(),
    getChatClock: () => '24h',
    setChatClock: vi.fn(),
    resetChatWindow: vi.fn(),
    ...overrides,
  } as never);
  window.toggle();
  return { window, restoreFocus };
}

const press = (root: HTMLElement, selector: string) =>
  root.querySelector<HTMLButtonElement>(selector)?.click();
const openSettings = (root: HTMLElement) => press(root, '.opt-btn[data-menu-action="settings"]');
const rail = (root: HTMLElement) => root.querySelector<HTMLElement>(':scope > .opt-rail');
const railIds = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('.opt-rail-btn')].map((b) => b.dataset.settingsCategory);
const current = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('.opt-rail-btn[aria-current="page"]')?.dataset.settingsCategory;
const title = (root: HTMLElement) => root.querySelector('#options-title')?.textContent;

let root: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  root.id = 'options-menu';
  root.className = 'window panel ui-window';
  document.body.appendChild(root);
});

afterEach(() => {
  setInterfaceMode('auto');
  document.body.className = '';
  document.body.replaceChildren();
});

describe('options window: the full-screen Settings view', () => {
  it('opens from the Esc menu Settings row on Graphics, full screen, with the rail after the head', () => {
    openWindow(root);
    expect(root.classList.contains(SETTINGS_VIEW_CLASS)).toBe(false);
    expect(rail(root)).toBeNull();
    openSettings(root);
    expect(title(root)).toBe(t('hud.options.graphics'));
    expect(root.classList.contains(SETTINGS_VIEW_CLASS)).toBe(true);
    expect(root.classList.contains(FULLSCREEN_WINDOW_CLASS)).toBe(true);
    const nav = rail(root);
    expect(nav?.tagName).toBe('NAV');
    expect(nav?.getAttribute('aria-label')).toBe(t('hudChrome.options.settingsCategories'));
    expect(nav?.previousElementSibling?.classList.contains('ui-win-head')).toBe(true);
    expect(railIds(root)).toEqual([
      'graphics',
      'interface',
      'keybinds',
      'controller',
      'overlays',
      'audio',
      'transfer',
    ]);
    expect(current(root)).toBe('graphics');
    // Entering Settings puts focus on the rail's open category.
    expect(document.activeElement).toBe(
      root.querySelector('.opt-rail-btn[data-settings-category="graphics"]'),
    );
  });

  it('reaches every category from every other with one press, the rail surviving each repaint', () => {
    openWindow(root);
    openSettings(root);
    const ids = railIds(root) as string[];
    for (const from of ids) {
      for (const to of ids) {
        press(root, `.opt-rail-btn[data-settings-category="${from}"]`);
        press(root, `.opt-rail-btn[data-settings-category="${to}"]`);
        expect(current(root), `${from} -> ${to}`).toBe(to);
        expect(rail(root), `${from} -> ${to} keeps one rail`).not.toBeNull();
        expect(root.querySelectorAll('.opt-rail')).toHaveLength(1);
        expect(root.classList.contains(SETTINGS_VIEW_CLASS)).toBe(true);
      }
    }
    // The press leaves focus on the rail, so a keyboard walk keeps its place.
    expect(document.activeElement).toBe(
      root.querySelector(`.opt-rail-btn[data-settings-category="${ids.at(-1)}"]`),
    );
  });

  it('keeps the rail and marks Overlays current inside an Overlays child panel', () => {
    openWindow(root);
    openSettings(root);
    press(root, '.opt-rail-btn[data-settings-category="overlays"]');
    press(root, '.opt-btn[data-menu-action="performance"]');
    expect(root.getAttribute('aria-label')).toBe(t('hudChrome.perf.title'));
    expect(rail(root)).not.toBeNull();
    expect(current(root)).toBe('overlays');
    // The panel's own self-rerender (a control change) keeps the rail seated.
    const before = root.querySelector('.perf-scroll');
    root.querySelector<HTMLButtonElement>('.perf-panel button')?.click();
    expect(root.querySelector('.perf-scroll'), 'the panel rebuilt itself').not.toBe(before);
    expect(root.querySelectorAll(':scope > .opt-rail')).toHaveLength(1);
    // The child's own Back returns to the Overlays list, still inside Settings.
    press(root, '.panel-title .back-btn');
    expect(title(root)).toBe(t('hudChrome.options.overlays'));
    expect(root.classList.contains(SETTINGS_VIEW_CLASS)).toBe(true);
  });

  it('Back returns from a category to the Esc menu, leaving full screen', () => {
    openWindow(root);
    openSettings(root);
    press(root, '.opt-rail-btn[data-settings-category="audio"]');
    press(root, '[data-back]');
    expect(title(root)).toBe(t('hud.options.gameMenu'));
    expect(root.classList.contains(SETTINGS_VIEW_CLASS)).toBe(false);
    expect(root.classList.contains(FULLSCREEN_WINDOW_CLASS)).toBe(false);
    expect(rail(root)).toBeNull();
    // Settings reopens on the category visited last this session.
    openSettings(root);
    expect(current(root)).toBe('audio');
  });

  it('close returns to the game with focus restored to the opener', () => {
    const { restoreFocus } = openWindow(root);
    openSettings(root);
    press(root, '[data-close]');
    expect(root.style.display).toBe('none');
    expect(restoreFocus).toHaveBeenCalledOnce();
  });

  it('a rail press out of Key Bindings disarms a capture in progress', () => {
    const captureKey = vi.fn();
    openWindow(root, { options: () => optionsDeps(captureKey) as never });
    openSettings(root);
    press(root, '.opt-rail-btn[data-settings-category="keybinds"]');
    expect(rail(root)).not.toBeNull();
    const cell = root.querySelector<HTMLButtonElement>(
      '.kb-rows > .kb-row:not(.kb-toggle-row) > button.kb-key',
    );
    expect(cell, 'a key cell to capture on').not.toBeNull();
    cell?.click();
    // The capture flow runs inside the new layout: armed, painted as listening,
    // and the rail still seated after the panel's own repaint.
    expect(captureKey).toHaveBeenCalledWith(expect.any(Function));
    expect(root.querySelector('button.kb-key.capturing')).not.toBeNull();
    expect(rail(root)).not.toBeNull();
    captureKey.mockClear();
    press(root, '.opt-rail-btn[data-settings-category="audio"]');
    expect(captureKey).toHaveBeenLastCalledWith(null);
    expect(current(root)).toBe('audio');
  });

  it('never offers Key Bindings on the touch layout or the native shell', () => {
    const arms: Array<() => void> = [
      () => setInterfaceMode('touch'),
      () => document.body.classList.add('native-app'),
    ];
    for (const arm of arms) {
      setInterfaceMode('auto');
      document.body.classList.remove('native-app');
      root.replaceChildren();
      arm();
      openWindow(root);
      openSettings(root);
      expect(railIds(root)).not.toContain('keybinds');
      expect(railIds(root)).toContain('controller');
      expect(current(root)).toBe('graphics');
    }
  });

  it('stands the title-bar drag down while full screen', () => {
    openWindow(root);
    const head = () => root.querySelector<HTMLElement>('.ui-win-title') as HTMLElement;
    expect(isWindowDragHandle(head(), root)).toBe(true);
    openSettings(root);
    expect(isWindowDragHandle(head(), root)).toBe(false);
  });
});
