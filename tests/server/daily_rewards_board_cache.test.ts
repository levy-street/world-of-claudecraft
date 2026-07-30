// The daily-rewards board cache (server/daily_rewards_board_cache.ts). These
// pin the derivation contract (all four ranked reads come from ONE snapshot
// fetch, never a second query), the TTL and bust behaviors inherited from
// createCachedRead, and the day scoping layered on top of it: a cached
// snapshot for another day is a miss, and a reader that shared a flight
// aimed at another day gets a direct read of its own day instead of a
// wrong-day answer. Every case pins the fetch call count so a
// regression that double-reads or serves the wrong day's rows fails
// decisively. The clock is injected, so no timers or sleeps anywhere:
// in-flight windows are driven by deferred promises.

import { describe, expect, it, vi } from 'vitest';
import {
  DAILY_REWARD_BOARD_TTL_MS,
  DailyRewardBoardCache,
} from '../../server/daily_rewards_board_cache';
import type { DailyRewardScoreRow } from '../../server/daily_rewards_db';

function row(accountId: number, points: number, rank: number): DailyRewardScoreRow {
  return { accountId, username: `player${accountId}`, points, rank };
}

// Deferred promise whose resolve the test drives, standing in for the
// snapshot query so the in-flight window is held open exactly as long as a
// case needs it.
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const DAY = '2026-07-16';

describe('DailyRewardBoardCache: one snapshot serves all four reads', () => {
  it('sequential leaderboard, total, rank, and self-row reads share ONE fetch', async () => {
    const rows = [row(1, 30, 1), row(2, 20, 2), row(3, 10, 3)];
    const fetchSnapshot = vi.fn(async (_day: string) => rows);
    const cache = new DailyRewardBoardCache(fetchSnapshot, { ttlMs: 1_000, now: () => 0 });
    await expect(cache.leaderboard(DAY, 10)).resolves.toEqual(rows);
    await expect(cache.leaderboardTotal(DAY)).resolves.toBe(3);
    await expect(cache.rankForAccount(DAY, 2)).resolves.toBe(2);
    await expect(cache.leaderboardRowForAccount(DAY, 3)).resolves.toEqual(row(3, 10, 3));
    expect(fetchSnapshot).toHaveBeenCalledOnce();
    expect(fetchSnapshot).toHaveBeenCalledWith(DAY);
  });

  it('concurrent cold reads collapse into one fetch and all derive from it', async () => {
    const d = deferred<DailyRewardScoreRow[]>();
    const fetchSnapshot = vi.fn((_day: string) => d.promise);
    const cache = new DailyRewardBoardCache(fetchSnapshot, { ttlMs: 1_000, now: () => 0 });
    const reads = Promise.all([
      cache.leaderboard(DAY, 10),
      cache.leaderboardTotal(DAY),
      cache.rankForAccount(DAY, 1),
      cache.leaderboardRowForAccount(DAY, 1),
    ]);
    expect(fetchSnapshot).toHaveBeenCalledOnce();
    d.resolve([row(1, 5, 1)]);
    const [leaders, total, rank, self] = await reads;
    expect(leaders).toEqual([row(1, 5, 1)]);
    expect(total).toBe(1);
    expect(rank).toBe(1);
    expect(self).toEqual(row(1, 5, 1));
    expect(fetchSnapshot).toHaveBeenCalledOnce();
  });
});

describe('DailyRewardBoardCache: TTL freshness gate', () => {
  it('serves the snapshot inside ttlMs and refetches once the window lapses', async () => {
    let t = 0;
    const fetchSnapshot = vi.fn(async (_day: string) => [row(1, 5, 1)]);
    const cache = new DailyRewardBoardCache(fetchSnapshot, { ttlMs: 1_000, now: () => t });
    await expect(cache.leaderboardTotal(DAY)).resolves.toBe(1);
    t = 999; // one tick inside the window
    await expect(cache.leaderboardTotal(DAY)).resolves.toBe(1);
    expect(fetchSnapshot).toHaveBeenCalledOnce();
    t = 1_000; // exactly ttlMs after the install: lapsed
    await expect(cache.leaderboardTotal(DAY)).resolves.toBe(1);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it('defaults to the 30s ceiling the other public board caches use', () => {
    expect(DAILY_REWARD_BOARD_TTL_MS).toBe(30_000);
  });
});

describe('DailyRewardBoardCache: day scoping', () => {
  it('a cached snapshot for another day is a miss, never served across the rollover', async () => {
    const byDay: Record<string, DailyRewardScoreRow[]> = {
      '2026-07-16': [row(1, 5, 1)],
      '2026-07-17': [row(2, 7, 1)],
    };
    const fetchSnapshot = vi.fn(async (day: string) => byDay[day] ?? []);
    const cache = new DailyRewardBoardCache(fetchSnapshot, { ttlMs: 1_000, now: () => 0 });
    await expect(cache.leaderboard('2026-07-16', 10)).resolves.toEqual([row(1, 5, 1)]);
    // Deep inside the TTL window: only the day mismatch forces this refetch,
    // and the old day's rows are never returned for the new day.
    await expect(cache.leaderboard('2026-07-17', 10)).resolves.toEqual([row(2, 7, 1)]);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(fetchSnapshot).toHaveBeenLastCalledWith('2026-07-17');
    // The new day's snapshot is what is cached now.
    await expect(cache.leaderboardTotal('2026-07-17')).resolves.toBe(1);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it('serves a mismatched flight-sharer a direct read of its own day, keeping the shared snapshot', async () => {
    const flights: Array<ReturnType<typeof deferred<DailyRewardScoreRow[]>>> = [];
    const fetchSnapshot = vi.fn((_day: string) => {
      const d = deferred<DailyRewardScoreRow[]>();
      flights.push(d);
      return d.promise;
    });
    const cache = new DailyRewardBoardCache(fetchSnapshot, { ttlMs: 1_000, now: () => 0 });
    // Three concurrent readers straddling a rollover: A starts the flight for
    // its day; C and B join that flight wanting OTHER days, so each sees a
    // mismatched snapshot and must get a direct read of ITS day, never A's
    // rows relabeled and never a wrong-day answer.
    const pA = cache.leaderboard('2026-07-16', 10);
    const pC = cache.leaderboardTotal('2026-07-17');
    const pB = cache.rankForAccount('2026-07-18', 3);
    expect(fetchSnapshot).toHaveBeenCalledOnce();
    flights[0].resolve([row(1, 5, 1)]);
    await expect(pA).resolves.toEqual([row(1, 5, 1)]);
    // C and B each fell back to a direct read of their own day.
    expect(fetchSnapshot).toHaveBeenCalledTimes(3);
    expect(fetchSnapshot.mock.calls.map((call) => call[0])).toEqual([
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
    ]);
    flights[1].resolve([row(2, 6, 1)]);
    flights[2].resolve([row(3, 7, 1)]);
    await expect(pC).resolves.toBe(1);
    await expect(pB).resolves.toBe(1);
    // The direct reads did not evict A's day: a follow-up read for it is
    // cache-served with no fourth fetch (no rollover ping-pong).
    await expect(cache.leaderboardTotal('2026-07-16')).resolves.toBe(1);
    expect(fetchSnapshot).toHaveBeenCalledTimes(3);
  });
});

describe('DailyRewardBoardCache: bust', () => {
  it('forces the next read to refetch even inside the TTL window', async () => {
    let t = 0;
    const fetchSnapshot = vi
      .fn<(day: string) => Promise<DailyRewardScoreRow[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row(1, 5, 1)]);
    const cache = new DailyRewardBoardCache(fetchSnapshot, { ttlMs: 1_000, now: () => t });
    await expect(cache.leaderboardTotal(DAY)).resolves.toBe(0);
    cache.bust();
    t = 1; // deep inside the TTL window: only the bust forces this refetch
    await expect(cache.leaderboardTotal(DAY)).resolves.toBe(1);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });
});

describe('DailyRewardBoardCache: derivations are exact', () => {
  it('clamps the leaderboard limit to the db bounds and derives total/rank/row from the one snapshot', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(i + 1, 200 - i, i + 1));
    const fetchSnapshot = vi.fn(async (_day: string) => rows);
    const cache = new DailyRewardBoardCache(fetchSnapshot, { ttlMs: 1_000, now: () => 0 });
    // The clamp mirrors the db read: never below 1, never above 100.
    await expect(cache.leaderboard(DAY, 0)).resolves.toEqual([rows[0]]);
    await expect(cache.leaderboard(DAY, 1000)).resolves.toEqual(rows.slice(0, 100));
    await expect(cache.leaderboard(DAY, 10)).resolves.toEqual(rows.slice(0, 10));
    // The total is the WHOLE population, never the clamped slice.
    await expect(cache.leaderboardTotal(DAY)).resolves.toBe(120);
    await expect(cache.rankForAccount(DAY, 7)).resolves.toBe(7);
    await expect(cache.rankForAccount(DAY, 999)).resolves.toBeNull();
    await expect(cache.leaderboardRowForAccount(DAY, 7)).resolves.toEqual(rows[6]);
    await expect(cache.leaderboardRowForAccount(DAY, 999)).resolves.toBeNull();
    expect(fetchSnapshot).toHaveBeenCalledOnce();
  });

  it('serves an empty snapshot cleanly: no rows, total 0, null rank and self row', async () => {
    const fetchSnapshot = vi.fn(async (_day: string) => [] as DailyRewardScoreRow[]);
    const cache = new DailyRewardBoardCache(fetchSnapshot, { ttlMs: 1_000, now: () => 0 });
    await expect(cache.leaderboard(DAY, 10)).resolves.toEqual([]);
    await expect(cache.leaderboardTotal(DAY)).resolves.toBe(0);
    await expect(cache.rankForAccount(DAY, 1)).resolves.toBeNull();
    await expect(cache.leaderboardRowForAccount(DAY, 1)).resolves.toBeNull();
    expect(fetchSnapshot).toHaveBeenCalledOnce();
  });

  it('a caller mutating a returned row never poisons the shared snapshot', async () => {
    const fetchSnapshot = vi.fn(async (_day: string) => [row(1, 30, 1), row(2, 20, 2)]);
    const cache = new DailyRewardBoardCache(fetchSnapshot, { ttlMs: 1_000, now: () => 0 });
    const board = await cache.leaderboard(DAY, 10);
    board[0].points = 999_999;
    const selfRow = await cache.leaderboardRowForAccount(DAY, 2);
    if (selfRow) selfRow.points = 999_999;
    // Same snapshot (no refetch), but the mutations stayed on the copies.
    await expect(cache.leaderboard(DAY, 10)).resolves.toEqual([row(1, 30, 1), row(2, 20, 2)]);
    await expect(cache.leaderboardRowForAccount(DAY, 2)).resolves.toEqual(row(2, 20, 2));
    expect(fetchSnapshot).toHaveBeenCalledOnce();
  });
});

describe('DailyRewardBoardCache: refresh telemetry', () => {
  it('counts successful refreshes and records the last refresh duration', async () => {
    let t = 0;
    const fetchSnapshot = vi.fn(async (_day: string) => {
      t += 7; // the query itself takes 7 clock ticks
      return [row(1, 30, 1)];
    });
    const cache = new DailyRewardBoardCache(fetchSnapshot, { ttlMs: 1_000, now: () => t });
    expect(cache.stats()).toEqual({ refreshes: 0, lastRefreshMs: null });
    await cache.leaderboardTotal(DAY);
    expect(cache.stats()).toEqual({ refreshes: 1, lastRefreshMs: 7 });
    // A cache-served read is not a refresh.
    await cache.leaderboardTotal(DAY);
    expect(cache.stats()).toEqual({ refreshes: 1, lastRefreshMs: 7 });
    cache.bust();
    await cache.leaderboardTotal(DAY);
    expect(cache.stats()).toEqual({ refreshes: 2, lastRefreshMs: 7 });
  });
});
