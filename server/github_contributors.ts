// The repo contributor-stats reader: the single source of "landed commits per
// GitHub login" that backs the developer badge. We fetch GitHub's public
// /contributors endpoint server-side and cache it process-locally, the same
// compute-once / serve-from-memory pattern as the GitHub Releases proxy in
// server/main.ts (and the holder-tier cache in woc_balance.ts): one shared server
// IP, an optional GITHUB_TOKEN to lift the rate limit, and a graceful fall back to
// the last good snapshot on a transient failure.
//
// The contributors endpoint counts non-merge commits on the default branch per
// linked GitHub account, which is exactly "commits that have landed into the
// game". GitHub merges duplicate author identities (multiple emails) onto one
// login upstream, so keying on the verified OAuth login sidesteps the
// author-email matching problem entirely. Bots (type !== 'User') are excluded.
//
// The parse helpers are pure and exported so they can be unit tested without a
// network; only refreshContributors() touches fetch.

const GITHUB_REPO = process.env.GITHUB_REPO ?? 'levy-street/world-of-claudecraft';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const CONTRIBUTORS_URL = `https://api.github.com/repos/${GITHUB_REPO}/contributors`;
const CONTRIBUTORS_TTL_MS = 30 * 60_000; // 30 min; contributor counts change slowly
const CONTRIBUTORS_PER_PAGE = 100;
const CONTRIBUTORS_MAX_PAGES = 20; // 2000 contributors cap; far beyond the real count

export interface ContributorStat {
  login: string;
  commits: number;
}

/**
 * Parse one page of the GitHub /contributors response into login -> commit-count
 * entries, keeping only real users (type 'User'; Bots and Anonymous are dropped)
 * with a positive contribution count and a string login.
 */
export function parseContributorsPage(value: unknown): ContributorStat[] {
  if (!Array.isArray(value)) return [];
  const out: ContributorStat[] = [];
  for (const c of value) {
    if (!c || typeof c !== 'object') continue;
    const v = c as Record<string, unknown>;
    if (v.type !== 'User') continue;
    const login = typeof v.login === 'string' ? v.login : '';
    const commits = typeof v.contributions === 'number' ? v.contributions : 0;
    if (!login || !Number.isFinite(commits) || commits <= 0) continue;
    out.push({ login, commits: Math.floor(commits) });
  }
  return out;
}

/**
 * Extract the rel="next" URL from a GitHub Link response header, or null when
 * there is no next page. Tolerant of spacing and attribute order.
 */
export function parseNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (match) return match[1];
  }
  return null;
}

/** Lowercase-keyed login -> landed-commit count, for case-insensitive lookup. */
export type ContributorMap = Map<string, number>;

/** Fold parsed contributor stats into the lowercase-keyed lookup map. */
export function contributorsToMap(stats: readonly ContributorStat[]): ContributorMap {
  const map: ContributorMap = new Map();
  for (const s of stats) map.set(s.login.toLowerCase(), s.commits);
  return map;
}

let contributorsCache: { at: number; map: ContributorMap } | null = null;
let refreshing: Promise<ContributorMap> | null = null;

function githubHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'world-of-claudecraft-server',
    ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
  };
}

// Fetch every page of the contributors list and build the lookup map. Throws on a
// non-OK status or network error so getContributors() can serve the last cache.
async function fetchAllContributors(): Promise<ContributorMap> {
  const stats: ContributorStat[] = [];
  let url: string | null = `${CONTRIBUTORS_URL}?per_page=${CONTRIBUTORS_PER_PAGE}&anon=0`;
  for (let page = 0; page < CONTRIBUTORS_MAX_PAGES && url; page++) {
    const res: Response = await fetch(url, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`github contributors ${res.status}`);
    const body: unknown = await res.json();
    stats.push(...parseContributorsPage(body));
    url = parseNextPageUrl(res.headers.get('link'));
  }
  return contributorsToMap(stats);
}

/**
 * The cached contributor map. Refreshes when stale (deduping concurrent refreshes
 * behind one in-flight promise) and falls back to the last good snapshot, or an
 * empty map, when a refresh fails.
 */
export async function getContributors(): Promise<ContributorMap> {
  if (contributorsCache && Date.now() - contributorsCache.at < CONTRIBUTORS_TTL_MS) {
    return contributorsCache.map;
  }
  if (!refreshing) {
    refreshing = fetchAllContributors()
      .then((map) => {
        contributorsCache = { at: Date.now(), map };
        return map;
      })
      .catch((err) => {
        console.error('github contributors refresh failed:', err);
        return contributorsCache?.map ?? new Map<string, number>();
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/**
 * Landed-commit count for a GitHub login (case-insensitive), or 0 when the login
 * is not a contributor. Reads the cached contributor map (refreshing if stale).
 */
export async function commitsForLogin(login: string): Promise<number> {
  if (!login) return 0;
  const map = await getContributors();
  return map.get(login.toLowerCase()) ?? 0;
}

/** Test-only: clear the cache so each case starts cold. */
export function resetContributorsCache(): void {
  contributorsCache = null;
  refreshing = null;
}
