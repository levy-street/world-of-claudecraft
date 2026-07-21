// The repo contributor-stats reader: the single source of "merged pull requests
// per GitHub login" that backs the developer badge. We fetch GitHub's closed
// pull requests server-side, filter to merged, tally per author, and cache the
// result process-locally, the same compute-once / serve-from-memory pattern as
// the GitHub Releases proxy in server/main.ts (and the holder-tier cache in
// woc_balance.ts): one shared server IP, an optional GITHUB_TOKEN to lift the
// rate limit, and a graceful fall back to the last good snapshot on a transient
// failure.
//
// Merged PRs, not raw commits: this repo merges with real merge commits (not
// squashes), so a raw commit count (e.g. GitHub's /contributors stats) would
// let a contributor pad their badge by splitting one contribution into many
// trivial "wip"/"fix typo" commits on a branch that still gets merged whole.
// Counting merged PRs means commit-spamming inside one PR still only ever earns
// one rung of credit, so the unit is "a reviewed, accepted contribution".
// GitHub merges duplicate author identities (multiple emails) onto one login
// upstream, so keying on the verified OAuth login sidesteps the author-email
// matching problem entirely. Bots (type !== 'User') are excluded.
//
// The parse helpers are pure and exported so they can be unit tested without a
// network; only fetchAllContributors() touches fetch.
import { devTierIndexForMergedPrs } from '../src/sim/dev_tier';
import { LEADERBOARD_MAX } from '../src/sim/leaderboard_page';
import type { DevLeaderboardEntry } from '../src/world_api';
import { recordUsageCacheEvent, recordUsageMetric, setUsageCacheSize } from './provider_usage';

const DEFAULT_GITHUB_REPO = 'levy-street/world-of-claudecraft';
const GITHUB_API_HOST = 'api.github.com';

// The repo slug + optional token, INJECTED at boot (server/main.ts wires these from
// the one validated boot Config via configureGithubContributorsRuntime, matching the
// configure<Domain>Runtime convention) rather than read from process.env at module
// load. That removes this module's duplicate of main.ts's GITHUB_REPO/GITHUB_TOKEN
// reads and keeps a bare import inert. The defaults point at the public repo with no
// token, identical to an unset env, so the pure parsers and any pre-boot read behave
// exactly as before.
interface GithubContributorsRuntime {
  readonly githubRepo: string;
  readonly githubToken: string;
}
let runtime: GithubContributorsRuntime = { githubRepo: DEFAULT_GITHUB_REPO, githubToken: '' };

/** Inject the repo slug + optional token. Called once at boot from server/main.ts. */
export function configureGithubContributorsRuntime(rt: GithubContributorsRuntime): void {
  runtime = { githubRepo: rt.githubRepo || DEFAULT_GITHUB_REPO, githubToken: rt.githubToken };
}

const CONTRIBUTORS_TTL_MS = 30 * 60_000; // 30 min; merged-PR counts change slowly
const CONTRIBUTORS_PER_PAGE = 100;
const CONTRIBUTORS_MAX_PAGES = 30; // 3000 closed PRs cap; well past the repo's current history
const FAILURE_COOLDOWN_MS = 5 * 60_000; // after a failed fetch, wait before retrying

setUsageCacheSize('github.contributors', 0, LEADERBOARD_MAX);

export interface ContributorStat {
  login: string;
  mergedPrs: number;
}

/**
 * Parse one page of GitHub's GET /pulls?state=closed response into the author
 * logins of MERGED pull requests only (one entry per merged PR; a closed-but-
 * not-merged PR contributed nothing and is dropped), keeping only real users
 * (type 'User'; bots are dropped).
 */
export function parseMergedPrLogins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const pr of value) {
    if (!pr || typeof pr !== 'object') continue;
    const v = pr as Record<string, unknown>;
    if (typeof v.merged_at !== 'string') continue; // closed without merging
    const user = v.user;
    if (!user || typeof user !== 'object') continue;
    const u = user as Record<string, unknown>;
    if (u.type !== 'User') continue;
    const login = typeof u.login === 'string' ? u.login : '';
    if (login) out.push(login);
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

/**
 * Whether a URL is safe to re-issue the GITHUB_TOKEN bearer header to: exactly
 * api.github.com over https. Defense in depth around the paginated fetch loop,
 * which re-attaches the token to whatever URL the previous response's Link
 * header named; this stops that token from ever following a redirected or
 * malformed Link header off api.github.com.
 */
export function isTrustedGithubApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.host === GITHUB_API_HOST;
  } catch {
    return false;
  }
}

/** Lowercase-keyed login -> merged-PR count, for case-insensitive lookup. */
export type ContributorMap = Map<string, number>;

/** Fold parsed contributor stats into the lowercase-keyed lookup map. */
export function contributorsToMap(stats: readonly ContributorStat[]): ContributorMap {
  const map: ContributorMap = new Map();
  for (const s of stats) map.set(s.login.toLowerCase(), s.mergedPrs);
  return map;
}

/** Sort contributor stats by merged-PR count descending, ties broken by login. */
export function sortContributors(stats: readonly ContributorStat[]): ContributorStat[] {
  return [...stats].sort((a, b) => b.mergedPrs - a.mergedPrs || a.login.localeCompare(b.login));
}

/**
 * Fold a flat list of merged-PR author logins (one entry per PR, repeats
 * expected) into per-login counts, sorted rank-descending.
 */
export function tallyMergedPrs(logins: readonly string[]): ContributorStat[] {
  const counts = new Map<string, number>();
  for (const login of logins) counts.set(login, (counts.get(login) ?? 0) + 1);
  return sortContributors(
    [...counts.entries()].map(([login, mergedPrs]) => ({ login, mergedPrs })),
  );
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
    ...(runtime.githubToken ? { Authorization: `Bearer ${runtime.githubToken}` } : {}),
  };
}

// Fetch every page of closed pull requests, tally the merged ones by author,
// sorted rank-descending. Throws on a non-OK status or network error so
// getContributors() can serve the last cache.
async function fetchAllContributors(): Promise<ContributorStat[]> {
  recordUsageMetric('github.contributors.fetch');
  const logins: string[] = [];
  const pullsUrl = `https://${GITHUB_API_HOST}/repos/${runtime.githubRepo}/pulls`;
  let url: string | null =
    `${pullsUrl}?state=closed&per_page=${CONTRIBUTORS_PER_PAGE}&sort=created&direction=desc`;
  for (let page = 0; page < CONTRIBUTORS_MAX_PAGES && url; page++) {
    const res: Response = await fetch(url, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`github pulls ${res.status}`);
    const body: unknown = await res.json();
    logins.push(...parseMergedPrLogins(body));
    const next = parseNextPageUrl(res.headers.get('link'));
    if (next && !isTrustedGithubApiUrl(next)) {
      throw new Error('github pulls: next-page link left api.github.com');
    }
    url = next;
  }
  return tallyMergedPrs(logins);
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
 * Merged-PR count for a GitHub login (case-insensitive), or 0 when the login
 * has no merged pull requests. Reads the cached snapshot (refreshing if stale).
 */
export async function mergedPrsForLogin(login: string): Promise<number> {
  if (!login) return 0;
  const { byLogin } = await getContributors();
  return byLogin.get(login.toLowerCase()) ?? 0;
}

/**
 * The top contributors as ranked developer-leaderboard rows (rank 1 = most
 * merged PRs), each with the dev tier its merged-PR count earns. Capped at
 * LEADERBOARD_MAX. Reads the cached snapshot (refreshing if stale).
 *
 * DELIBERATELY EXEMPT from the moderation delisting every player-derived
 * board applies (db.ts ELIGIBLE_ACCOUNT_SQL): this board ranks GitHub
 * identities from the public repo stats, with no game-account linkage, so
 * there is nothing to moderate against. A decision, not an omission.
 */
export async function topContributors(limit = LEADERBOARD_MAX): Promise<DevLeaderboardEntry[]> {
  const { stats } = await getContributors();
  return stats.slice(0, Math.max(0, limit)).map((s, i) => ({
    rank: i + 1,
    login: s.login,
    mergedPrs: s.mergedPrs,
    devTier: devTierIndexForMergedPrs(s.mergedPrs),
  }));
}

/** Test-only: clear the cache so each case starts cold. */
export function resetContributorsCache(): void {
  contributorsCache = null;
  refreshing = null;
  cooldownUntil = 0;
}
