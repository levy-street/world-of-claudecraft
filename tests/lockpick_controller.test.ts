import { describe, expect, it, vi } from 'vitest';
import type { FocusTrapHandle } from '../src/ui/focus_manager';
import { LockpickController } from '../src/ui/hud/delve/lockpick_controller';
import { t } from '../src/ui/i18n';
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

    test.controller.end('success', 'premium', liveView.sessionId);

    expect(test.showBanner).toHaveBeenCalledTimes(1);
    expect(test.log).toHaveBeenCalledWith(expect.any(String), '#7fdc4f');
    expect(test.panel.style.display).toBe('none');
    expect(test.release).toHaveBeenCalledWith(true);
  });

  it('a stale lockpickEnd cannot tear down a fresh session board (the online flash)', () => {
    // The online shape: withdraw session lp_1 (the panel stays up waiting on
    // the wire answer), re-engage, and the FRESH session lp_9's board is on
    // screen when lp_1's late lockpickEnd finally lands. The end arm used to
    // close whatever was up: the fresh 420px dead-centre board vanished for
    // the player (a split-second dark-panel flash at best) while its session
    // stayed live server-side, burning tries toward a forfeited chest.
    // ClientWorld.applyLockpickEvent already id-scopes the mirror clear; this
    // pins the SAME scoping on the HUD arm's close.
    const fresh: LockpickView = { ...liveView, sessionId: 'lp_9' };
    const test = harness(fresh);
    test.controller.openBoard();
    expect(test.panel.style.display).toBe('block');

    test.controller.end('abandoned', undefined, 'lp_1'); // the withdrawn session's late answer

    expect(test.panel.style.display, 'the fresh board survives the stale end').toBe('block');
    // The summary still lands (that attempt really was withdrawn); only the
    // CLOSE is session-scoped. A same-message [end(old), session(new)] batch
    // leaves the mirror on the new id before this arm runs, and a success in
    // that shape must not lose its banner and green line.
    expect(test.log).toHaveBeenCalledWith(t('lockpickUi.summary.abandoned'), '#ccc');
    expect(test.release).not.toHaveBeenCalled();
  });

  it('a session-scoped end for the LIVE session still closes and summarizes', () => {
    // The guard must scope, not suppress: an end naming the on-screen session
    // (and any end with no live mirror left, the normal online order, where
    // applyLockpickEvent cleared the state before the HUD drained) closes.
    const test = harness(liveView);
    test.controller.openBoard();

    test.controller.end('abandoned', undefined, liveView.sessionId);

    expect(test.panel.style.display).toBe('none');
    expect(test.log).toHaveBeenCalledWith(t('lockpickUi.summary.abandoned'), '#ccc');

    // And the mirror-already-cleared shape closes too.
    const second = harness(null);
    second.controller.openBoard();
    second.panel.style.display = 'block';
    second.controller.end('success', 'premium', 'lp_1');
    expect(second.panel.style.display).toBe('none');
    expect(second.showBanner).toHaveBeenCalledTimes(1);
  });

  it('logs a withdrawal without a banner before closing the panel', () => {
    // end() branches three ways on outcome and only 'success' was pinned, so the colour and
    // the no-banner half of the arm that a withdrawal actually takes were free to change.
    // This is the arm every #2517 dismissal of a live board ends on.
    const test = harness(liveView);
    test.controller.openBoard();

    test.controller.end('abandoned', undefined, liveView.sessionId);

    expect(test.showBanner, 'a withdrawal is not an achievement').not.toHaveBeenCalled();
    // The KEY, not just the colour: swapping the abandoned and fail summaries (or wiring
    // this arm to the fail key) leaves an `expect.any(String)` version of this green.
    expect(test.log).toHaveBeenCalledWith(t('lockpickUi.summary.abandoned'), '#ccc');
    expect(test.panel.style.display).toBe('none');
    expect(test.release).toHaveBeenCalledWith(true);
  });
});
