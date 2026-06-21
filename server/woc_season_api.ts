// Builds the GET /api/woc/season response body and caches it briefly. The pool
// projection over the arena ladder, and the short TTL cache that keeps this
// public, every-client-polled route off the DB hot path, live here as a pure
// composition + an injectable-clock cache, so the route logic is unit-tested
// without booting a server (main.ts is just the thin wiring).
import { projectSeasonRewards } from './reward_tiers';
import type { WocSeasonStatus } from './flow_ledger_db';

export interface SeasonStanding {
  rank: number;
  name: string;
  rating: number;
  rewardBase: string; // base-unit decimal string
}
export interface SeasonBody {
  season: WocSeasonStatus | null;
  standings: SeasonStanding[];
  decimals: number;
}
export interface RankedLadderEntry {
  name: string;
  rating: number;
}

/**
 * Project the season pool across the (best-first) arena ladder into serializable
 * standings. Pure; null season yields no standings.
 */
export function buildSeasonStandings(season: WocSeasonStatus | null, ladder: RankedLadderEntry[], tierBps: number[]): SeasonStanding[] {
  if (!season) return [];
  return projectSeasonRewards(BigInt(season.poolBase), ladder.map((r) => ({ name: r.name, rating: r.rating })), tierBps)
    .map((s) => ({ rank: s.rank, name: s.name, rating: s.rating, rewardBase: s.rewardBase.toString() }));
}

export interface SeasonBodyDeps {
  fetchSeason: () => Promise<WocSeasonStatus | null>;
  fetchLadder: (limit: number) => Promise<RankedLadderEntry[]>;
  tierBps: () => number[];
  decimals: number;
  now: () => number;
  ttlMs: number;
}

/**
 * Caches the (cheap) season body for `ttlMs`: the route is public and polled by
 * every client, so this bounds DB load. The ladder is fetched only when a season
 * is open (no season: one fetchSeason, no ladder query). Concurrent callers
 * within the window share one cached body.
 */
export class SeasonBodyCache {
  private cached: { at: number; body: SeasonBody } | null = null;
  constructor(private readonly deps: SeasonBodyDeps) {}

  async get(): Promise<SeasonBody> {
    const now = this.deps.now();
    if (this.cached && now - this.cached.at < this.deps.ttlMs) return this.cached.body;
    const season = await this.deps.fetchSeason();
    const tierBps = this.deps.tierBps();
    const ladder = season ? await this.deps.fetchLadder(tierBps.length) : [];
    const body: SeasonBody = { season, standings: buildSeasonStandings(season, ladder, tierBps), decimals: this.deps.decimals };
    this.cached = { at: now, body };
    return body;
  }
}
