// Self-test for the in-memory FakeRateLimitStore. It drives the store with a
// controllable fake clock (a closure over a mutable `t`) so the sliding-window
// boundary is exercised deterministically, with no real timers. The decision
// rule mirrors recordSlidingWindowAttempt in server/ratelimit: allowed while the
// in-window count is <= maxPerMinute, limited on the (maxPerMinute + 1)th hit.
import { describe, expect, it } from 'vitest';
import { WINDOW_MS } from '../../../server/ratelimit';
import { FakeRateLimitStore } from './fake_ratelimit_store';

// A fake clock: returns the current `t`, settable by the test.
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    set: (next: number) => {
      t = next;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('FakeRateLimitStore', () => {
  it('allows under-limit hits with decreasing remaining', () => {
    const clock = fakeClock(0);
    const store = new FakeRateLimitStore(clock.now);
    const max = 3;

    const first = store.hit('ip', max);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);

    const second = store.hit('ip', max);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);

    const third = store.hit('ip', max);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it('denies the (maxPerMinute + 1)th hit within the window', () => {
    const clock = fakeClock(0);
    const store = new FakeRateLimitStore(clock.now);
    const max = 3;

    for (let i = 0; i < max; i++) {
      expect(store.hit('ip', max).allowed).toBe(true);
    }
    const overflow = store.hit('ip', max);
    expect(overflow.allowed).toBe(false);
    expect(overflow.remaining).toBe(0);
  });

  it('keys windows independently', () => {
    const clock = fakeClock(0);
    const store = new FakeRateLimitStore(clock.now);
    const max = 1;

    expect(store.hit('a', max).allowed).toBe(true);
    // 'a' is now at its limit, but a different key is unaffected.
    expect(store.hit('a', max).allowed).toBe(false);
    expect(store.hit('b', max).allowed).toBe(true);
  });

  it('rolls the window once the clock advances past WINDOW_MS', () => {
    const clock = fakeClock(0);
    const store = new FakeRateLimitStore(clock.now);
    const max = 2;

    expect(store.hit('ip', max).allowed).toBe(true); // count 1 @ t=0
    expect(store.hit('ip', max).allowed).toBe(true); // count 2 @ t=0
    expect(store.hit('ip', max).allowed).toBe(false); // count 3 @ t=0, over limit

    // Advance a full window with no intervening hit. At t = WINDOW_MS prune keeps
    // only t > 0, dropping every t=0 entry, so a fresh hit starts a new window
    // and is allowed with full remaining.
    clock.set(WINDOW_MS);
    const rolled = store.hit('ip', max);
    expect(rolled.allowed).toBe(true);
    expect(rolled.remaining).toBe(max - 1); // 1
  });

  it('asserts the exact boundary with independent keys', () => {
    const clock = fakeClock(0);
    const store = new FakeRateLimitStore(clock.now);
    const max = 1;

    // Two keys each record one entry at t=0 on one monotonic timeline; probing
    // each at a different instant isolates the boundary without a probe hit
    // polluting the other key's window.
    expect(store.hit('near', max).allowed).toBe(true); // near entry @ t=0
    expect(store.hit('far', max).allowed).toBe(true); // far entry @ t=0

    // One ms before the window closes, near's t=0 entry is still counted, so a
    // second hit trips the limit.
    clock.set(WINDOW_MS - 1);
    expect(store.hit('near', max).allowed).toBe(false);

    // Exactly at WINDOW_MS, far's t=0 entry ages out, so its next hit is allowed.
    clock.set(WINDOW_MS);
    expect(store.hit('far', max).allowed).toBe(true);
  });

  it('computes resetSeconds from the oldest in-window entry', () => {
    const clock = fakeClock(0);
    const store = new FakeRateLimitStore(clock.now);
    const max = 5;

    // First hit at t=0: oldest = 0, so the window resets a full minute later.
    const first = store.hit('ip', max);
    expect(first.resetSeconds).toBe(WINDOW_MS / 1000); // 60

    // One second before the boundary: the t=0 entry is still the oldest, so it
    // ages out in ceil((0 + WINDOW_MS - (WINDOW_MS - 1000)) / 1000) = 1 second.
    clock.set(WINDOW_MS - 1000);
    expect(store.hit('ip', max).resetSeconds).toBe(1);
  });

  it('reset() clears all windows', () => {
    const clock = fakeClock(0);
    const store = new FakeRateLimitStore(clock.now);
    const max = 1;

    expect(store.hit('ip', max).allowed).toBe(true);
    expect(store.hit('ip', max).allowed).toBe(false); // at limit
    store.reset();
    // After reset the window is empty again, so the next hit is allowed.
    expect(store.hit('ip', max).allowed).toBe(true);
  });
});
