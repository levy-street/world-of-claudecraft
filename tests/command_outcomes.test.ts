import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandOutcomeTracker } from '../src/net/command_outcomes';

// The command-outcome tracker extracted off ClientWorld's cmdWithOutcome
// (src/net/online.ts): direct unit coverage of the contracts the extraction
// promised to keep byte-identical (see command_outcomes.ts's own header),
// PLUS the preserved failure contract: `register`'s `send` callback runs
// inside the returned Promise's executor, so a synchronous throw from it
// rejects the returned promise with that exact error (never a throw out of
// the caller, never a silent `false`) and clears the pending entry/timeout it
// just registered. The consumer-level round trip (a real cmdWithOutcome
// caller, a real onMessage commandOutcome reply) is covered in
// tests/command_outcome_transport.test.ts; this file is the FOCUSED direct
// test the tracker earns on its own.
//
// `register` no longer returns `{ rid, promise }`: it takes the `send(rid)`
// callback and returns the `Promise<boolean>` alone, so every case below
// captures `rid` (when it needs one) from inside that callback.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function registerNoop(tracker: CommandOutcomeTracker): { rid: number; promise: Promise<boolean> } {
  let rid!: number;
  const promise = tracker.register((r) => {
    rid = r;
  });
  return { rid, promise };
}

describe('CommandOutcomeTracker', () => {
  it('resolves true when resolve() is called before the timeout', async () => {
    const tracker = new CommandOutcomeTracker();
    const { rid, promise } = registerNoop(tracker);
    tracker.resolve(rid, true);
    await expect(promise).resolves.toBe(true);
  });

  it('resolves false when resolve() reports failure', async () => {
    const tracker = new CommandOutcomeTracker();
    const { rid, promise } = registerNoop(tracker);
    tracker.resolve(rid, false);
    await expect(promise).resolves.toBe(false);
  });

  it('times out to false after 5s with no resolve', async () => {
    const tracker = new CommandOutcomeTracker();
    const { promise } = registerNoop(tracker);
    vi.advanceTimersByTime(5000);
    await expect(promise).resolves.toBe(false);
  });

  it('a resolve() just before the 5s deadline still lands (the timeout never double-fires)', async () => {
    const tracker = new CommandOutcomeTracker();
    const { rid, promise } = registerNoop(tracker);
    vi.advanceTimersByTime(4999);
    tracker.resolve(rid, true);
    vi.advanceTimersByTime(1);
    await expect(promise).resolves.toBe(true);
  });

  it('an unknown rid is a silent no-op (already resolved, timed out, or never registered)', async () => {
    const tracker = new CommandOutcomeTracker();
    expect(() => tracker.resolve(999, true)).not.toThrow();
    const { rid, promise } = registerNoop(tracker);
    tracker.resolve(rid, true);
    // Resolving the SAME rid again must not throw and must not re-settle
    // (a Promise is single-settle anyway, but the tracker's own map lookup
    // must also treat the second call as a no-op, not a stale-entry error).
    expect(() => tracker.resolve(rid, false)).not.toThrow();
    await expect(promise).resolves.toBe(true);
  });

  it('failAll() resolves every still-pending outcome to false and clears the map', async () => {
    const tracker = new CommandOutcomeTracker();
    const first = registerNoop(tracker);
    const second = registerNoop(tracker);
    tracker.failAll();
    await expect(first.promise).resolves.toBe(false);
    await expect(second.promise).resolves.toBe(false);
    // A resolve() after failAll() finds nothing pending: no throw, no effect.
    expect(() => tracker.resolve(first.rid, true)).not.toThrow();
  });

  it('failAll() with nothing pending is a safe no-op', () => {
    const tracker = new CommandOutcomeTracker();
    expect(() => tracker.failAll()).not.toThrow();
  });

  it('allocates increasing rids and resolves each independently', () => {
    const tracker = new CommandOutcomeTracker();
    const first = registerNoop(tracker);
    const second = registerNoop(tracker);
    expect(second.rid).toBe(first.rid + 1);
    tracker.resolve(second.rid, true);
    tracker.resolve(first.rid, false);
    return Promise.all([
      expect(first.promise).resolves.toBe(false),
      expect(second.promise).resolves.toBe(true),
    ]);
  });

  // NOTE: the documented MAX_SAFE_INTEGER rollover (rid >= that ceiling wraps
  // to 1, never overflows) is not exercised here: driving register() ~2^53
  // times is not a real test. It is unchanged MOVED code (the exact prior
  // inline expression), not new logic, so this suite does not claim to cover
  // it; a reviewer verifying it should read the one-line guard in
  // src/net/command_outcomes.ts directly.

  describe('a synchronous throw from send()', () => {
    it('rejects the returned promise with the exact thrown value, never resolving to false', async () => {
      const tracker = new CommandOutcomeTracker();
      const thrown = new Error('transport exploded');
      const promise = tracker.register(() => {
        throw thrown;
      });
      await expect(promise).rejects.toBe(thrown);
    });

    it('clears the pending entry and its timeout: no leaked timer, and the rid is unknown afterward', async () => {
      const tracker = new CommandOutcomeTracker();
      let capturedRid!: number;
      const thrown = new Error('transport exploded');
      const promise = tracker.register((rid) => {
        capturedRid = rid;
        throw thrown;
      });
      // Swallow the rejection here so the "unhandled rejection" noise does not
      // depend on assertion ordering below; the actual rejection is asserted
      // via the same promise reference afterward.
      const settled = promise.catch((err) => err);

      expect(vi.getTimerCount()).toBe(0); // the 5s timeout was cleared, not merely orphaned
      // The rid the throwing send() saw is no longer tracked: resolving it
      // now (as a stray late server reply would) is a no-op, not a crash and
      // not a second settle of the already-rejected promise.
      expect(() => tracker.resolve(capturedRid, true)).not.toThrow();
      // Advancing well past the 5s deadline must fire nothing further: a
      // leaked timeout would otherwise throw trying to resolve a promise
      // that can no longer be resolved, or would simply prove the entry was
      // never really cleared.
      vi.advanceTimersByTime(10_000);
      expect(vi.getTimerCount()).toBe(0);

      expect(await settled).toBe(thrown);
    });

    it('does not disturb an unrelated concurrent request', async () => {
      const tracker = new CommandOutcomeTracker();
      const thrown = new Error('transport exploded');
      const failing = tracker.register(() => {
        throw thrown;
      });
      const okOutcome = registerNoop(tracker);
      const settledFailing = failing.catch((err) => err);

      tracker.resolve(okOutcome.rid, true);

      expect(await settledFailing).toBe(thrown);
      await expect(okOutcome.promise).resolves.toBe(true);
    });
  });
});
