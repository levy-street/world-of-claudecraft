// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FocusTrapHandle } from '../src/ui/focus_manager';
import { SkinEventController } from '../src/ui/hud/cosmetics/skin_event_controller';
import type { IWorld } from '../src/world_api';

const playerPortraitDataUrl = vi.hoisted(() => vi.fn<() => string | null>(() => null));
const visualPortraitDataUrl = vi.hoisted(() =>
  vi.fn<(key: string, skin: number) => string | null>(() => null),
);
vi.mock('../src/render/characters/portrait', () => ({
  playerPortraitDataUrl,
  visualPortraitDataUrl,
}));

function harness(reduceMotion = false, gender?: 'male' | 'female') {
  const scheduled = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
  const clearTimeout = vi.fn((id: number) => scheduled.delete(id));
  const window = {
    matchMedia: () => ({ matches: reduceMotion }),
    setTimeout: (callback: () => void, delay: number) => {
      const id = ++timerId;
      scheduled.set(id, { callback, delay });
      return id;
    },
    clearTimeout,
  } as unknown as Window;
  const release = vi.fn();
  const trap: FocusTrapHandle = { focusFirst: vi.fn(), release, opener: vi.fn(() => null) };
  const closeTop = vi
    .fn()
    .mockReturnValueOnce(true)
    .mockReturnValueOnce(true)
    .mockReturnValue(false);
  const audio = {
    bagOpen: vi.fn(),
    bagClose: vi.fn(),
    click: vi.fn(),
    cosmeticUnlock: vi.fn(),
  };
  const claimEventSkin = vi.fn();
  const preview = { mount: vi.fn(), setSkin: vi.fn() };
  const showBanner = vi.fn();
  const renderBagsIfOpen = vi.fn();
  let portraitUpdate: ((visualKey: string, skin: number) => void) | null = null;
  const controller = new SkinEventController({
    document,
    window,
    world: () =>
      ({
        cfg: { playerClass: 'warrior' },
        player: { modularAppearance: { gender } },
        claimEventSkin,
      }) as unknown as Pick<IWorld, 'cfg' | 'claimEventSkin'>,
    closeTop,
    hideTooltip: vi.fn(),
    onPortraitsReady: vi.fn(),
    onPortraitUpdate: (callback) => {
      portraitUpdate = callback;
    },
    preloadMechAssets: vi.fn(() => Promise.resolve()),
    preview,
    openFocusTrap: vi.fn(() => trap),
    attachTooltip: vi.fn(),
    showBanner,
    renderBagsIfOpen,
    random: () => 0.5,
    audio,
  });
  return {
    controller,
    scheduled,
    clearTimeout,
    closeTop,
    release,
    audio,
    claimEventSkin,
    preview,
    showBanner,
    renderBagsIfOpen,
    portraitUpdate: (visualKey: string, skin: number) => portraitUpdate?.(visualKey, skin),
  };
}

describe('SkinEventController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    playerPortraitDataUrl.mockReset();
    playerPortraitDataUrl.mockReturnValue(null);
    visualPortraitDataUrl.mockReset();
    visualPortraitDataUrl.mockReturnValue(null);
  });

  it('closes stacked surfaces, opens a trapped wheel, and owns timed teardown', () => {
    const test = harness();

    test.controller.open('rare');

    expect(test.closeTop).toHaveBeenCalledTimes(3);
    expect(document.body.children).toHaveLength(1);
    expect(document.body.children[0].classList.contains('open')).toBe(true);
    expect([...test.scheduled.values()].map((timer) => timer.delay)).toEqual([6600]);
    expect(test.audio.bagOpen).toHaveBeenCalledTimes(1);

    test.controller.close();

    expect(document.body.children[0].classList.contains('open')).toBe(false);
    expect(test.clearTimeout).toHaveBeenCalledTimes(1);
    expect(test.release).toHaveBeenCalledTimes(1);
    expect(test.audio.bagClose).toHaveBeenCalledTimes(1);
  });

  it('uses the short reveal only for the reduced-motion preference', () => {
    const test = harness(true);

    test.controller.open('epic');

    expect([...test.scheduled.values()].map((timer) => timer.delay)).toEqual([140]);
  });

  it('reveals selectable skins and claims the selected skin through IWorld', () => {
    const test = harness();
    test.controller.open('rare');

    const reveal = [...test.scheduled.values()][0];
    reveal.callback();

    const swatch = document.querySelector<HTMLButtonElement>('[data-lockable="true"]');
    const lock = document.querySelector<HTMLButtonElement>('[data-lockin]');
    expect(swatch).not.toBeNull();
    expect(lock).not.toBeNull();
    swatch?.click();
    expect(test.preview.setSkin).toHaveBeenCalledWith(Number(swatch?.dataset.skin));
    expect(lock?.disabled).toBe(false);

    lock?.click();

    expect(test.claimEventSkin).toHaveBeenCalledWith(Number(swatch?.dataset.skin));
    expect(test.showBanner).toHaveBeenCalledTimes(1);
    expect(test.audio.cosmeticUnlock).toHaveBeenCalledTimes(1);
    expect(test.renderBagsIfOpen).toHaveBeenCalledTimes(1);
    expect(document.getElementById('skin-event')?.classList.contains('open')).toBe(false);
  });

  it('replaces a visible skin fallback when its deferred portrait becomes ready', () => {
    const test = harness();
    test.controller.open('rare');
    [...test.scheduled.values()][0].callback();
    const swatch = document.querySelector<HTMLButtonElement>('.se-swatch[data-skin="1"]');
    expect(swatch?.querySelector('img')).toBeNull();

    visualPortraitDataUrl.mockReturnValue('data:image/png;base64,ready');
    test.portraitUpdate('player_warrior', 1);

    expect(swatch?.querySelector('img')?.src).toBe('data:image/png;base64,ready');
  });

  it('requests female skin portraits and hydrates only the matching body update', () => {
    const test = harness(false, 'female');
    test.controller.open('rare');
    [...test.scheduled.values()][0].callback();
    expect(visualPortraitDataUrl).toHaveBeenCalledWith('player_warrior_female', 1);
    expect(playerPortraitDataUrl).not.toHaveBeenCalled();
    const swatch = document.querySelector<HTMLButtonElement>('.se-swatch[data-skin="1"]');
    visualPortraitDataUrl.mockReturnValue('data:image/png;base64,female');
    test.portraitUpdate('player_warrior', 1);
    expect(swatch?.querySelector('img')).toBeNull();
    test.portraitUpdate('player_warrior_female', 1);
    expect(swatch?.querySelector('img')?.src).toBe('data:image/png;base64,female');
  });
});
