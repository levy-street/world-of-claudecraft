// Tests the GET /api/woc/season route logic (server/woc_season_api.ts): the pure
// pool-to-standings projection and the short-TTL cache, with injected fetchers +
// a controllable clock. Exercises the REAL cache + REAL projectSeasonRewards;
// only the DB reads (fetchSeason/fetchLadder) are fakes (they are integration-
// tested against real Postgres in season_standings.integration.test.ts).
import { describe, it, expect, vi } from 'vitest';
import { SeasonBodyCache, buildSeasonStandings, type RankedLadderEntry } from '../server/woc_season_api';
import type { WocSeasonStatus } from '../server/flow_ledger_db';

const season = (poolBase: string): WocSeasonStatus => ({
  seasonId: 1, label: 'S1', status: 'active', openedAt: '2026-06-01T00:00:00.000Z',
  endsAt: null, sinkBase: poolBase, emissionBase: '0', poolBase,
});
const ladder: RankedLadderEntry[] = [
  { name: 'Ada', rating: 1900 }, { name: 'Bo', rating: 1800 }, { name: 'Cy', rating: 1700 },
];
const TIERS = [3000, 2000, 1200, 800, 800, 440, 440, 440, 440, 440];

describe('buildSeasonStandings', () => {
  it('returns [] for a null season', () => {
    expect(buildSeasonStandings(null, ladder, TIERS)).toEqual([]);
  });
  it('returns [] for an empty ladder', () => {
    expect(buildSeasonStandings(season('1000000000'), [], TIERS)).toEqual([]);
  });
  it('projects the pool across the ladder as serializable standings', () => {
    expect(buildSeasonStandings(season('1000000000'), ladder, TIERS)).toEqual([
      { rank: 1, name: 'Ada', rating: 1900, rewardBase: '300000000' }, // 30%
      { rank: 2, name: 'Bo', rating: 1800, rewardBase: '200000000' },  // 20%
      { rank: 3, name: 'Cy', rating: 1700, rewardBase: '120000000' },  // 12%
    ]);
  });
});

describe('SeasonBodyCache', () => {
  function setup(seasonValue: WocSeasonStatus | null) {
    let now = 1_000_000;
    const fetchSeason = vi.fn(async () => seasonValue);
    const fetchLadder = vi.fn(async (limit: number) => ladder.slice(0, limit));
    const cache = new SeasonBodyCache({
      fetchSeason, fetchLadder, tierBps: () => TIERS, decimals: 6, now: () => now, ttlMs: 5000,
    });
    return { cache, fetchSeason, fetchLadder, advance: (ms: number) => { now += ms; } };
  }

  it('builds the full body (season + projected standings + decimals)', async () => {
    const { cache } = setup(season('1000000000'));
    const body = await cache.get();
    expect(body.decimals).toBe(6);
    expect(body.season?.seasonId).toBe(1);
    expect(body.standings[0]).toEqual({ rank: 1, name: 'Ada', rating: 1900, rewardBase: '300000000' });
  });

  it('serves a cached body within the TTL (one DB read), refetching only past it', async () => {
    const { cache, fetchSeason, advance } = setup(season('1000000000'));
    await cache.get();
    await cache.get();
    expect(fetchSeason).toHaveBeenCalledTimes(1); // second served from cache
    advance(4999); // still within TTL
    await cache.get();
    expect(fetchSeason).toHaveBeenCalledTimes(1);
    advance(1); // now exactly at TTL → refetch
    await cache.get();
    expect(fetchSeason).toHaveBeenCalledTimes(2);
  });

  it('skips the ladder query entirely when no season is open', async () => {
    const { cache, fetchLadder } = setup(null);
    const body = await cache.get();
    expect(body).toEqual({ season: null, standings: [], decimals: 6 });
    expect(fetchLadder).not.toHaveBeenCalled();
  });

  it('requests exactly tierBps.length ladder entries', async () => {
    const { cache, fetchLadder } = setup(season('1000000000'));
    await cache.get();
    expect(fetchLadder).toHaveBeenCalledWith(TIERS.length);
  });
});
