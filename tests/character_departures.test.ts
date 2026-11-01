import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterDepartures } from '../server/character_departures';

afterEach(() => vi.useRealTimers());

describe('complete character departure tracking', () => {
  it('registers before the synchronous departure prefix can re-enter', async () => {
    const tracker = new CharacterDepartures();
    const session = {};
    const duplicateWork = vi.fn();
    let duplicate: Promise<void> | undefined;
    const first = tracker.run(session, async () => {
      duplicate = tracker.run(session, duplicateWork);
    });
    expect(duplicate).toBe(first);
    await first;
    expect(duplicateWork).not.toHaveBeenCalled();
  });

  it('latches a settled failure after its pending promise has been removed', async () => {
    const tracker = new CharacterDepartures();
    await expect(
      tracker.run({}, async () => {
        throw new Error('disk unavailable');
      }),
    ).rejects.toThrow();
    await expect(tracker.shutdownDrain(20_000)()).rejects.toThrow('did not finish durably');
    expect(tracker.sealed).toBe(false);
  });

  it('includes departures added while the current batch is awaited', async () => {
    const tracker = new CharacterDepartures();
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    void tracker.run(
      {},
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    const drain = tracker.shutdownDrain(20_000)(true);
    void tracker.run(
      {},
      () =>
        new Promise((resolve) => {
          finishSecond = resolve;
        }),
    );
    finishFirst();
    await Promise.resolve();
    expect(tracker.sealed).toBe(false);
    finishSecond();
    await drain;
    expect(tracker.sealed).toBe(true);
    const late = vi.fn();
    await tracker.run({}, late);
    expect(late).not.toHaveBeenCalled();
  });

  it('shares one cumulative wait budget and leaves timed-out work running', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const tracker = new CharacterDepartures();
    const drain = tracker.shutdownDrain(20_000);
    void tracker.run({}, () => new Promise((resolve) => setTimeout(resolve, 12_000)));
    const first = drain();
    await vi.advanceTimersByTimeAsync(12_000);
    await first;
    // Time spent in other shutdown phases does not consume departure waiting.
    await vi.advanceTimersByTimeAsync(30_000);
    let finished = false;
    const departure = tracker.run({}, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      finished = true;
    });
    const outcome = expect(drain(true)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(8_000);
    await outcome;
    expect(finished).toBe(false);
    expect(tracker.sealed).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    await departure;
    expect(finished).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
