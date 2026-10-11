// The online world-quest ladder read (src/net/world_quest_leaderboard_wire.ts):
// the viewer rides the query, `self` is parsed defensively, and any failure
// resolves the empty page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWorldQuestLeaderboard,
  parseWorldQuestLeaderboardEntry,
} from '../src/net/world_quest_leaderboard_wire';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn(async (_url: string) => ({ ok, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('parseWorldQuestLeaderboardEntry', () => {
  it('accepts a well-formed row, with or without a medal', () => {
    expect(
      parseWorldQuestLeaderboardEntry({ rank: 4, name: 'Ari', medal: 'gold', metric: 12 }),
    ).toEqual({
      rank: 4,
      name: 'Ari',
      medal: 'gold',
      metric: 12,
    });
    expect(
      parseWorldQuestLeaderboardEntry({ rank: 9, name: 'Bo', medal: null, metric: 0 })?.medal,
    ).toBeNull();
  });

  it('rejects every malformed field one at a time', () => {
    const good = { rank: 1, name: 'Ari', medal: 'silver', metric: 3 };
    expect(parseWorldQuestLeaderboardEntry(null)).toBeNull();
    expect(parseWorldQuestLeaderboardEntry('Ari')).toBeNull();
    expect(parseWorldQuestLeaderboardEntry({ ...good, rank: 0 })).toBeNull();
    expect(parseWorldQuestLeaderboardEntry({ ...good, rank: '1' })).toBeNull();
    expect(parseWorldQuestLeaderboardEntry({ ...good, name: '' })).toBeNull();
    expect(parseWorldQuestLeaderboardEntry({ ...good, metric: Number.NaN })).toBeNull();
    expect(parseWorldQuestLeaderboardEntry({ ...good, medal: 'platinum' })).toBeNull();
    expect(parseWorldQuestLeaderboardEntry({ ...good, medal: undefined })).toBeNull();
  });
});

describe('fetchWorldQuestLeaderboard', () => {
  it('sends the viewer and returns the parsed self row', async () => {
    const fetchMock = stubFetch({
      leaders: [{ rank: 1, name: 'Top', medal: 'gold', metric: 40 }],
      page: 0,
      pageCount: 2,
      total: 60,
      pageSize: 50,
      self: { rank: 57, name: 'Ari Vale', medal: 'bronze', metric: 3 },
    });
    const page = await fetchWorldQuestLeaderboard('', 'forge', 0, 50, 'Ari Vale');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(
      '/api/world-quests/leaderboard?board=forge&page=0&pageSize=50&viewer=Ari%20Vale',
    );
    expect(page.self).toEqual({ rank: 57, name: 'Ari Vale', medal: 'bronze', metric: 3 });
    expect(page.total).toBe(60);
  });

  it('omits the viewer when none is given and reads a missing or bad self as null', async () => {
    const fetchMock = stubFetch({ leaders: [], self: { rank: 'x' } });
    const page = await fetchWorldQuestLeaderboard('', 'slalom', 0, 50);
    expect(fetchMock.mock.calls[0][0]).not.toContain('viewer=');
    expect(page.self).toBeNull();
  });

  it('resolves the empty page on a failed response', async () => {
    stubFetch({}, false);
    const page = await fetchWorldQuestLeaderboard('', 'slalom', 3, 50, 'Ari');
    expect(page).toMatchObject({ board: 'slalom', leaders: [], page: 0, total: 0, self: null });
  });
});
