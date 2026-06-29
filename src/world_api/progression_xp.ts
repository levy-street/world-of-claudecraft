import type { LeaderboardPage } from '../sim/leaderboard_page';
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

// One ranked row of the guild high score board: guilds ranked by total member
// lifetime XP. Like LeaderboardEntry this is computed server-side and the client
// only displays it. Not part of IWorld (the in-game panel ranks characters, not
// guilds); it rides the same REST plumbing as the home-page player board.
export interface GuildLeaderboardEntry {
  rank: number;
  guild: string;
  members: number;
  topLevel: number;
  totalXp: number;
  realm?: string; // present on the global (cross-realm) home-page board
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
  // Post-cap progression: the realm-scoped lifetime-XP leaderboard, and the
  // opt-in cosmetic prestige action. Paged server-side (a realm can hold far
  // more than one page of max-level players); page is 0-based.
  leaderboard(page?: number, pageSize?: number): Promise<LeaderboardPage>;
  prestige(): void;
}
