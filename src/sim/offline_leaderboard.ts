// The offline world's lifetime-XP board rows: every player this Sim hosts,
// ranked lifetime XP first, then level, then name (the server's fill order), in
// the LeaderboardEntry shape the server's board ships. Moved verbatim out of
// Sim.leaderboard (the monolith ratchet); the Sim keeps the thin delegate that
// pages these rows through paginateLeaderboard. Pure: no clock, no rng.
import type { LeaderboardEntry } from '../world_api';
import type { PlayerMeta } from './sim';
import { type Entity, virtualLevel } from './types';

export function offlineLeaderboardRows(
  players: ReadonlyMap<number, PlayerMeta>,
  entities: ReadonlyMap<number, Entity>,
): LeaderboardEntry[] {
  return [...players.values()]
    .map((m) => {
      const e = entities.get(m.entityId);
      return e ? { meta: m, e } : null;
    })
    .filter((x): x is { meta: PlayerMeta; e: Entity } => x !== null)
    .sort(
      (a, b) =>
        b.meta.lifetimeXp - a.meta.lifetimeXp ||
        b.e.level - a.e.level ||
        a.meta.name.localeCompare(b.meta.name),
    )
    .map(({ meta, e }, i) => ({
      rank: i + 1,
      name: meta.name,
      cls: meta.cls,
      level: e.level,
      virtualLevel: virtualLevel(meta.lifetimeXp),
      lifetimeXp: meta.lifetimeXp,
      prestigeRank: meta.prestigeRank,
      // the selected Book of Deeds title (a deed id), like the server fill
      title: meta.activeTitle,
      // The guild tag beside the name, read off the passive display field the
      // host stamps (setPlayerGuild). Omitted rather than empty, like the server
      // fill; offline that is always the case, since guilds are server-only.
      ...(e.guild ? { guild: e.guild } : {}),
    }));
}
