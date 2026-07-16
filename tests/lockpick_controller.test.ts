import { describe, expect, it, vi } from 'vitest';
import type { FocusTrapHandle } from '../src/ui/focus_manager';
import { LockpickController } from '../src/ui/hud/delve/lockpick_controller';
import type { LockpickView } from '../src/world_api';
import { FakeDocument, FakeWindow } from './helpers/fake_dom';

const liveView: LockpickView = {
  sessionId: 'lp_1',
  objectId: 7,
  w: 3,
  h: 3,
  col: 0,
  row: 1,
  page: 1,
  pageCount: 1,
  tries: 1,
  triesTotal: 1,
  lootTier: 'premium',
  allowed: ['set'],
  visible: [],
  stepTimeoutMs: null,
};

function keyEvent(key: string): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperties(event, {
    key: { value: key },
    repeat: { value: false },
  });
  return event;
}

function harness(initialState: LockpickView | null = null) {
  const document = new FakeDocument();
  const panel = document.element('lockpick-panel');
  panel.style.display = 'none';
  const keyboard = new FakeWindow(1280, 720);
  const focusFirst = vi.fn();
  const release = vi.fn();
  const trap: FocusTrapHandle = { focusFirst, release };
  const openFocusTrap = vi.fn(() => trap);
  const engage = vi.fn();
  const act = vi.fn();
  const abort = vi.fn();
  const handleEvents = vi.fn();
  const showBanner = vi.fn();
  const log = vi.fn();
  const hideTooltip = vi.fn();
  let state = initialState;
  let drained: unknown[] | null = [];
  const controller = new LockpickController({
    panel: panel as unknown as HTMLElement,
    keyboardTarget: keyboard as unknown as Window,
    openFocusTrap,
    getState: () => state,
    engage,
    act,
    abort,
    drainEvents: () => drained as never,
    handleEvents,
    showBanner,
    log,
    hideTooltip,
  });
  return {
    controller,
    panel,
    keyboard,
    focusFirst,
    release,
    openFocusTrap,
    engage,
    act,
    abort,
    handleEvents,
    showBanner,
    log,
    hideTooltip,
    setState: (next: LockpickView | null) => {
      state = next;
    },
    setDrained: (events: unknown[] | null) => {
      drained = events;
    },
  };
}

describe('LockpickController', () => {
  it('owns one focus trap and keyboard listener for an ante-panel lifetime', () => {
    const test = harness();

    test.controller.openAnte(7, true);
    test.controller.openAnte(7, true);

    expect(test.panel.style.display).toBe('block');
    expect(test.panel.innerHTML).toContain('lp-ante-row-coffer');
    expect(test.openFocusTrap).toHaveBeenCalledTimes(1);
    expect(test.focusFirst).toHaveBeenCalledWith('.lp-ante-btn');

    test.keyboard.dispatchEvent(keyEvent('Escape'));
    expect(test.panel.style.display).toBe('none');
    expect(test.release).toHaveBeenCalledWith(true);
    expect(test.hideTooltip).toHaveBeenCalledTimes(1);
  });

  it('routes only allowed live-board hotkeys through the authoritative action seam', () => {
    const test = harness(liveView);
    test.controller.openBoard();

    test.keyboard.dispatchEvent(keyEvent('q'));
    test.keyboard.dispatchEvent(keyEvent('w'));

    expect(test.act).toHaveBeenCalledTimes(1);
    expect(test.act).toHaveBeenCalledWith('set');
  });

  it('drains offline events immediately after commands and forwards them once', () => {
    const test = harness();
    const event = { type: 'lockpickSession' };
    test.setDrained([event]);

    test.controller.submitEngage(9, 2);

    expect(test.engage).toHaveBeenCalledWith(9, 2);
    expect(test.handleEvents).toHaveBeenCalledTimes(1);
    expect(test.handleEvents).toHaveBeenCalledWith([event]);
  });

  it('announces a successful result before closing the panel', () => {
    const test = harness(liveView);
    test.controller.openBoard();

    test.controller.end('success', 'premium');

    expect(test.showBanner).toHaveBeenCalledTimes(1);
    expect(test.log).toHaveBeenCalledWith(expect.any(String), '#7fdc4f');
    expect(test.panel.style.display).toBe('none');
    expect(test.release).toHaveBeenCalledWith(true);
  });
});
