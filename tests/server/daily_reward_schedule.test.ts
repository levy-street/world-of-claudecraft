import { describe, expect, it, vi } from 'vitest';
import { DailyRewardScheduleCache } from '../../server/daily_reward_schedule';

describe('DailyRewardScheduleCache', () => {
  it('serves the last known good schedule when a normal refresh fails', async () => {
    let now = 0;
    const load = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(22 * 60)
      .mockRejectedValueOnce(new Error('schedule unavailable'));
    const cache = new DailyRewardScheduleCache(load, { ttlMs: 1_000, now: () => now });

    await expect(cache.read()).resolves.toBe(22 * 60);
    now = 1_000;
    await expect(cache.read()).resolves.toBe(22 * 60);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('fails closed when no schedule has ever loaded', async () => {
    const cache = new DailyRewardScheduleCache(
      async () => {
        throw new Error('schedule unavailable');
      },
      { ttlMs: 1_000 },
    );

    await expect(cache.read()).rejects.toThrow('schedule unavailable');
  });

  it('requires a successful source read for an explicit refresh', async () => {
    const load = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(22 * 60)
      .mockRejectedValueOnce(new Error('schedule unavailable'));
    const cache = new DailyRewardScheduleCache(load, { ttlMs: 60_000 });

    await expect(cache.read()).resolves.toBe(22 * 60);
    await expect(cache.refresh()).rejects.toThrow('schedule unavailable');
    expect(cache.peek()).toBe(22 * 60);
  });

  it('collapses concurrent refreshes into one source request', async () => {
    let resolve = (_minutes: number): void => {};
    const pending = new Promise<number>((done) => {
      resolve = done;
    });
    const load = vi.fn(() => pending);
    const cache = new DailyRewardScheduleCache(load, { ttlMs: 1_000 });

    const reads = [cache.refresh(), cache.refresh(), cache.read()];
    expect(load).toHaveBeenCalledOnce();
    resolve(22 * 60);
    await expect(Promise.all(reads)).resolves.toEqual([22 * 60, 22 * 60, 22 * 60]);
  });
});
