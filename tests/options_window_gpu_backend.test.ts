// @vitest-environment happy-dom
// The desktop shell judges the graphics backend a few seconds after launch, so
// the Graphics panel can be on screen before the reading it paints under the
// Auto/Vulkan/OpenGL buttons exists. It follows the shell's verdict while open,
// and stops following the moment it closes.

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
  initDesktopGpuBackendActive,
  resetDesktopGpuBackendActiveForTest,
} from '../src/game/desktop_gpu_backend_sync';
import { normalizeGraphicsSettingsSnapshot } from '../src/game/graphics_rebuild_core';
import { type DesktopGpuBackendState, desktopBridge } from '../src/runtime';
import { t } from '../src/ui/i18n';
import { buildOptionsMenu } from '../src/ui/options_view';
import { OptionsWindow } from '../src/ui/options_window';

const BOOL_SETTING_KEYS = new Set(['waterRipples']);

function installShell(): { send(state: DesktopGpuBackendState): void } {
  let push: ((state: DesktopGpuBackendState) => void) | null = null;
  (globalThis as unknown as { wocDesktop: unknown }).wocDesktop = {
    openBrowserLogin: () => Promise.resolve(),
    takeLoginCode: () => Promise.resolve(null),
    onLoginCode: () => () => {},
    hasGpuBackendChoice: true,
    getGpuBackend: () => Promise.resolve({ setting: 'vulkan' }),
    setGpuBackend: () => Promise.resolve(true),
    onGpuBackendState: (callback: (state: DesktopGpuBackendState) => void) => {
      push = callback;
      return () => {
        push = null;
      };
    },
  };
  return { send: (state) => push?.(state) };
}

function openGraphicsPanel(root: HTMLElement): OptionsWindow {
  const window = new OptionsWindow({
    root: () => root,
    world: () => ({}) as never,
    options: () =>
      ({
        settings: {
          get: (key: string) => (BOOL_SETTING_KEYS.has(key) ? false : 0),
          set: vi.fn(),
          reset: vi.fn(),
        },
        onSettingChange: vi.fn(),
        graphicsApplied: () => normalizeGraphicsSettingsSnapshot({}),
        applyGraphics: () => Promise.resolve('applied'),
        perfOverlay: { setPlacement: vi.fn() },
      }) as never,
    bugReport: () => null,
    hideTooltip: vi.fn(),
    captureFocus: () => null,
    restoreFocus: vi.fn(),
    focusFirstInteractive: vi.fn(),
    closeOthers: vi.fn(),
  } as never);
  window.toggle();
  const menu = buildOptionsMenu({ bugReportAvailable: false });
  const graphicsIndex = menu.findIndex(
    (entry) => entry.action.kind === 'goto' && entry.action.view === 'graphics',
  );
  root.querySelectorAll<HTMLButtonElement>('.opt-btn')[graphicsIndex]?.click();
  return window;
}

/** The reading painted inside the backend row, and no other row's: scoped to
 *  the row that owns the backend choice, so a second status line elsewhere
 *  in the panel cannot satisfy this by accident. */
function backendReading(root: HTMLElement): string | null {
  const choice = root.querySelector('[data-focus-key^="gpuBackend:"]');
  return choice?.closest('.set-row')?.querySelector('.set-note-inline')?.textContent ?? null;
}

const VULKAN_READING = t('hudChrome.options.gpuBackendActive', {
  backend: t('hudChrome.options.gpuBackendActiveNameVulkan'),
});
const OPENGL_FELL_SHORT = t('hudChrome.options.gpuBackendActiveUnavailable', {
  backend: t('hudChrome.options.gpuBackendActiveNameOpenGL'),
});

let root: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.appendChild(root);
  resetDesktopGpuBackendActiveForTest();
});

afterEach(() => {
  resetDesktopGpuBackendActiveForTest();
  (globalThis as unknown as { wocDesktop?: unknown }).wocDesktop = undefined;
});

describe('OptionsWindow graphics backend reading', () => {
  it('paints the reading that arrives after the panel was built', () => {
    const shell = installShell();
    const off = initDesktopGpuBackendActive(desktopBridge());
    openGraphicsPanel(root);

    // Opened before the shell judged the launch: the row is there, its reading
    // is not (an unjudged rung is absent, never the asked-for backend).
    expect(root.querySelector('[data-focus-key^="gpuBackend:"]')).not.toBeNull();
    expect(backendReading(root)).toBeNull();

    shell.send({ setting: 'vulkan', active: 'vulkan-parallel-compile' });
    // Half a payload is still nothing to say: the verdict needs both fields.
    expect(backendReading(root)).toBeNull();

    shell.send({
      setting: 'vulkan',
      active: 'vulkan-parallel-compile',
      requestedUnavailable: false,
    });
    expect(backendReading(root)).toBe(VULKAN_READING);

    // A later verdict repaints too (a relaunch judged differently while the
    // panel stayed open).
    shell.send({ setting: 'vulkan', active: 'opengl', requestedUnavailable: true });
    expect(backendReading(root)).toBe(OPENGL_FELL_SHORT);
    off();
  });

  it('stops following the shell once the panel leaves the screen', () => {
    const shell = installShell();
    const off = initDesktopGpuBackendActive(desktopBridge());
    const window = openGraphicsPanel(root);
    shell.send({
      setting: 'vulkan',
      active: 'vulkan-parallel-compile',
      requestedUnavailable: false,
    });
    expect(backendReading(root)).toBe(VULKAN_READING);

    // Back to the Game Menu: another sub-view paints no backend row, and a
    // verdict arriving there must not rebuild the menu under the player.
    root.querySelector<HTMLButtonElement>('[data-back]')?.click();
    shell.send({ setting: 'vulkan', active: 'opengl', requestedUnavailable: true });
    expect(root.querySelector('.opt-list')).not.toBeNull();
    expect(backendReading(root)).toBeNull();

    // Reopening picks the latched reading straight up.
    root
      .querySelectorAll<HTMLButtonElement>('.opt-btn')
      [
        buildOptionsMenu({ bugReportAvailable: false }).findIndex(
          (entry) => entry.action.kind === 'goto' && entry.action.view === 'graphics',
        )
      ]?.click();
    expect(backendReading(root)).toBe(OPENGL_FELL_SHORT);

    // Closed: the hidden panel keeps whatever it last painted rather than
    // rebuilding stale DOM off a verdict nobody is looking at.
    window.close();
    expect(root.style.display).toBe('none');
    shell.send({
      setting: 'vulkan',
      active: 'vulkan-parallel-compile',
      requestedUnavailable: false,
    });
    expect(root.style.display).toBe('none');
    expect(backendReading(root)).toBe(OPENGL_FELL_SHORT);
    off();
  });
});
