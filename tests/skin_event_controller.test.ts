// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FocusTrapHandle } from '../src/ui/focus_manager';
import { SkinEventController } from '../src/ui/hud/cosmetics/skin_event_controller';
import type { IWorld } from '../src/world_api';

vi.mock('../src/render/characters/portrait', () => ({
  playerPortraitDataUrl: () => null,
  visualPortraitDataUrl: () => null,
}));

function harness(reduceMotion = false) {
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
  const trap: FocusTrapHandle = { focusFirst: vi.fn(), release };
  const closeTop = vi
    .fn()
    .mockReturnValueOnce(true)
    .mockReturnValueOnce(true)
    .mockReturnValue(false);
  const audio = {
    bagOpen: vi.fn(),
    bagClose: vi.fn(),
    click: vi.fn(),
    levelUp: vi.fn(),
  };
  const claimEventSkin = vi.fn();
  const preview = { mount: vi.fn(), setSkin: vi.fn() };
  const showBanner = vi.fn();
  const renderBagsIfOpen = vi.fn();
  const controller = new SkinEventController({
    document,
    window,
    world: () =>
      ({ cfg: { playerClass: 'warrior' }, claimEventSkin }) as unknown as Pick<
        IWorld,
        'cfg' | 'claimEventSkin'
      >,
    closeTop,
    hideTooltip: vi.fn(),
    onPortraitsReady: vi.fn(),
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
  };
}

describe('SkinEventController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
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
    expect(test.audio.levelUp).toHaveBeenCalledTimes(1);
    expect(test.renderBagsIfOpen).toHaveBeenCalledTimes(1);
    expect(document.getElementById('skin-event')?.classList.contains('open')).toBe(false);
  });
});
