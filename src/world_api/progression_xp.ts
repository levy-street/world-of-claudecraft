import type {
  DevLeaderboardPage,
  GuildLeaderboardPage,
  LeaderboardPage,
} from '../sim/leaderboard_page';
import type { PlayerClass } from '../sim/types';

// One ranked row of the lifetime-XP leaderboard (Max-Level XP Overflow). Always
// computed server-side; the client only displays it.
export interface LeaderboardEntry {
  rank: number;
  name: string;
  cls: PlayerClass;
  level: number;
  virtualLevel: number;
  lifetimeXp: number;
  prestigeRank: number;
  realm?: string; // present on the global (cross-realm) home-page board
}

// One ranked row of the GUILD high-score board. A guild's score is the SUM of
// every member's lifetimeXp; memberCount and topLevel are shown alongside. Like
// LeaderboardEntry it is always computed server-side (guilds live only in the
// server social DB, never in the deterministic sim), so the offline Sim ranks no
// guilds and the client only displays what the server ranked.
export interface GuildLeaderboardEntry {
  rank: number;
  name: string;
  memberCount: number;
  totalLifetimeXp: number;
  topLevel: number;
  realm?: string; // present on the global (cross-realm) board
}

// One ranked row of the DEVELOPER high-score board: contributors ranked by how
// many pull requests they have had MERGED into the open-source repo. Sourced
// from GitHub's pulls API (cached server-side), the same for every realm, so
// the offline Sim ranks none (empty page) and the client only displays what
// the server ranked. `devTier` is the rung the merged-PR count earns (1-5).
export interface DevLeaderboardEntry {
  rank: number;
  login: string;
  mergedPrs: number;
  devTier: number;
}

export interface IWorldProgressionXp {
  xp: number;
  // Post-cap progression (Max-Level XP Overflow). All server-authoritative;
  // the client renders these as-is and derives virtual level from lifetimeXp.
  lifetimeXp: number;
  prestigeRank: number;
  unlockedMilestones: string[];
  // Classic Rested XP pool (inn-rested kill-XP bonus); 0 when not rested.
  restedXp: number;
  // Flat per-craft skill tracking (#1126): one independent, additive-only skill
  // value for each of the ten crafts on the professions ring, keyed by craft id
  // (see src/sim/content/professions.ts and src/sim/professions/wheel.ts). No
  // conserved-mass economy yet, so this is a plain read of the persisted counters.
  craftSkills: Record<string, number>;
  // Post-cap progression: the realm-scoped lifetime-XP leaderboard, and the
  // opt-in cosmetic prestige action. Paged server-side (a realm can hold far
  // more than one page of max-level players); page is 0-based.
  leaderboard(page?: number, pageSize?: number): Promise<LeaderboardPage>;
  // The realm-scoped guild high-score board (guilds ranked by summed member
  // lifetime XP), paged server-side the same way as the player board. Guilds are
  // a server-only social system, so the offline Sim resolves an empty page.
  guildLeaderboard(page?: number, pageSize?: number): Promise<GuildLeaderboardPage>;
  // The developer high-score board (contributors ranked by merged PRs), sourced
  // from the repo's GitHub pulls API and paged the same way. The same data for
  // every realm; the offline Sim resolves an empty page.
  devLeaderboard(page?: number, pageSize?: number): Promise<DevLeaderboardPage>;
  prestige(): void;
}
