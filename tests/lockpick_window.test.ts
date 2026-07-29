// @vitest-environment happy-dom

// Pure helpers behind the rewritten lockpick window (src/ui/hud/delve/lockpick_window.ts).
// The window itself is a thin DOM consumer (no unit test, per the vendor recipe);
// the only branching logic worth isolating is the timer-reset decision and the
// per-frame repaint signature. The dialog-root describe block below is the one
// exception: it drives the real LockpickWindow class (the lockpick_timer_repaint.ts
// harness shape) to pin the WCAG 2.2 dialog identity on both screens it paints.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lockpickRenderSig, lockpickTimerKey } from '../src/ui/hud/delve/lockpick_panel';
import { LockpickWindow } from '../src/ui/hud/delve/lockpick_window';
import type { LockpickView } from '../src/world_api';

const base: LockpickView = {
  sessionId: 'lp_1_0',
  objectId: 1,
  w: 16,
  h: 6,
  col: 0,
  row: 3,
  page: 1,
  pageCount: 3,
  tries: 1,
  triesTotal: 1,
  lootTier: 'premium',
  allowed: ['set'],
  visible: [],
  stepTimeoutMs: 15000,
};

describe('lockpickTimerKey (per-move clock refill)', () => {
  it('changes on every pin advance so the clock refills each move', () => {
    const k = lockpickTimerKey(base);
    expect(lockpickTimerKey({ ...base, col: 1 })).not.toBe(k);
    expect(lockpickTimerKey({ ...base, col: 2 })).not.toBe(k);
  });

  it('changes on a fresh try, a new page, and a new session', () => {
    const k = lockpickTimerKey(base);
    expect(lockpickTimerKey({ ...base, tries: 0 })).not.toBe(k); // burned a try -> reset
    expect(lockpickTimerKey({ ...base, page: 2 })).not.toBe(k); // next page -> reset
    expect(lockpickTimerKey({ ...base, sessionId: 'lp_2_9' })).not.toBe(k); // new lock -> reset
  });

  it('is stable while nothing about the timed move changed (no needless restart)', () => {
    // row/visible move within a column do not gate the clock; only col/try/page/session do.
    expect(lockpickTimerKey({ ...base, row: 5, visible: [{ col: 0, row: 1, kind: 'open' }] })).toBe(
      lockpickTimerKey(base),
    );
  });
});

describe('lockpickRenderSig', () => {
  it('is stable for an unchanged view', () => {
    expect(lockpickRenderSig(base)).toBe(lockpickRenderSig({ ...base }));
  });

  it('changes when any painted field moves', () => {
    const sig = lockpickRenderSig(base);
    expect(lockpickRenderSig({ ...base, col: 1 })).not.toBe(sig);
    expect(lockpickRenderSig({ ...base, row: 2 })).not.toBe(sig);
    expect(lockpickRenderSig({ ...base, page: 2 })).not.toBe(sig);
    expect(lockpickRenderSig({ ...base, tries: 0 })).not.toBe(sig);
    expect(lockpickRenderSig({ ...base, sessionId: 'lp_1_4' })).not.toBe(sig);
    expect(lockpickRenderSig({ ...base, visible: [{ col: 0, row: 1, kind: 'open' }] })).not.toBe(
      sig,
    );
  });
});

describe('LockpickWindow dialog root (accessible name, #2808)', () => {
  // openBoard() arms the countdown's real setInterval when the view carries a
  // stepTimeoutMs; fake timers keep that interval from firing on the wall
  // clock during (or after) this describe block, the lockpick_timer_repaint
  // idiom.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function harness(initial: LockpickView | null) {
    document.body.innerHTML = '<div id="lockpick-panel" style="display:block"></div>';
    const panel = document.getElementById('lockpick-panel') as HTMLElement;
    let state: LockpickView | null = initial;
    const win = new LockpickWindow({
      panel: () => panel,
      getState: () => state,
      tierName: (tier) => tier,
      onEngage: () => {},
      onAction: () => {},
      onAbort: () => {},
      onClose: () => {},
    });
    return {
      win,
      panel,
      set(next: LockpickView | null): void {
        state = next;
      },
    };
  }

  it('the ante selector marks the panel a labeled dialog', () => {
    const h = harness(null);
    h.win.renderAnte(1, false);

    expect(h.panel.getAttribute('role')).toBe('dialog');
    expect(h.panel.getAttribute('aria-modal')).toBe('false');
    expect(h.panel.getAttribute('tabindex')).toBe('-1');
    expect(h.panel.getAttribute('aria-label')).toBe('Pick the Lock');
    expect(h.panel.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('a Bountiful Coffer ante selector carries its own distinct name', () => {
    const h = harness(null);
    h.win.renderAnte(1, true);

    expect(h.panel.getAttribute('aria-label')).toBe('Bountiful Coffer');
  });

  it('the live board marks the panel a labeled dialog, named for the lock tier', () => {
    const h = harness(base);
    h.win.openBoard();

    expect(h.panel.getAttribute('role')).toBe('dialog');
    expect(h.panel.getAttribute('aria-modal')).toBe('false');
    expect(h.panel.getAttribute('tabindex')).toBe('-1');
    // tierName is stubbed as the identity function above, so the tier renders raw.
    expect(h.panel.getAttribute('aria-label')).toBe("Tumbler's Path: premium cache");
    expect(h.panel.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('the dialog name follows a rebuild from the ante selector to the live board', () => {
    // The two screens replace the panel's whole subtree in turn (renderAnte then
    // openBoard, the ante-to-engage transition); the accessible name must move
    // with it rather than sticking to whichever screen painted first.
    const h = harness(base);
    h.win.renderAnte(1, false);
    expect(h.panel.getAttribute('aria-label')).toBe('Pick the Lock');
    h.win.openBoard();
    expect(h.panel.getAttribute('aria-label')).toBe("Tumbler's Path: premium cache");
  });
});
