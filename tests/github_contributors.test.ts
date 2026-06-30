import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ContributorStat,
  commitsForLogin,
  contributorsToMap,
  getContributors,
  parseContributorsPage,
  parseNextPageUrl,
  resetContributorsCache,
  sortContributors,
  topContributors,
} from '../server/github_contributors';

describe('parseContributorsPage', () => {
  it('keeps real users with a positive commit count, dropping bots and anonymous', () => {
    const page = [
      { login: 'FernandoX7', type: 'User', contributions: 821 },
      { login: 'jgyy', type: 'User', contributions: 664 },
      { login: 'dependabot[bot]', type: 'Bot', contributions: 50 },
      { name: 'someone@example.com', type: 'Anonymous', contributions: 9 },
      { login: 'ghost', type: 'User', contributions: 0 },
      { login: 'neg', type: 'User', contributions: -3 },
    ];
    expect(parseContributorsPage(page)).toEqual([
      { login: 'FernandoX7', commits: 821 },
      { login: 'jgyy', commits: 664 },
    ]);
  });

  it('floors fractional contribution counts and tolerates junk entries', () => {
    expect(parseContributorsPage([{ login: 'x', type: 'User', contributions: 12.9 }])).toEqual([
      { login: 'x', commits: 12 },
    ]);
    expect(
      parseContributorsPage([null, 7, { type: 'User' }, { login: 'y', type: 'User' }]),
    ).toEqual([]);
    expect(parseContributorsPage('not an array' as unknown)).toEqual([]);
  });
});

describe('parseNextPageUrl', () => {
  it('extracts the rel="next" link, ignoring other rels', () => {
    const header =
      '<https://api.github.com/repositories/1/contributors?per_page=100&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/contributors?per_page=100&page=5>; rel="last"';
    expect(parseNextPageUrl(header)).toBe(
      'https://api.github.com/repositories/1/contributors?per_page=100&page=2',
    );
  });

  it('returns null when there is no next page or no header', () => {
    expect(parseNextPageUrl('<https://api.github.com/x?page=5>; rel="last"')).toBeNull();
    expect(parseNextPageUrl(null)).toBeNull();
    expect(parseNextPageUrl('')).toBeNull();
  });
});

describe('contributorsToMap', () => {
  it('builds a lowercase-keyed lookup for case-insensitive logins', () => {
    const map = contributorsToMap([
      { login: 'FernandoX7', commits: 821 },
      { login: 'JGYY', commits: 664 },
    ]);
    expect(map.get('fernandox7')).toBe(821);
    expect(map.get('jgyy')).toBe(664);
    expect(map.get('unknown')).toBeUndefined();
  });
});

describe('sortContributors', () => {
  it('sorts by landed commits descending, ties broken by login', () => {
    const stats: ContributorStat[] = [
      { login: 'jgyy', commits: 664 },
      { login: 'FernandoX7', commits: 821 },
      { login: 'bbb', commits: 50 },
      { login: 'aaa', commits: 50 },
    ];
    expect(sortContributors(stats)).toEqual([
      { login: 'FernandoX7', commits: 821 },
      { login: 'jgyy', commits: 664 },
      { login: 'aaa', commits: 50 },
      { login: 'bbb', commits: 50 },
    ]);
  });

  it('does not mutate the input array', () => {
    const stats: ContributorStat[] = [
      { login: 'a', commits: 1 },
      { login: 'b', commits: 9 },
    ];
    const copy = [...stats];
    sortContributors(stats);
    expect(stats).toEqual(copy);
  });
});

// The cached fetch + cooldown behavior under a mocked global fetch. Each test
// resets the module-local cache so they run cold and independently.
describe('getContributors / topContributors / commitsForLogin (cached fetch)', () => {
  beforeEach(() => {
    resetContributorsCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetContributorsCache();
  });

  function mockOnePageResponse(body: unknown): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null }, // no rel="next" -> single page
        json: async () => body,
      })),
    );
  }

  it('fetches, caches, and serves the contributor snapshot', async () => {
    mockOnePageResponse([
      { login: 'FernandoX7', type: 'User', contributions: 821 },
      { login: 'jgyy', type: 'User', contributions: 664 },
    ]);
    const snapshot = await getContributors();
    expect(snapshot.stats).toEqual([
      { login: 'FernandoX7', commits: 821 },
      { login: 'jgyy', commits: 664 },
    ]);
    expect(snapshot.byLogin.get('jgyy')).toBe(664);
    // A second call within the TTL must not re-fetch.
    await getContributors();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ranks topContributors by landed commits with the earned dev tier, capped at the limit', async () => {
    mockOnePageResponse([
      { login: 'FernandoX7', type: 'User', contributions: 821 },
      { login: 'jgyy', type: 'User', contributions: 664 },
      { login: 'newdev', type: 'User', contributions: 3 },
    ]);
    const top = await topContributors(2);
    expect(top).toEqual([
      { rank: 1, login: 'FernandoX7', commits: 821, devTier: 5 },
      { rank: 2, login: 'jgyy', commits: 664, devTier: 5 },
    ]);
  });

  it('commitsForLogin resolves case-insensitively and 0 for a non-contributor', async () => {
    mockOnePageResponse([{ login: 'FernandoX7', type: 'User', contributions: 821 }]);
    expect(await commitsForLogin('fernandox7')).toBe(821);
    expect(await commitsForLogin('FERNANDOX7')).toBe(821);
    expect(await commitsForLogin('nobody')).toBe(0);
    expect(await commitsForLogin('')).toBe(0);
  });

  it('serves an empty snapshot (never throws) when the very first fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const snapshot = await getContributors();
    expect(snapshot.stats).toEqual([]);
    expect(snapshot.byLogin.size).toBe(0);
  });

  it('backs off after a failure: a second call inside the cooldown does not re-fetch', async () => {
    const failing = vi.fn(async () => {
      throw new Error('rate limited');
    });
    vi.stubGlobal('fetch', failing);
    await getContributors();
    await getContributors();
    // Both calls land inside the post-failure cooldown window, so only the first
    // call actually hit the network; a down/rate-limited API is not hammered.
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('keeps serving the last good snapshot (not wiped) through a cooldown after a later failure', async () => {
    vi.useFakeTimers();
    try {
      mockOnePageResponse([{ login: 'FernandoX7', type: 'User', contributions: 821 }]);
      const first = await getContributors();
      expect(first.stats).toHaveLength(1);

      // Advance past the 30-minute TTL so the next call is considered stale, and
      // make the refresh attempt fail.
      vi.advanceTimersByTime(31 * 60_000);
      const failing = vi.fn(async () => {
        throw new Error('network down');
      });
      vi.stubGlobal('fetch', failing);
      const second = await getContributors();
      // The failed refresh must NOT wipe the last good snapshot.
      expect(second.stats).toEqual(first.stats);
      expect(failing).toHaveBeenCalledTimes(1);

      // A second call still inside the post-failure cooldown serves the same
      // snapshot without attempting another fetch.
      const third = await getContributors();
      expect(third.stats).toEqual(first.stats);
      expect(failing).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
