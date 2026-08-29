// Pure, host-agnostic view model for the signpost guild board's roster
// drill-in: the async-state discriminators plus the resolved roster in its
// display order (the Guild Master, then officers, then members, each rank
// tier ranked by lifetime XP; the server read orders the rows and the core
// pins that contract rather than re-sorting). ASYNC-FREE and DOM/i18n-free
// like guild_leaderboard_view.ts: the painter localizes the rank chips and
// formats the numbers.

import { guildTierForLifetimeXp } from '../../../sim/guild_tier';
import type { GuildRosterEntry, GuildRosterInfo } from '../../../world_api';

export interface GuildRosterRow {
  name: string;
  rank: GuildRosterEntry['rank'];
  class: string;
  level: number;
  lifetimeXp: number;
}

export type GuildRosterView =
  | { kind: 'loading'; guild: string }
  | { kind: 'error'; guild: string }
  | { kind: 'empty'; guild: string }
  | {
      kind: 'loaded';
      guild: string;
      /** The guild colour tier of the SUMMED roster XP (the same ladder the
       *  board row and the nameplate colour by). */
      tier: number;
      totalLifetimeXp: number;
      rows: GuildRosterRow[];
    };

export type GuildRosterInput =
  | { kind: 'loading'; guild: string }
  | { kind: 'error'; guild: string }
  | { kind: 'info'; guild: string; info: GuildRosterInfo | null };

/** Build the roster view. A null info (unknown guild, offline, or a failed
 *  fetch already mapped by ClientWorld) is the empty state; the server's
 *  rank-then-XP ordering is preserved verbatim. */
export function buildGuildRosterView(input: GuildRosterInput): GuildRosterView {
  if (input.kind === 'loading') return { kind: 'loading', guild: input.guild };
  if (input.kind === 'error') return { kind: 'error', guild: input.guild };
  const info = input.info;
  if (info === null || info.members.length === 0) return { kind: 'empty', guild: input.guild };
  const totalLifetimeXp = info.members.reduce((sum, m) => sum + m.lifetimeXp, 0);
  return {
    kind: 'loaded',
    guild: info.guild,
    tier: guildTierForLifetimeXp(totalLifetimeXp),
    totalLifetimeXp,
    rows: info.members.map((m) => ({
      name: m.name,
      rank: m.rank,
      class: m.class,
      level: m.level,
      lifetimeXp: m.lifetimeXp,
    })),
  };
}
