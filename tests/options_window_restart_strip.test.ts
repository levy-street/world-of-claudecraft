// @vitest-environment happy-dom
// The restart strip in the options window: a next-launch setting (the Linux
// graphics backend, the dedicated-GPU preference) that differs from what this
// launch runs on is applied by a restart, not by Apply, so the panel that hosts
// the row offers "Restart Game" where a greyed-out Apply used to sit.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/app_viewport', () => ({ syncAppViewport: vi.fn() }));
vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));
vi.mock('../src/game/music', () => ({
  music: { pauseForMenu: vi.fn(), resumeFromMenu: vi.fn() },
}));
vi.mock('../src/ui/app_version', () => ({
  appVersionInfo: () => ({ version: 'test', build: 'test' }),
}));

import {
  resetDesktopLaunchSettingsForTest,
  syncDesktopLaunchSettings,
} from '../src/game/desktop_next_launch_settings';
import { normalizeGraphicsSettingsSnapshot } from '../src/game/graphics_rebuild_core';
import { type DesktopLaunchSettings, desktopBridge } from '../src/runtime';
import { t } from '../src/ui/i18n';
import { buildOptionsMenu } from '../src/ui/options_view';
import { OptionsWindow } from '../src/ui/options_window';

const BOOL_SETTING_KEYS = new Set(['waterRipples', 'forceHighPerfGpu']);

/** The Linux desktop shell: both next-launch rows, the launch snapshot, the restart. */
function installShell(launched: DesktopLaunchSettings, restartAnswer: () => Promise<boolean>) {
  const restartApp = vi.fn(restartAnswer);
  (globalThis as unknown as { wocDesktop: unknown }).wocDesktop = {
    openBrowserLogin: () => Promise.resolve(),
    takeLoginCode: () => Promise.resolve(null),
    onLoginCode: () => () => {},
    hasGpuBackendChoice: true,
    getGpuBackend: () => Promise.resolve({ setting: launched.gpuBackend }),
    setGpuBackend: () => Promise.resolve(true),
    getGpuForceOptOut: () => Promise.resolve(launched.gpuForceOptOut),
    setGpuForceOptOut: () => Promise.resolve(true),
    getLaunchSettings: () => Promise.resolve(launched),
    restartApp,
  };
  return { restartApp };
}

/** The live settings the window reads: a mutable map, defaults elsewhere. */
function settingsStore(values: Record<string, number | boolean>) {
  return {
    get: (key: string) => values[key] ?? (BOOL_SETTING_KEYS.has(key) ? false : 0),
    // The live store answers the value it stored (the toggles feed it on).
    set: vi.fn((key: string, value: number | boolean) => {
      values[key] = value;
      return value;
    }),
    reset: vi.fn(),
  };
}

function openWindow(
  root: HTMLElement,
  settings: ReturnType<typeof settingsStore>,
  onSettingChange: (key: string, value: unknown) => void = vi.fn(),
): OptionsWindow {
  const window = new OptionsWindow({
    root: () => root,
    world: () => ({}) as never,
    options: () =>
      ({
        settings,
        onSettingChange,
        graphicsApplied: () => normalizeGraphicsSettingsSnapshot({}),
        applyGraphics: () => Promise.resolve('applied'),
        perfOverlay: { setPlacement: vi.fn() },
        captureKey: vi.fn(),
        logout: vi.fn(),
        changeLanguage: () => Promise.resolve(true),
        refreshWocBalance: vi.fn(),
        // Interface > General leads with the language and theme controls.
        theme: {
          get: () => ({ preset: 'classic', custom: {} }),
          setPreset: vi.fn(),
          setCustom: vi.fn(),
          resetCustom: vi.fn(),
        },
      }) as never,
    bugReport: () => null,
    hideTooltip: vi.fn(),
    captureFocus: () => null,
    restoreFocus: vi.fn(),
    focusFirstInteractive: vi.fn(),
    closeOthers: vi.fn(),
    resetUnitFrames: vi.fn(),
    // The Interface > General language picker: a stand-in node is enough here.
    buildDropdown: () => document.createElement('div'),
    setDropdownValue: vi.fn(),
    // The Frames tab's unlock row, the Chat tab's timestamp and clock rows.
    isInterfaceUnlocked: () => false,
    toggleInterfaceUnlock: () => false,
    getChatTimestamps: () => false,
    setChatTimestamps: vi.fn(),
    getChatClock: () => '24h',
    setChatClock: vi.fn(),
    resetChatWindow: vi.fn(),
  } as never);
  window.toggle();
  return window;
}

function goTo(root: HTMLElement, view: 'graphics' | 'interface'): void {
  const menu = buildOptionsMenu({ bugReportAvailable: false });
  const index = menu.findIndex(
    (entry) => entry.action.kind === 'goto' && entry.action.view === view,
  );
  root.querySelectorAll<HTMLButtonElement>('.opt-btn')[index]?.click();
}

/** A second window on a fresh root: the menu buttons live on the menu view only,
 *  so a second panel is reached by opening again, not by navigating back. */
function freshRoot(): HTMLElement {
  document.body.replaceChildren();
  const next = document.createElement('div');
  document.body.appendChild(next);
  root = next;
  return next;
}

const strip = (root: HTMLElement) => root.querySelector<HTMLElement>('.restart-strip');
const stripButton = (root: HTMLElement) =>
  root.querySelector<HTMLButtonElement>('[data-restart-game]');

const LAUNCHED_DEFAULTS: DesktopLaunchSettings = { gpuForceOptOut: false, gpuBackend: 'auto' };

let root: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.appendChild(root);
  resetDesktopLaunchSettingsForTest();
});

afterEach(() => {
  resetDesktopLaunchSettingsForTest();
  (globalThis as unknown as { wocDesktop?: unknown }).wocDesktop = undefined;
});

describe('OptionsWindow restart strip', () => {
  it('offers the restart in Graphics when the backend choice differs from what launched', async () => {
    installShell(LAUNCHED_DEFAULTS, () => new Promise(() => {}));
    await syncDesktopLaunchSettings(desktopBridge());
    // OpenGL chosen, Auto running.
    openWindow(root, settingsStore({ gpuBackend: 2 }));
    goTo(root, 'graphics');

    const shown = strip(root);
    expect(shown).not.toBeNull();
    expect(shown?.dataset.restartStrip).toBe('ready');
    expect(shown?.querySelector('.restart-strip-status')?.textContent).toBe(
      t('hudChrome.options.restartPending'),
    );
    expect(stripButton(root)?.textContent).toBe(t('hudChrome.options.restartGame'));
    expect(stripButton(root)?.disabled).toBe(false);
    // The in-page Apply is untouched: still there, still nothing to apply.
    const apply = root.querySelector<HTMLButtonElement>('[data-graphics-apply]');
    expect(apply?.disabled).toBe(true);
  });

  it('appears under the click itself: picking another backend rebuilds the panel', async () => {
    // What the tester hit: the row wrote the value but nothing repainted, so the
    // greyed Apply stayed the only thing in sight. The choice row must ask for a
    // re-render, and the setting change must reach the store the strip reads.
    installShell(LAUNCHED_DEFAULTS, () => Promise.resolve(true));
    await syncDesktopLaunchSettings(desktopBridge());
    const values: Record<string, number | boolean> = { gpuBackend: 0, forceHighPerfGpu: true };
    const settings = settingsStore(values);
    const onSettingChange = vi.fn((key: string, value: unknown) => {
      // main.ts routes a shell-mirrored key to settings.set (desktop_shell_settings.ts).
      values[key] = value as number | boolean;
    });
    openWindow(root, settings, onSettingChange);
    goTo(root, 'graphics');
    expect(strip(root)).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-focus-key="gpuBackend:2"]')?.click();
    expect(onSettingChange).toHaveBeenCalledWith('gpuBackend', 2);
    expect(strip(root)?.dataset.restartStrip).toBe('ready');
    // Back to what runs: the offer withdraws under the same click path.
    root.querySelector<HTMLButtonElement>('[data-focus-key="gpuBackend:0"]')?.click();
    expect(strip(root)).toBeNull();
  });

  it('appears under the GPU force flip on Interface > General', async () => {
    installShell(LAUNCHED_DEFAULTS, () => Promise.resolve(true));
    await syncDesktopLaunchSettings(desktopBridge());
    const values: Record<string, number | boolean> = { gpuBackend: 0, forceHighPerfGpu: true };
    const onSettingChange = vi.fn((key: string, value: unknown) => {
      values[key] = value as number | boolean;
    });
    openWindow(root, settingsStore(values), onSettingChange);
    goTo(root, 'interface');
    expect(strip(root)).toBeNull();
    const toggle = root.querySelector<HTMLElement>('[data-setting-key="forceHighPerfGpu"]');
    expect(toggle).not.toBeNull();
    toggle?.click();
    expect(onSettingChange).toHaveBeenCalledWith('forceHighPerfGpu', false);
    expect(strip(root)?.dataset.restartStrip).toBe('ready');
  });

  it('offers nothing when the local values are what this launch runs on', async () => {
    installShell(LAUNCHED_DEFAULTS, () => Promise.resolve(true));
    await syncDesktopLaunchSettings(desktopBridge());
    const asLaunched = settingsStore({ gpuBackend: 0, forceHighPerfGpu: true });
    openWindow(root, asLaunched);
    goTo(root, 'graphics');
    expect(strip(root)).toBeNull();
    openWindow(freshRoot(), asLaunched);
    goTo(root, 'interface');
    expect(strip(root)).toBeNull();
  });

  it("offers nothing without the shell's launch snapshot (the web, an older shell)", () => {
    installShell(LAUNCHED_DEFAULTS, () => Promise.resolve(true));
    // No sync: the snapshot never arrived.
    openWindow(root, settingsStore({ gpuBackend: 2 }));
    goTo(root, 'graphics');
    expect(strip(root)).toBeNull();
  });

  it('offers the restart on Interface > General when the GPU force changed', async () => {
    installShell({ gpuForceOptOut: false, gpuBackend: 'auto' }, () => Promise.resolve(true));
    await syncDesktopLaunchSettings(desktopBridge());
    // The force turned off, launched on.
    const forceOff = settingsStore({ forceHighPerfGpu: false });
    openWindow(root, forceOff);
    goTo(root, 'interface');
    expect(strip(root)?.dataset.restartStrip).toBe('ready');
    // The offer follows what is pending, not the panel: a player who toggled
    // the force and then opened Graphics still sees the way to apply it.
    openWindow(freshRoot(), forceOff);
    goTo(root, 'graphics');
    expect(strip(root)?.dataset.restartStrip).toBe('ready');
  });

  it('offers nothing on a shell that cannot restart itself', async () => {
    installShell(LAUNCHED_DEFAULTS, () => Promise.resolve(true));
    const shell = (globalThis as unknown as { wocDesktop: Record<string, unknown> }).wocDesktop;
    delete shell.restartApp;
    await syncDesktopLaunchSettings(desktopBridge());
    openWindow(root, settingsStore({ gpuBackend: 2 }));
    goTo(root, 'graphics');
    expect(strip(root)).toBeNull();
  });

  it('yields to an unapplied graphics draft: hidden while dirty, back once the draft is reset', async () => {
    installShell(LAUNCHED_DEFAULTS, () => Promise.resolve(true));
    await syncDesktopLaunchSettings(desktopBridge());
    openWindow(root, settingsStore({ gpuBackend: 2 }));
    goTo(root, 'graphics');
    expect(strip(root)).not.toBeNull();
    // Stage a different preset: Apply has the hand, the strip steps aside.
    const presets = root.querySelectorAll<HTMLButtonElement>('[data-focus-key^="graphicsPreset:"]');
    const other = [...presets].find((b) => !b.classList.contains('on') && !b.disabled);
    expect(other).toBeDefined();
    other?.click();
    expect(root.querySelector<HTMLButtonElement>('[data-graphics-apply]')?.disabled).toBe(false);
    expect(strip(root)).toBeNull();
    // Reset to Defaults settles the draft: the offer stands again.
    const reset = [...root.querySelectorAll<HTMLButtonElement>('.gfx-footer .btn')].find(
      (b) => b.textContent === t('hud.options.resetToDefaults'),
    );
    reset?.click();
    expect(strip(root)).not.toBeNull();
  });

  it('hosts the strip on Interface > General only', async () => {
    installShell(LAUNCHED_DEFAULTS, () => Promise.resolve(true));
    await syncDesktopLaunchSettings(desktopBridge());
    openWindow(root, settingsStore({ forceHighPerfGpu: false }));
    goTo(root, 'interface');
    expect(strip(root)).not.toBeNull();
    for (const tab of root.querySelectorAll<HTMLButtonElement>('.opt-tab')) {
      if (tab.classList.contains('on')) continue;
      tab.click();
      expect(strip(root), `strip on tab ${tab.textContent}`).toBeNull();
    }
  });

  it('forgets a failure once nothing is pending, so the next change starts fresh', async () => {
    installShell(LAUNCHED_DEFAULTS, () => Promise.resolve(false));
    await syncDesktopLaunchSettings(desktopBridge());
    const values: Record<string, number | boolean> = { gpuBackend: 2, forceHighPerfGpu: true };
    const window = openWindow(root, settingsStore(values));
    goTo(root, 'graphics');
    stripButton(root)?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(strip(root)?.dataset.restartStrip).toBe('failed');
    // Put the value back to what runs: nothing pending, and the failure is forgotten.
    values.gpuBackend = 0;
    (window as unknown as { render(): void }).render();
    expect(strip(root)).toBeNull();
    values.gpuBackend = 1;
    (window as unknown as { render(): void }).render();
    expect(strip(root)?.dataset.restartStrip).toBe('ready');
  });

  it('asks the shell to restart on click, and shows the wait while it takes the window down', async () => {
    let settle: (started: boolean) => void = () => {};
    const { restartApp } = installShell(
      LAUNCHED_DEFAULTS,
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
    );
    await syncDesktopLaunchSettings(desktopBridge());
    openWindow(root, settingsStore({ gpuBackend: 2 }));
    goTo(root, 'graphics');

    const before = strip(root);
    stripButton(root)?.click();
    expect(restartApp).toHaveBeenCalledTimes(1);
    // Repainted in place: the same live region, its text moved, focus parked on
    // it while the button cannot hold focus.
    expect(strip(root)).toBe(before);
    expect(strip(root)?.dataset.restartStrip).toBe('restarting');
    expect(stripButton(root)?.disabled).toBe(true);
    const waiting = strip(root)?.querySelector<HTMLElement>('.restart-strip-status');
    expect(waiting?.textContent).toBe(t('hudChrome.options.restartInProgress'));
    expect(waiting?.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(waiting);
    // A second click while waiting asks nothing twice.
    stripButton(root)?.click();
    expect(restartApp).toHaveBeenCalledTimes(1);

    // The child never started: the offer stands again, with the reason, as an alert.
    settle(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(strip(root)?.dataset.restartStrip).toBe('failed');
    const status = strip(root)?.querySelector('.restart-strip-status');
    expect(status?.getAttribute('role')).toBe('alert');
    expect(status?.textContent).toBe(t('hudChrome.options.restartFailed'));
    expect(stripButton(root)?.disabled).toBe(false);
    // The offer stands again under the player's hands.
    expect(document.activeElement).toBe(stripButton(root));
    stripButton(root)?.click();
    expect(restartApp).toHaveBeenCalledTimes(2);
  });
});
