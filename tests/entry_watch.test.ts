// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTRY_TIMEOUT_MS, watchWorldEntry } from '../src/net/entry_watch';

function fakeWorld(overrides: Partial<{ connected: boolean; playerId: number }> = {}) {
  const entities = new Map<number, true>();
  return {
    connected: overrides.connected ?? false,
    playerId: overrides.playerId ?? 1,
    entities,
  };
}

describe('watchWorldEntry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onReady once the world connects with the player entity present', () => {
    const world = fakeWorld();
    const onReady = vi.fn();
    const onTimedOut = vi.fn();
    const handle = watchWorldEntry(world, onReady, onTimedOut);

    vi.advanceTimersByTime(100);
    expect(onReady).not.toHaveBeenCalled();

    world.connected = true;
    world.entities.set(world.playerId, true);
    vi.advanceTimersByTime(50);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onTimedOut).not.toHaveBeenCalled();
    handle.cancel();
  });

  it('calls onTimedOut after ENTRY_TIMEOUT_MS with no sign of life', () => {
    const world = fakeWorld();
    const onReady = vi.fn();
    const onTimedOut = vi.fn();
    watchWorldEntry(world, onReady, onTimedOut);

    vi.advanceTimersByTime(ENTRY_TIMEOUT_MS - 100);
    expect(onTimedOut).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(onTimedOut).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('noteActivity pushes the deadline out, so a legitimate retry is never killed mid-backoff', () => {
    const world = fakeWorld();
    const onTimedOut = vi.fn();
    const handle = watchWorldEntry(world, vi.fn(), onTimedOut);

    // Just short of the original deadline, a retry starts (reconnect_policy.ts
    // tolerating a transient rejection): this must reset the clock.
    vi.advanceTimersByTime(ENTRY_TIMEOUT_MS - 500);
    handle.noteActivity();
    vi.advanceTimersByTime(ENTRY_TIMEOUT_MS - 500);
    expect(onTimedOut).not.toHaveBeenCalled();

    // Only once ENTRY_TIMEOUT_MS elapses with NO further activity does it give up.
    vi.advanceTimersByTime(600);
    expect(onTimedOut).toHaveBeenCalledTimes(1);
  });

  it('extends through a scheduled retry whose backoff exceeds ENTRY_TIMEOUT_MS', () => {
    const world = fakeWorld();
    const onTimedOut = vi.fn();
    const handle = watchWorldEntry(world, vi.fn(), onTimedOut);
    const now = Date.now();
    const longBackoff = ENTRY_TIMEOUT_MS * 2;

    vi.advanceTimersByTime(100);
    handle.noteActivity(now + longBackoff);

    vi.advanceTimersByTime(longBackoff + ENTRY_TIMEOUT_MS - 250);
    expect(onTimedOut).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(onTimedOut).toHaveBeenCalledTimes(1);
  });

  it('cancel() stops polling: neither callback fires again', () => {
    const world = fakeWorld();
    const onReady = vi.fn();
    const onTimedOut = vi.fn();
    const handle = watchWorldEntry(world, onReady, onTimedOut);
    handle.cancel();

    world.connected = true;
    world.entities.set(world.playerId, true);
    vi.advanceTimersByTime(ENTRY_TIMEOUT_MS + 1000);

    expect(onReady).not.toHaveBeenCalled();
    expect(onTimedOut).not.toHaveBeenCalled();
  });
});
