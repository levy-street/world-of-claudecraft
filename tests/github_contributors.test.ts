import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ContributorStat,
  contributorsToMap,
  getContributors,
  isTrustedGithubApiUrl,
  mergedPrsForLogin,
  parseMergedPrLogins,
  parseNextPageUrl,
  resetContributorsCache,
  sortContributors,
  tallyMergedPrs,
  topContributors,
} from '../server/github_contributors';
import { providerUsageSnapshot, resetProviderUsageForTests } from '../server/provider_usage';

function pr(login: string, opts: { merged?: boolean; type?: string } = {}): unknown {
  const merged = opts.merged ?? true;
  return {
    number: 1,
    user: { login, type: opts.type ?? 'User' },
    merged_at: merged ? '2024-01-01T00:00:00Z' : null,
  };
}

describe('parseMergedPrLogins', () => {
  it('keeps only MERGED pull requests by real users, dropping closed-not-merged and bots', () => {
    const page = [
      pr('FernandoX7'),
      pr('jgyy'),
      pr('someone', { merged: false }), // closed without merging: contributed nothing
      pr('dependabot[bot]', { type: 'Bot' }),
      pr('ghost-author', { type: 'Anonymous' }),
    ];
    expect(parseMergedPrLogins(page)).toEqual(['FernandoX7', 'jgyy']);
  });

  it('one entry per merged PR (repeats expected), so multiple PRs by one author appear multiple times', () => {
    const page = [pr('jgyy'), pr('jgyy'), pr('FernandoX7')];
    expect(parseMergedPrLogins(page)).toEqual(['jgyy', 'jgyy', 'FernandoX7']);
  });

  it('tolerates junk entries and a non-array body', () => {
    expect(
      parseMergedPrLogins([
        null,
        7,
        { user: { type: 'User' } }, // no login
        { user: { login: 'x', type: 'User' } }, // no merged_at -> not merged
        { merged_at: '2024-01-01T00:00:00Z' }, // no user
      ]),
    ).toEqual([]);
    expect(parseMergedPrLogins('not an array' as unknown)).toEqual([]);
  });
});

describe('parseNextPageUrl', () => {
  it('extracts the rel="next" link, ignoring other rels', () => {
    const header =
      '<https://api.github.com/repositories/1/pulls?per_page=100&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/pulls?per_page=100&page=5>; rel="last"';
    expect(parseNextPageUrl(header)).toBe(
      'https://api.github.com/repositories/1/pulls?per_page=100&page=2',
    );
  });

  it('returns null when there is no next page or no header', () => {
    expect(parseNextPageUrl('<https://api.github.com/x?page=5>; rel="last"')).toBeNull();
    expect(parseNextPageUrl(null)).toBeNull();
    expect(parseNextPageUrl('')).toBeNull();
  });
});

describe('isTrustedGithubApiUrl', () => {
  it('accepts only https URLs whose host is exactly api.github.com', () => {
    expect(isTrustedGithubApiUrl('https://api.github.com/repositories/1/pulls?page=2')).toBe(true);
  });

  it('rejects a different host, including a look-alike subdomain', () => {
    expect(isTrustedGithubApiUrl('https://evil.example.com/pulls?page=2')).toBe(false);
    expect(isTrustedGithubApiUrl('https://api.github.com.evil.example.com/pulls')).toBe(false);
    expect(isTrustedGithubApiUrl('https://notapi.github.com/pulls')).toBe(false);
  });

  it('rejects a non-https scheme even on the right host', () => {
    expect(isTrustedGithubApiUrl('http://api.github.com/pulls')).toBe(false);
  });

  it('rejects an unparseable URL instead of throwing', () => {
    expect(isTrustedGithubApiUrl('not a url')).toBe(false);
    expect(isTrustedGithubApiUrl('')).toBe(false);
  });
});

describe('tallyMergedPrs', () => {
  it('folds a flat list of logins (with repeats) into per-login counts, sorted rank-descending', () => {
    expect(tallyMergedPrs(['jgyy', 'FernandoX7', 'jgyy', 'jgyy', 'FernandoX7'])).toEqual([
      { login: 'jgyy', mergedPrs: 3 },
      { login: 'FernandoX7', mergedPrs: 2 },
    ]);
  });

  it('returns an empty list for an empty input', () => {
    expect(tallyMergedPrs([])).toEqual([]);
  });
});

describe('contributorsToMap', () => {
  it('builds a lowercase-keyed lookup for case-insensitive logins', () => {
    const map = contributorsToMap([
      { login: 'FernandoX7', mergedPrs: 27 },
      { login: 'JGYY', mergedPrs: 138 },
    ]);
    expect(map.get('fernandox7')).toBe(27);
    expect(map.get('jgyy')).toBe(138);
    expect(map.get('unknown')).toBeUndefined();
  });
});

describe('sortContributors', () => {
  it('sorts by merged-PR count descending, ties broken by login', () => {
    const stats: ContributorStat[] = [
      { login: 'jgyy', mergedPrs: 138 },
      { login: 'FernandoX7', mergedPrs: 27 },
      { login: 'bbb', mergedPrs: 5 },
      { login: 'aaa', mergedPrs: 5 },
    ];
    expect(sortContributors(stats)).toEqual([
      { login: 'jgyy', mergedPrs: 138 },
      { login: 'FernandoX7', mergedPrs: 27 },
      { login: 'aaa', mergedPrs: 5 },
      { login: 'bbb', mergedPrs: 5 },
    ]);
  });

  it('does not mutate the input array', () => {
    const stats: ContributorStat[] = [
      { login: 'a', mergedPrs: 1 },
      { login: 'b', mergedPrs: 9 },
    ];
    const copy = [...stats];
    sortContributors(stats);
    expect(stats).toEqual(copy);
  });
});

// The cached fetch + cooldown behavior under a mocked global fetch. Each test
// resets the module-local cache so they run cold and independently.
describe('getContributors / topContributors / mergedPrsForLogin (cached fetch)', () => {
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
    mockOnePageResponse([pr('FernandoX7'), pr('FernandoX7'), pr('jgyy')]);
    const snapshot = await getContributors();
    expect(snapshot.stats).toEqual([
      { login: 'FernandoX7', mergedPrs: 2 },
      { login: 'jgyy', mergedPrs: 1 },
    ]);
    expect(snapshot.byLogin.get('fernandox7')).toBe(2);
    // A second call within the TTL must not re-fetch.
    await getContributors();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ranks topContributors by merged PRs with the earned dev tier, capped at the limit', async () => {
    mockOnePageResponse([
      pr('FernandoX7'),
      pr('FernandoX7'),
      pr('FernandoX7'),
      pr('FernandoX7'),
      pr('FernandoX7'), // 5 merged PRs -> Artificer (rung 2)
      pr('jgyy'), // 1 merged PR -> Tinkerer (rung 1)
      pr('newdev', { merged: false }), // closed, never merged: 0 credit
    ]);
    const top = await topContributors(2);
    expect(top).toEqual([
      { rank: 1, login: 'FernandoX7', mergedPrs: 5, devTier: 2 },
      { rank: 2, login: 'jgyy', mergedPrs: 1, devTier: 1 },
    ]);
  });

  it('mergedPrsForLogin resolves case-insensitively and 0 for a non-contributor', async () => {
    mockOnePageResponse([pr('FernandoX7')]);
    expect(await mergedPrsForLogin('fernandox7')).toBe(1);
    expect(await mergedPrsForLogin('FERNANDOX7')).toBe(1);
    expect(await mergedPrsForLogin('nobody')).toBe(0);
    expect(await mergedPrsForLogin('')).toBe(0);
  });

  it('aborts pagination (never re-attaches the token off api.github.com) when a Link header points elsewhere', async () => {
    const fetchSpy = vi.fn(async (url: unknown) => {
      if (String(url).includes('api.github.com')) {
        return {
          ok: true,
          status: 200,
          headers: {
            get: () => '<https://evil.example.com/repositories/1/pulls?page=2>; rel="next"',
          },
          json: async () => [pr('FernandoX7')],
        };
      }
      throw new Error('must never be called: untrusted host');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const snapshot = await getContributors();
    // The failed refresh serves the empty snapshot (no prior cache), exactly
    // like any other fetch failure, and never issued a second request.
    expect(snapshot.stats).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
      mockOnePageResponse([pr('FernandoX7')]);
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

// Proves the admin-dashboard telemetry calls actually fire at the right moments
// (not just that the code compiles): a cold miss + successful fetch records a
// fetch attempt, a cache store, and the right entry count; a warm call records a
// hit with no further fetch; and a failed refresh records both the fetch-failure
// metric and the cache failure event, reading the real counters back through
// providerUsageSnapshot() exactly as the admin dashboard does.
describe('github_contributors telemetry (provider_usage wiring)', () => {
  beforeEach(() => {
    resetContributorsCache();
    resetProviderUsageForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetContributorsCache();
    resetProviderUsageForTests();
  });

  function metricCount(key: string): number {
    const snap = providerUsageSnapshot();
    const metric = snap.metrics.find((m) => m.key === key);
    return metric ? metric.counts.h24 : -1;
  }

  function cacheStats(key: string) {
    const snap = providerUsageSnapshot();
    const cache = snap.caches.find((c) => c.key === key);
    if (!cache) throw new Error(`cache key not registered: ${key}`);
    return cache;
  }

  it('records a fetch attempt + cache store + entry count on a cold miss', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [pr('FernandoX7'), pr('jgyy')],
      })),
    );
    expect(metricCount('github.contributors.fetch')).toBe(0);
    expect(cacheStats('github.contributors').stores).toBe(0);

    await getContributors();

    expect(metricCount('github.contributors.fetch')).toBe(1);
    const stats = cacheStats('github.contributors');
    expect(stats.stores).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.entries).toBe(2);
    expect(stats.maxEntries).not.toBeNull();
  });

  it('records a hit (no fetch) on a warm call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [pr('jgyy')],
      })),
    );
    await getContributors(); // primes the cache (1 fetch, 1 store)
    expect(metricCount('github.contributors.fetch')).toBe(1);

    await getContributors(); // served from cache: no second fetch

    expect(metricCount('github.contributors.fetch')).toBe(1); // unchanged
    expect(cacheStats('github.contributors').hits).toBe(1);
  });

  it('records a fetch failure metric and a cache failure event on a failed refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(metricCount('github.contributors.fetch.failure')).toBe(0);

    await getContributors();

    expect(metricCount('github.contributors.fetch')).toBe(1); // the attempt was made
    expect(metricCount('github.contributors.fetch.failure')).toBe(1);
    expect(cacheStats('github.contributors').failures).toBe(1);
  });
});
