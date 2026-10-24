import { describe, expect, it, vi } from 'vitest';
import { createStaffWatchlistCache, STAFF_WATCHLIST_TTL_MS } from '../server/staff_watchlist_cache';
import type { StaffWatchEntry } from '../server/staff_watchlist_db';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const empty: { entries: StaffWatchEntry[]; total: number } = { entries: [], total: 0 };
const listed = { entries: [], total: 40 };

describe('staff watchlist list cache', () => {
  it('collapses cold and expired bursts and serves warm reads without SQL', async () => {
    let now = 0;
    const first = deferred<typeof empty>();
    const query = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(listed);
    const cache = createStaffWatchlistCache(query, () => now);
    const cold = Array.from({ length: 60 }, () => cache.read());
    expect(query).toHaveBeenCalledTimes(1);
    first.resolve(empty);
    expect(await Promise.all(cold)).toEqual(Array(60).fill(empty));
    now = STAFF_WATCHLIST_TTL_MS - 1;
    await Promise.all(Array.from({ length: 60 }, () => cache.read()));
    expect(query).toHaveBeenCalledTimes(1);
    now++;
    expect(await Promise.all(Array.from({ length: 60 }, () => cache.read()))).toEqual(
      Array(60).fill(listed),
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('serializes post-bust reads, coalesces multiple busts and refuses stale installation', async () => {
    const old = deferred<typeof empty>();
    const fresh = deferred<typeof empty>();
    const query = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const cache = createStaffWatchlistCache(query, () => 0);
    const preBust = cache.read();
    const postBust: Promise<typeof empty>[] = [];
    for (let i = 0; i < 60; i++) {
      cache.bust();
      postBust.push(cache.read());
    }
    expect(query).toHaveBeenCalledTimes(1);
    old.resolve(empty);
    await expect(preBust).resolves.toEqual(empty);
    // The old SQL has settled before any post-bust SQL starts.
    expect(query).toHaveBeenCalledTimes(2);
    fresh.resolve(listed);
    expect(await Promise.all(postBust)).toEqual(Array(60).fill(listed));
    await expect(cache.read()).resolves.toEqual(listed);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('never serves an expired snapshot after refresh failure and retries fresh', async () => {
    let now = 0;
    const query = vi
      .fn()
      .mockResolvedValueOnce(empty)
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(listed);
    const cache = createStaffWatchlistCache(query, () => now);
    await cache.read();
    now = STAFF_WATCHLIST_TTL_MS;
    await expect(cache.read()).rejects.toThrow('unavailable');
    await expect(cache.read()).resolves.toEqual(listed);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('counts freshness from query start and catches other-realm writes at expiry', async () => {
    let now = 0;
    let persisted = empty;
    const query = vi.fn(async () => persisted);
    const realmA = createStaffWatchlistCache(query, () => now);
    const realmB = createStaffWatchlistCache(query, () => now);
    await realmA.read();
    await realmB.read();
    persisted = listed;
    realmA.bust();
    await expect(realmA.read()).resolves.toEqual(listed);
    await expect(realmB.read()).resolves.toEqual(empty);
    expect(query).toHaveBeenCalledTimes(3);
    now = STAFF_WATCHLIST_TTL_MS;
    await expect(realmB.read()).resolves.toEqual(listed);
    expect(query).toHaveBeenCalledTimes(4);

    const slow = deferred<typeof empty>();
    const slowQuery = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValue(listed);
    const slowCache = createStaffWatchlistCache(slowQuery, () => now);
    const reading = slowCache.read();
    now += STAFF_WATCHLIST_TTL_MS;
    slow.resolve(empty);
    await reading;
    await expect(slowCache.read()).resolves.toEqual(listed);
    expect(slowQuery).toHaveBeenCalledTimes(2);
  });

  it('freezes shared entries and retries a post-bust read after old SQL fails', async () => {
    const fail = deferred<typeof empty>();
    const query = vi
      .fn()
      .mockReturnValueOnce(
        fail.promise.then(() => {
          throw new Error('old failure');
        }),
      )
      .mockResolvedValueOnce({
        entries: [
          {
            accountId: 1,
            characterName: 'Synthetic',
            note: null,
            addedBy: null,
            createdAt: '2026-10-15T00:00:00.000Z',
          },
        ],
        total: 1,
      });
    const cache = createStaffWatchlistCache(query, () => 0);
    const old = expect(cache.read()).rejects.toThrow('old failure');
    cache.bust();
    const fresh = cache.read();
    fail.resolve(empty);
    await old;
    const snapshot = await fresh;
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.entries)).toBe(true);
    expect(Object.isFrozen(snapshot.entries[0])).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
