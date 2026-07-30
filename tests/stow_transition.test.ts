// src/render/characters/stow_transition.ts: the deferred sheathe-swap state
// machine (gesture replay on target change, mid-flight reversal, snap paths).
import { describe, expect, it } from 'vitest';
import {
  createStowTransition,
  forceStow,
  requestStow,
  tickStow,
} from '../src/render/characters/stow_transition';

describe('stow transition', () => {
  it('defers the swap to the gesture peak and applies it once', () => {
    const t = createStowTransition();
    expect(requestStow(t, true, 0.3)).toBe(true);
    expect(tickStow(t, 0.1)).toBe('none'); // still mid-gesture
    expect(t.attached).toBe(false);
    expect(tickStow(t, 0.25)).toBe('swap'); // timer expired: swap + cut clip
    expect(t.attached).toBe(true);
    expect(tickStow(t, 1)).toBe('none'); // nothing pending afterwards
  });

  it('a same-target request neither replays the gesture nor re-arms the timer', () => {
    const t = createStowTransition();
    requestStow(t, true, 0.3);
    tickStow(t, 0.5);
    expect(requestStow(t, true, 0.3)).toBe(false);
    expect(t.timer).toBe(0);
  });

  it('a mid-flight reversal replays the gesture and expires without a rebuild', () => {
    const t = createStowTransition();
    requestStow(t, true, 0.3);
    tickStow(t, 0.1);
    // Z pressed again before the swap landed: back to drawn, which is what the
    // model still shows, so the expiry cuts the gesture but skips the re-attach.
    expect(requestStow(t, false, 0.3)).toBe(true);
    expect(tickStow(t, 0.5)).toBe('expired');
    expect(t.attached).toBe(false);
    // A double reversal (stow, unstow, stow) still lands exactly one swap.
    requestStow(t, true, 0.3);
    tickStow(t, 0.1);
    requestStow(t, false, 0.3);
    tickStow(t, 0.1);
    requestStow(t, true, 0.3);
    expect(tickStow(t, 0.5)).toBe('swap');
    expect(t.attached).toBe(true);
  });

  it('forceStow snaps with no pending timer and reports whether a re-attach is due', () => {
    const t = createStowTransition();
    expect(forceStow(t, true)).toBe(true); // spawn-in already stowed: attach now
    expect(t.timer).toBe(0);
    expect(forceStow(t, true)).toBe(false); // idempotent
    requestStow(t, false, 0.3);
    expect(forceStow(t, false)).toBe(true); // cancels the pending gesture swap
    expect(tickStow(t, 1)).toBe('none');
  });

  it('a zero swap delay still defers to the next tick, never re-enters the caller', () => {
    const t = createStowTransition();
    expect(requestStow(t, true, 0)).toBe(true);
    expect(tickStow(t, 1 / 60)).toBe('swap');
    expect(t.attached).toBe(true);
  });
});
