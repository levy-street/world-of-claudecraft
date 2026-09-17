// @vitest-environment happy-dom
// The window shell in the options family (maintainer finding, W25): a settings
// page that carries an action or confirm row must keep that row VISIBLE, not
// hidden behind the scroll. The shell is head, optional tab strip, ONE scrolling
// body (.ui-win-body) and a pinned foot (.ui-win-foot) that is a SIBLING of the
// scroller, never a descendant of it, so no amount of content can push Apply,
// Reset or Back out of reach.
//
// Driven for real (happy-dom) rather than pinned as source text: the whole claim
// is a DOM relationship, and a source pin would keep passing if a future edit
// appended the footer into the body again.

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
import { OptionsWindow } from '../src/ui/options_window';

const BOOL_SETTING_KEYS = new Set(['waterRipples', 'forceHighPerfGpu']);

function settingsStore() {
  const values: Record<string, number | boolean> = {};
  return {
    get: (key: string) => values[key] ?? (BOOL_SETTING_KEYS.has(key) ? false : 0),
    set: vi.fn((key: string, value: number | boolean) => {
      values[key] = value;
      return value;
    }),
    reset: vi.fn(),
  };
}

function optionsDeps() {
  return {
    settings: settingsStore(),
    onSettingChange: vi.fn(),
    graphicsApplied: () => normalizeGraphicsSettingsSnapshot({}),
    applyGraphics: () => Promise.resolve('applied'),
    perfOverlay: { setPlacement: vi.fn() },
    gamepad: {
      kind: () => 'xbox',
      entries: () => [],
      bind: vi.fn(),
      reset: vi.fn(),
      resetCrossHotbar: vi.fn(),
    },
    captureKey: vi.fn(),
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

/** Open the window on `root`; `overrides` replace individual deps for one test. */
function openWindow(root: HTMLElement, overrides: Record<string, unknown> = {}): OptionsWindow {
  const window = new OptionsWindow({
    root: () => root,
    world: () => ({}) as never,
    keybinds: () => ({ labelAt: () => '', snapshot: () => ({}) }) as never,
    refreshKeybindLabels: vi.fn(),
    beginActionBarKeybindMode: vi.fn(),
    slotActionName: () => null,
    options: () => optionsDeps() as never,
    bugReport: () => null,
    hideTooltip: vi.fn(),
    captureFocus: () => null,
    restoreFocus: vi.fn(),
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
  return window;
}

// By the row's data-menu-action hook, never by index: the main menu's order
// shifts by host (the Unlock Interface row leads on desktop only).
function goTo(root: HTMLElement, view: string): void {
  root.querySelector<HTMLButtonElement>(`.opt-btn[data-menu-action="${view}"]`)?.click();
}

const body = (root: HTMLElement) => root.querySelector<HTMLElement>(':scope > .ui-win-body');
const foot = (root: HTMLElement) => root.querySelector<HTMLElement>(':scope > .ui-win-foot');

let root: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  root.className = 'window panel ui-window';
  document.body.appendChild(root);
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('options window: the shell', () => {
  it('opens as a flex column so the shell rules take effect', () => {
    // library.css cannot declare the display itself: a `.window` is shown by an
    // inline style.display no stylesheet rule can outrank.
    openWindow(root);
    expect(root.style.display).toBe('flex');
  });

  it('gives every sub-view exactly ONE scrolling body, a direct child of the window', () => {
    for (const view of ['graphics', 'interface', 'audio', 'keybinds', 'controller', 'transfer']) {
      document.body.replaceChildren();
      root = document.createElement('div');
      root.className = 'window panel ui-window';
      document.body.appendChild(root);
      openWindow(root);
      goTo(root, view);
      expect(root.querySelectorAll('.ui-win-body').length, `${view} scroller count`).toBe(1);
      expect(body(root), `${view} scroller is a direct child`).not.toBeNull();
    }
  });

  it('keeps the Graphics Apply / Reset row a SIBLING of the scroller, never inside it', () => {
    // The maintainer's example: Graphics has a long two-column dial list, and its
    // action row used to be the last thing in the scrolled content.
    openWindow(root);
    goTo(root, 'graphics');
    const scroller = body(root);
    const footer = root.querySelector<HTMLElement>('.gfx-footer');
    expect(scroller).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(footer?.classList.contains('ui-win-foot')).toBe(true);
    expect(scroller?.contains(footer as Node)).toBe(false);
    expect(footer?.parentElement).toBe(root);
    // Apply itself is in that pinned row, not adrift in the dial list.
    const apply = root.querySelector<HTMLElement>('[data-graphics-apply]');
    expect(footer?.contains(apply as Node)).toBe(true);
    expect(scroller?.contains(apply as Node)).toBe(false);
    // The dials DO scroll: they are the body's content.
    expect(scroller?.querySelector('.gfx-cols')).not.toBeNull();
  });

  it('pins the Reset / Back row of every settings page that has one', () => {
    for (const view of ['interface', 'audio', 'keybinds', 'controller', 'transfer']) {
      document.body.replaceChildren();
      root = document.createElement('div');
      root.className = 'window panel ui-window';
      document.body.appendChild(root);
      openWindow(root);
      goTo(root, view);
      const pinned = foot(root);
      expect(pinned, `${view} has a pinned foot`).not.toBeNull();
      expect(body(root)?.contains(pinned as Node), `${view} foot is not in the scroller`).toBe(
        false,
      );
    }
  });

  it('puts the Interface tab strip between the head and the body, not inside either', () => {
    // Finding 2's representative page: head, tab strip, scrolling body, pinned
    // foot, all four on the same gutter, and the strip is its own flex-none row.
    openWindow(root);
    goTo(root, 'interface');
    const children = [...root.children];
    const head = root.querySelector('.ui-win-head');
    const strip = root.querySelector('.opt-tabs');
    const scroller = body(root);
    expect(strip?.parentElement).toBe(root);
    expect(children.indexOf(head as Element)).toBeLessThan(children.indexOf(strip as Element));
    expect(children.indexOf(strip as Element)).toBeLessThan(children.indexOf(scroller as Element));
    // The tabpanel the strip controls IS the scroller.
    expect(scroller?.id).toBe('interface-tabpanel');
  });
});

// The root view's button list moved to options_main_menu.ts; this pins the
// WIRING the window still owns: the touch gate it computes for the Unlock
// Interface row, the frame-editing seam that row presses, and the routing arms
// no other suite drives (goto is the goTo helper above; unstuck and wiki have
// their own suites).
describe('options window: the main menu', () => {
  afterEach(() => {
    setInterfaceMode('auto');
  });

  it('leads with Unlock Interface on desktop and presses it through the seam', () => {
    let unlocked = false;
    const toggleInterfaceUnlock = vi.fn(() => {
      unlocked = !unlocked;
      return unlocked;
    });
    openWindow(root, { isInterfaceUnlocked: () => unlocked, toggleInterfaceUnlock });
    const first = root.querySelector<HTMLButtonElement>('.opt-list .opt-btn');
    expect(first?.dataset.menuAction).toBe('interfaceUnlock');
    expect(first?.textContent).toBe(t('hudChrome.interfaceUnlock.unlock'));
    first?.click();
    expect(toggleInterfaceUnlock).toHaveBeenCalledOnce();
    expect(first?.textContent).toBe(t('hudChrome.interfaceUnlock.lock'));
    expect(first?.classList.contains('ui-btn--on')).toBe(true);
    // The menu stays open, the Frames tab's contract: the floating Lock
    // Interface control is the mode's own exit.
    expect(root.style.display).toBe('flex');
  });

  it('reopens already relabelled Lock Interface while the frames are loose', () => {
    openWindow(root, { isInterfaceUnlocked: () => true });
    const first = root.querySelector<HTMLButtonElement>('.opt-list .opt-btn');
    expect(first?.dataset.menuAction).toBe('interfaceUnlock');
    expect(first?.textContent).toBe(t('hudChrome.interfaceUnlock.lock'));
    expect(first?.classList.contains('ui-btn--on')).toBe(true);
  });

  it('omits the row wherever the touch HUD is active, where Key Bindings leads again', () => {
    // The same gate as the Frames tab's row, read live at paint, and the same
    // union that raises the touch HUD (which is what Hud.toggleInterfaceUnlock
    // refuses on): the player-chosen Touch interface mode, or the packaged
    // native shell, which forces the touch HUD whatever the mode says.
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
      expect(root.querySelector('.opt-btn[data-menu-action="interfaceUnlock"]')).toBeNull();
      const first = root.querySelector<HTMLButtonElement>('.opt-list .opt-btn');
      expect(first?.dataset.menuAction).toBe('keybinds');
    }
    document.body.classList.remove('native-app');
  });

  it('routes Logout to the options seam and Return to Game to close', () => {
    const logout = vi.fn();
    openWindow(root, { options: () => ({ ...optionsDeps(), logout }) as never });
    root.querySelector<HTMLButtonElement>('.opt-btn[data-menu-action="logout"]')?.click();
    expect(logout).toHaveBeenCalledOnce();
    expect(root.style.display, 'logout is the seam’s to confirm, the menu stays').toBe('flex');
    root.querySelector<HTMLButtonElement>('.opt-btn[data-menu-action="close"]')?.click();
    expect(root.style.display).toBe('none');
  });
});
