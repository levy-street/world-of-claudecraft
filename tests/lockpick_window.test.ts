// Pure helpers behind the rewritten lockpick window (src/ui/hud/delve/lockpick_window.ts).
// The window itself is a thin DOM consumer (no unit test, per the vendor recipe);
// the only branching logic worth isolating is the timer-reset decision and the
// per-frame repaint signature.

import { describe, expect, it } from 'vitest';
import { lockpickRenderSig, lockpickTimerKey } from '../src/ui/hud/delve/lockpick_panel';
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
