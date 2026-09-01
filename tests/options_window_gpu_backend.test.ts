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

  it('leaves the keyboard player on the control they were standing on', () => {
    // The verdict lands seconds into the session, on a panel the player may be
    // working in, and it rebuilds every control in it. A dial that came back
    // without the focus it had drops the player on <body>, OUTSIDE the window's
    // Tab trap, so the sliders and toggles carry the same rebuild-crossing
    // focus identity the choice buttons already do (focus_restore.ts).
    const shell = installShell();
    const off = initDesktopGpuBackendActive(desktopBridge());
    openGraphicsPanel(root);

    const standing = root.querySelector<HTMLInputElement>('.set-slider');
    expect(standing).not.toBeNull();
    const label = standing?.getAttribute('aria-label');
    standing?.focus();
    expect(document.activeElement).toBe(standing);

    shell.send({
      setting: 'vulkan',
      active: 'vulkan-parallel-compile',
      requestedUnavailable: false,
    });
    expect(backendReading(root)).toBe(VULKAN_READING);
    // The node the player held is gone with the rebuild; the control is not.
    expect(standing?.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(root.querySelector('.set-slider'));
    expect(document.activeElement?.getAttribute('aria-label')).toBe(label);

    // A numeric toggle answers the same way (Fullscreen: the first .set-toggle,
    // built without a setting key).
    const toggle = root.querySelector<HTMLButtonElement>('.set-toggle:not([data-setting-key])');
    const toggleLabel = toggle?.getAttribute('aria-label');
    toggle?.focus();
    shell.send({ setting: 'vulkan', active: 'opengl', requestedUnavailable: true });
    expect(toggle?.isConnected).toBe(false);
    expect(document.activeElement).toBe(root.querySelector('.set-toggle:not([data-setting-key])'));
    expect(document.activeElement?.getAttribute('aria-label')).toBe(toggleLabel);

    // And so does a bool toggle (Water Ripples), which the OTHER toggle builder
    // paints: it already carried a setting key of its own, which is how a
    // rerendering toggle finds itself after its own change, and the focus key
    // beside it is what carries a rebuild nobody asked for.
    const bool = root.querySelector<HTMLButtonElement>('.set-toggle[data-setting-key]');
    const boolLabel = bool?.getAttribute('aria-label');
    expect(bool).not.toBeNull();
    bool?.focus();
    shell.send({ setting: 'vulkan', active: 'vulkan', requestedUnavailable: false });
    expect(bool?.isConnected).toBe(false);
    expect(document.activeElement).toBe(root.querySelector('.set-toggle[data-setting-key]'));
    expect(document.activeElement?.getAttribute('aria-label')).toBe(boolLabel);
    off();
  });

  it('leaves no dial in the panel without a focus identity to come back to', () => {
    // The carry above is only as wide as the markup: a builder that mints a
    // control without the key drops the player on <body> the next time the
    // shell speaks, and nothing else in the panel would say so.
    installShell();
    const off = initDesktopGpuBackendActive(desktopBridge());
    openGraphicsPanel(root);

    const dials = [...root.querySelectorAll<HTMLElement>('.set-slider, .set-toggle')];
    // The vacuity floor: the Graphics panel paints sliders AND both kinds of
    // toggle, so an empty or one-sided sweep is not the panel.
    expect(dials.length).toBeGreaterThan(5);
    expect(root.querySelector('.set-slider')).not.toBeNull();
    expect(root.querySelector('.set-toggle:not([data-setting-key])')).not.toBeNull();
    expect(root.querySelector('.set-toggle[data-setting-key]')).not.toBeNull();
    const keyless = dials
      .filter((dial) => !dial.dataset.focusKey)
      .map((dial) => `${dial.className}: ${dial.getAttribute('aria-label')}`);
    expect(keyless).toEqual([]);
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
