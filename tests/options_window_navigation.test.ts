// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/app_viewport', () => ({ syncAppViewport: vi.fn() }));
vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));
vi.mock('../src/game/music', () => ({
  music: { pauseForMenu: vi.fn(), resumeFromMenu: vi.fn() },
}));
vi.mock('../src/ui/app_version', () => ({
  appVersionInfo: () => ({ version: 'test', build: 'test' }),
}));

import { OptionsWindow, type OptionsWindowDeps } from '../src/ui/options_window';

interface OptionsWindowTestAccess {
  view: 'interface' | 'controller';
  opened: boolean;
  render(): void;
}

function mountView(view: OptionsWindowTestAccess['view']): {
  root: HTMLElement;
  window: OptionsWindow;
  focusFirstInteractive: ReturnType<typeof vi.fn>;
} {
  const root = document.createElement('section');
  root.style.display = 'block';
  document.body.appendChild(root);
  const focusFirstInteractive = vi.fn();
  const deps = {
    root: () => root,
    world: () => ({}),
    options: () => null,
    bugReport: () => null,
    keybinds: () => ({}),
    slotActionName: () => null,
    refreshKeybindLabels: vi.fn(),
    buildDropdown: () => document.createElement('div'),
    setDropdownValue: vi.fn(),
    focusFirstInteractive,
    closeOthers: vi.fn(),
    hideTooltip: vi.fn(),
    captureFocus: () => null,
    restoreFocus: vi.fn(),
    log: vi.fn(),
    resetChatWindow: vi.fn(),
    resetUnitFrames: vi.fn(),
    getChatTimestamps: () => false,
    setChatTimestamps: vi.fn(),
    getChatClock: () => 'local',
    setChatClock: vi.fn(),
  } as unknown as OptionsWindowDeps;
  const window = new OptionsWindow(deps);
  const access = window as unknown as OptionsWindowTestAccess;
  access.view = view;
  access.opened = true;
  access.render();
  return { root, window, focusFirstInteractive };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('options window interface navigation', () => {
  it('keeps the title-bar Back button wired after switching tabs', () => {
    const { root, focusFirstInteractive } = mountView('interface');

    const initialBack = root.querySelector<HTMLButtonElement>('[data-back]');
    const frames = root.querySelector<HTMLButtonElement>('[data-tab="frames"]');
    if (!initialBack || !frames) throw new Error('Interface navigation controls were not rendered');
    frames.click();
    const rebuiltBack = root.querySelector<HTMLButtonElement>('[data-back]');
    if (!rebuiltBack) throw new Error('Interface Back control was not rebuilt');
    expect(root.querySelector('[data-tab="frames"]')?.getAttribute('aria-selected')).toBe('true');
    expect(rebuiltBack).not.toBe(initialBack);

    rebuiltBack.click();

    expect(root.querySelector('[role="tablist"]')).toBeNull();
    expect(focusFirstInteractive).toHaveBeenCalledWith(root);
  });

  it('keeps the title-bar Back button wired after controller labels refresh', () => {
    const { root, window, focusFirstInteractive } = mountView('controller');

    const initialBack = root.querySelector<HTMLButtonElement>('[data-back]');
    if (!initialBack) throw new Error('Controller Back control was not rendered');
    window.refreshControllerLabels();
    const rebuiltBack = root.querySelector<HTMLButtonElement>('[data-back]');
    if (!rebuiltBack) throw new Error('Controller Back control was not rebuilt');
    expect(rebuiltBack).not.toBe(initialBack);

    rebuiltBack.click();

    expect(root.querySelector('.opt-list')).not.toBeNull();
    expect(focusFirstInteractive).toHaveBeenCalledWith(root);
  });

  it('does not rebuild controller labels while the options window is closed', () => {
    const { root, window } = mountView('controller');
    const initialBack = root.querySelector<HTMLButtonElement>('[data-back]');
    if (!initialBack) throw new Error('Controller Back control was not rendered');
    (window as unknown as OptionsWindowTestAccess).opened = false;

    window.refreshControllerLabels();

    expect(root.querySelector('[data-back]')).toBe(initialBack);
  });

  it('does not rebuild a non-controller view when controller labels refresh', () => {
    const { root, window } = mountView('interface');
    const initialBack = root.querySelector<HTMLButtonElement>('[data-back]');
    if (!initialBack) throw new Error('Interface Back control was not rendered');

    window.refreshControllerLabels();

    expect(root.querySelector('[data-back]')).toBe(initialBack);
  });
});
