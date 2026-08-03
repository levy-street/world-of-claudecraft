// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/app_viewport', () => ({ syncAppViewport: vi.fn() }));
vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));
vi.mock('../src/game/music', () => ({
  music: { pauseForMenu: vi.fn(), resumeFromMenu: vi.fn() },
}));
vi.mock('../src/ui/app_version', () => ({
  appVersionInfo: () => ({ version: 'test', build: 'test' }),
}));

import { OptionsWindow } from '../src/ui/options_window';

beforeEach(() => {
  document.body.replaceChildren();
});

describe('OptionsWindow Auras view', () => {
  it('closes through the title-bar X and leaves placement mode', () => {
    const root = document.createElement('div');
    root.style.display = 'block';
    document.body.appendChild(root);
    const setPlacement = vi.fn();
    const window = new OptionsWindow({
      root: () => root,
      world: () => ({}) as never,
      options: () => ({ perfOverlay: { setPlacement: vi.fn() } }) as never,
      auraOverlays: () =>
        ({
          playerClass: () => 'warrior',
          defs: () => [],
          get: vi.fn(),
          patch: vi.fn(),
          reset: vi.fn(),
          setAll: vi.fn(),
          beginPlacement: vi.fn(),
          endPlacement: vi.fn(),
          setPlacement,
          onPositionChange: () => vi.fn(),
          onPlacementChange: () => vi.fn(),
        }) as never,
      bugReport: () => null,
      hideTooltip: vi.fn(),
      restoreFocus: vi.fn(),
    } as never);

    (window as unknown as { renderAuras(): void }).renderAuras();
    root.querySelector<HTMLButtonElement>('[data-close]')?.click();

    expect(root.style.display).toBe('none');
    expect(setPlacement).toHaveBeenLastCalledWith(false);
  });
});
