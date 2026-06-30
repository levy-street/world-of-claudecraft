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
import { devTierIndexForCommits } from '../src/sim/dev_tier';
import { LEADERBOARD_MAX } from '../src/sim/leaderboard_page';
import type { DevLeaderboardEntry } from '../src/world_api';
import { recordUsageCacheEvent, recordUsageMetric, setUsageCacheSize } from './provider_usage';

const GITHUB_REPO = process.env.GITHUB_REPO ?? 'levy-street/world-of-claudecraft';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const CONTRIBUTORS_URL = `https://api.github.com/repos/${GITHUB_REPO}/contributors`;
const CONTRIBUTORS_TTL_MS = 30 * 60_000; // 30 min; contributor counts change slowly
const CONTRIBUTORS_PER_PAGE = 100;
const CONTRIBUTORS_MAX_PAGES = 20; // 2000 contributors cap; far beyond the real count
const FAILURE_COOLDOWN_MS = 5 * 60_000; // after a failed fetch, wait before retrying

setUsageCacheSize('github.contributors', 0, LEADERBOARD_MAX);

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

/** Sort contributor stats by landed commits descending, ties broken by login. */
export function sortContributors(stats: readonly ContributorStat[]): ContributorStat[] {
  return [...stats].sort((a, b) => b.commits - a.commits || a.login.localeCompare(b.login));
}

// A resolved snapshot: the original-case stats sorted rank-descending (so the
// leaderboard is a cheap slice) plus a lowercase lookup map (so a per-login badge
// tier is case-insensitive).
export interface ContributorSnapshot {
  stats: ContributorStat[];
  byLogin: ContributorMap;
}

const EMPTY_SNAPSHOT: ContributorSnapshot = { stats: [], byLogin: new Map() };

let contributorsCache: { at: number; snapshot: ContributorSnapshot } | null = null;
let refreshing: Promise<ContributorSnapshot> | null = null;
// After a failed fetch, do not retry until this time: a down or rate-limited
// GitHub API must not be re-hit on every refresh cycle / status read.
let cooldownUntil = 0;

function githubHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'world-of-claudecraft-server',
    ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
  };
}

// Fetch every page of the contributors list, sorted rank-descending. Throws on a
// non-OK status or network error so getContributors() can serve the last cache.
async function fetchAllContributors(): Promise<ContributorStat[]> {
  recordUsageMetric('github.contributors.fetch');
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
  return sortContributors(stats);
}

/**
 * The cached contributor snapshot. Serves the last good snapshot while a refresh
 * is in flight and through a post-failure cooldown, so a down / rate-limited
 * GitHub API is not re-fetched on every call. Refreshes when stale and not in
 * cooldown, deduping concurrent refreshes behind one in-flight promise.
 */
export async function getContributors(): Promise<ContributorSnapshot> {
  const now = Date.now();
  if (contributorsCache && now - contributorsCache.at < CONTRIBUTORS_TTL_MS) {
    recordUsageCacheEvent('github.contributors', 'hit');
    return contributorsCache.snapshot;
  }
  // Back off after a failure: keep serving the last snapshot (or empty) rather
  // than re-hitting a failing API every cycle.
  if (now < cooldownUntil) {
    recordUsageCacheEvent('github.contributors', 'stale');
    return contributorsCache?.snapshot ?? EMPTY_SNAPSHOT;
  }
  recordUsageCacheEvent('github.contributors', contributorsCache ? 'stale' : 'miss');
  if (!refreshing) {
    refreshing = fetchAllContributors()
      .then((stats) => {
        const snapshot: ContributorSnapshot = { stats, byLogin: contributorsToMap(stats) };
        contributorsCache = { at: Date.now(), snapshot };
        cooldownUntil = 0;
        recordUsageCacheEvent('github.contributors', 'store');
        setUsageCacheSize('github.contributors', stats.length, LEADERBOARD_MAX);
        return snapshot;
      })
      .catch((err) => {
        console.error('github contributors refresh failed:', err);
        cooldownUntil = Date.now() + FAILURE_COOLDOWN_MS;
        recordUsageMetric('github.contributors.fetch.failure');
        recordUsageCacheEvent('github.contributors', 'failure');
        return contributorsCache?.snapshot ?? EMPTY_SNAPSHOT;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/**
 * Landed-commit count for a GitHub login (case-insensitive), or 0 when the login
 * is not a contributor. Reads the cached snapshot (refreshing if stale).
 */
export async function commitsForLogin(login: string): Promise<number> {
  if (!login) return 0;
  const { byLogin } = await getContributors();
  return byLogin.get(login.toLowerCase()) ?? 0;
}

/**
 * The top contributors as ranked developer-leaderboard rows (rank 1 = most landed
 * commits), each with the dev tier its commit count earns. Capped at
 * LEADERBOARD_MAX. Reads the cached snapshot (refreshing if stale).
 */
export async function topContributors(limit = LEADERBOARD_MAX): Promise<DevLeaderboardEntry[]> {
  const { stats } = await getContributors();
  return stats.slice(0, Math.max(0, limit)).map((s, i) => ({
    rank: i + 1,
    login: s.login,
    commits: s.commits,
    devTier: devTierIndexForCommits(s.commits),
  }));
}

/** Test-only: clear the cache so each case starts cold. */
export function resetContributorsCache(): void {
  contributorsCache = null;
  refreshing = null;
  cooldownUntil = 0;
}
