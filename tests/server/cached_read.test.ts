// Generic single-flight TTL read cache (server/cached_read.ts). These pin the
// four behaviors the factory generalizes from the main.ts board caches and
// deeds_board_warm's singleFlight: the TTL freshness gate, concurrent-miss
// collapse to one refresh, stale-serve when a refresh fails after a success,
// and the epoch guard that declines an install when a bust lands mid-flight.
// Every case pins the refresh call count so a regression that double-reads or
// skips a required refresh fails decisively. The clock is injected, so no
// timers or sleeps anywhere: in-flight windows are driven by deferred promises.

import { describe, expect, it, vi } from 'vitest';
import { createCachedRead } from '../../server/cached_read';

// Deferred promise whose resolve/reject the test drives, standing in for the
// expensive read so the in-flight window is held open exactly as long as a
// case needs it.
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('createCachedRead: single-flight collapse', () => {
  it('concurrent cold reads share ONE refresh and all resolve with its value', async () => {
    const d = deferred<string>();
    const refresh = vi.fn(() => d.promise);
    const cache = createCachedRead(refresh, { ttlMs: 1_000, now: () => 0 });
    expect(cache.peek()).toBeNull(); // cold before the first read
    const reads = [cache.read(), cache.read(), cache.read()];
    expect(refresh).toHaveBeenCalledOnce();
    d.resolve('board');
    await expect(Promise.all(reads)).resolves.toEqual(['board', 'board', 'board']);
    expect(refresh).toHaveBeenCalledOnce();
    expect(cache.peek()).toBe('board');
  });
});

describe('createCachedRead: TTL freshness gate', () => {
  it('concurrent warm-expired reads share ONE refresh like a cold miss', async () => {
    let t = 0;
    const d = deferred<string>();
    const refresh = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('first')
      .mockReturnValueOnce(d.promise);
    const cache = createCachedRead(refresh, { ttlMs: 1_000, now: () => t });
    await expect(cache.read()).resolves.toBe('first');
    t = 1_000; // lapsed: both readers below miss and must share one flight
    const reads = [cache.read(), cache.read()];
    expect(refresh).toHaveBeenCalledTimes(2);
    d.resolve('second');
    await expect(Promise.all(reads)).resolves.toEqual(['second', 'second']);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('serves the cache inside ttlMs and refreshes once the window lapses', async () => {
    let t = 0;
    const refresh = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');
    const cache = createCachedRead(refresh, { ttlMs: 1_000, now: () => t });
    await expect(cache.read()).resolves.toBe('first');
    t = 999; // one tick inside the window
    await expect(cache.read()).resolves.toBe('first');
    expect(refresh).toHaveBeenCalledOnce();
    t = 1_000; // exactly ttlMs after the install: lapsed (exclusive upper bound)
    await expect(cache.read()).resolves.toBe('second');
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe('createCachedRead: stale-serve on refresh failure', () => {
  it('serves the stale value when the refresh fails after a success, then retries', async () => {
    let t = 0;
    const refresh = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('good')
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce('recovered');
    const cache = createCachedRead(refresh, { ttlMs: 1_000, now: () => t });
    await expect(cache.read()).resolves.toBe('good');
    t = 5_000; // far past the TTL, so the next read must attempt the refresh
    await expect(cache.read()).resolves.toBe('good');
    expect(refresh).toHaveBeenCalledTimes(2); // the failing refresh really ran
    // The settled (rejected) flight cleared its slot: the next read retries
    // fresh instead of sharing a cached rejection or the stale value forever.
    await expect(cache.read()).resolves.toBe('recovered');
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('rejects a cold read when the refresh fails with nothing installed', async () => {
    const refresh = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('db down'));
    const cache = createCachedRead(refresh, { ttlMs: 1_000, now: () => 0 });
    await expect(cache.read()).rejects.toThrow('db down');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('warns once per failure streak, and again after a recovery', async () => {
    let t = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const refresh = vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce('good')
        .mockRejectedValueOnce(new Error('db down'))
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce('recovered')
        .mockRejectedValueOnce(new Error('db down again'));
      const cache = createCachedRead(refresh, { ttlMs: 1_000, now: () => t });
      await expect(cache.read()).resolves.toBe('good');
      t = 2_000;
      await expect(cache.read()).resolves.toBe('good'); // first failure: warns
      await expect(cache.read()).resolves.toBe('good'); // same streak: silent
      expect(warn).toHaveBeenCalledTimes(1);
      await expect(cache.read()).resolves.toBe('recovered'); // streak resets
      t = 4_000;
      await expect(cache.read()).resolves.toBe('recovered'); // new streak: warns
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('a busted cache is cold again: a failing refresh rejects, never stale-serves', async () => {
    const refresh = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('good')
      .mockRejectedValueOnce(new Error('db down'));
    const cache = createCachedRead(refresh, { ttlMs: 1_000, now: () => 0 });
    await expect(cache.read()).resolves.toBe('good');
    cache.bust();
    await expect(cache.read()).rejects.toThrow('db down');
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe('createCachedRead: bust', () => {
  it('forces the next read to refresh even inside the TTL window; peek() empties', async () => {
    let t = 0;
    const refresh = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');
    const cache = createCachedRead(refresh, { ttlMs: 1_000, now: () => t });
    await expect(cache.read()).resolves.toBe('first');
    expect(cache.peek()).toBe('first');
    cache.bust();
    expect(cache.peek()).toBeNull();
    t = 1; // deep inside the TTL window: only the bust forces this refresh
    await expect(cache.read()).resolves.toBe('second');
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe('createCachedRead: epoch guard (lost-bust race)', () => {
  it('a bust mid-flight resolves the pending read but declines its install', async () => {
    const d = deferred<string>();
    const refresh = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(d.promise)
      .mockResolvedValueOnce('post-bust');
    const cache = createCachedRead(refresh, { ttlMs: 1_000, now: () => 0 });
    const pending = cache.read();
    expect(refresh).toHaveBeenCalledOnce();
    cache.bust(); // lands while the refresh is in flight
    d.resolve('pre-bust');
    // The in-flight caller still receives the value it computed...
    await expect(pending).resolves.toBe('pre-bust');
    // ...but the pre-bust snapshot must NOT be installed over the bust.
    expect(cache.peek()).toBeNull();
    // So the next read starts a fresh refresh instead of serving stale state.
    await expect(cache.read()).resolves.toBe('post-bust');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('a reader arriving after the bust refuses to join the pre-bust flight', async () => {
    // The joiner side of the lost-bust race: without the epoch check on the
    // in-flight slot, a post-bust read() would share the pre-bust flight and
    // return pre-bust data (e.g. a spin's internal status read joining a
    // status refresh that started before the spin busted the board).
    const dStale = deferred<string>();
    const dFresh = deferred<string>();
    const refresh = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(dStale.promise)
      .mockReturnValueOnce(dFresh.promise);
    const cache = createCachedRead(refresh, { ttlMs: 1_000, now: () => 0 });
    const preBust = cache.read();
    expect(refresh).toHaveBeenCalledOnce();
    cache.bust();
    const postBust = cache.read(); // must start a SECOND flight, not join
    expect(refresh).toHaveBeenCalledTimes(2);
    dStale.resolve('pre-bust');
    dFresh.resolve('post-bust');
    await expect(preBust).resolves.toBe('pre-bust');
    await expect(postBust).resolves.toBe('post-bust');
    // Only the post-bust flight installs.
    expect(cache.peek()).toBe('post-bust');
    // The settled stale flight must not clobber the fresh flight's slot: a
    // further read inside the TTL serves the install without refreshing.
    await expect(cache.read()).resolves.toBe('post-bust');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('the refresh after a declined install installs normally again', async () => {
    let t = 0;
    const d = deferred<string>();
    const refresh = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(d.promise)
      .mockResolvedValueOnce('fresh');
    const cache = createCachedRead(refresh, { ttlMs: 1_000, now: () => t });
    const pending = cache.read();
    cache.bust();
    d.resolve('declined');
    await expect(pending).resolves.toBe('declined');
    await expect(cache.read()).resolves.toBe('fresh');
    expect(cache.peek()).toBe('fresh');
    expect(refresh).toHaveBeenCalledTimes(2);
    // The new install is a real one: a further read inside the TTL serves it
    // without another refresh.
    t = 1;
    await expect(cache.read()).resolves.toBe('fresh');
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
